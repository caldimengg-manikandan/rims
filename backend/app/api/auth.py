from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Response, Request
from typing import List
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
from app.infrastructure.database import get_db
from app.domain.models import User, Job, Application
from app.domain.schemas import UserRegister, UserLogin, UserResponse, UserVerifyOTP, ForgotPasswordRequest, ResetPasswordRequest, UserProfileUpdate, UserListResponse
from app.core.auth import hash_password, verify_password, create_access_token, get_current_user, get_current_admin
from app.services.email_service import send_otp_email, send_password_reset_email
from app.core.config import get_settings
import secrets
import string
import logging
from app.core.timezone import get_ist_now, to_naive_ist

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])
settings = get_settings()

from app.core.rate_limiter import limiter

if settings.env.lower().strip() not in ("production", "staging"):
    @router.get("/debug/data-health")
    def data_health(
        request: Request,
        db: Session = Depends(get_db),
        current_admin: User = Depends(get_current_admin),
    ):
        """Phase 9: Enhanced Safety & Monitoring Debugging Endpoint - Super Admin only"""
        from sqlalchemy import func
        from app.domain.models import Application, Job, User, Interview
        return {
            "counts": {
                "applications": db.query(func.count(Application.id)).scalar(),
                "jobs": db.query(func.count(Job.id)).scalar(),
                "users": db.query(func.count(User.id)).scalar(),
                "interviews": db.query(func.count(Interview.id)).scalar()
            },
            "monitoring": {
                "stuck_resume_parsing": db.query(func.count(Application.id)).filter(
                    Application.resume_status == "parsing",
                    Application.parsing_started_at < get_ist_now() - timedelta(hours=1)
                ).scalar(),
                "failed_resume_parsing": db.query(func.count(Application.id)).filter(
                    Application.resume_status == "failed"
                ).scalar(),
            },
            "timestamp": get_ist_now().isoformat()
        }

@router.post("/register", response_model=UserResponse)
@limiter.limit("20/minute")
def register(request: Request, user_data: UserRegister, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Register a new HR user with pending approval."""
    try:
        from app.core.email_utils import validate_email_strict
        user_data.email = validate_email_strict(user_data.email)
    except ValueError as e:
        logger.warning(f"Email validation failed during registration: {e}")
        err_msg = str(e)
        if any(keyword in err_msg.lower() for keyword in ["email", "disposable", "domain"]):
            raise HTTPException(status_code=400, detail=err_msg)
        raise HTTPException(status_code=400, detail="Invalid email format.")

    # M-08 check HR allowed domains
    if settings.hr_allowed_domains:
        allowed_domains = [d.strip().lower() for d in settings.hr_allowed_domains.split(",") if d.strip()]
        if allowed_domains:
            email_parts = user_data.email.split("@")
            if len(email_parts) != 2 or email_parts[1].lower() not in allowed_domains:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Registration is restricted to authorized domains."
                )

    existing_user = db.query(User).filter(User.email == user_data.email).first()
    if existing_user:
        if existing_user.approval_status == "approved" and existing_user.is_active:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An approved account already exists for this email."
            )
        if existing_user.approval_status == "rejected":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This email has been rejected and cannot be registered again."
            )
        if existing_user.approval_status != "approved" and existing_user.is_verified:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An approval request for this email is already pending Super Admin review."
            )

        try:
            raw_otp = ''.join(secrets.choice(string.digits) for _ in range(6))
            existing_user.password_hash = hash_password(user_data.password)
            existing_user.full_name = user_data.full_name
            existing_user.role = "pending_hr"
            existing_user.is_active = False
            existing_user.is_verified = False
            existing_user.approval_status = "pending"
            existing_user.otp_code = hash_password(raw_otp)
            existing_user.otp_expiry = get_ist_now() + timedelta(minutes=30)
            db.commit()
            db.refresh(existing_user)
            background_tasks.add_task(send_otp_email, existing_user.email, raw_otp)
            return existing_user
        except Exception:
            db.rollback()
            raise HTTPException(status_code=500, detail="Registration update failed safely.")

    role = "pending_hr"
    raw_otp = ''.join(secrets.choice(string.digits) for _ in range(6))
    hashed_otp = hash_password(raw_otp)
    hashed_password = hash_password(user_data.password)

    new_user = User(
        email=user_data.email,
        password_hash=hashed_password,
        full_name=user_data.full_name,
        role=role,
        is_active=False,
        is_verified=False,
        approval_status="pending",
        otp_code=hashed_otp,
        otp_expiry=get_ist_now() + timedelta(minutes=30)
    )

    try:
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
        background_tasks.add_task(send_otp_email, new_user.email, raw_otp)
        return new_user
    except Exception as e:
        db.rollback()
        logger.error(f"Registration failed for {user_data.email}: {type(e).__name__}")
        raise HTTPException(status_code=500, detail="Registration creation failed")

@router.post("/verify", response_model=dict)
@limiter.limit("20/minute")
def verify_otp(request: Request, verification_data: UserVerifyOTP, db: Session = Depends(get_db)):
    """Verify user account with OTP"""
    email = verification_data.email.lower()

    user = db.query(User).filter(User.email == email).first()
    if not user:
        verify_password("dummy_password", "$2b$12$XzQyJkG9aBcDeFgHiJkLmOpQrStUvWxYz0123456789abcdefghij")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if user.approval_status == "rejected":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been rejected and is permanently blocked."
        )

    if user.is_verified:
        return {"message": "User is already verified"}

    # C-02 OTP locked check
    if user.otp_locked_until:
        locked_until = to_naive_ist(user.otp_locked_until)
        if get_ist_now() < locked_until:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Too many failed attempts. This action is temporarily locked."
            )

    if not user.otp_expiry:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No OTP has been generated. Please register again."
        )

    expiry_time = to_naive_ist(user.otp_expiry)
        
    if get_ist_now() > expiry_time:
        try:
            user.otp_code = None
            user.otp_expiry = None
            user.otp_attempt_count = 0
            user.otp_locked_until = None
            db.commit()
        except Exception:
            db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OTP has expired. Please register again to receive a new OTP."
        )

    if not user.otp_code or not verify_password(verification_data.otp, user.otp_code):
        try:
            user.otp_attempt_count = (user.otp_attempt_count or 0) + 1
            if user.otp_attempt_count >= 5:
                user.otp_locked_until = get_ist_now() + timedelta(minutes=15)
            db.commit()
        except Exception:
            db.rollback()
            
        if user.otp_attempt_count >= 5:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Too many failed attempts. This action is temporarily locked."
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid OTP code"
            )

    try:
        user.is_verified = True
        user.otp_code = None
        user.otp_expiry = None
        user.otp_attempt_count = 0
        user.otp_locked_until = None
        db.commit()
        return {"message": "Account successfully verified. It will require Super Admin approval before login."}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail="Verification finalization failed safely.")

@router.post("/login")
@limiter.limit("5/minute")
def login(request: Request, response: Response, credentials: UserLogin, db: Session = Depends(get_db)):
    """Login and set secure JWT HttpOnly cookie"""
    from sqlalchemy import update as sa_update
    credentials.email = credentials.email.lower().strip()
    user = db.query(User).filter(User.email == credentials.email).first()

    if not user:
        logger.warning("Login failed: User not found (email redacted)")
        verify_password("dummy_password", "$2b$12$XzQyJkG9aBcDeFgHiJkLmOpQrStUvWxYz0123456789abcdefghij")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials"
        )

    # BUG-012 Fix: Per-account lockout after 10 consecutive failures (15-minute window).
    login_attempt_count = getattr(user, 'login_attempt_count', 0) or 0
    login_locked_until = getattr(user, 'login_locked_until', None)
    if login_locked_until:
        lock_time = to_naive_ist(login_locked_until) if hasattr(login_locked_until, 'tzinfo') else login_locked_until
        if get_ist_now() < lock_time:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Account temporarily locked due to too many failed login attempts. Try again later."
            )
        else:
            # Lock expired — reset counter atomically
            db.execute(
                sa_update(User)
                .where(User.id == user.id)
                .values(login_attempt_count=0, login_locked_until=None)
            )
            db.commit()
            user.login_attempt_count = 0

    logger.debug("Login attempt for user (email redacted)")
    if not verify_password(credentials.password, user.password_hash):
        # BUG-012: Atomically increment failure counter, lock after 10 failures
        new_count = (user.login_attempt_count or 0) + 1
        lock_until = None
        if new_count >= 10:
            lock_until = get_ist_now() + timedelta(minutes=15)
            logger.warning(f"Account locked after {new_count} failed login attempts.")
        db.execute(
            sa_update(User)
            .where(User.id == user.id)
            .values(login_attempt_count=new_count, login_locked_until=lock_until)
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials"
        )

    # Success: reset lockout counter
    if (user.login_attempt_count or 0) > 0:
        db.execute(
            sa_update(User)
            .where(User.id == user.id)
            .values(login_attempt_count=0, login_locked_until=None)
        )
        db.commit()

    if not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is not verified. Please verify your email first."
        )

    if user.approval_status == "rejected":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been rejected and is permanently blocked."
        )
    
    if user.role == "pending_hr" or user.approval_status != "approved" or not user.is_active:
        if user.approval_status == "approved" and not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This account has been deactivated. Please contact your administrator."
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is pending approval by the Super Admin."
        )

    access_token_expires = timedelta(minutes=settings.jwt_expiration_minutes)
    token_data = {
        "sub": str(user.id),
        "role": user.role
    }
    access_token = create_access_token(token_data, access_token_expires)

    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        # BUG-029 Fix: Always set samesite=strict, not only in production.
        # samesite=lax in development still sends cookies on cross-site navigations.
        samesite="strict",
        secure=settings.env == "production",
        path="/"
        # Removed max_age and expires: Browser will delete cookie on close
    )

    return {
        "message": "Login successful",
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "role": user.role,
            "is_active": user.is_active,
            "is_verified": user.is_verified,
            "approval_status": user.approval_status,
            "created_at": user.created_at
        }
    }

@router.get("/hr-requests", response_model=List[UserListResponse])
@limiter.limit("20/minute")
def get_hr_requests(
    request: Request, 
    status: str = "pending", 
    current_admin: User = Depends(get_current_admin), 
    db: Session = Depends(get_db)
):
    """List HR users by status for Super Admin management"""
    query = db.query(User).filter(User.role != "super_admin")
    
    if status == "pending":
        query = query.filter(User.approval_status == "pending", User.is_verified == True)
    elif status == "approved":
        query = query.filter(User.approval_status == "approved")
    elif status == "rejected":
        query = query.filter(User.approval_status == "rejected")
    
    return query.order_by(User.created_at.desc()).all()


@router.delete("/remove/{user_id}", response_model=dict)
@limiter.limit("10/minute")
def remove_hr_user(
    request: Request, 
    user_id: int, 
    current_admin: User = Depends(get_current_admin), 
    db: Session = Depends(get_db)
):
    """Soft-delete (deactivate) an approved HR user account"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    
    if user.role == "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot remove a Super Admin")

    user.is_active = False
    # Reassign candidates (Phase 3 fix)
    _reassign_managed_resources(db, user.id, current_admin.id)
    
    db.commit()
    return {"message": f"User {user.email} has been deactivated and candidates reassigned."}

def _reassign_managed_resources(db: Session, old_hr_id: int, fallback_user_id: int):
    """
    Reassign all jobs and applications to the Super Admin (fallback_user_id).
    Avoids randomly reassigning to another HR to maintain strict boundary isolation (H-05).
    """
    new_owner_id = fallback_user_id
    
    # 1. Update Jobs handler
    db.query(Job).filter(Job.hr_id == old_hr_id).update({"hr_id": new_owner_id})
    # 2. Update Applications handler (active ones)
    db.query(Application).filter(Application.hr_id == old_hr_id).update({"hr_id": new_owner_id})
    # This ensures RLS ownership is transferred


@router.get("/pending-approvals", response_model=List[UserListResponse])
@limiter.limit("20/minute")
def get_pending_approvals(request: Request, current_admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """List HR users waiting for Super Admin approval"""
    pending_users = db.query(User).filter(
        User.role == "pending_hr",
        User.approval_status == "pending",
        User.is_verified == True
    ).order_by(User.created_at.desc()).all()
    return pending_users


@router.post("/approve/{user_id}", response_model=UserResponse)
@limiter.limit("10/minute")
def approve_hr_user(request: Request, user_id: int, current_admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """Approve a pending or rejected HR user account"""
    user = db.query(User).filter(User.id == user_id, User.role != "super_admin").first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="HR user not found")
    
    if user.approval_status == "approved" and user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is already approved and active")

    user.role = "hr"
    user.is_active = True
    user.approval_status = "approved"

    # L-04 audit log
    from app.domain.models import AuditLog
    import json
    log = AuditLog(
        user_id=current_admin.id,
        action="HR_USER_APPROVED",
        resource_type="User",
        resource_id=user.id,
        details=json.dumps({"approved_by": current_admin.id, "user_email": user.email})
    )
    db.add(log)

    db.commit()
    db.refresh(user)
    return user


@router.post("/reject/{user_id}", response_model=dict)
@limiter.limit("10/minute")
def reject_hr_user(request: Request, user_id: int, current_admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """Reject a pending or active HR user account"""
    user = db.query(User).filter(User.id == user_id, User.role != "super_admin").first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="HR user not found")

    user.is_active = False
    user.otp_code = None
    user.otp_expiry = None
    user.approval_status = "rejected"
    
    # Reassign candidates (Phase 3 fix)
    _reassign_managed_resources(db, user.id, current_admin.id)
    
    # L-04 audit log
    from app.domain.models import AuditLog
    import json
    log = AuditLog(
        user_id=current_admin.id,
        action="HR_USER_REJECTED",
        resource_type="User",
        resource_id=user.id,
        details=json.dumps({"rejected_by": current_admin.id, "user_email": user.email})
    )
    db.add(log)

    db.commit()
    return {"message": f"User {user.email} has been rejected and candidates reassigned."}


from app.core.redis_store import get_redis_client
from app.core.auth import verify_token

@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    """Clear both authentication cookies (access_token and hr_token).
    BUG-013 Fix: hr_token was not cleared on logout, leaving HR sessions active.
    BUG-010 Fix: Adds the token to Redis blocklist to prevent reuse.
    """
    # Extract token to blocklist before deleting cookies
    token = request.cookies.get("access_token") or request.cookies.get("hr_token")
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]

    if token:
        # Try to blocklist the token if Redis is configured
        if settings.redis_url:
            from app.core.redis_store import get_redis_client
            from app.core.auth import verify_token
            
            r = get_redis_client()
            if not r:
                logger.error("[BUG-010 Fix] Redis configured but unavailable on logout. Failing closed.")
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Authentication service temporarily offline.",
                )
            try:
                # Safely decode token to get expiration
                payload = verify_token(token)
                exp = payload.get("exp")
                jti = payload.get("jti")
                if exp:
                    now = int(get_ist_now().timestamp())
                    ttl = int(exp - now)
                    if ttl > 0:
                        if jti:
                            r.setex(f"token_blocklist:{jti}", ttl, "true")
                            logger.info(f"[BUG-010 Fix] Token JTI successfully blocklisted for {ttl}s: {jti}")
            except HTTPException:
                # Token already expired/invalid: skip blocklisting
                pass
            except Exception as e:
                logger.error(f"[BUG-010 Fix] Redis blocklist error during logout (failing closed): {e}")
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Authentication service temporarily offline.",
                )

        # Database-backed token revocation
        try:
            from app.core.auth import verify_token
            payload = verify_token(token)
            jti = payload.get("jti")
            exp = payload.get("exp")
            if jti and exp:
                from app.domain.models import RevokedToken
                from sqlalchemy import select
                existing = db.execute(select(RevokedToken).where(RevokedToken.jti == jti)).scalar_one_or_none()
                if not existing:
                    # Note: expires_at is Column(DateTime) which is naive in the DB schema.
                    # We store it as a naive UTC timestamp to prevent database/SQLAlchemy warnings.
                    # This is metadata only; no reads or comparisons of this field exist in Python.
                    exp_dt = datetime.fromtimestamp(exp, tz=timezone.utc).replace(tzinfo=None)
                    revoked = RevokedToken(jti=jti, expires_at=exp_dt)
                    db.add(revoked)
                    db.commit()
                    logger.info(f"Token JTI successfully blocklisted in DB: {jti}")
        except HTTPException:
            # Token already expired/invalid: skip DB blocklisting
            pass
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to save revoked token to DB (failing closed): {e}")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Authentication service temporarily offline.",
            )

    response.delete_cookie(
        key="access_token",
        httponly=True,
        samesite="strict",
        secure=settings.env == "production",
        path="/"
    )
    # BUG-013 Fix: Also clear hr_token (set during HR interview-module operations)
    response.delete_cookie(
        key="hr_token",
        httponly=True,
        samesite="strict",
        secure=settings.env == "production"
    )
    return {"message": "Logged out successfully"}

@router.get("/me", response_model=UserResponse)
def get_current_user_info(current_user: User = Depends(get_current_user)):
    """Get current authenticated user info"""
    return current_user

@router.put("/me", response_model=UserResponse)
def update_current_user_info(
    data: UserProfileUpdate, 
    current_user: User = Depends(get_current_user), 
    db: Session = Depends(get_db)
):
    """Update current user profile info"""
    if data.full_name is not None:
        current_user.full_name = data.full_name
    if data.profile_image_url is not None:
        current_user.profile_image_url = data.profile_image_url
    
    try:
        db.commit()
        db.refresh(current_user)
        return current_user
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to update profile")

@router.post("/forgot-password")
@limiter.limit("3/hour")
def forgot_password(request: Request, data: ForgotPasswordRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Generate a password reset OTP and send email"""
    user = db.query(User).filter(User.email == data.email.lower()).first()
    
    # We return success even if user doesn't exist to prevent email enumeration
    if not user:
        logger.info(f"Forgot password requested for non-existent email: {data.email}")
        return {"message": "If an account exists with this email, a reset OTP has been sent."}
    
    raw_otp = ''.join(secrets.choice(string.digits) for _ in range(6))
    user.otp_code = hash_password(raw_otp)
    user.otp_expiry = get_ist_now() + timedelta(minutes=30)
    user.otp_attempt_count = 0
    user.otp_locked_until = None
    
    try:
        db.commit()
        background_tasks.add_task(send_password_reset_email, user.email, raw_otp)
        return {"message": "If an account exists with this email, a reset OTP has been sent."}
    except Exception as e:
        db.rollback()
        logger.error(f"Forgot password failed for {user.email}: {e}")
        raise HTTPException(status_code=500, detail="Failed to process request")

@router.post("/reset-password")
@limiter.limit("3/hour")
def reset_password(request: Request, data: ResetPasswordRequest, db: Session = Depends(get_db)):
    """Reset password using OTP"""
    user = db.query(User).filter(User.email == data.email.lower()).first()
    if not user:
         # C-01: generic message same as forgot-password success to prevent email enumeration
         # Prevent email enumeration by always performing a dummy hash check
         verify_password("dummy_password", "$2b$12$XzQyJkG9aBcDeFgHiJkLmOpQrStUvWxYz0123456789abcdefghij")
         return {"message": "Password has been successfully reset"}
    
    # C-02 OTP locked check
    if user.otp_locked_until:
        locked_until = to_naive_ist(user.otp_locked_until)
        if get_ist_now() < locked_until:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Too many failed attempts. This action is temporarily locked."
            )

    if not user.otp_code or not user.otp_expiry:
        raise HTTPException(status_code=400, detail="No reset request found")
        
    expiry_time = to_naive_ist(user.otp_expiry)
        
    if get_ist_now() > expiry_time:
        try:
            user.otp_code = None
            user.otp_expiry = None
            user.otp_attempt_count = 0
            user.otp_locked_until = None
            db.commit()
        except Exception:
            db.rollback()
        raise HTTPException(status_code=400, detail="Reset OTP has expired")
        
    if not verify_password(data.otp, user.otp_code):
        try:
            user.otp_attempt_count = (user.otp_attempt_count or 0) + 1
            if user.otp_attempt_count >= 5:
                user.otp_locked_until = get_ist_now() + timedelta(minutes=15)
            db.commit()
        except Exception:
            db.rollback()

        if user.otp_attempt_count >= 5:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Too many failed attempts. This action is temporarily locked."
            )
        else:
            raise HTTPException(status_code=400, detail="Invalid OTP code")
        
    try:
        user.password_hash = hash_password(data.new_password)
        user.password_changed_at = get_ist_now()
        user.otp_code = None
        user.otp_expiry = None
        user.otp_attempt_count = 0
        user.otp_locked_until = None
        db.commit()
        return {"message": "Password has been successfully reset"}
    except Exception as e:
        db.rollback()
        logger.error(f"Reset password failed for {user.email}: {e}")
        raise HTTPException(status_code=500, detail="Failed to reset password")