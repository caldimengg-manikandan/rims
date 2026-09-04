"""
Local storage file serving endpoint for local development environment.
Serves files stored locally under storage/uploads/{bucket}/{file_path}.
"""
import os
import mimetypes
import logging
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse
from app.core.storage import get_local_file_path, is_local_storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/storage", tags=["Storage"])

@router.get("/{bucket}/{file_path:path}")
def serve_local_file(bucket: str, file_path: str):
    """Serve a locally stored file securely."""
    if not is_local_storage():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Local storage endpoint is only active when STORAGE_PROVIDER=local"
        )
    
    try:
        full_path = get_local_file_path(bucket, file_path)
    except ValueError as e:
        logger.warning(f"Directory traversal blocked: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file path")
    
    if not os.path.isfile(full_path):
        logger.warning(f"File not found on local storage: {full_path}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    
    content_type, _ = mimetypes.guess_type(full_path)
    return FileResponse(
        path=full_path,
        media_type=content_type or "application/octet-stream",
        filename=os.path.basename(full_path)
    )
