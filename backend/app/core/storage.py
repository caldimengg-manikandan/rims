import logging
import os
from urllib.parse import urlparse

from typing import Optional, Any, List
from app.core.config import get_settings


logger = logging.getLogger(__name__)
settings = get_settings()

try:
    from supabase import create_client
    SUPABASE_AVAILABLE = True
except ImportError:
    SUPABASE_AVAILABLE = False

import functools

def _append_no_proxy_host(host: str) -> None:
    if not host:
        return
    for key in ("NO_PROXY", "no_proxy"):
        existing = os.environ.get(key, "")
        entries = [item.strip() for item in existing.split(",") if item.strip()]
        if host not in entries:
            entries.append(host)
        os.environ[key] = ",".join(entries)

def _ensure_supabase_bypasses_local_proxy() -> None:
    parsed = urlparse(settings.supabase_url or "")
    host = parsed.hostname or ""
    if not host:
        return
    _append_no_proxy_host(host)
    if host.endswith(".supabase.co"):
        _append_no_proxy_host(".supabase.co")

def resolve_bucket_and_path(bucket: str, path: str):
    if bucket == "MAIL_ATTACHMENTS":
        bucket = settings.supabase_bucket_resumes
    if path and path.startswith("MAIL_ATTACHMENTS/"):
        return settings.supabase_bucket_resumes, path.replace("MAIL_ATTACHMENTS/", "", 1)
    if path and path.startswith("resumes/"):
        return settings.supabase_bucket_resumes, path.replace("resumes/", "", 1)
    return bucket, path

# Use lru_cache for thread-safe lazy initialization
@functools.lru_cache(maxsize=1)
def get_supabase_client() -> Optional[Any]:
    if settings.supabase_url and settings.supabase_key and SUPABASE_AVAILABLE:
        try:
            _ensure_supabase_bypasses_local_proxy()
            return create_client(settings.supabase_url, settings.supabase_key)
        except Exception as e:
            logger.error(f"Failed to initialize Supabase client: {e}")
    return None

def is_local_storage() -> bool:
    """Return True if local disk storage is enabled."""
    provider = (getattr(settings, "storage_provider", None) or "local").lower().strip()
    if provider == "local":
        return True
    if provider == "supabase":
        return False
    return settings.env == "development"

def get_local_storage_base_dir() -> str:
    """Resolve the absolute root directory for local file storage."""
    raw_dir = getattr(settings, "local_storage_dir", "storage/uploads") or "storage/uploads"
    if os.path.isabs(raw_dir):
        return raw_dir
    from app.core.config import BASE_DIR
    return os.path.normpath(os.path.join(str(BASE_DIR), raw_dir))

def get_local_file_path(bucket: str, path: str) -> str:
    """Resolve an absolute path on disk for a bucket and file, preventing traversal."""
    base_dir = get_local_storage_base_dir()
    bucket, path = resolve_bucket_and_path(bucket, path)
    clean_path = path.lstrip("/\\")
    full_path = os.path.normpath(os.path.join(base_dir, bucket, clean_path))
    # Path traversal guard
    if not full_path.startswith(os.path.normpath(base_dir)):
        raise ValueError("Invalid storage path: directory traversal attempt detected")
    return full_path

def upload_file(bucket: str, path: str, content: bytes, content_type: str = "application/octet-stream") -> Optional[str]:
    original_path = path
    bucket, path = resolve_bucket_and_path(bucket, path)

    # 1. Local Storage Provider
    if is_local_storage():
        try:
            full_path = get_local_file_path(bucket, path)
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            with open(full_path, "wb") as f:
                f.write(content)
            logger.info(f"STORAGE [LOCAL]: Saved file ({len(content)} bytes) to {full_path}")
            return original_path
        except Exception as e:
            logger.error(f"STORAGE [LOCAL]: Upload failed for {bucket}/{path}: {e}")
            return None

    # 2. Supabase Cloud Storage Provider
    client = get_supabase_client()
    if client:
        try:
            client.storage.from_(bucket).upload(
                path, 
                content, 
                {"content-type": content_type, "upsert": "true"}
            )
            logger.info(f"STORAGE [SUPABASE]: Uploaded to Supabase bucket: {bucket}")
            return original_path
        except Exception as e:
            logger.error(f"STORAGE [SUPABASE]: Supabase upload failed for {bucket}/{path}: {e}")
            return None
    logger.error("Storage provider unavailable for upload")
    return None

def download_file(bucket: str, path: str) -> Optional[bytes]:
    bucket, path = resolve_bucket_and_path(bucket, path)

    # 1. Local Storage Provider
    if is_local_storage():
        try:
            full_path = get_local_file_path(bucket, path)
            if not os.path.exists(full_path):
                # Fallback: check if bucket was already prefixed in relative path
                base_dir = get_local_storage_base_dir()
                alt_path = os.path.normpath(os.path.join(base_dir, path.lstrip("/\\")))
                if os.path.exists(alt_path):
                    full_path = alt_path

            if os.path.exists(full_path):
                logger.info(f"STORAGE [LOCAL]: Reading file from {full_path}")
                with open(full_path, "rb") as f:
                    return f.read()
            logger.warning(f"STORAGE [LOCAL]: File not found: {full_path}")
            return None
        except Exception as e:
            logger.error(f"STORAGE [LOCAL]: Download failed for {bucket}/{path}: {e}")
            return None

    # 2. Supabase Cloud Storage Provider
    client = get_supabase_client()
    if client:
        try:
            logger.info(f"STORAGE [SUPABASE]: Fetching from cloud for {bucket}/{path}")
            return client.storage.from_(bucket).download(path)
        except Exception as e:
            logger.error(f"STORAGE [SUPABASE]: Cloud download failed for {bucket}/{path}: {e}")
            return None
    return None

def delete_file(bucket: str, path: str):
    bucket, path = resolve_bucket_and_path(bucket, path)

    # 1. Local Storage Provider
    if is_local_storage():
        try:
            full_path = get_local_file_path(bucket, path)
            if os.path.exists(full_path):
                os.remove(full_path)
                logger.info(f"STORAGE [LOCAL]: Deleted file {full_path}")
            return [path]
        except Exception as e:
            logger.error(f"STORAGE [LOCAL]: Delete failed for {bucket}/{path}: {e}")
            return []

    # 2. Supabase Cloud Storage Provider
    client = get_supabase_client()
    if client:
        try:
            return client.storage.from_(bucket).remove([path])
        except Exception:
            return []
    return []

def get_signed_url(bucket: str, path: str, expires_in: int = 3600) -> Optional[str]:
    if not path:
        return None
    bucket, path = resolve_bucket_and_path(bucket, path)

    # 1. Local Storage Provider
    if is_local_storage():
        base_url = (getattr(settings, "backend_base_url", None) or "http://127.0.0.1:10000").rstrip("/")
        clean_path = path.lstrip("/\\")
        return f"{base_url}/api/storage/{bucket}/{clean_path}"

    # 2. Supabase Cloud Storage Provider
    client = get_supabase_client()
    if client:
        try:
            res = client.storage.from_(bucket).create_signed_url(path, expires_in)
            if isinstance(res, dict):
                return res.get("signedURL") or res.get("signedUrl")
            elif isinstance(res, str):
                return res
        except Exception as e:
            logger.warning(f"STORAGE [SUPABASE]: Failed to get signed URL from cloud: {e}")
    return None

def get_signed_urls(bucket: str, paths: List[str], expires_in: int = 3600) -> dict:
    if not paths:
        return {}

    # 1. Local Storage Provider
    if is_local_storage():
        result_map = {}
        for p in paths:
            result_map[p] = get_signed_url(bucket, p, expires_in)
        return result_map

    # 2. Supabase Cloud Storage Provider
    client = get_supabase_client()
    result_map = {}
    if client:
        try:
            bucket_groups = {}
            for p in paths:
                b, resolved_p = resolve_bucket_and_path(bucket, p)
                bucket_groups.setdefault(b, []).append((p, resolved_p))
                
            for b, path_pairs in bucket_groups.items():
                resolved_paths = [rp for _, rp in path_pairs]
                res = client.storage.from_(b).create_signed_urls(resolved_paths, expires_in)
                if isinstance(res, list):
                    for i, item in enumerate(res):
                        if not item.get("error"):
                            orig_path = path_pairs[i][0]
                            result_map[orig_path] = item.get("signedURL") or item.get("signedUrl")
        except Exception as e:
            logger.warning(f"STORAGE [SUPABASE]: Failed to get signed URLs from cloud: {e}")
    return result_map

def get_public_url(bucket: str, path: str) -> Optional[str]:
    if not path:
        return None
    bucket, path = resolve_bucket_and_path(bucket, path)

    # 1. Local Storage Provider
    if is_local_storage():
        base_url = (getattr(settings, "backend_base_url", None) or "http://127.0.0.1:10000").rstrip("/")
        clean_path = path.lstrip("/\\")
        return f"{base_url}/api/storage/{bucket}/{clean_path}"

    # 2. Supabase Cloud Storage Provider
    client = get_supabase_client()
    if client:
        try:
            res = client.storage.from_(bucket).get_public_url(path)
            if isinstance(res, str):
                return res
        except Exception as e:
            logger.warning(f"STORAGE [SUPABASE]: Failed to get public URL from cloud: {e}")
    
    return None
