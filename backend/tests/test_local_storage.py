"""
Tests for local storage provider and file serving endpoint.
"""
import pytest
import os
from fastapi.testclient import TestClient
from app.main import app
from app.core.storage import (
    is_local_storage,
    upload_file,
    download_file,
    delete_file,
    get_signed_url,
    get_public_url,
    get_local_file_path,
)

client = TestClient(app)

def test_local_storage_active():
    assert is_local_storage() is True

def test_upload_download_delete_local_file():
    test_bucket = "resumes"
    test_path = "test_candidate/resume_test_sample.pdf"
    content = b"%PDF-1.4 Mock PDF Content For Storage Test"

    # Upload
    stored_path = upload_file(test_bucket, test_path, content, content_type="application/pdf")
    assert stored_path == test_path

    # Verify file is on disk
    disk_path = get_local_file_path(test_bucket, test_path)
    assert os.path.exists(disk_path)

    # Download
    downloaded = download_file(test_bucket, test_path)
    assert downloaded == content

    # Test URLs
    url = get_signed_url(test_bucket, test_path)
    assert "/api/storage/resumes/test_candidate/resume_test_sample.pdf" in url

    # Test HTTP serving endpoint
    res = client.get(f"/api/storage/{test_bucket}/{test_path}")
    assert res.status_code == 200
    assert res.content == content
    assert "pdf" in res.headers.get("content-type", "").lower()

    # Delete
    deleted = delete_file(test_bucket, test_path)
    assert deleted == [test_path]
    assert not os.path.exists(disk_path)
