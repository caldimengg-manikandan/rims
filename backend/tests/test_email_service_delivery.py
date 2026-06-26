import pytest
from unittest.mock import MagicMock, AsyncMock, patch, call
import httpx
from app.services.email_service import _html_to_text, _send_via_smtp, send_email_async, _send_via_resend

def test_html_to_text_basic():
    html_input = "<h1>Hello</h1><p>This is a test <a href='https://example.com'>link</a>.</p><br>Goodbye!"
    expected = "Hello\n\nThis is a test link (https://example.com).\n\nGoodbye!"
    assert _html_to_text(html_input) == expected

def test_html_to_text_strip_tags():
    html_input = "<html><head><style>body {color: red;}</style></head><body><p>Content</p></body></html>"
    assert _html_to_text(html_input) == "Content"

@patch("smtplib.SMTP")
@patch("app.services.email_service.get_branding_dict")
@patch("app.services.email_service.settings")
def test_send_via_smtp_mime_structure(mock_settings, mock_branding, mock_smtp):
    mock_settings.env = "production"
    mock_settings.smtp_host = "smtp.test.com"
    mock_settings.smtp_port = 587
    mock_settings.smtp_user = "user@test.com"
    mock_settings.smtp_password = "password"
    mock_settings.smtp_from = "from@test.com"
    mock_branding.return_value = {"product_name": "Test System"}

    smtp_instance = MagicMock()
    mock_smtp.return_value.__enter__.return_value = smtp_instance

    html_body = "<h1>Header</h1><p>Paragraph <a href='http://test.com'>Link</a></p>"
    result = _send_via_smtp("recipient@test.com", "Test Subject", html_body)

    assert result["success"] is True
    assert result["error"] is None

    # Verify smtplib interactions
    mock_smtp.assert_called_once_with("smtp.test.com", 587, timeout=20)
    smtp_instance.starttls.assert_called_once()
    smtp_instance.login.assert_called_once_with("user@test.com", "password")
    
    # Check that send_message was called and inspect the message
    assert smtp_instance.send_message.call_count == 1
    sent_msg = smtp_instance.send_message.call_args[0][0]
    
    # Verify headers
    assert sent_msg["Subject"] == "Test Subject"
    assert "recipient@test.com" in sent_msg["To"]
    assert "from@test.com" in sent_msg["From"]
    assert "Message-ID" in sent_msg
    assert sent_msg["Message-ID"].endswith(">")

    # Verify MIME parts
    assert sent_msg.is_multipart()
    parts = list(sent_msg.walk())
    
    # Root parts should contain alternative container and text/plain + text/html parts
    html_found = False
    text_found = False
    for part in parts:
        ctype = part.get_content_type()
        if ctype == "text/html":
            html_found = True
            assert part.get_payload(decode=True).decode() == html_body
        elif ctype == "text/plain":
            text_found = True
            assert "Header" in part.get_payload(decode=True).decode()
            assert "http://test.com" in part.get_payload(decode=True).decode()

    assert html_found
    assert text_found

@pytest.mark.asyncio
@patch("app.services.email_service.settings")
async def test_send_via_resend_payload_and_headers(mock_settings):
    mock_settings.resend_api_key = "re_12345"
    mock_settings.resend_from = "from@test.com"
    
    # Mocking httpx client
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 200
    mock_response.text = "Accepted"
    
    post_mock = AsyncMock(return_value=mock_response)
    
    client_mock = MagicMock(spec=httpx.AsyncClient)
    client_mock.post = post_mock
    
    # Use patch to replace httpx.AsyncClient and make __aenter__ return client_mock
    with patch("httpx.AsyncClient") as mock_async_client:
        mock_async_client.return_value.__aenter__.return_value = client_mock
        
        html_body = "<h1>Hello</h1><p>Click <a href='http://test.com'>here</a></p>"
        result = await _send_via_resend("recipient@test.com", "Test Resend", html_body, idempotency_key="idemp_key_123")
        
        assert result["success"] is True
        assert result["error"] is None
        
        # Verify client was called with correct payload and headers
        mock_async_client.assert_called_once_with(timeout=20.0)
        
        # Extract post call arguments
        called_args, called_kwargs = post_mock.call_args
        assert called_args[0] == "https://api.resend.com/emails"
        
        headers = called_kwargs["headers"]
        assert headers["Authorization"] == "Bearer re_12345"
        assert headers["Idempotency-Key"] == "idemp_key_123"
        
        payload = called_kwargs["json"]
        assert payload["to"] == "recipient@test.com"
        assert payload["subject"] == "Test Resend"
        assert payload["html"] == html_body
        assert "Hello" in payload["text"]
        assert "here (http://test.com)" in payload["text"]

@pytest.mark.asyncio
@patch("app.services.email_service.asyncio.sleep", new_callable=AsyncMock)
@patch("app.services.email_service._send_via_smtp_helper", new_callable=AsyncMock)
async def test_send_email_async_retries_on_failure(mock_smtp_helper, mock_sleep):
    mock_smtp_helper.return_value = {"success": False, "error": "Connection lost", "deferred": False}
    
    result = await send_email_async(
        to_email="recipient@test.com",
        subject="Retry Test",
        html_body="<p>Test</p>",
        provider="smtp"
    )
    
    assert result["success"] is False
    assert result["error"] == "Connection lost"
    assert mock_smtp_helper.call_count == 3
    assert mock_sleep.call_count == 2
    mock_sleep.assert_has_calls([call(1.0), call(5.0)])

@pytest.mark.asyncio
@patch("app.services.email_service.asyncio.sleep", new_callable=AsyncMock)
@patch("app.services.email_service._send_via_smtp_helper", new_callable=AsyncMock)
async def test_send_email_async_no_retry_on_deferred(mock_smtp_helper, mock_sleep):
    mock_smtp_helper.return_value = {"success": False, "error": "5.4.5 sending limit exceeded", "deferred": True}
    
    result = await send_email_async(
        to_email="recipient@test.com",
        subject="Deferred Test",
        html_body="<p>Test</p>",
        provider="smtp"
    )
    
    assert result["success"] is False
    assert result["deferred"] is True
    assert mock_smtp_helper.call_count == 1
    assert mock_sleep.call_count == 0

@pytest.mark.asyncio
@patch("app.services.email_service.settings")
@patch("app.services.email_service._send_via_smtp_helper", new_callable=AsyncMock)
@patch("app.services.email_service._send_via_resend", new_callable=AsyncMock)
async def test_send_email_async_fallback_resend_to_smtp(mock_resend, mock_smtp_helper, mock_settings):
    mock_settings.smtp_host = "smtp.test.com"
    mock_settings.smtp_user = "user@test.com"
    mock_settings.smtp_password = "password"
    mock_settings.smtp_from = "from@test.com"
    
    mock_resend.return_value = {"success": False, "error": "Resend API error"}
    mock_smtp_helper.return_value = {"success": True, "error": None, "provider": "smtp"}
    
    result = await send_email_async(
        to_email="recipient@test.com",
        subject="Fallback Test",
        html_body="<p>Test</p>",
        provider="resend"
    )
    
    assert result["success"] is True
    assert result["provider"] == "smtp"
    mock_resend.assert_called_once()
    mock_smtp_helper.assert_called_once()

@pytest.mark.asyncio
@patch("app.infrastructure.database.SessionLocal")
@patch("app.services.email_service.send_email_async", new_callable=AsyncMock)
async def test_execute_email_with_retries_idempotency_prevents_duplicate(mock_send_email, mock_session_local):
    db_instance = MagicMock()
    mock_session_local.return_value.__enter__.return_value = db_instance
    
    mock_result = MagicMock()
    mock_result.rowcount = 0
    db_instance.execute.return_value = mock_result
    
    mock_app = MagicMock()
    mock_app.id = 123
    mock_app.email_status = "processing"
    
    from app.services.email_service import execute_email_with_retries
    res = await execute_email_with_retries(
        to_email="candidate@test.com",
        subject="Job Update",
        body="<p>Update</p>",
        application=mock_app
    )
    
    assert res is True
    assert mock_send_email.call_count == 0

@pytest.mark.asyncio
@patch("app.infrastructure.database.SessionLocal")
@patch("app.services.email_service.send_email_async", new_callable=AsyncMock)
async def test_execute_email_with_retries_idempotency_success(mock_send_email, mock_session_local):
    db_instance = MagicMock()
    mock_session_local.return_value.__enter__.return_value = db_instance
    
    mock_result = MagicMock()
    mock_result.rowcount = 1
    db_instance.execute.return_value = mock_result
    
    mock_send_email.return_value = {"success": True, "error": None}
    
    mock_app = MagicMock()
    mock_app.id = 123
    mock_app.email_status = "none"
    
    from app.services.email_service import execute_email_with_retries
    res = await execute_email_with_retries(
        to_email="candidate@test.com",
        subject="Job Update",
        body="<p>Update</p>",
        application=mock_app
    )
    
    assert res is True
    assert mock_send_email.call_count == 1
