import os
import io
from jinja2.sandbox import SandboxedEnvironment as Environment
from jinja2 import select_autoescape
from xhtml2pdf import pisa
from datetime import datetime
from app.core.config import get_settings
import logging

logger = logging.getLogger(__name__)
settings = get_settings()

def generate_offer_letter_pdf(template_html: str, data: dict, output_path: str):
    """
    Generates a PDF from an HTML template string and data dictionary.
    Writes result to output_path on disk.
    """
    try:
        # C-22: Enable autoescaping for candidate-supplied data to prevent XSS in PDF
        env = Environment(autoescape=select_autoescape(['html', 'xml']))
        template = env.from_string(template_html)
        rendered_html = template.render(**data)
        
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        with open(output_path, "wb") as result_file:
            pisa_status = pisa.CreatePDF(rendered_html, dest=result_file)
            
        if pisa_status.err:
            logger.error(f"Error generating PDF: {pisa_status.err}")
            return False
            
        return True
    except Exception as e:
        logger.error(f"Failed to generate offer letter PDF: {e}")
        return False


def generate_offer_letter_pdf_bytes(template_html: str, data: dict) -> bytes:
    """
    Renders the Jinja2 HTML template with the given data and converts it to a
    PDF entirely in-memory using xhtml2pdf/pisa.

    Returns the raw PDF bytes on success.
    Raises RuntimeError if the PDF engine reports errors.
    """
    # C-22: Enable autoescaping for candidate-supplied data to prevent XSS in PDF
    env = Environment(autoescape=select_autoescape(['html', 'xml']))
    template = env.from_string(template_html)
    rendered_html = template.render(**data)

    buffer = io.BytesIO()
    pisa_status = pisa.CreatePDF(rendered_html, dest=buffer)

    if pisa_status.err:
        raise RuntimeError(f"xhtml2pdf reported errors while generating offer letter PDF: {pisa_status.err}")

    return buffer.getvalue()

def _fetch_logo_as_base64(url: str) -> str:
    """
    Fetch a logo URL and return a data URI (base64).
    Falls back to the original URL on any failure.
    """
    import base64
    import urllib.request
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            logo_bytes = resp.read()
            content_type = resp.headers.get_content_type() or "image/png"
            logo_b64 = base64.b64encode(logo_bytes).decode("utf-8")
            return f"data:{content_type};base64,{logo_b64}"
    except Exception as fetch_err:
        logger.warning(f"Failed to fetch logo from {url} for base64 embed: {fetch_err}")
        return url


def get_offer_letter_data(candidate_name, job_role, department, joining_date, company_name, logo_url, hr_email, hr_name="", hr_phone="", company_address=""):
    """ Helper to structure offer letter data """
    import base64
    resolved_logo_url = logo_url

    if logo_url:
        if logo_url.startswith("data:"):
            # Already a data URI — use as-is
            resolved_logo_url = logo_url

        elif logo_url.startswith("/"):
            # Relative path — try local filesystem first (dev), then HTTP fetch (live)
            clean_path = logo_url
            if clean_path.startswith("/calrims"):
                clean_path = clean_path.replace("/calrims", "", 1)
            local_logo_path = os.path.abspath(
                os.path.join(os.path.dirname(__file__), "..", "..", "..", "frontend", "public", clean_path.lstrip("/"))
            )
            if os.path.exists(local_logo_path):
                try:
                    with open(local_logo_path, "rb") as logo_file:
                        logo_bytes = logo_file.read()
                        logo_base64 = base64.b64encode(logo_bytes).decode("utf-8")
                        resolved_logo_url = f"data:image/png;base64,{logo_base64}"
                except Exception as logo_err:
                    logger.warning(f"Failed to read local logo file in service: {logo_err}")

            # Local file not found (live server) — build absolute URL and fetch as base64
            if resolved_logo_url and resolved_logo_url.startswith("/"):
                frontend_url = (os.environ.get("FRONTEND_BASE_URL") or settings.frontend_base_url or "").rstrip("/")
                absolute_url = f"{frontend_url}{logo_url}"
                resolved_logo_url = _fetch_logo_as_base64(absolute_url)

        elif logo_url.startswith("http://") or logo_url.startswith("https://"):
            # Already an absolute URL — fetch as base64 so about:blank preview works
            resolved_logo_url = _fetch_logo_as_base64(logo_url)

    return {
        "candidate_name": candidate_name,
        "job_role": job_role,
        "department": department,
        "joining_date": joining_date.strftime("%B %d, %Y") if joining_date else "TBD",
        "company_name": company_name,
        "logo": resolved_logo_url,       # legacy compat
        "logo_url": resolved_logo_url,   # new template variable
        "hr_email": hr_email,
        "hr_name": hr_name,
        "hr_phone": hr_phone,
        "company_address": company_address,
        "offer_date": datetime.now().strftime("%B %d, %Y")
    }
