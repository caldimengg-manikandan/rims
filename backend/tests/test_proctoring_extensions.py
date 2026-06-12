"""
Tests for proctoring extensions in models, schemas, and API endpoints.
"""

import os
import sys
import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime

# Ensure backend package is importable regardless of cwd
BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.domain.schemas import MonitoringEventCreate, MonitoringEventResponse
from app.domain.models import InterviewMonitoringEvent


def test_monitoring_event_schemas():
    # Test valid custom/enterprise proctoring event types
    valid_types = ["gaze_deviation", "low_lighting", "clipboard_violation"]
    for t in valid_types:
        create_schema = MonitoringEventCreate(
            event_type=t,
            confidence_score=0.9,
            frame_snapshot="data:image/jpeg;base64,abc",
            details="yaw: 26, pitch: 10"
        )
        assert create_schema.event_type == t
        assert create_schema.details == "yaw: 26, pitch: 10"

    # Test invalid event type raises ValidationError
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        MonitoringEventCreate(event_type="completely_invalid_type")

    # Test MonitoringEventResponse matches extended database schema
    resp_schema = MonitoringEventResponse(
        id=1,
        interview_id=10,
        event_type="gaze_deviation",
        timestamp=datetime.now(),
        confidence_score=0.95,
        frame_image_path="monitoring_frames/10/frame.jpg",
        frame_image_url="http://signed-url.com/frame.jpg",
        video_reference="offset_30s",
        is_false_positive=True,
        details="some details"
    )
    assert resp_schema.is_false_positive is True
    assert resp_schema.details == "some details"


@pytest.mark.asyncio
async def test_flag_false_positive_endpoint():
    # Mock FastAPI dependencies
    mock_db = MagicMock()
    from starlette.requests import Request
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/interviews/123/monitoring-events/456/flag-false-positive",
        "headers": [],
    }
    mock_request = Request(scope)
    
    mock_interview = MagicMock()
    mock_interview.id = 123
    
    mock_event = MagicMock()
    mock_event.id = 456
    mock_event.interview_id = 123
    mock_event.event_type = "gaze_deviation"
    mock_event.timestamp = datetime.now()
    mock_event.confidence_score = 0.9
    mock_event.frame_image_path = "path/to/frame.jpg"
    mock_event.video_reference = "offset_30s"
    mock_event.is_false_positive = False
    mock_event.details = "yaw details"

    # Set up query returns
    mock_query = MagicMock()
    mock_db.query.return_value = mock_query
    mock_query.filter.return_value = mock_query
    mock_query.first.side_effect = [mock_interview, mock_event]

    # Mock user details
    mock_user = MagicMock()
    mock_user.role = "super_admin"

    # Mock settings
    mock_settings = MagicMock()
    mock_settings.supabase_bucket_videos = "videos"
    mock_settings.enable_request_id_idempotency = False

    # Import and test the endpoint
    with patch("app.api.interviews.get_settings", return_value=mock_settings), \
         patch("app.api.interviews.settings", mock_settings), \
         patch("app.core.storage.get_signed_url", return_value="http://signed-url.com"):
        
        from app.api.interviews import flag_false_positive

        # 1. Call without body param is_false_positive (should toggle from False to True)
        response = await flag_false_positive(
            request=mock_request,
            interview_id=123,
            event_id=456,
            data={},
            current_user=mock_user,
            db=mock_db
        )

        assert mock_event.is_false_positive is True
        assert response.is_false_positive is True
        assert mock_db.commit.called
        assert mock_db.refresh.called

        # Reset mocks
        mock_db.commit.reset_mock()
        mock_db.refresh.reset_mock()
        mock_query.first.side_effect = [mock_interview, mock_event]

        # 2. Call with is_false_positive=False explicitly
        response2 = await flag_false_positive(
            request=mock_request,
            interview_id=123,
            event_id=456,
            data={"is_false_positive": False},
            current_user=mock_user,
            db=mock_db
        )

        assert mock_event.is_false_positive is False
        assert response2.is_false_positive is False
        assert mock_db.commit.called
        assert mock_db.refresh.called
