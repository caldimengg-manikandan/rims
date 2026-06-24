from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator, ConfigDict
from datetime import datetime
import re
import json
from typing import Optional, List, Any
from app.domain.constants import CandidateState

# ============================================================================
# Auth Schemas
# ============================================================================

class UserRegister(BaseModel):
    email: str
    password: str
    full_name: str

    @field_validator('password')
    @classmethod
    def validate_password_robust(cls, v):
        password = v
        if len(password) < 8:
            raise ValueError("Password must be at least 8 characters long.")
        if not any(c.isupper() for c in password):
            raise ValueError("Password must contain at least one uppercase letter.")
        if not any(c.islower() for c in password):
            raise ValueError("Password must contain at least one lowercase letter.")
        if not any(c.isdigit() for c in password):
            raise ValueError("Password must contain at least one digit.")
        if not any(c in "!@#$%^&*()_+-=[]{}|;':\",./<>?`~" for c in password):
            raise ValueError("Password must contain at least one special character.")
        return password

    @field_validator('email')
    def validate_email_robust(cls, v):
        from app.core.config import get_settings
        settings = get_settings()
        
        # 1. Base Structure Check: exactly one @, min 3 chars
        email_trimmed = v.strip().lower()
        if "@" not in email_trimmed or len(email_trimmed) < 3:
            raise ValueError("Enter a valid email address.")
            
        parts = email_trimmed.split("@")
        if len(parts) != 2:
             raise ValueError("Enter a valid email address.")
             
        local_part, domain = parts
        
        # 2. Strict validation for production (requires real TLD)
        # 3. Flexible validation for dev/test (allows .local)
        if settings.env == "production":
            # Strict regex: requires at least 2 char TLD
            email_regex = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        else:
            # Flexible regex: allows .local and single-char domains for testing
            email_regex = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{1,}$'
            
        if not re.match(email_regex, email_trimmed):
            raise ValueError("Enter a valid email (e.g., user@example.com)")
            
        # Additional checks for common invalid patterns
        if "@." in email_trimmed or ".." in email_trimmed or email_trimmed.endswith(".") or email_trimmed.startswith(".") or email_trimmed.startswith("@"):
             raise ValueError("Enter a valid email address.")
             
        return email_trimmed

class UserLogin(BaseModel):
    email: str
    password: str
    
    @field_validator('email')
    @classmethod
    def validate_email(cls, v):
        return UserRegister.validate_email_robust(v)

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"

class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    is_active: bool
    is_verified: bool
    approval_status: str
    profile_image_url: Optional[str] = None
    created_at: datetime
    
    # Pydantic v2 compatibility for naive vs aware datetimes
    @field_validator('created_at', mode='before')
    def parse_created_at(cls, v):
        if isinstance(v, str):
             try:
                 # Standard ISO datetime parsing for cross-database JSON compatibility
                 return datetime.fromisoformat(v.replace('Z', '+00:00'))
             except:
                 pass
        return v
    
    model_config = ConfigDict(from_attributes=True)

class ForgotPasswordRequest(BaseModel):
    email: str
    
    @field_validator('email')
    @classmethod
    def validate_email(cls, v):
        return UserRegister.validate_email_robust(v)

class ResetPasswordRequest(BaseModel):
    email: str
    otp: str
    new_password: str

    @field_validator('new_password')
    @classmethod
    def validate_password_robust(cls, v):
        return UserRegister.validate_password_robust(v)
    
    @field_validator('email')
    @classmethod
    def validate_email(cls, v):
        return UserRegister.validate_email_robust(v)

class UserProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    profile_image_url: Optional[str] = None

    @field_validator('profile_image_url')
    @classmethod
    def validate_profile_image_url(cls, v):
        if v is not None:
            if not v.startswith("https://"):
                raise ValueError("Profile image URL must be HTTPS")
            from urllib.parse import urlparse
            parsed = urlparse(v)
            if not parsed.netloc.endswith("supabase.co") and "supabase.co" not in parsed.netloc:
                raise ValueError("Only Supabase storage URLs are permitted for profile images")
        return v

class UserListResponse(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    is_active: bool
    is_verified: bool
    approval_status: str
    created_at: datetime

    @field_validator('email')
    @classmethod
    def sanitize_email(cls, v):
        return v.strip().lower()
    
    @field_validator('created_at', mode='before')
    @classmethod
    def parse_created_at(cls, v):
        if isinstance(v, str):
             try:
                 return datetime.fromisoformat(v.replace('Z', '+00:00'))
             except:
                 pass
        return v
        
    model_config = ConfigDict(from_attributes=True)

# ============================================================================
# Job Schemas
# ============================================================================

class JobCreate(BaseModel):
    title: str
    description: str
    # Optional structured requirements. If provided, we append it to `description`
    # so downstream AI prompt generation can consume a single job narrative.
    requirements: Optional[str] = None
    experience_level: str  # 'junior', 'mid', 'senior'
    location: Optional[str] = None
    mode_of_work: Optional[str] = 'Remote'
    job_type: Optional[str] = 'Full-Time'
    domain: Optional[str] = 'Engineering'
    primary_evaluated_skills: Optional[List[str]] = None
    # Interview Config overrides
    aptitude_enabled: Optional[bool] = False
    aptitude_mode: Optional[str] = "ai"
    first_level_enabled: Optional[bool] = True
    interview_mode: Optional[str] = "ai"
    behavioral_role: Optional[str] = "general"
    interview_token: Optional[str] = None
    uploaded_question_file: Optional[str] = None
    aptitude_questions_file: Optional[str] = None
    aptitude_config: Optional[str] = None
    duration_minutes: Optional[int] = 60
    # Repository-sourced question sets (used instead of file upload)
    aptitude_repo_set_id: Optional[int] = None
    technical_repo_set_id: Optional[int] = None
    behavioural_repo_set_id: Optional[int] = None

    @field_validator('title')
    def validate_title(cls, v):
        if not v or len(v.strip()) < 3:
            raise ValueError("Job Title must be at least 3 characters long")
        
        title_trimmed = v.strip()
        # Rule: Must contain at least one alphabetic character
        if not any(c.isalpha() for c in title_trimmed):
            raise ValueError("Job Title must contain letters and no special characters")
            
        # Rule: Allow letters, numbers, spaces, and common technical symbols (+, #, ., -, /)
        if not re.match(r'^[a-zA-Z0-9\s+#.\-\/]+$', title_trimmed):
            raise ValueError("Job Title must contain letters, numbers, spaces, and common symbols like +, #, ., -, /")
            
        # Edge case: prevent titles that are ONLY symbols
        if len(re.sub(r'[^a-zA-Z0-9]', '', title_trimmed)) < 1:
             raise ValueError("Job Title must contain meaningful content")
             
        return title_trimmed

    @field_validator('experience_level')
    def validate_experience_level(cls, v):
        valid_levels = {'intern', 'junior', 'mid', 'senior', 'lead'}
        if not v or v.strip().lower() not in valid_levels:
            raise ValueError(f"Invalid experience level. Must be one of {valid_levels}")
        return v.strip().lower()

    @field_validator('description')
    def validate_description(cls, v):
        if not v or len(v.strip()) < 10:
            raise ValueError("Description must contain meaningful text (minimum 10 characters)")
        # Must not be only numbers or special characters
        if not any(c.isalpha() for c in v):
            raise ValueError("Description must contain meaningful text")
        return v.strip()

    @field_validator("requirements")
    def validate_requirements(cls, v):
        if v is None:
            return v
        v = v.strip()
        if len(v) < 10:
            raise ValueError("Requirements must contain meaningful text (minimum 10 characters)")
        if not any(c.isalpha() for c in v):
            raise ValueError("Requirements must contain meaningful text")
        return v

    @field_validator('duration_minutes')
    def validate_duration(cls, v):
        if v is not None:
            if v < 1 or v > 300:
                raise ValueError("Interview duration must be between 1 and 300 minutes")
        return v

class JobUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    experience_level: Optional[str] = None
    location: Optional[str] = None
    mode_of_work: Optional[str] = None
    job_type: Optional[str] = None
    domain: Optional[str] = None
    status: Optional[str] = None  # 'open', 'closed'
    primary_evaluated_skills: Optional[List[str]] = None
    # Interview pipeline config
    aptitude_enabled: Optional[bool] = None
    first_level_enabled: Optional[bool] = None
    interview_mode: Optional[str] = None
    uploaded_question_file: Optional[str] = None
    aptitude_config: Optional[dict] = None
    aptitude_questions_file: Optional[str] = None
    duration_minutes: Optional[int] = None
    # Repository-sourced question sets
    aptitude_repo_set_id: Optional[int] = None
    technical_repo_set_id: Optional[int] = None
    behavioural_repo_set_id: Optional[int] = None
    behavioral_role: Optional[str] = None
    aptitude_mode: Optional[str] = None

    @field_validator('title')
    def validate_title(cls, v):
        if v is not None:
            title_trimmed = v.strip()
            if len(title_trimmed) < 3:
                raise ValueError("Job Title must be at least 3 characters long")
            if not any(c.isalpha() for c in title_trimmed):
                raise ValueError("Job Title must contain letters and no special characters")
            if not re.match(r'^[a-zA-Z0-9\s+#.\-\/]+$', title_trimmed):
                raise ValueError("Job Title must contain letters, numbers, spaces, and common symbols like +, #, ., -, /")
            if len(re.sub(r'[^a-zA-Z0-9]', '', title_trimmed)) < 1:
                raise ValueError("Job Title must contain meaningful content")
            return title_trimmed
        return v

    @field_validator('experience_level')
    def validate_experience_level(cls, v):
        if v is not None:job from applications and similar
            valid_levels = {'intern', 'junior', 'mid', 'senior', 'lead'}
            if not v or v.strip().lower() not in valid_levels:
                raise ValueError(f"Invalid experience level. Must be one of {valid_levels}")
            return v.strip().lower()
        return v

    @field_validator('description')
    def validate_description(cls, v):
        if v is not None:
            if len(v.strip()) < 10:
                raise ValueError("Description must contain meaningful text (minimum 10 characters)")
            if not any(c.isalpha() for c in v):
                raise ValueError("Description must contain meaningful text")
            return v.strip()
        return v

    @field_validator('duration_minutes')
    def validate_duration(cls, v):
        if v is not None:
            if v < 1 or v > 300:
                raise ValueError("Interview duration must be between 1 and 300 minutes")
        return v

class JobResponse(BaseModel):
    id: int
    job_id: Optional[str] = None
    title: str
    description: str
    experience_level: str
    location: Optional[str]
    mode_of_work: Optional[str] = 'Remote'
    job_type: Optional[str]
    domain: Optional[str]
    status: str
    closed_at: Optional[datetime] = None
    primary_evaluated_skills: Optional[str] = None
    # Interview pipeline config
    aptitude_enabled: Optional[bool] = False
    aptitude_mode: Optional[str] = "ai"
    first_level_enabled: Optional[bool] = True
    interview_mode: Optional[str] = "ai"
    behavioral_role: Optional[str] = "general"
    interview_token: Optional[str] = None
    uploaded_question_file: Optional[str] = None
    aptitude_config: Optional[str] = None
    aptitude_questions_file: Optional[str] = None
    duration_minutes: int = 60
    # Repository-sourced question sets
    aptitude_repo_set_id: Optional[int] = None
    technical_repo_set_id: Optional[int] = None
    behavioural_repo_set_id: Optional[int] = None
    is_applied: bool = False
    hr_id: int
    created_at: datetime
    updated_at: datetime
    
    model_config = ConfigDict(from_attributes=True)

class JobPublicResponse(BaseModel):
    id: int
    job_id: Optional[str] = None
    title: str
    description: str
    experience_level: str
    location: Optional[str] = 'Remote'
    mode_of_work: Optional[str] = 'Remote'
    job_type: Optional[str] = 'Full-Time'
    domain: Optional[str] = 'Engineering'
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class JobExtractionResponse(BaseModel):
    title: str = ""
    experience_level: str = ""
    domain: str = ""
    job_type: str = ""
    location: str = ""
    description: str = ""
    primary_evaluated_skills: List[str] = []
    # Ephemeral UX hints (no DB); e.g. empty skills after AI extract.
    warnings: List[str] = Field(default_factory=list)

# ============================================================================
# Application Schemas
# ============================================================================

class ApplicationCreate(BaseModel):
    job_id: int

class ApplicationStatusUpdate(BaseModel):
    action: str  # FSM action: 'approve_for_interview', 'reject', 'call_for_interview', 'review_later', 'hire'
    hr_notes: Optional[str] = None

class ApplicationNotesUpdate(BaseModel):
    hr_notes: str

class TransitionResponse(BaseModel):
    application_id: int
    from_state: str
    to_state: str
    action: str
    email_type: Optional[str] = None


class JobSummary(BaseModel):
    id: int
    job_id: Optional[str] = None
    title: str

    model_config = ConfigDict(from_attributes=True)

class ApplicationResponse(BaseModel):
    id: int
    job_id: int
    job: Optional[JobSummary] = None
    candidate_name: str
    candidate_email: str
    candidate_phone: Optional[str] = None
    resume_file_name: Optional[str]
    resume_file_path: Optional[str]
    candidate_photo_path: Optional[str] = None
    candidate_phone_raw: Optional[str] = None
    status: str
    hr_id: int
    hr_notes: Optional[str] = None
    resume_status: str = "pending"
    file_status: Optional[str] = 'active'
    
    # Cloud Storage URLs
    resume_url: Optional[str] = None
    photo_url: Optional[str] = None
    id_card_url: Optional[str] = None
    video_url: Optional[str] = None
    
    # Enterprise Scoring (Point 2)
    resume_score: Optional[float] = 0.0
    aptitude_score: Optional[float] = 0.0
    interview_score: Optional[float] = 0.0
    composite_score: Optional[float] = 0.0
    recommendation: Optional[str] = None
    
    applied_at: datetime
    updated_at: datetime
    is_owner: bool = False
    assigned_hr_id: Optional[int] = None
    assigned_hr_name: Optional[str] = None

    # Onboarding response fields (Enhanced V2)
    offer_sent: bool = False
    offer_sent_date: Optional[datetime] = None
    joining_date: Optional[datetime] = None
    onboarding_approval_status: Optional[str] = 'pending'
    offer_approval_status: Optional[str] = 'pending'
    offer_approved_by: Optional[int] = None
    offer_approved_at: Optional[datetime] = None
    offer_response_status: Optional[str] = 'pending'
    offer_response_date: Optional[datetime] = None
    offer_email_status: Optional[str] = 'pending'
    offer_email_retry_count: int = 0
    reminder_sent_at: Optional[datetime] = None
    onboarded_at: Optional[datetime] = None

    @field_validator('status')
    @classmethod
    def validate_status_enum(cls, v):
        if v not in [s.value for s in CandidateState]:
            return v
        return v

    @field_validator('resume_score', 'aptitude_score', 'interview_score', 'composite_score', mode='before')
    @classmethod
    def clamp_scores(cls, v):
        if v is None:
            return 0.0
        try:
            val = float(v)
            if val < 0 or val > 100:
                import logging
                logger = logging.getLogger(__name__)
                logger.warning(
                    f"DATA_INTEGRITY: Score out of range (value={val}). Clamped to 0-100.",
                    extra={"invalid_value": val}
                )
            return max(0.0, min(100.0, val))
        except (ValueError, TypeError):
            return 0.0

    model_config = ConfigDict(from_attributes=True)

class ResumeExtractionSummary(BaseModel):
    id: int
    resume_score: float = 0.0
    skill_match_percentage: float = 0.0
    experience_level: Optional[str] = None
    summary: Optional[str] = None
    extracted_skills: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

class InterviewReportSummary(BaseModel):
    """Minimal report fields needed for the applications list score bars."""
    aptitude_score: Optional[float] = None
    technical_skills_score: Optional[float] = None
    behavioral_score: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)


class InterviewSummary(BaseModel):
    id: int
    test_id: Optional[str] = None
    status: str
    overall_score: Optional[float] = 0.0
    report: Optional[InterviewReportSummary] = None

    model_config = ConfigDict(from_attributes=True)

class ApplicationSummaryResponse(BaseModel):
    id: int
    job_id: int
    job: Optional[JobSummary] = None
    candidate_name: str
    candidate_email: str
    candidate_phone: Optional[str] = None
    status: str
    file_status: Optional[str] = 'active'
    
    # Pruned for performance (List view doesn't need these)
    resume_url: Optional[str] = None
    photo_url: Optional[str] = None
    candidate_photo_path: Optional[str] = None
    
    resume_score: Optional[float] = 0.0
    composite_score: Optional[float] = 0.0
    
    applied_at: datetime
    
    # Correctly typed nested data
    resume_extraction: Optional[ResumeExtractionSummary] = None
    interview: Optional[InterviewSummary] = None
    is_owner: bool = False
    assigned_hr_id: Optional[int] = None
    assigned_hr_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

class ApplicationListResponse(BaseModel):
    items: List[ApplicationSummaryResponse]
    total: int
    page: int
    size: int
    pages: int

class ApplicationStageResponse(BaseModel):
    id: int
    stage_name: str
    stage_status: str
    score: Optional[float] = None
    evaluation_notes: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ApplicationDetailResponse(ApplicationResponse):
    job: Optional[JobResponse] = None # Optional to handle potential detached instances
    resume_extraction: Optional['ResumeExtractionResponse'] = None
    interview: Optional['InterviewResponse'] = None
    pipeline_stages: List[ApplicationStageResponse] = Field(default_factory=list)
    # Read-only: heuristic + optional hr_notes marker; not persisted as its own column.
    extraction_degraded: bool = False


class HasAppliedResponse(BaseModel):
    hasApplied: bool


class AuditLogResponse(BaseModel):
    id: int
    user_id: Optional[int]
    action: str
    resource_type: Optional[str]
    resource_id: Optional[int]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)



# ============================================================================
# Resume Schemas
# ============================================================================

class ResumeExtractionResponse(BaseModel):
    id: int
    application_id: int
    extracted_text: Optional[str]  # Full text
    candidate_name: Optional[str] = None
    email: Optional[str] = None
    phone_number: Optional[str] = None
    summary: Optional[str]  # AI summary
    extracted_skills: Optional[str]
    years_of_experience: Optional[float]
    education: Optional[str]
    previous_roles: Optional[str]
    experience_level: Optional[str]
    reasoning: Optional[dict] = None
    resume_score: float = 0.0
    skill_match_percentage: float = 0.0
    created_at: datetime
    
    @field_validator('resume_score', 'skill_match_percentage', mode='before')
    @classmethod
    def clamp_resume_scores(cls, v):
        if v is None:
            return 0.0
        try:
            val = float(v)
            if val < 0 or val > 100:
                import logging
                logger = logging.getLogger(__name__)
                logger.warning(
                    f"DATA_INTEGRITY: Resume score out of range (value={val}). Clamped to 0-100.",
                    extra={"invalid_value": val}
                )
            return max(0.0, min(100.0, val))
        except (ValueError, TypeError):
            return 0.0
    
    @field_validator('reasoning', mode='before')
    @classmethod
    def parse_reasoning_safe(cls, v: Any) -> Any:
        if isinstance(v, str) and v.strip():
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                return {"error": "Invalid format", "raw": v}
        return v

    model_config = ConfigDict(from_attributes=True)

# ============================================================================
# Interview Report Schemas
# ============================================================================

class InterviewReportResponse(BaseModel):
    id: int
    interview_id: int
    candidate_name: Optional[str]
    candidate_email: Optional[str]
    applied_role: Optional[str]
    overall_score: Optional[float]
    technical_skills_score: Optional[float]
    communication_score: Optional[float]
    problem_solving_score: Optional[float]
    summary: Optional[str]
    strengths: Optional[str]
    weaknesses: Optional[str]
    recommendation: Optional[str]
    detailed_feedback: Optional[str]
    aptitude_score: Optional[float] = None
    behavioral_score: Optional[float] = None
    combined_score: Optional[float] = None
    termination_reason: Optional[str] = None

    @field_validator('overall_score', 'technical_skills_score', 'communication_score', 
                     'problem_solving_score', 'aptitude_score', 'behavioral_score', 
                     'combined_score', mode='before')
    @classmethod
    def clamp_report_scores(cls, v):
        if v is None:
            return 0.0
        try:
            val = float(v)
            return max(0.0, min(100.0, val))
        except (ValueError, TypeError):
            return 0.0
    evaluated_skills: Optional[str] = None
    ai_used: Optional[bool] = False
    fallback_used: Optional[bool] = False
    confidence_score: Optional[float] = None
    reasoning: Optional[dict] = None
    created_at: datetime
    
    @field_validator('reasoning', mode='before')
    @classmethod
    def parse_reasoning_safe(cls, v: Any) -> Any:
        if isinstance(v, str) and v.strip():
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                return {"error": "Invalid format", "raw": v}
        return v

    model_config = ConfigDict(from_attributes=True)

# ============================================================================
# Interview Schemas
# ============================================================================

class InterviewStart(BaseModel):
    camera_active: bool
    mic_active: bool

class InterviewAccess(BaseModel):
    email: str
    access_key: str

class InterviewAnswerSubmit(BaseModel):
    question_id: int
    answer_text: str

    @field_validator('answer_text')
    @classmethod
    def validate_answer_text(cls, v):
        if len(v) > 10000:
            from fastapi import HTTPException
            raise HTTPException(
                status_code=400,
                detail="Answer text is too long (max 10,000 characters)."
            )
        return v

class InterviewQuestionResponse(BaseModel):
    id: int
    interview_id: int
    question_number: int
    question_text: str
    question_type: Optional[str]
    question_options: Optional[str] = None
    options: Optional[str] = None
    
    model_config = ConfigDict(from_attributes=True)

class InterviewAnswerResponse(BaseModel):
    id: int
    question_id: int
    answer_text: str
    answer_score: Optional[float]
    answer_evaluation: Optional[str]
    skill_relevance_score: Optional[float]
    ai_used: Optional[bool] = False
    fallback_used: Optional[bool] = False
    confidence_score: Optional[float] = None
    reasoning: Optional[dict] = None
    submitted_at: datetime
    
    @field_validator('reasoning', mode='before')
    @classmethod
    def parse_reasoning_safe(cls, v: Any) -> Any:
        if isinstance(v, str) and v.strip():
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                return {"error": "Invalid format", "raw": v}
        return v

    model_config = ConfigDict(from_attributes=True)

class InterviewListResponse(BaseModel):
    id: int
    test_id: Optional[str] = None
    status: str
    created_at: datetime
    job_id: int
    job_title: str
    locked_skill: Optional[str]
    score: Optional[float]
    
    model_config = ConfigDict(from_attributes=True)

class InterviewResponse(BaseModel):
    id: int
    test_id: Optional[str] = None
    application_id: int
    status: str
    locked_skill: Optional[str] = None
    total_questions: int
    questions_asked: int
    overall_score: Optional[float]
    started_at: Optional[datetime]
    ended_at: Optional[datetime]
    # Sequential pipeline fields
    interview_stage: Optional[str] = 'first_level'
    aptitude_score: Optional[float] = None
    aptitude_completed_at: Optional[datetime] = None
    duration_minutes: int = 60
    report: Optional[InterviewReportResponse] = None
    
    model_config = ConfigDict(from_attributes=True)

class InterviewDetailResponse(InterviewResponse):
    questions: List[InterviewQuestionResponse] = []

class MonitoringEventCreate(BaseModel):
    event_type: str
    confidence_score: Optional[float] = None
    frame_snapshot: Optional[str] = None  # Base64 string
    video_reference: Optional[str] = None
    details: Optional[str] = None
    signature: Optional[str] = None
    client_timestamp: Optional[int] = None
    nonce: Optional[str] = None
    sequence_number: Optional[int] = None

    @field_validator('event_type')
    @classmethod
    def validate_event_type(cls, v):
        if not v or not v.strip():
            raise ValueError("event_type cannot be empty.")
        import re
        v_clean = re.sub(r'[^a-z0-9_]', '_', v.strip().lower())
        
        valid_types = {
            "focus_lost", "face_not_visible", "multiple_faces", "normal", 
            "tab_switch", "fullscreen_exit", "face_not_detected", "multiple_people",
            "gaze_deviation", "low_lighting", "clipboard_violation",
            "liveness_violation", "voice_coaching_detected"
        }
        if v_clean in valid_types:
            return v_clean
        if re.match(r"^focus_lost_strike_\d+_[a-z0-9_]+$", v_clean):
            return v_clean
            
        raise ValueError(f"Invalid event_type: {v}")

    @field_validator('confidence_score')
    @classmethod
    def validate_confidence(cls, v):
        if v is not None and not (0.0 <= v <= 1.0):
            # Clamp to [0, 1] range — negative or >1 values are nonsensical for proctoring
            return max(0.0, min(1.0, v))
        return v

    @field_validator('frame_snapshot')
    @classmethod
    def validate_frame(cls, v):
        if v and len(v) > 2000000:
            raise ValueError("Frame snapshot payload is too large (max ~2MB).")
        return v

class MonitoringEventResponse(BaseModel):
    id: int
    interview_id: int
    event_type: str
    timestamp: datetime
    confidence_score: Optional[float] = None
    frame_image_path: Optional[str] = None
    frame_image_url: Optional[str] = None  # Signed URL
    video_reference: Optional[str] = None
    is_false_positive: Optional[bool] = False
    details: Optional[str] = None
    strike_count: Optional[int] = None
    token_revoked: Optional[bool] = False

    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# Hiring Decision Schemas
# ============================================================================

class HiringDecisionMake(BaseModel):
    decision: str  # 'hired' or 'rejected'
    decision_comments: Optional[str] = None
    joining_date: Optional[datetime] = None

class HiringDecisionResponse(BaseModel):
    id: int
    application_id: int
    decision: str
    decision_comments: Optional[str]
    joining_date: Optional[datetime] = None
    offer_letter_path: Optional[str] = None
    decided_at: datetime
    is_owner: bool = False
    assigned_hr_id: Optional[int] = None
    assigned_hr_name: Optional[str] = None
    
    model_config = ConfigDict(from_attributes=True)

# ============================================================================
# Notification Schemas
# ============================================================================

class NotificationResponse(BaseModel):
    id: int
    user_id: int
    notification_type: str
    title: str
    message: str
    is_read: bool
    related_application_id: Optional[int] = None
    created_at: datetime
    read_at: Optional[datetime]
    
    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# Ticket / Support Schemas
# ============================================================================

class InterviewIssueCreate(BaseModel):
    interview_id: int
    issue_type: str  # 'interruption', 'technical', 'misconduct_appeal'
    description: str

class GeneralGrievanceCreate(BaseModel):
    email: EmailStr
    access_key: str
    issue_type: str
    description: str

class SupportTicketCreate(BaseModel):
    email: EmailStr
    access_key: str
    grievance_type: str
    description: str

    @model_validator(mode="before")
    @classmethod
    def populate_access_key(cls, data):
        if isinstance(data, dict):
            if "key" in data and "access_key" not in data:
                data["access_key"] = data["key"]
        return data

    @field_validator('grievance_type')
    @classmethod
    def validate_grievance_type(cls, v):
        valid_types = {
            "technical", "access_issue", "misconduct_appeal", "key_reissue", "other",
            "interruption", "onboarding issue", "onboarding issue (link error)"
        }
        v_clean = v.strip().lower()
        if v_clean not in valid_types and "onboarding" not in v_clean:
            raise ValueError(f"Invalid grievance_type. Must be one of {valid_types}")
        return v_clean


class InterviewIssueResolve(BaseModel):
    hr_response: Optional[str] = ""  # Optional for 'dismiss' action; required for reply/resolve
    action: str  # 'reissue_key', 'dismiss', 'dismissed', 'resolve', 'resolved', 'reply'
    send_email: bool = True

class InterviewIssueResponse(BaseModel):
    id: int
    interview_id: int
    application_id: Optional[int] = None
    test_id: Optional[str] = None
    job_id: Optional[int] = None
    job_identifier: Optional[str] = None
    candidate_name: Optional[str]
    candidate_email: Optional[str]
    issue_type: str
    description: str
    status: str
    hr_response: Optional[str]
    is_reissue_granted: bool
    created_at: datetime
    resolved_at: Optional[datetime]
    is_owner: bool = False
    assigned_hr_id: Optional[int] = None
    assigned_hr_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

class InterviewFeedbackCreate(BaseModel):
    interview_id: int
    ui_ux_rating: int
    feedback_text: Optional[str] = None

    @field_validator('ui_ux_rating')
    @classmethod
    def validate_rating(cls, v):
        if v < 1 or v > 5:
            raise ValueError("Rating must be between 1 and 5")
        return v

class InterviewFeedbackResponse(BaseModel):
    id: int
    interview_id: int
    ui_ux_rating: int
    feedback_text: Optional[str]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class UserVerifyOTP(BaseModel):
    email: str
    otp: str
    
    @field_validator('email')
    @classmethod
    def validate_email(cls, v):
        return UserRegister.validate_email_robust(v)

# ============================================================================
# Global Settings
# ============================================================================

class GlobalSettingsUpdate(BaseModel):
    company_logo_url: Optional[str] = None
    company_name: Optional[str] = None
    company_address: Optional[str] = None
    hr_email: Optional[str] = None
    hr_name: Optional[str] = None
    hr_phone: Optional[str] = None
    offer_letter_template: Optional[str] = None
    imap_email: Optional[str] = None
    imap_password: Optional[str] = None
    auto_sync_enabled: Optional[bool] = None
    
    product_name: Optional[str] = None
    dark_logo_url: Optional[str] = None
    favicon_url: Optional[str] = None
    footer_text: Optional[str] = None
    support_email: Optional[str] = None
    theme_color: Optional[str] = None
    terms_url: Optional[str] = None
    privacy_url: Optional[str] = None
    seo_title_default: Optional[str] = None
    seo_description_default: Optional[str] = None

    @field_validator('theme_color')
    @classmethod
    def validate_theme_color(cls, v):
        if v is None or v.strip() == '':
            return v
        v = v.strip()
        if not re.match(r'^#[0-9A-Fa-f]{3,8}$', v):
            raise ValueError('Invalid theme color format. Must be a valid hex color code (e.g. #2563eb).')
        return v

    @field_validator('imap_email')
    @classmethod
    def validate_imap_email(cls, v):
        if v is None or v.strip() == '':
            return v
        v = v.strip()
        # RFC-like email validation
        email_pattern = re.compile(
            r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        )
        if not email_pattern.match(v):
            raise ValueError(
                'Invalid email format. Please enter a valid email address (e.g. user@gmail.com).'
            )
        return v

    @field_validator('imap_password')
    @classmethod
    def validate_imap_password(cls, v):
        if v is None or v.strip() == '':
            return v
        v = v.strip()
        # Gmail App Passwords are 16 chars (with spaces removed), but allow ≥8 to be safe
        password_no_spaces = v.replace(' ', '')
        if len(password_no_spaces) < 8:
            raise ValueError(
                'App Password is too short. Gmail App Passwords are typically 16 characters.'
            )
        return v

class GlobalSettingsResponse(BaseModel):
    company_logo_url: Optional[str] = ""
    company_name: Optional[str] = ""
    company_address: Optional[str] = ""
    hr_email: Optional[str] = ""
    hr_name: Optional[str] = ""
    hr_phone: Optional[str] = ""
    offer_letter_template: Optional[str] = ""
    imap_email: Optional[str] = ""
    imap_password: Optional[str] = ""
    auto_sync_enabled: bool = False
    
    product_name: Optional[str] = ""
    dark_logo_url: Optional[str] = ""
    favicon_url: Optional[str] = ""
    footer_text: Optional[str] = ""
    support_email: Optional[str] = ""
    theme_color: Optional[str] = ""
    terms_url: Optional[str] = ""
    privacy_url: Optional[str] = ""
    seo_title_default: Optional[str] = ""
    seo_description_default: Optional[str] = ""

# ============================================================================
# Candidate Offer Actions
# ============================================================================

class OfferResponseRequest(BaseModel):
    token: str
    response_type: str  # 'accept' or 'reject'

class BulkDeleteEmailsRequest(BaseModel):
    ids: List[int]

# Rebuild model to resolve forward references
ApplicationDetailResponse.model_rebuild()

