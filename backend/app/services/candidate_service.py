from sqlalchemy.orm import Session
from app.domain.models import Application, ApplicationStage, AuditLog
from datetime import datetime
import json
from app.core.timezone import get_ist_now

class CandidateService:
    def __init__(self, db: Session):
        self.db = db

    def create_audit_log(self, user_id: int, action: str, resource_type: str, resource_id: int, details: dict = None, is_critical: bool = False):
        log = AuditLog(
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            details=json.dumps(details) if details else None,
            is_critical=is_critical
        )
        self.db.add(log)
        self.db.flush() # Keep in same transaction (Phase 8 Fix)

    def advance_stage(self, application_id: int, stage_name: str, status: str = 'pending', score: float = None, notes: str = None, evaluator_id: int = None):
        """Advance a candidate to a new pipeline stage"""
        application = self.db.query(Application).filter(Application.id == application_id).with_for_update().first() # Phase 3 Fix
        if not application:
            return None

        # Update application status to the programmatic name of the stage
        status_map = {
            "Application Submitted": "applied",
            "Resume Screening": "applied",
            "AI Interview Completed": "interview_completed",
            "Review Later": "review_later",
            "Rejected": "rejected"
        }
        
        if stage_name in status_map:
            new_status = status_map[stage_name]
            
            # Prevent status regression (e.g. don't set back to 'applied' if already 'screened' or further)
            current_status = application.status or "applied"
            
            # Simple heuristic: If we are in 'applied' stage, only update if current is 'applied'.
            # If we are in later stages, always update.
            if new_status == "applied":
                if current_status == "applied":
                    application.status = new_status
                    application.email_status = 'pending'
            else:
                application.status = new_status
                application.email_status = 'pending'

        # Create or update the stage record
        stage = self.db.query(ApplicationStage).filter(
            ApplicationStage.application_id == application_id,
            ApplicationStage.stage_name == stage_name
        ).first()

        if not stage:
            stage = ApplicationStage(
                application_id=application_id,
                stage_name=stage_name,
                started_at=get_ist_now()
            )
            self.db.add(stage)

        stage.stage_status = status
        if score is not None:
            stage.score = score
        if notes:
            stage.evaluation_notes = notes
        if evaluator_id:
            stage.evaluator_id = evaluator_id
        
        if status in ['pass', 'fail', 'hold']:
            stage.completed_at = get_ist_now()
        
        # Trigger composite score update if scores changed
        self.update_composite_score(application_id)
        
        # Combined log (Phase 8 Fix)
        self.create_audit_log(
            evaluator_id, 
            "STAGE_TRANSITION", 
            "Application", 
            application_id, 
            {"stage": stage_name, "status": status}, 
            is_critical=(status in ['pass', 'fail', 'hired'])
        )
        
        self.db.flush()
        return stage

    def update_composite_score(self, application_id: int):
        """
        Calculate composite score based on job configuration:
        - If aptitude enabled: 30% Resume + 20% Aptitude + 50% Interview
        - If aptitude NOT enabled: 40% Resume + 60% Interview
        """
        application = self.db.query(Application).filter(Application.id == application_id).with_for_update().first() # Phase 3 Fix
        if not application:
            return

        # Resume score is out of 10 in DB normally, convert to match percentage 0-100 scale
        r_val = application.resume_score or 0
        res_score = (r_val * 10) if r_val <= 10 else r_val
        
        apt_score = application.aptitude_score or 0
        int_score = application.interview_score or 0 

        # Check if job has aptitude enabled
        job_aptitude_enabled = getattr(application.job, 'aptitude_enabled', False) if application.job else False

        # Weighted calculation
        if job_aptitude_enabled:
            # Aptitude enabled: 30% Resume + 20% Aptitude + 50% Interview
            final_score = (0.3 * res_score) + (0.2 * apt_score) + (0.5 * int_score)
        else:
            # Aptitude NOT enabled: redistribute to 40% Resume + 60% Interview
            final_score = (0.4 * res_score) + (0.6 * int_score)
        
        application.composite_score = round(final_score, 2)

        # Update recommendation based on score (Point 4)
        if final_score >= 80:
            application.recommendation = "Strong Hire"
        elif final_score >= 65:
            application.recommendation = "Hire"
        elif final_score >= 50:
            application.recommendation = "Borderline"
        else:
            application.recommendation = "Reject"

        self.db.flush()

    def get_ranked_candidates(self, job_id: int):
        """Get candidates ranked by composite score for a specific job, filtered by final decision status."""
        from app.domain.constants import CandidateState
        
        # Candidates are only ranked once a definitive selection/rejection decision is made
        final_statuses = [
            CandidateState.REJECTED.value,
            CandidateState.OFFER_SENT.value,
            CandidateState.OFFER_ACCEPTED.value,
            CandidateState.OFFER_REJECTED.value,
            CandidateState.ONBOARDED.value,
        ]
        
        return self.db.query(Application).filter(
            Application.job_id == job_id,
            Application.status.in_(final_statuses)
        ).order_by(Application.composite_score.desc()).all()

    def ensure_interview_record_exists(self, application: Application) -> str:
        """
        Guarantee interview record exists for an application. 
        Returns the raw access key for the candidate.
        """
        from app.domain.models import Interview
        from app.core.auth import pwd_context
        from datetime import datetime, timedelta, timezone
        import secrets
        import uuid

        raw_access_key = secrets.token_urlsafe(16)
        hashed_key = pwd_context.hash(raw_access_key)
        expiration = get_ist_now() + timedelta(days=10)

        existing_interview = self.db.query(Interview).filter(
            Interview.application_id == application.id
        ).with_for_update().first()

        if not existing_interview:
            interview_stage = 'aptitude' if application.job.aptitude_enabled else 'first_level'
            unique_test_id = f"TEST-{uuid.uuid4().hex[:8].upper()}"

            new_interview = Interview(
                test_id=unique_test_id,
                application_id=application.id,
                status='not_started',
                access_key_hash=hashed_key,
                expires_at=expiration,
                is_used=False,
                interview_stage=interview_stage,
            )
            self.db.add(new_interview)
            self.db.flush()
            self.create_audit_log(
                None, "INTERVIEW_CREATED", "Interview", new_interview.id, 
                {"application_id": application.id, "stage": interview_stage}
            )
        else:
            # Lifecycle logic: Overwrite old key to ensure single-key integrity
            old_status = existing_interview.status
            existing_interview.access_key_hash = hashed_key
            existing_interview.expires_at = expiration
            
            # Safe reset for non-active sessions
            if existing_interview.status in ['not_started', 'cancelled', 'expired']:
                existing_interview.is_used = False
                existing_interview.status = 'not_started' 
                
            if not existing_interview.test_id:
                existing_interview.test_id = f"TEST-{uuid.uuid4().hex[:8].upper()}"
            
            self.db.flush()
            self.create_audit_log(
                None, "INTERVIEW_KEY_REGENERATED", "Interview", existing_interview.id,
                {"application_id": application.id, "previous_status": old_status}
            )

        return raw_access_key