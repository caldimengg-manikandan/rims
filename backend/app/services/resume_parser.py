import pypdf
import docx
import io

def parse_pdf(file) -> str:
    """Extract text from a PDF file with scanned document detection."""
    try:
        pdf_reader = pypdf.PdfReader(file)
        text = ""
        has_pages = len(pdf_reader.pages) > 0
        for page in pdf_reader.pages:
            page_text = page.extract_text() or ""
            text += page_text + "\n"
        
        # If we have pages but absolutely no text was extracted, it's likely a scanned image
        if has_pages and not text.strip():
            return "ERROR: SCANNED_PDF_DETECTED - The document appears to be a scanned image or contains no selectable text."
            
        return text
    except Exception as e:
        return f"Error parsing PDF: {str(e)}"

def parse_docx(file) -> str:
    """Extract text from a DOCX file."""
    try:
        doc = docx.Document(file)
        text = ""
        for para in doc.paragraphs:
            text += para.text + "\n"
        return text
    except Exception as e:
        return f"Error parsing DOCX: {str(e)}"

def _decode_text_bytes(raw: bytes) -> str:
    """Decode text bytes using common encodings with safe replacement fallback."""
    for encoding in ("utf-8", "utf-8-sig", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def parse_resume(uploaded_file) -> str:
    """
    Parse uploaded resume file (PDF or DOCX) and return text content.
    Handles both FastAPI UploadFile and Streamlit UploadedFile formats.
    """
    if uploaded_file is None:
        return ""
    
    file_name = getattr(uploaded_file, "filename", None) or getattr(uploaded_file, "name", "")
    file_type = file_name.split('.')[-1].lower()
    
    # Extract inner file object for FastAPI
    file_obj = getattr(uploaded_file, "file", uploaded_file)
    
    if file_type == 'pdf':
        return parse_pdf(file_obj)
    elif file_type in ['docx', 'doc']:
        return parse_docx(file_obj)
    else:
        # Fallback for text files
        try:
            # Prefer Streamlit getvalue() when available, otherwise read synchronously from file_obj
            # (FastAPI UploadFile.read() is async, whereas file_obj = UploadFile.file is synchronous).
            if hasattr(uploaded_file, "getvalue"):
                content = uploaded_file.getvalue()
            elif hasattr(file_obj, "read"):
                content = file_obj.read()
            else:
                return ""

            if isinstance(content, bytes):
                return _decode_text_bytes(content)
            return content if isinstance(content, str) else str(content)
        except Exception as e:
            return f"Error parsing file: {str(e)}"

            
def parse_content_from_path(file_path: str) -> str:
    """Extract text from a file on disk (PDF, DOCX, or TXT)."""
    import os
    if not os.path.exists(file_path):
        return ""
    
    ext = os.path.splitext(file_path)[1].lower()
    if ext == '.pdf':
        with open(file_path, 'rb') as f:
            return parse_pdf(f)
    elif ext in ['.docx', '.doc']:
        with open(file_path, 'rb') as f:
            return parse_docx(f)
    else:
        # Default to text reading with fallback encodings
        for encoding in ['utf-8', 'utf-8-sig', 'latin-1']:
            try:
                with open(file_path, 'r', encoding=encoding) as f:
                    return f.read()
            except Exception:
                continue
    return ""
