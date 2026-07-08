import { NextRequest, NextResponse } from "next/server"
import puppeteer from "puppeteer"
import DOMPurify from 'isomorphic-dompurify';

// Global concurrency counter (persists across requests in a Node.js process)
let activeGenerations = 0;
const MAX_CONCURRENT_GENERATIONS = 3;
const MAX_PAYLOAD_SIZE = 5 * 1024 * 1024; // 5MB limit

export async function POST(req: NextRequest) {
  // Security check: Validate Authorization header against PDF_GENERATION_SECRET only.
  // JWT_SECRET must NOT be used as a fallback — doing so would expose the app's primary signing key.
  const authHeader = req.headers.get("authorization")
  const pdfSecret = process.env.PDF_GENERATION_SECRET

  // Always require PDF_GENERATION_SECRET explicitly. Fail closed if missing.
  if (!pdfSecret) {
    console.error("CRITICAL: PDF_GENERATION_SECRET is not set. Set it in your environment variables to enable PDF generation.");
    return NextResponse.json({ error: "Server configuration error: PDF_GENERATION_SECRET is not configured" }, { status: 500 })
  }

  if (!authHeader || !authHeader.startsWith("Bearer ") || authHeader.substring(7) !== pdfSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Check payload size via header first
  const contentLength = req.headers.get("content-length")
  if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_SIZE) {
    return NextResponse.json({ error: "Payload too large (Max 5MB)" }, { status: 413 })
  }

  if (activeGenerations >= MAX_CONCURRENT_GENERATIONS) {
    return NextResponse.json({ error: "Too many concurrent PDF generation requests. Please try again later." }, { status: 429 })
  }

  let browser = null
  try {
    activeGenerations++;

    const textPayload = await req.text()
    if (textPayload.length > MAX_PAYLOAD_SIZE) {
       return NextResponse.json({ error: "Payload too large (Max 5MB)" }, { status: 413 })
    }

    let html;
    try {
      const parsed = JSON.parse(textPayload);
      html = parsed.html;
    } catch (e) {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 })
    }

    if (!html) {
      return NextResponse.json({ error: "No HTML content provided" }, { status: 400 })
    }

    // Sanitize HTML strictly to prevent SSRF and XSS
    // We allow style elements and images because they are needed for PDF rendering.
    const sanitizedHtml = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'b', 'i', 'strong', 'em', 'strike',
        'br', 'hr', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'ul', 'ol', 'li', 'img',
        'style', 'html', 'body', 'head', 'title', 'center', 'section', 'article', 'main', 'header', 'footer'
      ],
      ALLOWED_ATTR: [
        'style', 'class', 'id', 'src', 'alt', 'width', 'height', 'border', 'cellpadding', 'cellspacing', 'color'
      ],
      FORCE_BODY: false,
      WHOLE_DOCUMENT: true
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout after 30 seconds")), 30000)
    );

    const generationPromise = (async () => {
      // Launch puppeteer with system chromium
      const b = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--font-render-hinting=none",
          "--disable-crash-reporter",
          "--no-crashpad"
        ],
        headless: true,
        userDataDir: "/tmp/chrome-user-data",
      })
      browser = b

      const page = await b.newPage()

      // Enable console & request logging for debugging
      page.on('console', msg => console.log('PUPPETEER CONSOLE:', msg.text()));
      page.on('pageerror', err => console.error('PUPPETEER PAGEERROR:', err));
      page.on('requestfailed', request => {
        console.error(`PUPPETEER REQUEST_FAILED: ${request.url()} - ${request.failure()?.errorText}`);
      });

      // Set viewport to A4 dimensions at 96 DPI for layout calculation
      await page.setViewport({
        width: 794,
        height: 1123,
        deviceScaleFactor: 2, // Higher scale factor for better quality rendering (shadows, paths)
      })

      // Inject necessary CSS adjustments for printing
      const styledHtml = `
        <style>
          body {
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
            display: block !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        </style>
        ${sanitizedHtml}
      `

      // Set content and wait for network to be idle (important for fonts/images from external URLs)
      try {
        await page.setContent(styledHtml, {
          waitUntil: "networkidle2",
          timeout: 10000, // 10-second limit to prevent hanging on hot-reload/WS connections
        })
      } catch (loadError: any) {
        console.warn("Puppeteer content loading timed out, proceeding to generate PDF anyway:", loadError.message)
      }

      // Generate PDF - Respect CSS page size
      const pdfBuffer = await page.pdf({
        printBackground: true,
        margin: {
          top: "0px",
          right: "0px",
          bottom: "0px",
          left: "0px",
        },
        preferCSSPageSize: true,
      })

      await b.close()
      browser = null
      return pdfBuffer
    })();

    const pdfBuffer = await Promise.race([generationPromise, timeoutPromise])

    // Return the PDF as response
    return new NextResponse(pdfBuffer as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="offer-letter.pdf"',
        "Content-Length": pdfBuffer.length.toString(),
      },
    })
  } catch (error: any) {
    console.error("PDF Generation Error:", error)
    if (browser) await (browser as any).close()
    return NextResponse.json({ error: `Failed to generate PDF: ${error.message}` }, { status: 500 })
  } finally {
    activeGenerations--;
  }
}
