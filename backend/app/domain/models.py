import datetime
from datetime import timezone
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, Boolean, Float,
    ForeignKey, UniqueConstraint, CheckConstraint, Index, JSON, Enum, LargeBinary
)
from sqlalchemy.orm import relationship, backref
from sqlalchemy.sql import func
from app.infrastructure.database import Base
from app.core.encryption import EncryptedText
from app.domain.constants import CandidateState
from app.core.timezone import get_ist_now


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "role IN ('super_admin', 'hr', 'pending_hr', 'candidate')",
            name='check_users_role',
        ),
        CheckConstraint("approval_status IN ('pending', 'approved', 'rejected')", name='check_users_approval_status'),
    )

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, index=True)
    is_active = Column(Boolean, default=False)
    is_verified = Column(Boolean, default=False)
    approval_status = Column(String(20), default='pending', index=True, nullable=True)
    profile_image_url = Column(String(500), nullable=True)
    otp_code = Column(String(255), nullable=True)
    otp_expiry = Column(DateTime(timezone=True), nullable=True, index=True)
    # BUG-012 Fix: Per-account login lockout fields.
    # After 10 consecutive failed logins the account is locked for 15 minutes.
    login_attempt_count = Column(Integer, default=0, nullable=False, server_default="0")
    login_locked_until = Column(DateTime(timezone=False), nullable=True)
    otp_attempt_count = Column(Integer, default=0, nullable=False)
    otp_locked_until = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime, default=get_ist_now, server_default=func.now())
    updated_at = Column(DateTime, default=get_ist_now, server_default=func.now(), onupdate=get_ist_now)
    password_changed_at = Column(DateTime, nullable=True)

    imap_email = Column(String(255), nullable=True)
    imap_password = Column(EncryptedText, nullable=True)
    auto_sync_enabled = Column(Boolean, default=False)

    # Relationships
    jobs = relationship("Job", back_populates="hr")
    hiring_decisions = relationship("HiringDecision", back_populates="hr")
    notifications = relationship("Notification", back_populates="user")
    stages_handled = relationship("ApplicationStage", back_populates="evaluator")


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        CheckConstraint("status IN ('open', 'closed')", name='check_jobs_status'),
        # Job search performance (used by /api/jobs/public search=...).
        Index('ix_jobs_title', 'title'),
        Index('ix_jobs_description', 'description'),
        Index('ix_jobs_domain', 'domain'),
        Index('ix_jobs_location', 'location'),
        Index('ix_jobs_experience_level', 'experience_level'),
        Index('ix_jobs_primary_evaluated_skills', 'primary_evaluated_skills'),
    )

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(String(50), unique=True, index=True, nullable=True)
    interview_token = Column(String(50), unique=True, index=True, nullable=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    experience_level = Column(String(50), nullable=False)
    location = Column(String(255), default='Remote')
    mode_of_work = Column(String(50), default='Remote')
    job_type = Column(String(50), default='Full-Time')
    domain = Column(String(100), default='Engineering')
    status = Column(String(50), default='open', index=True)
    primary_evaluated_skills = Column(Text)
    aptitude_enabled = Column(Boolean, default=False)
    aptitude_mode = Column(String(50), default='ai')
    first_level_enabled = Column(Boolean, default=False)
    interview_mode = Column(String(50), nullable=True)
    behavioral_role = Column(String(50), default='general')
    uploaded_question_file = Column(String(500), nullable=True)
    aptitude_config = Column(Text, nullable=True)
    aptitude_questions_file = Column(String(500), nullable=True)  # Path to uploaded MCQ JSON
    # Repository-sourced question sets (replaces file upload when source == "repository")
    aptitude_repo_set_id = Column(Integer, ForeignKey('question_sets.id', ondelete='SET NULL'), nullable=True)
    technical_repo_set_id = Column(Integer, ForeignKey('question_sets.id', ondelete='SET NULL'), nullable=True)
    behavioural_repo_set_id = Column(Integer, ForeignKey('question_sets.id', ondelete='SET NULL'), nullable=True)
    duration_minutes = Column(Integer, default=60) # Global interview duration
    hr_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    created_at = Column(DateTime, default=get_ist_now, server_default=func.now())
    updated_at = Column(DateTime, default=get_ist_now, server_default=func.now(), onupdate=get_ist_now)
    closed_at = Column(DateTime, nullable=True)

    # Relationships
    hr = relationship("User", back_populates="jobs")
    applications = relationship("Application", back_populates="job", cascade="all, delete-orphan")


class Application(Base):
    __tablename__ = "applications"
    __table_args__ = (
        CheckConstraint(
            f"status IN ({', '.join([f'{s.value!r}' for s in CandidateState])})",
            name='check_applications_status'
        ),
        UniqueConstraint('job_id', 'candidate_email', name='uq_application_job_email'),
        # Phone is encrypted using nondeterministic Fernet encryption, so we store
        # a deterministic hash to enable uniqueness checks without decrypting.
        UniqueConstraint('job_id', 'candidate_phone_hash', name='uq_application_job_phone_hash'),
        Index('ix_applications_job_status', 'job_id', 'status'),
        Index('ix_applications_dashboard_filters', 'job_id', 'status', 'applied_at'),
    )

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, ForeignKey('jobs.id', ondelete="CASCADE"), nullable=False, index=True)
    hr_id = Column(Integer, ForeignKey('users.id', ondelete="SET NULL"), nullable=True, index=True) # Denormalized for speed
    candidate_name = Column(String(255), nullable=False)
    candidate_email = Column(String(255), nullable=False, index=True)
    candidate_phone = Column(EncryptedText)
    candidate_phone_hash = Column(String(64), nullable=True, index=True)
    # plain digits for easier debugging/validation
    # DEPRECATED (CRIT-03): candidate_phone_normalized is kept for schema compatibility but now always stores NULL.
    # The phone digits are stored in the encrypted candidate_phone field instead.
    candidate_phone_normalized = Column(String(50), nullable=True, index=True)
    # Original user-provided phone value (DEPRECATED: MED-06)
    # Stored as EncryptedText but now cleared (set to NULL) after normalization succeeds to minimize PII.
    candidate_phone_raw = Column(EncryptedText, nullable=True)
    resume_file_path = Column(String(500))
    resume_file_name = Column(String(255))
    resume_hash = Column(String(64), nullable=True, index=True) # SHA256 of content
    candidate_photo_path = Column(String(500), nullable=True)
    is_disposable_email = Column(Boolean, default=False)
    status = Column(String(50), default='applied', index=True)
    # Resume AI pipeline: pending → parsing → parsed | failed
    resume_status = Column(String(32), default='pending', index=True)

    hr_notes = Column(EncryptedText)
    
    # Composite Scores (Point 2)
    resume_score = Column(Float, default=0)
    aptitude_score = Column(Float, default=0)
    interview_score = Column(Float, default=0)
    composite_score = Column(Float, default=0, index=True)
    
    # Recommendations (Point 4)
    recommendation = Column(String(50)) # 'Strong Hire', 'Hire', 'Borderline', 'Reject'
    
    applied_at = Column(DateTime, default=get_ist_now, server_default=func.now(), index=True)
    updated_at = Column(DateTime, default=get_ist_now, server_default=func.now(), onupdate=get_ist_now)

    # Reliability & Versioning
    parsing_started_at = Column(DateTime, nullable=True)
    file_status = Column(String(20), default='active') # 'active', 'orphaned', 'deleted', 'missing'
    retry_count = Column(Integer, default=0)
    failure_reason = Column(String(1000))
    last_attempt_at = Column(DateTime)
    background_task_id = Column(String(100))
    scoring_metadata = Column(JSON, nullable=True) # JSON string of weights/logic
    email_status = Column(String(20), default='pending')
    email_sent_at = Column(DateTime, nullable=True)

    # Relationships
    job = relationship("Job", back_populates="applications")
    hr = relationship("User", foreign_keys=[hr_id])
    resume_extraction = relationship(
        "ResumeExtraction", 
        back_populates="application", 
        uselist=False, 
        cascade="all, delete-orphan",
        lazy='select'
    )
    interview = relationship("Interview", back_populates="application", uselist=False, cascade="all, delete-orphan")
    hiring_decision = relationship("HiringDecision", back_populates="application", uselist=False, cascade="all, delete-orphan")
    pipeline_stages = relationship("ApplicationStage", back_populates="application", cascade="all, delete-orphan")
    notifications = relationship("Notification", foreign_keys="[Notification.related_application_id]", cascade="all, delete-orphan")
    candidate_skills = relationship("CandidateSkill", cascade="all, delete-orphan")
    interview_sessions = relationship("InterviewSession", cascade="all, delete-orphan")  # Legacy — kept for migration safety

    # Relationships (additional)
    offer = relationship("Offer", back_populates="application", uselist=False, cascade="all, delete-orphan")
    onboarding = relationship("Onboarding", back_populates="application", uselist=False, cascade="all, delete-orphan")
    
    # Backward compatibility properties for schemas
    @property
    def offer_sent(self): return self.offer.offer_sent if self.offer else False
    @offer_sent.setter
    def offer_sent(self, value):
        if not self.offer: self.offer = Offer()
        self.offer.offer_sent = value
        
    @property
    def offer_sent_date(self): return self.offer.offer_sent_date if self.offer else None
    @offer_sent_date.setter
    def offer_sent_date(self, value):
        if not self.offer: self.offer = Offer()
        self.offer.offer_sent_date = value
        
    @property
    def offer_approval_status(self): return self.offer.offer_approval_status if self.offer else 'pending'
    @offer_approval_status.setter
    def offer_approval_status(self, value):
        if not self.offer: self.offer = Offer()
        self.offer.offer_approval_status = value
        
    @property
    def offer_response_status(self): return self.offer.offer_response_status if self.offer else 'pending'
    @offer_response_status.setter
    def offer_response_status(self, value):
        if not self.offer: self.offer = Offer()
        self.offer.offer_response_status = value
        
    @property
    def offer_response_date(self): return self.offer.offer_response_date if self.offer else None
    @offer_response_date.setter
    def offer_response_date(self, value):
        if not self.offer: self.offer = Offer()
        self.offer.offer_response_date = value
        
    @property
    def offer_token(self): return self.offer.offer_token if self.offer else None
    @offer_token.setter
    def offer_token(self, value):
        if not self.offer: self.offer = Offer()
        self.offer.offer_token = value
        
    @property
    def offer_short_id(self): return self.offer.offer_short_id if self.offer else None
    @offer_short_id.setter
    def offer_short_id(self, value):
        if not self.offer: self.offer = Offer()
        self.offer.offer_short_id = value
        
    @property
    def offer_token_used(self): return self.offer.offer_token_used if self.offer else False
    @offer_token_used.setter
    def offer_token_used(self, value):
        if not self.offer: self.offer = Offer()
        self.offer.offer_token_used = value
        
    @property
    def offer_token_expiry(self): return self.offer.offer_token_expiry if self.offer else None
    @offer_token_expiry.setter
    def offer_token_expiry(self, value):
        if not self.offer: self.offer = Offer()
        self.offer.offer_token_expiry = value
        
    @property
    def offer_pdf_path(self): return self.offer.offer_pdf_path if self.offer else None
    @offer_pdf_path.setter
    def offer_pdf_path(self, value):
        if not self.offer: self.offer = Offer()
        self.offer.offer_pdf_path = value
        
    @property
    def offer_template_snapshot(self): return self.offer.offer_template_snapshot if self.offer else None
    @offer_template_snapshot.setter
    def offer_template_snapshot(self, value):
        if not self.offer: self.offer = Offer()
        self.offer.offer_template_snapshot = value
        
    @property
    def offer_email_status(self): return self.offer.offer_email_status if self.offer else 'pending'
    @offer_email_status.setter
    def offer_email_status(self, value):
        if not self.offer: self.offer = Offer()
        self.offer.offer_email_status = value
        
    @property
    def offer_email_retry_count(self): return self.offer.offer_email_retry_count if self.offer else 0
    @offer_email_retry_count.setter
    def offer_email_retry_count(self, value):
        if not self.offer: self.offer = Offer()
        self.offer.offer_email_retry_count = value
        
    @property
    def joining_date(self): return self.onboarding.joining_date if self.onboarding else None
    @joining_date.setter
    def joining_date(self, value):
        if not self.onboarding: self.onboarding = Onboarding()
        self.onboarding.joining_date = value
        
    @property
    def employee_id(self): return self.onboarding.employee_id if self.onboarding else None
    @employee_id.setter
    def employee_id(self, value):
        if not self.onboarding: self.onboarding = Onboarding()
        self.onboarding.employee_id = value
        
    @property
    def id_card_url(self): return self.onboarding.id_card_url if self.onboarding else None
    @id_card_url.setter
    def id_card_url(self, value):
        if not self.onboarding: self.onboarding = Onboarding()
        self.onboarding.id_card_url = value
        
    @property
    def onboarded_at(self): return self.onboarding.onboarded_at if self.onboarding else None
    @onboarded_at.setter
    def onboarded_at(self, value):
        if not self.onboarding: self.onboarding = Onboarding()
        self.onboarding.onboarded_at = value
        
    @property
    def offer_approved_by(self): return self.offer.offer_approved_by if self.offer else None
    @offer_approved_by.setter
    def offer_approved_by(self, value):
        if not self.offer: self.offer = Offer()
        self.offer.offer_approved_by = value
        
    @property
    def offer_approved_at(self): return self.offer.offer_approved_at if self.offer else None
    @offer_approved_at.setter
    def offer_approved_at(self, value):
        if not self.offer: self.offer = Offer()
        self.offer.offer_approved_at = value
        
    @property
    def offer_accepted_ip(self): return self.offer.offer_accepted_ip if self.offer else None
    @offer_accepted_ip.setter
    def offer_accepted_ip(self, value):
        if not self.offer: self.offer = Offer()
        self.offer.offer_accepted_ip = value
        
    @property
    def offer_accepted_user_agent(self): return self.offer.offer_accepted_user_agent if self.offer else None
    @offer_accepted_user_agent.setter
    def offer_accepted_user_agent(self, value):
        if not self.offer: self.offer = Offer()
        self.offer.offer_accepted_user_agent = value

    @property
    def reminder_sent_at(self): return self.offer.reminder_sent_at if self.offer else None
    @reminder_sent_at.setter
    def reminder_sent_at(self, value):
        if not self.offer: self.offer = Offer()
        self.offer.reminder_sent_at = value


class Offer(Base):
    __tablename__ = "offers"
    
    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(Integer, ForeignKey('applications.id', ondelete="CASCADE"), nullable=False, unique=True, index=True)
    offer_sent = Column(Boolean, default=False)
    offer_sent_date = Column(DateTime)
    offer_approval_status = Column(String(20), default='pending') # 'pending', 'approved', 'rejected'
    offer_approved_by = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    offer_approved_at = Column(DateTime)
    offer_response_status = Column(String(20), default='pending') # 'pending', 'accepted', 'rejected'
    offer_response_date = Column(DateTime)
    offer_token = Column(String(100), unique=True, index=True)
    offer_short_id = Column(String(20), unique=True, index=True)
    offer_token_expiry = Column(DateTime(timezone=True))
    offer_token_used = Column(Boolean, default=False)
    offer_template_snapshot = Column(Text)
    offer_pdf_path = Column(String(500))
    offer_accepted_ip = Column(String(50))
    offer_accepted_user_agent = Column(Text)
    offer_email_status = Column(String(20), default='pending')
    offer_email_retry_count = Column(Integer, default=0)
    reminder_sent_at = Column(DateTime)
    offer_preview_count = Column(Integer, default=0, nullable=False)
    
    application = relationship("Application", back_populates="offer")
    approver = relationship("User", foreign_keys=[offer_approved_by])


class Onboarding(Base):
    __tablename__ = "onboardings"
    
    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(Integer, ForeignKey('applications.id', ondelete="CASCADE"), nullable=False, unique=True, index=True)
    joining_date = Column(DateTime)
    employee_id = Column(String(50), unique=True, index=True)
    id_card_url = Column(String(500))
    onboarded_at = Column(DateTime)
    
    application = relationship("Application", back_populates="onboarding")


class ApplicationStage(Base):
    __tablename__ = "application_stages"
    
    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(Integer, ForeignKey('applications.id', ondelete="CASCADE"), nullable=False, index=True)
    stage_name = Column(String(100), nullable=False, index=True) # e.g., 'Aptitude Round'
    stage_status = Column(String(50), default='pending', index=True) # 'pending', 'pass', 'fail', 'hold'
    score = Column(Float, nullable=True)
    evaluation_notes = Column(EncryptedText)
    evaluator_id = Column(Integer, ForeignKey('users.id', ondelete="SET NULL"), nullable=True)
    started_at = Column(DateTime)
    completed_at = Column(DateTime)
    created_at = Column(DateTime, default=get_ist_now, server_default=func.now())

    # Relationships
    application = relationship("Application", back_populates="pipeline_stages")
    evaluator = relationship("User", back_populates="stages_handled")


class ResumeExtraction(Base):
    __tablename__ = "resume_extractions"

    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(Integer, ForeignKey('applications.id', ondelete="CASCADE"), nullable=False, unique=True, index=True)
    extracted_text = Column(EncryptedText)
    summary = Column(Text)  # Added summary field
    extracted_skills = Column(Text)  # JSON array
    years_of_experience = Column(Float)
    education = Column(Text)  # JSON array
    previous_roles = Column(Text)  # JSON array
    experience_level = Column(String(50))  # 'Intern', 'Junior', 'Mid-Level', 'Senior', 'Lead'
    resume_score = Column(Float, default=0)  # Out of 10
    skill_match_percentage = Column(Float, default=0)  # Out of 100
    # Identity details extracted from resume
    candidate_name = Column(String(255), nullable=True)
    email = Column(String(255), nullable=True)
    phone_number = Column(String(50), nullable=True)
    reasoning = Column(JSON, nullable=True)  # AI reasoning for scores

    created_at = Column(DateTime, default=get_ist_now, server_default=func.now())
    updated_at = Column(DateTime, default=get_ist_now, server_default=func.now(), onupdate=get_ist_now)


    # Relationships
    application = relationship("Application", back_populates="resume_extraction")


class Interview(Base):
    __tablename__ = "interviews"

    id = Column(Integer, primary_key=True, index=True)
    test_id = Column(String(50), unique=True, index=True, nullable=True)  # New Test ID field
    application_id = Column(Integer, ForeignKey('applications.id', ondelete="CASCADE"), nullable=False, unique=True, index=True)
    status = Column(String(50), default='not_started', index=True)  # 'not_started', 'in_progress', 'completed', 'cancelled'
    locked_skill = Column(String(50))  # e.g. 'backend', 'frontend'
    total_questions = Column(Integer, default=20)
    questions_asked = Column(Integer, default=0)
    current_difficulty = Column(String(20), default='medium') # 'easy', 'medium', 'hard'
    overall_score = Column(Float)
    started_at = Column(DateTime, index=True)
    ended_at = Column(DateTime, index=True)
    access_key_hash = Column(String(255))
    expires_at = Column(DateTime)
    is_used = Column(Boolean, default=False)
    used_at = Column(DateTime)
    interview_stage = Column(String(50), default='first_level')  # 'aptitude', 'first_level'
    aptitude_score = Column(Float, nullable=True)
    aptitude_completed_at = Column(DateTime, nullable=True)
    duration_minutes = Column(Integer, default=60) # Snapshot of job duration when started
    aptitude_completed = Column(Boolean, default=False)
    first_level_completed = Column(Boolean, default=False)
    first_level_score = Column(Float, nullable=True)
    video_recording_path = Column(String(500), nullable=True)
    risk_score = Column(Float, default=0.0, nullable=False, server_default='0.0')
    is_terminated_by_violations = Column(Boolean, default=False, nullable=False, server_default='0')
    active_session_jti = Column(String(50), nullable=True)
    # Marks interviews created via the /demo endpoint as provisional.
    # When True: application + interview records are deleted on early-end,
    # proctoring auto-termination, or abandon. Report is only generated on
    # successful completion.
    is_demo = Column(Boolean, default=False, nullable=False, server_default='0')
    created_at = Column(DateTime, default=get_ist_now, server_default=func.now())
    updated_at = Column(DateTime, default=get_ist_now, server_default=func.now(), onupdate=get_ist_now)


    # Relationships
    application = relationship("Application", back_populates="interview")
    questions = relationship(
        "InterviewQuestion",
        back_populates="interview",
        cascade="all, delete-orphan",
        passive_deletes=True
    )
    report = relationship(
        "InterviewReport",
        back_populates="interview",
        uselist=False,
        cascade="all, delete-orphan",
        passive_deletes=True
    )
    issues = relationship(
        "InterviewIssue",
        back_populates="interview",
        cascade="all, delete-orphan",
        passive_deletes=True
    )
    feedback = relationship(
        "InterviewFeedback",
        back_populates="interview",
        uselist=False,
        cascade="all, delete-orphan",
        passive_deletes=True
    )



class InterviewQuestion(Base):
    __tablename__ = "interview_questions"
    __table_args__ = (
        UniqueConstraint('interview_id', 'question_number', name='uq_interview_question_number'),
    )

    id = Column(Integer, primary_key=True, index=True)
    interview_id = Column(Integer, ForeignKey('interviews.id', ondelete="CASCADE"), nullable=False, index=True)
    question_number = Column(Integer, nullable=False)
    question_text = Column(Text, nullable=False)
    question_type = Column(String(100))  # 'aptitude', 'behavioral', 'technical', 'follow_up'
    expected_points = Column(JSON, nullable=True) # AI-generated rubric for this question
    options = Column(Text, nullable=True)  # JSON array for multiple choice options
    correct_answer = Column(Text, nullable=True)
    ai_generated_at = Column(DateTime, default=get_ist_now)
    created_at = Column(DateTime, default=get_ist_now)
    
    # Relationships
    interview = relationship("Interview", back_populates="questions")
    answers = relationship("InterviewAnswer", back_populates="question", cascade="all, delete-orphan")


class InterviewAnswer(Base):
    __tablename__ = "interview_answers"
    __table_args__ = (
        UniqueConstraint('interview_id', 'question_id', name='uq_answer_per_question'),
    )

    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(Integer, ForeignKey('interview_questions.id', ondelete="CASCADE"), nullable=False, index=True)
    interview_id = Column(Integer, ForeignKey('interviews.id', ondelete="CASCADE"), index=True, nullable=False)
    answer_text = Column(EncryptedText, nullable=False)
    answer_score = Column(Float)  # 1-10
    answer_evaluation = Column(EncryptedText)  # AI evaluation
    skill_relevance_score = Column(Float)
    technical_score = Column(Float, nullable=True)
    completeness_score = Column(Float, nullable=True)
    depth_score = Column(Float, nullable=True)
    ai_used = Column(Boolean, default=False)
    fallback_used = Column(Boolean, default=False)
    confidence_score = Column(Float, nullable=True)
    reasoning = Column(JSON, nullable=True)  # AI reasoning for scores
    submitted_at = Column(DateTime(timezone=True), default=get_ist_now)
    evaluated_at = Column(DateTime)

    # Relationships
    question = relationship("InterviewQuestion", back_populates="answers")
    interview = relationship("Interview")
    evaluation = relationship("AIEvaluation", back_populates="answer", uselist=False, cascade="all, delete-orphan")
    versions = relationship("InterviewAnswerVersion", back_populates="answer", cascade="all, delete-orphan")


class InterviewAnswerVersion(Base):
    __tablename__ = "interview_answer_versions"

    id = Column(Integer, primary_key=True, index=True)
    answer_id = Column(Integer, ForeignKey('interview_answers.id', ondelete="CASCADE"), nullable=False, index=True)
    answer_text = Column(EncryptedText, nullable=False)
    answer_score = Column(Float, nullable=True)
    submitted_at = Column(DateTime(timezone=True), default=get_ist_now)
    version_number = Column(Integer, default=1)

    answer = relationship("InterviewAnswer", back_populates="versions")


class InterviewReport(Base):
    __tablename__ = "interview_reports"

    id = Column(Integer, primary_key=True, index=True)
    interview_id = Column(Integer, ForeignKey('interviews.id', ondelete="CASCADE"), nullable=False, unique=True, index=True)
    application_id = Column(Integer, ForeignKey('applications.id', ondelete="CASCADE"), nullable=True, index=True)
    job_id = Column(Integer, ForeignKey('jobs.id', ondelete="CASCADE"), nullable=True, index=True)
    overall_score = Column(Float)
    technical_skills_score = Column(Float)
    communication_score = Column(Float)
    problem_solving_score = Column(Float)
    candidate_name = Column(String(255))
    candidate_email = Column(String(255))
    applied_role = Column(String(255))
    summary = Column(EncryptedText)
    strengths = Column(EncryptedText)  # JSON array or text
    weaknesses = Column(EncryptedText)  # JSON array or text
    recommendation = Column(String(50))  # 'recommended', 'consider', 'not_recommended'
    detailed_feedback = Column(EncryptedText)
    aptitude_score = Column(Float, nullable=True)
    behavioral_score = Column(Float, nullable=True)
    combined_score = Column(Float, nullable=True)
    evaluated_skills = Column(Text)  # JSON array of evaluated skills
    termination_reason = Column(String(255), nullable=True)
    ai_used = Column(Boolean, default=False)
    fallback_used = Column(Boolean, default=False)
    reasoning = Column(JSON, nullable=True)  # AI reasoning for scores
    confidence_score = Column(Float, nullable=True)
    retry_count = Column(Integer, default=0)
    failure_reason = Column(String(1000))
    created_at = Column(DateTime, default=get_ist_now, server_default=func.now())
    updated_at = Column(DateTime, default=get_ist_now, server_default=func.now(), onupdate=get_ist_now)

    # Relationships
    interview = relationship("Interview", back_populates="report")


class HiringDecision(Base):
    __tablename__ = "hiring_decisions"
    __table_args__ = (
        CheckConstraint("decision IN ('hired', 'rejected')", name='check_hiring_decision'),
    )

    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(Integer, ForeignKey('applications.id', ondelete="CASCADE"), nullable=False, unique=True, index=True)
    hr_id = Column(Integer, ForeignKey('users.id', ondelete="SET NULL"), index=True)
    decision = Column(String(20), nullable=False)  # 'hired', 'rejected'
    decision_comments = Column(EncryptedText)
    joining_date = Column(DateTime)
    offer_letter_path = Column(String(500))
    decided_at = Column(DateTime, default=get_ist_now, server_default=func.now())
    created_at = Column(DateTime, default=get_ist_now, server_default=func.now())

    # Relationships
    application = relationship("Application", back_populates="hiring_decision")
    hr = relationship("User", back_populates="hiring_decisions")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    notification_type = Column(String(50), nullable=False)
    title = Column(String(255), nullable=False)
    message = Column(EncryptedText, nullable=False)
    is_read = Column(Boolean, default=False, index=True)
    related_application_id = Column(Integer, ForeignKey('applications.id', ondelete="CASCADE"))
    related_interview_id = Column(Integer, ForeignKey('interviews.id', ondelete="CASCADE"))
    created_at = Column(DateTime, default=get_ist_now, server_default=func.now(), index=True)
    read_at = Column(DateTime)

    # Relationships
    user = relationship("User", back_populates="notifications")



class InterviewIssue(Base):
    __tablename__ = "interview_issues"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'resolved', 'dismissed')", name='check_issue_status'),
    )

    id = Column(Integer, primary_key=True, index=True)
    interview_id = Column(Integer, ForeignKey('interviews.id', ondelete="CASCADE"), nullable=True, index=True)
    application_id = Column(Integer, ForeignKey('applications.id', ondelete="CASCADE"), nullable=True, index=True)
    candidate_name = Column(String(255))
    candidate_email = Column(String(255), index=True)
    issue_type = Column(String(100), index=True)  # 'interruption', 'technical', 'misconduct_appeal'
    description = Column(Text, nullable=False)
    status = Column(String(20), default='pending', index=True)
    hr_response = Column(Text)
    is_reissue_granted = Column(Boolean, default=False)
    created_at = Column(DateTime, default=get_ist_now, server_default=func.now(), index=True)
    resolved_at = Column(DateTime)

    # Relationships
    application = relationship("Application", backref="interview_issues")
    interview = relationship("Interview", back_populates="issues")


class InterviewFeedback(Base):
    __tablename__ = "interview_feedbacks"

    id = Column(Integer, primary_key=True, index=True)
    interview_id = Column(Integer, ForeignKey('interviews.id', ondelete="CASCADE"), nullable=False, unique=True, index=True)
    ui_ux_rating = Column(Integer)  # 1-5
    feedback_text = Column(Text)
    created_at = Column(DateTime, default=get_ist_now, server_default=func.now())

    # Relationships
    interview = relationship("Interview", back_populates="feedback")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=True, index=True)
    action = Column(String(255), nullable=False) # e.g., 'RESUME_SCREENING_COMPLETED'
    resource_type = Column(String(100)) # e.g., 'Application'
    resource_id = Column(Integer)
    details = Column(EncryptedText) 
    ip_address = Column(String(50))
    is_critical = Column(Boolean, default=False)
    created_at = Column(DateTime, default=get_ist_now, server_default=func.now(), index=True)

    # Relationships
    user = relationship("User")


class InterviewSession(Base):
    __tablename__ = "interview_sessions"

    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(Integer, ForeignKey('users.id', ondelete="CASCADE"), nullable=False, index=True)
    job_id = Column(Integer, ForeignKey('jobs.id', ondelete="CASCADE"), nullable=False, index=True)
    application_id = Column(Integer, ForeignKey('applications.id', ondelete="CASCADE"), nullable=True, index=True)
    start_time = Column(DateTime(timezone=True), default=get_ist_now)
    end_time = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(50), default='pending', index=True)  # 'pending', 'active', 'completed', 'aborted'
    final_score = Column(Float, nullable=True)
    difficulty_level = Column(String(50), default='medium')

    # Relationships
    application = relationship("Application", back_populates="interview_sessions")

    # Relationships
    events = relationship("InterviewEvent", back_populates="session", cascade="all, delete-orphan")


class InterviewEvent(Base):
    __tablename__ = "interview_events"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey('interview_sessions.id'), nullable=False, index=True)
    event_type = Column(String(50), nullable=False)  # 'question_asked', 'answer_received', 'ai_evaluated', 'status_changed'
    payload = Column(Text, nullable=True)  # JSON serialized data
    created_at = Column(DateTime(timezone=True), default=get_ist_now, index=True)

    # Relationships
    session = relationship("InterviewSession", back_populates="events")


class InterviewMonitoringEvent(Base):
    __tablename__ = "interview_monitoring_events"

    id = Column(Integer, primary_key=True, index=True)
    interview_id = Column(Integer, ForeignKey('interviews.id', ondelete="CASCADE"), nullable=False, index=True)
    event_type = Column(String(50), nullable=False, index=True)  # 'focus_lost', 'multiple_faces', 'no_face', 'normal'
    timestamp = Column(DateTime(timezone=True), default=get_ist_now, index=True)
    confidence_score = Column(Float, nullable=True)
    frame_image_path = Column(String(500), nullable=True)  # Cloud storage path
    video_reference = Column(String(255), nullable=True)  # Video offset or segment
    is_false_positive = Column(Boolean, default=False, nullable=False, server_default='0')
    details = Column(Text, nullable=True)

    interview = relationship(
        "Interview",
        backref=backref("monitoring_events", cascade="all, delete-orphan", passive_deletes=True),
    )


class QuestionBank(Base):
    __tablename__ = "question_bank"

    id = Column(Integer, primary_key=True, index=True)
    domain = Column(String(100), index=True)  # e.g. 'Engineering', 'Sales'
    role = Column(String(100), index=True)    # e.g. 'Frontend', 'Backend'
    difficulty = Column(String(50), index=True) # 'easy', 'medium', 'hard'
    question_text = Column(Text, nullable=False)
    expected_key_points = Column(Text) # JSON array of points
    created_at = Column(DateTime(timezone=True), default=get_ist_now)


class QuestionSet(Base):
    """
    A reusable, named collection of questions for a specific round type.
    Used by the Repository feature — HR picks a set instead of uploading a file.
    """
    __tablename__ = "question_sets"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    round_type = Column(String(50), nullable=False, index=True)  # aptitude | technical | behavioural
    job_roles = Column(Text, nullable=True)    # JSON array of role tags, e.g. ["Steel Detailer", "CAD Engineer"]
    questions = Column(Text, nullable=False)   # JSON array of question objects
    topic_tags = Column(Text, nullable=True)   # JSON array of topic strings for display
    hr_id = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), default=get_ist_now, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), default=get_ist_now, server_default=func.now(), onupdate=get_ist_now)


class CandidateSkill(Base):
    __tablename__ = "candidate_skills"

    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(Integer, ForeignKey('applications.id', ondelete="CASCADE"), nullable=False, index=True)
    skill_name = Column(String(100), nullable=False, index=True)
    proficiency_score = Column(Float, nullable=True) # 0-10 based on AI analysis
    years_experience = Column(Float, nullable=True)

    # Relationships
    application = relationship("Application", back_populates="candidate_skills")


class AIEvaluation(Base):
    __tablename__ = "ai_evaluations"

    id = Column(Integer, primary_key=True, index=True)
    answer_id = Column(Integer, ForeignKey('interview_answers.id', ondelete="CASCADE"), nullable=False, index=True)
    technical_score = Column(Float)
    communication_score = Column(Float)
    reasoning_score = Column(Float)
    feedback_text = Column(Text)
    created_at = Column(DateTime(timezone=True), default=get_ist_now)

    # Relationships
    answer = relationship("InterviewAnswer", back_populates="evaluation")


class GlobalSettings(Base):
    __tablename__ = "global_settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(100), unique=True, nullable=False, index=True)
    value = Column(EncryptedText, nullable=False)
    created_at = Column(DateTime, default=get_ist_now)
    updated_at = Column(DateTime, default=get_ist_now, onupdate=get_ist_now)


class JobVersion(Base):
    __tablename__ = "job_versions"
    __table_args__ = (UniqueConstraint('job_id', 'version_number', name='uq_job_version'),)

    id = Column(Integer, primary_key=True)
    job_id = Column(Integer, ForeignKey('jobs.id', ondelete='CASCADE'))
    version_number = Column(Integer, nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    primary_evaluated_skills = Column(Text)
    experience_level = Column(String(50))
    created_at = Column(DateTime, default=get_ist_now)


class ResumeExtractionVersion(Base):
    __tablename__ = "resume_extraction_versions"
    __table_args__ = (UniqueConstraint('application_id', 'version_number', name='uq_resume_version'),)

    id = Column(Integer, primary_key=True)
    application_id = Column(Integer, ForeignKey('applications.id', ondelete='CASCADE'))
    version_number = Column(Integer, nullable=False)
    extracted_text = Column(EncryptedText)
    extracted_skills = Column(Text)
    resume_score = Column(Float)
    created_at = Column(DateTime, default=get_ist_now)


class InterviewReportVersion(Base):
    __tablename__ = "interview_report_versions"
    __table_args__ = (UniqueConstraint('interview_id', 'version_number', name='uq_report_version'),)

    id = Column(Integer, primary_key=True)
    interview_id = Column(Integer, ForeignKey('interviews.id', ondelete='CASCADE'))
    version_number = Column(Integer, nullable=False)
    overall_score = Column(Float)
    summary = Column(EncryptedText)
    created_at = Column(DateTime, default=get_ist_now)

class AttachmentResume(Base):
    __tablename__ = "attachment_resumes"
    __table_args__ = (
        Index('ix_attachment_resumes_duplicate_detection', 'sender_email', 'subject', 'received_at'),
    )
    
    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(String(255), unique=True, index=True, nullable=True)
    sender_email = Column(String(255), index=True)
    subject = Column(String(500))
    file_name = Column(String(255))
    file_data = Column(LargeBinary, nullable=True) # Optional now
    file_url = Column(String(1000), nullable=True) # Added for Supabase Storage
    email_body = Column(Text, nullable=True) # Added to store email text
    mime_type = Column(String(100))
    received_at = Column(DateTime, default=get_ist_now)
    processed = Column(Boolean, default=False)
    mapping_failed = Column(Boolean, default=False, server_default="false")
    retry_count = Column(Integer, default=0)
    last_error = Column(Text, nullable=True) # Store error messages for debugging
    hr_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=True, index=True)
    
    hr = relationship("User", foreign_keys=[hr_id])


class RevokedToken(Base):
    __tablename__ = "revoked_tokens"
    
    id = Column(Integer, primary_key=True, index=True)
    jti = Column(String(255), unique=True, index=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=get_ist_now)


