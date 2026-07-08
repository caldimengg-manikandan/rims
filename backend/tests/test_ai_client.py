import pytest
from unittest.mock import AsyncMock, patch
from groq import RateLimitError, APIStatusError
from app.services.ai_client import AIClient
import httpx

@pytest.mark.asyncio
async def test_ai_client_retry_rate_limit():
    # Mock AsyncGroq client
    mock_response = httpx.Response(429, request=httpx.Request("POST", "https://api.groq.com"))
    
    with patch("app.services.ai_client.AsyncGroq") as mock_groq_class:
        mock_client = AsyncMock()
        mock_groq_class.return_value = mock_client
        
        # Instantiate AIClient
        client = AIClient()
        client.disabled = False
        client.client = mock_client
        
        # Simulate two failures followed by one success
        mock_completion = AsyncMock()
        mock_completion.choices = [AsyncMock(message=AsyncMock(content="Success response"))]
        
        # Raise RateLimitError on first two attempts, succeed on third
        mock_client.chat.completions.create.side_effect = [
            RateLimitError("Rate limit", response=mock_response, body=None),
            RateLimitError("Rate limit", response=mock_response, body=None),
            mock_completion
        ]
        
        result = await client.generate("test prompt")
        assert result == "Success response"
        assert mock_client.chat.completions.create.call_count == 3


@pytest.mark.asyncio
async def test_ai_client_no_retry_on_bad_request():
    mock_response = httpx.Response(400, request=httpx.Request("POST", "https://api.groq.com"))
    
    with patch("app.services.ai_client.AsyncGroq") as mock_groq_class:
        mock_client = AsyncMock()
        mock_groq_class.return_value = mock_client
        
        client = AIClient()
        client.disabled = False
        client.client = mock_client
        
        # Raise 400 Bad Request APIStatusError immediately
        mock_client.chat.completions.create.side_effect = [
            APIStatusError("Bad Request", response=mock_response, body=None)
        ]
        
        result = await client.generate("test prompt")
        # Should return "AI_DISABLED" because it fails immediately without retrying
        assert result == "AI_DISABLED"
        assert mock_client.chat.completions.create.call_count == 1
