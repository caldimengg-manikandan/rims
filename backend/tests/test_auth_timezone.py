from datetime import datetime, timezone, timedelta
from jose import jwt
from app.core.auth import create_access_token, verify_token
from app.core.config import get_settings

def test_jwt_expiration_uses_utc():
    settings = get_settings()
    data = {"sub": "testuser", "role": "hr"}
    
    # 1. Create a token
    token = create_access_token(data=data, expires_delta=timedelta(minutes=15))
    
    # 2. Decode the token payload manually without verifying exp yet
    payload = jwt.decode(
        token, 
        settings.jwt_secret, 
        algorithms=[settings.jwt_algorithm],
        options={"verify_signature": True, "verify_exp": False}
    )
    
    # 3. Assert "exp" is close to UTC time (not IST which is 5.5 hours ahead)
    exp_timestamp = payload.get("exp")
    iat_timestamp = payload.get("iat")
    
    assert exp_timestamp is not None
    assert iat_timestamp is not None
    
    # Compare with current UTC time
    now_utc = datetime.now(timezone.utc).timestamp()
    
    # Token exp should be around +15 minutes from now in UTC (allow small delta for execution latency)
    expected_exp = now_utc + 15 * 60
    assert abs(exp_timestamp - expected_exp) < 10  # within 10 seconds
    
    # Token iat should be around now in UTC
    assert abs(iat_timestamp - now_utc) < 10
    
    # 4. Verify that verify_token successfully validates it
    decoded = verify_token(token)
    assert decoded["sub"] == "testuser"
    assert decoded["role"] == "hr"
