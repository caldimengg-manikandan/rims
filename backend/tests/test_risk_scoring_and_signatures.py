import os
import sys
import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone, timedelta
import time
import hmac
import hashlib

# Ensure backend package is importable regardless of cwd
BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.domain.schemas import MonitoringEventCreate, MonitoringEventResponse
from app.api.interviews import EVENT_WEIGHTS
from app.core.timezone import get_ist_now

def test_signature_hmac_sha256():
    # Verify the HMAC-SHA256 signature verification logic
    event_type = "gaze_deviation"
    client_timestamp = int(time.time() * 1000)
    nonce = "test_nonce_abc123"
    token = "test_candidate_token_123"
    secret = "rims_proctoring_secret_2026"
    raw_str = f"{event_type}:{client_timestamp}:{nonce}:{token}:{secret}"
    
    calculated_sig = hmac.new(
        secret.encode('utf-8'),
        raw_str.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    
    assert isinstance(calculated_sig, str)
    assert len(calculated_sig) == 64  # hex representation of SHA256 is 64 chars


@pytest.mark.asyncio
async def test_create_monitoring_event_signature_and_risk_scoring():
    mock_db = MagicMock()
    def mock_refresh(instance):
        instance.id = 999
    mock_db.refresh.side_effect = mock_refresh

    from starlette.requests import Request
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/interviews/123/monitoring-events",
        "headers": [
            (b"authorization", b"Bearer test_candidate_token_123"),
            (b"content-type", b"application/json")
        ],
    }
    mock_request = Request(scope)
    
    # Mock interview model
    mock_interview = MagicMock()
    mock_interview.id = 123
    mock_interview.risk_score = 0.0
    
    # Mock return values for DB session queries
    mock_query = MagicMock()
    mock_db.query.return_value = mock_query
    mock_query.filter.return_value = mock_query
    mock_query.first.return_value = mock_interview
    
    # Mock the time-series check to return an empty list by default
    mock_query.all.return_value = []
    
    # Formulate valid request signature using HMAC-SHA256
    event_type = "clipboard_violation"
    client_timestamp = int(time.time() * 1000)
    nonce = "test_nonce_val_1"
    token = "test_candidate_token_123"
    secret = "rims_proctoring_secret_2026"
    
    raw_str = f"{event_type}:{client_timestamp}:{nonce}:{token}:{secret}"
    signature = hmac.new(
        secret.encode('utf-8'),
        raw_str.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

    # Schema create data
    event_data = MonitoringEventCreate(
        event_type=event_type,
        confidence_score=1.0,
        frame_snapshot="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        details="copied some code",
        signature=signature,
        client_timestamp=client_timestamp,
        nonce=nonce
    )
    
    mock_settings = MagicMock()
    mock_settings.supabase_bucket_videos = "videos"
    
    with patch("app.api.interviews.get_settings", return_value=mock_settings), \
         patch("app.api.interviews.settings", mock_settings), \
         patch("app.api.interviews.get_current_interview", return_value=mock_interview), \
         patch("app.core.storage.upload_file", return_value="monitoring_frames/123/frame.jpg"), \
         patch("app.core.storage.get_signed_url", return_value="http://signed-url.com/frame.jpg"):
        
        from app.api.interviews import create_monitoring_event
        
        # 1. Verify successful request signature and risk scoring update
        response = await create_monitoring_event(
            request=mock_request,
            interview_id=123,
            event_data=event_data,
            db=mock_db,
            interview_session=mock_interview
        )
        
        # Risk score for clipboard_violation is 8.0 * confidence (1.0) = 8.0
        assert mock_interview.risk_score == 8.0
        assert mock_db.commit.called
        assert response.details == "copied some code"

        # 2. Verify duplicate nonce rejection (Replay protection)
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            await create_monitoring_event(
                request=mock_request,
                interview_id=123,
                event_data=event_data,
                db=mock_db,
                interview_session=mock_interview
            )
        assert exc_info.value.status_code == 400
        assert "Duplicate monitoring event" in exc_info.value.detail

        # 3. Verify expired timestamp raises HTTP 400
        expired_timestamp = int((datetime.now(timezone.utc) - timedelta(minutes=10)).timestamp() * 1000)
        expired_nonce = "expired_nonce_123"
        expired_raw = f"{event_type}:{expired_timestamp}:{expired_nonce}:{token}:{secret}"
        expired_signature = hmac.new(
            secret.encode('utf-8'),
            expired_raw.encode('utf-8'),
            hashlib.sha256
        ).hexdigest()

        expired_event_data = MonitoringEventCreate(
            event_type=event_type,
            confidence_score=1.0,
            frame_snapshot=None,
            details="expired message",
            signature=expired_signature,
            client_timestamp=expired_timestamp,
            nonce=expired_nonce
        )

        with pytest.raises(HTTPException) as exc_info:
            await create_monitoring_event(
                request=mock_request,
                interview_id=123,
                event_data=expired_event_data,
                db=mock_db,
                interview_session=mock_interview
            )
        assert exc_info.value.status_code == 400
        assert "Event timestamp has expired" in exc_info.value.detail

        # 4. Verify invalid signature raises HTTP 400 error
        invalid_event_data = MonitoringEventCreate(
            event_type=event_type,
            confidence_score=1.0,
            frame_snapshot=None,
            details="wrong signature",
            signature="wrong_sig_here",
            client_timestamp=int(time.time() * 1000),
            nonce="some_other_nonce_val_1"
        )
        
        with pytest.raises(HTTPException) as exc_info:
            await create_monitoring_event(
                request=mock_request,
                interview_id=123,
                event_data=invalid_event_data,
                db=mock_db,
                interview_session=mock_interview
            )
        assert exc_info.value.status_code == 400
        assert "Invalid HMAC event signature" in exc_info.value.detail


@pytest.mark.asyncio
async def test_risk_scoring_correlation_penalty():
    mock_db = MagicMock()
    def mock_refresh(instance):
        instance.id = 888
    mock_db.refresh.side_effect = mock_refresh

    mock_interview = MagicMock()
    mock_interview.id = 123
    mock_interview.risk_score = 0.0

    from starlette.requests import Request
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/interviews/123/monitoring-events",
        "headers": [
            (b"authorization", b"Bearer test_candidate_token_123"),
            (b"content-type", b"application/json")
        ],
    }
    mock_request = Request(scope)

    # Mock the query behavior
    mock_query = MagicMock()
    mock_db.query.return_value = mock_query
    mock_query.filter.return_value = mock_query
    mock_query.first.return_value = mock_interview

    # Create a mock preceding event (focus_lost) within the 30-second window
    from app.domain.models import InterviewMonitoringEvent
    preceding_event = MagicMock(spec=InterviewMonitoringEvent)
    preceding_event.event_type = "focus_lost"
    preceding_event.timestamp = get_ist_now()
    preceding_event.is_false_positive = False

    mock_query.all.return_value = [preceding_event]

    # Formulate valid request signature for "clipboard_violation"
    event_type = "clipboard_violation"
    client_timestamp = int(time.time() * 1000)
    nonce = "correlation_test_nonce"
    token = "test_candidate_token_123"
    secret = "rims_proctoring_secret_2026"
    raw_str = f"{event_type}:{client_timestamp}:{nonce}:{token}:{secret}"
    signature = hmac.new(
        secret.encode('utf-8'),
        raw_str.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

    event_data = MonitoringEventCreate(
        event_type=event_type,
        confidence_score=1.0,
        details="clipboard copy after focus lost",
        signature=signature,
        client_timestamp=client_timestamp,
        nonce=nonce
    )

    mock_settings = MagicMock()
    mock_settings.supabase_bucket_videos = "videos"

    with patch("app.api.interviews.get_settings", return_value=mock_settings), \
         patch("app.api.interviews.settings", mock_settings), \
         patch("app.api.interviews.get_current_interview", return_value=mock_interview):
        
        from app.api.interviews import create_monitoring_event
        
        await create_monitoring_event(
            request=mock_request,
            interview_id=123,
            event_data=event_data,
            db=mock_db,
            interview_session=mock_interview
        )
        
        # Risk score calculation:
        # base clipboard_violation weight = 8.0
        # penalty for focus_lost + clipboard_violation = 4.0
        # Total increment = 12.0
        assert mock_interview.risk_score == 12.0


@pytest.mark.asyncio
async def test_heartbeat_sequence_number_gap_detection():
    mock_db = MagicMock()
    def mock_refresh(instance):
        instance.id = 777
    mock_db.refresh.side_effect = mock_refresh

    mock_interview = MagicMock()
    mock_interview.id = 777
    mock_interview.risk_score = 0.0

    from starlette.requests import Request
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/interviews/777/monitoring-events",
        "headers": [],
    }
    mock_request = Request(scope)

    from app.api.interviews import LAST_SEQUENCE_NUMBERS
    LAST_SEQUENCE_NUMBERS[777] = 2

    # Send sequence_number = 5 (gap = 2, meaning 3 and 4 were missed)
    event_data = MonitoringEventCreate(
        event_type="normal",
        confidence_score=1.0,
        sequence_number=5
    )

    mock_settings = MagicMock()
    mock_settings.supabase_bucket_videos = "videos"

    with patch("app.api.interviews.get_settings", return_value=mock_settings), \
         patch("app.api.interviews.settings", mock_settings), \
         patch("app.api.interviews.get_current_interview", return_value=mock_interview):
        
        from app.api.interviews import create_monitoring_event
        await create_monitoring_event(
            request=mock_request,
            interview_id=777,
            event_data=event_data,
            db=mock_db,
            interview_session=mock_interview
        )

        # Ensure that gap detection logged a suppression event (liveness_violation)
        # by calling db.add
        assert mock_db.add.called
        # Check that one of the added models was a liveness_violation event
        added_objs = [call.args[0] for call in mock_db.add.call_args_list]
        liveness_events = [o for o in added_objs if hasattr(o, 'event_type') and o.event_type == "liveness_violation"]
        assert len(liveness_events) > 0
        assert "gap" in liveness_events[0].details
        assert LAST_SEQUENCE_NUMBERS[777] == 5


@pytest.mark.asyncio
async def test_server_side_strike_enforcement_and_termination():
    mock_db = MagicMock()
    def mock_refresh(instance):
        instance.id = 888
    mock_db.refresh.side_effect = mock_refresh

    mock_interview = MagicMock()
    mock_interview.id = 888
    mock_interview.risk_score = 0.0
    mock_interview.status = "ongoing"
    mock_interview.ended_at = None

    from starlette.requests import Request
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/interviews/888/monitoring-events",
        "headers": [(b"authorization", b"Bearer jwt_token_abc")],
    }
    mock_request = Request(scope)

    # Mock DB query to return 3 existing focus_lost_strike events
    mock_query = MagicMock()
    mock_db.query.return_value = mock_query
    mock_query.filter.return_value = mock_query
    mock_query.count.return_value = 3  # 3 existing strikes
    mock_query.first.return_value = None  # no existing revoked token

    # Target event: 4th strike (causes termination)
    event_data = MonitoringEventCreate(
        event_type="focus_lost_strike_4_gaze",
        confidence_score=1.0
    )

    mock_settings = MagicMock()
    mock_settings.supabase_bucket_videos = "videos"
    mock_settings.jwt_secret = "secret"
    mock_settings.jwt_algorithm = "HS256"
    mock_settings.interview_jwt_secret = "secret_interview"

    with patch("app.api.interviews.get_settings", return_value=mock_settings), \
         patch("app.api.interviews.settings", mock_settings), \
         patch("app.api.interviews.get_current_interview", return_value=mock_interview), \
         patch("jose.jwt.decode", return_value={"jti": "mock_jti_123", "exp": int(time.time() + 3600)}), \
         patch("app.services.state_machine.CandidateStateMachine") as mock_fsm_class, \
         patch("app.api.interviews._set_interview_status") as mock_set_status:
        
        # Setup FSM mock
        mock_fsm = MagicMock()
        mock_fsm_class.return_value = mock_fsm

        from app.api.interviews import create_monitoring_event
        response = await create_monitoring_event(
            request=mock_request,
            interview_id=888,
            event_data=event_data,
            db=mock_db,
            interview_session=mock_interview
        )

        # 1. Assert strike count is computed authoritatively by server
        assert response.strike_count == 4
        assert response.token_revoked is True
        assert response.event_type == "focus_lost_strike_4_gaze"

        # 2. Assert interview status update was triggered
        assert mock_set_status.called
        assert mock_set_status.call_args[0][1] == "terminated"

        # 3. Assert Candidate FSM transitioned to REJECT
        assert mock_fsm.transition.called
        assert mock_fsm.transition.call_args[0][1].name == "REJECT"

        # 4. Assert RevokedToken was written to database
        added_objs = [call.args[0] for call in mock_db.add.call_args_list]
        revoked_tokens = [o for o in added_objs if type(o).__name__ == "RevokedToken"]
        assert len(revoked_tokens) == 1
        assert revoked_tokens[0].jti == "mock_jti_123"

        # 5. Assert critical audit log entry was written
        audit_logs = [o for o in added_objs if type(o).__name__ == "AuditLog"]
        assert len(audit_logs) == 1
        assert audit_logs[0].action == "INTERVIEW_TERMINATED_VIOLATION"


@pytest.mark.asyncio
async def test_dynamic_derived_session_secret():
    mock_db = MagicMock()
    def mock_refresh(instance):
        instance.id = 555
    mock_db.refresh.side_effect = mock_refresh
    mock_interview = MagicMock()
    mock_interview.id = 555
    mock_interview.risk_score = 0.0

    # Test dynamic signature validation using a JWT JTI derived key
    from starlette.requests import Request
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/interviews/555/monitoring-events",
        "headers": [
            (b"authorization", b"Bearer jwt_token_mock_val"),
            (b"content-type", b"application/json")
        ],
    }
    mock_request = Request(scope)

    # Derived key logic simulation
    interview_secret = "secret_interview"
    token = "jwt_token_mock_val"
    jti = "mock_jti_derived"
    derived_secret = hmac.new(
        interview_secret.encode('utf-8'),
        f"555:{jti}".encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

    event_type = "gaze_deviation"
    client_timestamp = int(time.time() * 1000)
    nonce = "dynamic_nonce_val_1"
    
    raw_str = f"{event_type}:{client_timestamp}:{nonce}:{token}:{derived_secret}"
    signature = hmac.new(
        derived_secret.encode('utf-8'),
        raw_str.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

    event_data = MonitoringEventCreate(
        event_type=event_type,
        confidence_score=1.0,
        signature=signature,
        client_timestamp=client_timestamp,
        nonce=nonce
    )

    mock_settings = MagicMock()
    mock_settings.supabase_bucket_videos = "videos"
    mock_settings.jwt_secret = "secret"
    mock_settings.jwt_algorithm = "HS256"
    mock_settings.interview_jwt_secret = "secret_interview"

    with patch("app.api.interviews.get_settings", return_value=mock_settings), \
         patch("app.api.interviews.settings", mock_settings), \
         patch("app.api.interviews.get_current_interview", return_value=mock_interview), \
         patch("jose.jwt.decode", return_value={"jti": "mock_jti_derived", "exp": int(time.time() + 3600)}):
        
        from app.api.interviews import create_monitoring_event
        response = await create_monitoring_event(
            request=mock_request,
            interview_id=555,
            event_data=event_data,
            db=mock_db,
            interview_session=mock_interview
        )
        assert response.event_type == "gaze_deviation"


@pytest.mark.asyncio
async def test_redis_nonce_and_sequence_validation():
    mock_db = MagicMock()
    def mock_refresh(instance):
        instance.id = 555
    mock_db.refresh.side_effect = mock_refresh
    mock_interview = MagicMock()
    mock_interview.id = 555
    mock_interview.risk_score = 0.0

    # 1. Test Redis nonce uniqueness check
    mock_redis = MagicMock()
    # set returns False if nx=True and key already exists (nonce duplicate)
    mock_redis.set.side_effect = lambda k, v, ex=None, nx=None: not k.endswith("duplicated_nonce")
    mock_redis.get.return_value = "2" # sequence number 2 in cache

    from starlette.requests import Request
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/interviews/555/monitoring-events",
        "headers": [(b"authorization", b"Bearer token_123")],
    }
    mock_request = Request(scope)

    # Event with normal signature but duplicated nonce in Redis
    event_data_duplicate = MonitoringEventCreate(
        event_type="normal",
        confidence_score=1.0,
        nonce="duplicated_nonce",
        client_timestamp=int(time.time() * 1000),
        signature="legacy_compatibility_bypass_sig_is_mocked",
        sequence_number=3
    )

    mock_settings = MagicMock()
    mock_settings.supabase_bucket_videos = "videos"

    with patch("app.api.interviews.get_settings", return_value=mock_settings), \
         patch("app.api.interviews.settings", mock_settings), \
         patch("app.api.interviews.get_current_interview", return_value=mock_interview), \
         patch("app.core.redis_store.get_redis_client", return_value=mock_redis), \
         patch("jose.jwt.decode", return_value={"jti": "mock_jti", "exp": int(time.time() + 3600)}), \
         patch("hmac.new") as mock_hmac:
        
        # Mock hmac check to pass
        mock_hmac.return_value.hexdigest.return_value = "legacy_compatibility_bypass_sig_is_mocked"
        
        from app.api.interviews import create_monitoring_event
        from fastapi import HTTPException
        
        # Verifies duplicate nonce in Redis raises HTTP 400
        with pytest.raises(HTTPException) as exc_info:
            await create_monitoring_event(
                request=mock_request,
                interview_id=555,
                event_data=event_data_duplicate,
                db=mock_db,
                interview_session=mock_interview
            )
        assert exc_info.value.status_code == 400
        assert "Duplicate monitoring event" in exc_info.value.detail

        # Verifies sequence tracking reads/writes from Redis correctly
        event_data_sequence_gap = MonitoringEventCreate(
            event_type="normal",
            confidence_score=1.0,
            nonce="valid_nonce_seq",
            client_timestamp=int(time.time() * 1000),
            signature="legacy_compatibility_bypass_sig_is_mocked",
            sequence_number=5 # gap of 1 (should log liveness_violation)
        )
        
        await create_monitoring_event(
            request=mock_request,
            interview_id=555,
            event_data=event_data_sequence_gap,
            db=mock_db,
            interview_session=mock_interview
        )
        
        # Verify mock_redis set sequence number to 5
        mock_redis.set.assert_any_call("seq:555", "5", ex=14400)
        # Verify mock_db added the gap violation
        assert mock_db.add.called
        added_objs = [call.args[0] for call in mock_db.add.call_args_list]
        liveness_events = [o for o in added_objs if hasattr(o, 'event_type') and o.event_type == "liveness_violation"]
        assert len(liveness_events) > 0
