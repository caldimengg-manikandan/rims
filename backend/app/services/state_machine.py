
from app.core.timezone import get_ist_now

"""
Candidate State Machine — Single Source of Truth

This module implements a strict finite state machine for candidate pipeline
transitions. Every state change in the system MUST go through this module.

Design principles:
  1. Every state has explicit allowed transitions
  2. Invalid transitions are impossible (raise errors)
  3. State changes are atomic (single DB commit)
  4. State history is logged to StateTransitionLog
  5. Emails trigger ONLY after a successful state transition
"""

import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, List, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError

from app.domain.models import Application, Job, AuditLog
from app.domain.constants import CandidateState, TransitionAction

logger = logging.getLogger(__name__)



# ─────────────────────────────────────────────────────────────────────────────
# 2. Terminal States & Core Definitions
# ─────────────────────────────────────────────────────────────────────────────

# Terminal states — no transitions out of these
TERMINAL_STATES = frozenset({
    CandidateState.ONBOARDED,
    CandidateState.REJECTED
})


# ─────────────────────────────────────────────────────────────────────────────
# 2. Transition Table
# ─────────────────────────────────────────────────────────────────────────────

# Key: (current_state, action) → target_state
_TRANSITION_TABLE: Dict[Tuple[CandidateState, TransitionAction], CandidateState] = {
    # 1. applied -> screened
    (CandidateState.APPLIED, TransitionAction.SYSTEM_PARSING_COMPLETE): CandidateState.SCREENED,
    (CandidateState.APPLIED, TransitionAction.MARK_SCREENED): CandidateState.SCREENED,
    (CandidateState.APPLIED, TransitionAction.REJECT): CandidateState.REJECTED,

    # 2. screened -> interview_scheduled or rejected
    (CandidateState.SCREENED, TransitionAction.APPROVE_FOR_INTERVIEW): CandidateState.INTERVIEW_SCHEDULED,
    (CandidateState.SCREENED, TransitionAction.REJECT): CandidateState.REJECTED,

    # 3. interview_scheduled -> interview_completed (system action only) or rejected
    (CandidateState.INTERVIEW_SCHEDULED, TransitionAction.SYSTEM_INTERVIEW_COMPLETE): CandidateState.INTERVIEW_COMPLETED,
    (CandidateState.INTERVIEW_SCHEDULED, TransitionAction.COMPLETE_INTERVIEW): CandidateState.INTERVIEW_COMPLETED,
    (CandidateState.INTERVIEW_SCHEDULED, TransitionAction.REJECT): CandidateState.REJECTED,

    # 3b. in_progress -> interview_completed or rejected
    (CandidateState.IN_PROGRESS, TransitionAction.SYSTEM_INTERVIEW_COMPLETE): CandidateState.INTERVIEW_COMPLETED,
    (CandidateState.IN_PROGRESS, TransitionAction.COMPLETE_INTERVIEW): CandidateState.INTERVIEW_COMPLETED,
    (CandidateState.IN_PROGRESS, TransitionAction.REJECT): CandidateState.REJECTED,

    # 4. interview_completed -> hire / physical_interview / review_later
    #    NOTE: No reject from interview_completed per spec.
    (CandidateState.INTERVIEW_COMPLETED, TransitionAction.HIRE): CandidateState.HIRED,
    (CandidateState.INTERVIEW_COMPLETED, TransitionAction.REVIEW_LATER): CandidateState.REVIEW_LATER,
    (CandidateState.INTERVIEW_COMPLETED, TransitionAction.CALL_FOR_INTERVIEW): CandidateState.PHYSICAL_INTERVIEW,

    # 5. review_later -> physical_interview / rejected
    (CandidateState.REVIEW_LATER, TransitionAction.CALL_FOR_INTERVIEW): CandidateState.PHYSICAL_INTERVIEW,
    (CandidateState.REVIEW_LATER, TransitionAction.REJECT): CandidateState.REJECTED,

    # 6. physical_interview -> hired / rejected
    (CandidateState.PHYSICAL_INTERVIEW, TransitionAction.HIRE): CandidateState.HIRED,
    (CandidateState.PHYSICAL_INTERVIEW, TransitionAction.REJECT): CandidateState.REJECTED,

    # 7. hired -> offer_sent (direct) or via pending_approval (legacy approval flow)
    (CandidateState.HIRED, TransitionAction.SEND_FOR_APPROVAL): CandidateState.PENDING_APPROVAL,
    (CandidateState.PENDING_APPROVAL, TransitionAction.SEND_OFFER): CandidateState.OFFER_SENT,
    (CandidateState.HIRED, TransitionAction.SEND_OFFER): CandidateState.OFFER_SENT,
    (CandidateState.PENDING_APPROVAL, TransitionAction.REJECT): CandidateState.REJECTED,
    (CandidateState.HIRED, TransitionAction.REJECT): CandidateState.REJECTED,

    # 8. offer_sent -> accepted -> onboarded  (candidate-driven)
    (CandidateState.OFFER_SENT, TransitionAction.ACCEPT_OFFER): CandidateState.ACCEPTED,
    (CandidateState.ACCEPTED, TransitionAction.SYSTEM_ONBOARD): CandidateState.ONBOARDED,
    (CandidateState.OFFER_SENT, TransitionAction.REJECT): CandidateState.REJECTED,   # offer declined
    (CandidateState.ACCEPTED, TransitionAction.REJECT): CandidateState.REJECTED,
}

# Email mapping: target_state → email_type identifier
EMAIL_TRIGGERS: Dict[Tuple[TransitionAction, CandidateState], str] = {
    (TransitionAction.SYSTEM_PARSING_COMPLETE, CandidateState.SCREENED): "screened",
    (TransitionAction.MARK_SCREENED, CandidateState.SCREENED): "screened",
    (TransitionAction.APPROVE_FOR_INTERVIEW, CandidateState.INTERVIEW_SCHEDULED): "approved_for_interview",
    (TransitionAction.REJECT, CandidateState.REJECTED): "rejected",
    (TransitionAction.CALL_FOR_INTERVIEW, CandidateState.PHYSICAL_INTERVIEW): "call_for_interview",
    (TransitionAction.HIRE, CandidateState.HIRED): "hired",
}


# ─────────────────────────────────────────────────────────────────────────────
# 3. State Machine Errors
# ─────────────────────────────────────────────────────────────────────────────

class InvalidTransitionError(Exception):
    """Raised when a requested state transition is not allowed."""
    def __init__(self, current_state: str, action: str, message: str = ""):
        self.current_state = current_state
        self.action = action
        self.message = message or f"Invalid transition: cannot perform '{action}' from state '{current_state}'"
        super().__init__(self.message)


class DuplicateTransitionError(Exception):
    """Raised when attempting a transition to the same state."""
    def __init__(self, state: str):
        self.state = state
        super().__init__(f"Application is already in state '{state}'")


# ─────────────────────────────────────────────────────────────────────────────
# Friendly labels for non-technical users
# ─────────────────────────────────────────────────────────────────────────────
STATE_DISPLAY_NAMES = {
    "applied": "Applied",
    "screened": "Screened",
    "interview_scheduled": "Interview Scheduled",
    "in_progress": "In Progress",
    "interview_completed": "Interview Completed",
    "review_later": "Review Later",
    "physical_interview": "Physical Interview",
    "hired": "Hired",
    "rejected": "Rejected",
    # Onboarding sub-stages
    "offer_sent": "Offer Sent",
    "pending_approval": "Pending Approval",
    "accepted": "Offer Accepted",
    "onboarded": "Onboarded",
    # Legacy / internal
    "aptitude_round": "Aptitude Assessment",
    "ai_interview": "AI Interview",
    "permanent_failure": "Disqualified",
}

ACTION_DISPLAY_NAMES = {
    "approve_for_interview": "approve for interview",
    "send_for_approval": "stage for approval",
    "send_offer": "release offer letter",
    "accept_offer": "accept offer",
    "hire": "hire candidate",
    "reject": "reject candidate",
    "complete_interview": "complete interview",
    "fail_proctoring": "fail proctoring check",
}

def get_user_friendly_fsm_error(e: Exception) -> str:
    if isinstance(e, InvalidTransitionError):
        # If a custom message was provided instead of the default, use it.
        if e.message and not e.message.startswith("Invalid transition:"):
            return e.message
        state_display = STATE_DISPLAY_NAMES.get(e.current_state, e.current_state.replace('_', ' ').title() if e.current_state else "unknown")
        action_display = ACTION_DISPLAY_NAMES.get(e.action, e.action.replace('_', ' ').lower() if e.action else "unknown")
        return f"Cannot {action_display} because the candidate is currently in the '{state_display}' stage."
    elif isinstance(e, DuplicateTransitionError):
        state_display = STATE_DISPLAY_NAMES.get(e.state, e.state.replace('_', ' ').title() if e.state else "unknown")
        return f"The candidate's status is already set to '{state_display}'."
    return str(e)


# ─────────────────────────────────────────────────────────────────────────────
# 4. State Machine Service
# ─────────────────────────────────────────────────────────────────────────────

class CandidateStateMachine:
    """
    Strict finite state machine for candidate pipeline transitions.
    
    Usage:
        fsm = CandidateStateMachine(db)
        result = fsm.transition(application, TransitionAction.APPROVE_FOR_INTERVIEW, user_id=hr.id)
        # result.target_state, result.email_type etc.
    """

    def __init__(self, db: Session):
        self.db = db

    def get_allowed_actions(self, application: Application) -> List[str]:
        """Return list of valid actions for the current application state."""
        try:
            current = CandidateState(application.status)
        except ValueError:
            return []

        if current in TERMINAL_STATES:
            return []

        allowed = []
        for (state, action), _target in _TRANSITION_TABLE.items():
            if state == current and not action.value.startswith("system_"):
                allowed.append(action.value)

        # Add dynamic APPROVE action for 'applied' state
        if current == CandidateState.APPLIED:
            allowed.append(TransitionAction.APPROVE_FOR_INTERVIEW.value)

        return sorted(set(allowed))

    def validate_transition(
        self,
        application: Application,
        action: TransitionAction,
    ) -> CandidateState:
        """
        Validate a transition and return the target state.
        Raises InvalidTransitionError if not allowed.
        """
        try:
            current = CandidateState(application.status)
        except ValueError:
            raise InvalidTransitionError(
                application.status, action.value,
                f"Unknown current state: '{application.status}'"
            )

        # Block transitions from terminal states
        if current in TERMINAL_STATES:
            raise InvalidTransitionError(
                current.value, action.value,
                f"Cannot transition from terminal state '{current.value}'"
            )

        # Handle dynamic APPROVE transition
        if action == TransitionAction.APPROVE_FOR_INTERVIEW and current in (CandidateState.APPLIED, CandidateState.SCREENED):
            return self._resolve_approve_target(application)

        # Standard table lookup
        key = (current, action)
        if key not in _TRANSITION_TABLE:
            raise InvalidTransitionError(current.value, action.value)

        target = _TRANSITION_TABLE[key]

        # Prevent duplicate transitions
        if current == target:
            raise DuplicateTransitionError(current.value)

        return target

    def transition(
        self,
        application: Application,
        action: TransitionAction,
        user_id: Optional[int] = None,
        notes: Optional[str] = None,
        is_critical: bool = False,
        background_tasks: Optional[any] = None, # Accept BackgroundTasks from FastAPI if available
    ) -> "TransitionResult":
        """
        Execute an atomic state transition.
        """
        # 0. Idempotency Guard (Double-Click / Retry Protection)
        # Check if an identical transition occurred within the last 120 seconds.
        # We look for the action name inside the EncryptedText details.
        if user_id:
            # FETCH recent logs for this user and app (last 120 seconds)
            # We cannot use .contains() on EncryptedText columns in SQL
            recent_logs = self.db.query(AuditLog).filter(
                AuditLog.user_id == user_id,
                AuditLog.resource_id == application.id,
                AuditLog.action == "STATE_TRANSITION",
                AuditLog.created_at >= get_ist_now() - timedelta(seconds=120)
            ).all()

            for log in recent_logs:
                try:
                    log_details = json.loads(log.details)
                    if log_details.get("action") == action.value:
                        logger.warning(f"[IDEMPOTENCY] Skipping duplicate transition for App {application.id} (Action: {action.value})")
                        return TransitionResult(
                            application_id=application.id,
                            from_state=application.status,
                            to_state=application.status,
                            action=action.value,
                            email_type=None
                        )
                except Exception:
                    continue

        # 1. Acquire Row Lock with Timeout (Concurrency Hardening)
        try:
            # RLS and row locking logic for PostgreSQL (Phase 2/8)
            is_postgres = "postgresql" in str(self.db.get_bind().url).lower()
            
            if is_postgres:
                # Set a 2-second timeout for this specific lock attempt
                self.db.execute(text("SET LOCAL statement_timeout = '2s'"))
                locked_app = self.db.query(Application).with_for_update().filter(Application.id == application.id).first()
            else:
                locked_app = self.db.query(Application).filter(Application.id == application.id).first()
                
            if not locked_app:
                raise RuntimeError(f"Application {application.id} no longer exists")
            application = locked_app
        except OperationalError:
            if is_postgres:
                self.db.rollback()
                raise RuntimeError(f"Application {application.id} is currently locked by another process (Transaction Timeout). Please retry.")
            else:
                raise

        # 2. Validate
        target_state = self.validate_transition(application, action)
        
        # 2. Preconditions (including notes if required)
        self._check_preconditions(application, action, notes)
        
        old_state = application.status

        # 3. Atomic status update
        application.status = target_state.value
        application.updated_at = get_ist_now()
        application.email_status = 'pending'

        # 4. Log the transition
        self._log_transition(
            application_id=application.id,
            from_state=old_state,
            to_state=target_state.value,
            action=action.value,
            user_id=user_id,
            notes=notes,
            is_critical=is_critical,
        )


        # 5. Handle Automated Side Effects (Point 3)
        if target_state == CandidateState.INTERVIEW_COMPLETED and background_tasks:
            self._trigger_interview_report(application, background_tasks)

        # 6. Determine email trigger
        email_type = EMAIL_TRIGGERS.get((action, target_state))

        logger.info(
            f"STATE_TRANSITION: app={application.id} "
            f"{old_state} -[{action.value}]-> {target_state.value} "
            f"(user={user_id}, email={email_type})"
        )

        return TransitionResult(
            application_id=application.id,
            from_state=old_state,
            to_state=target_state.value,
            action=action.value,
            email_type=email_type,
        )

    def _trigger_interview_report(self, application: Application, background_tasks):
        """Logic to trigger AI report generation with safety checks (Point 3)."""
        if not application.interview:
            return

        # Safety Check: Prevent generating a report if < 3 questions answered
        from app.domain.models import InterviewAnswer
        answered_count = self.db.query(InterviewAnswer).filter(
            InterviewAnswer.interview_id == application.interview.id
        ).count()
        
        if answered_count < 3:
            logger.info(f"Skipping automated report for App {application.id}: only {answered_count} questions answered.")
            return

        try:
            from app.api.interviews import _finalize_interview_and_report
            background_tasks.add_task(_finalize_interview_and_report, application.interview.id)
            logger.info(f"Scheduled automated interview report for App {application.id}")
        except ImportError:
            logger.warning("Could not import report generation task (cyclic import or path mismatch)")
        except Exception as e:
            logger.error(f"Error triggering automated report: {e}")

    def _check_preconditions(
        self,
        application: Application,
        action: TransitionAction,
        notes: Optional[str] = None
    ):
        """Action-specific guard logic."""
        # Precondition: APPROVE_FOR_INTERVIEW from APPLIED requires resume parsing to be done.
        if action == TransitionAction.APPROVE_FOR_INTERVIEW:
            try:
                cur = CandidateState(application.status)
            except ValueError:
                cur = None
            if cur == CandidateState.APPLIED:
                rs = getattr(application, "resume_status", None) or "pending"
                if rs not in ("parsed", "failed") and not getattr(application, "resume_score", 0):
                    raise InvalidTransitionError(
                        application.status,
                        action.value,
                        "Resume analysis must complete successfully before approving for interview.",
                    )

        # Precondition: To HIRE, the interview must be completed (unless coming from physical interview where they might not have a digital interview).
        if action == TransitionAction.HIRE and application.status != CandidateState.PHYSICAL_INTERVIEW.value:
            if not application.interview or not application.interview.first_level_completed:
                raise InvalidTransitionError(
                    application.status, action.value,
                    "Cannot hire candidate: The interview has not been completed."
                )

    def _resolve_approve_target(self, application: Application) -> CandidateState:
        """Always route approved candidates to interview_scheduled stage."""
        return CandidateState.INTERVIEW_SCHEDULED

    def _log_transition(
        self,
        application_id: int,
        from_state: str,
        to_state: str,
        action: str,
        user_id: Optional[int] = None,
        notes: Optional[str] = None,
        is_critical: bool = False,
    ):
        """Write an audit log for every state transition."""
        details = {
            "from_state": from_state,
            "to_state": to_state,
            "action": action,
        }
        if notes:
            details["notes"] = notes

        log = AuditLog(
            user_id=user_id,
            action="STATE_TRANSITION",
            resource_type="Application",
            resource_id=application_id,
            details=json.dumps(details),
            is_critical=is_critical,
        )
        self.db.add(log)


# ─────────────────────────────────────────────────────────────────────────────
# 5. Transition Result DTO
# ─────────────────────────────────────────────────────────────────────────────

class TransitionResult:
    """Immutable result of a state transition."""

    __slots__ = ("application_id", "from_state", "to_state", "action", "email_type")

    def __init__(
        self,
        application_id: int,
        from_state: str,
        to_state: str,
        action: str,
        email_type: Optional[str],
    ):
        self.application_id = application_id
        self.from_state = from_state
        self.to_state = to_state
        self.action = action
        self.email_type = email_type

    def __repr__(self):
        return (
            f"TransitionResult(app={self.application_id}, "
            f"{self.from_state}->{self.to_state}, "
            f"action={self.action}, email={self.email_type})"
        )


# ─────────────────────────────────────────────────────────────────────────────
# 6. UI Button Mapping Helpers
# ─────────────────────────────────────────────────────────────────────────────

def get_ui_buttons_for_state(state: str) -> List[Dict[str, str]]:
    """
    Return the list of UI buttons for each pipeline state (spec-compliant).

    Application Pipeline:
      applied           → Mark as Screened, Reject
      screened          → Approve for Interview, Reject
      interview_scheduled → (no transition buttons — waiting state)
      interview_completed → Hire, Call for Physical Interview, Review Later
      review_later      → Call for Physical Interview, Reject
      physical_interview → Hire, Reject
      hired             → (no buttons in applications page; handled by onboarding)
      rejected          → (terminal)

    Onboarding Pipeline:
      hired             → Issue Offer Letter
      offer_sent        → (system/candidate driven)
      accepted          → Finalize Join
      onboarded         → Generate ID Card
    """
    buttons = []

    if state == CandidateState.APPLIED.value:
        buttons = [
            {"action": "mark_screened", "label": "Mark as Screened", "variant": "primary"},
            {"action": "reject", "label": "Reject Candidate", "variant": "destructive"},
        ]
    elif state == CandidateState.SCREENED.value:
        buttons = [
            {"action": "approve_for_interview", "label": "Approve for Interview", "variant": "primary"},
            {"action": "reject", "label": "Reject Candidate", "variant": "destructive"},
        ]
    elif state == CandidateState.INTERVIEW_SCHEDULED.value:
        # Waiting state — no HR transition buttons
        buttons = []
    elif state == CandidateState.INTERVIEW_COMPLETED.value:
        buttons = [
            {"action": "hire", "label": "Hire Candidate", "variant": "success"},
            {"action": "call_for_interview", "label": "Call for Physical Interview", "variant": "primary"},
            {"action": "review_later", "label": "Review Later", "variant": "secondary"},
        ]
    elif state == CandidateState.REVIEW_LATER.value:
        buttons = [
            {"action": "call_for_interview", "label": "Call for Physical Interview", "variant": "primary"},
            {"action": "reject", "label": "Reject Candidate", "variant": "destructive"},
        ]
    elif state == CandidateState.PHYSICAL_INTERVIEW.value:
        buttons = [
            {"action": "hire", "label": "Hire Candidate", "variant": "success"},
            {"action": "reject", "label": "Reject Candidate", "variant": "destructive"},
        ]
    elif state == CandidateState.HIRED.value:
        # Terminal in applications page; onboarding page handles offer letter
        buttons = []
    elif state == CandidateState.PENDING_APPROVAL.value:
        # Handled by onboarding page
        buttons = []
    elif state == CandidateState.ACCEPTED.value:
        buttons = [
            {"action": "capture_photo", "label": "Capture Photo", "variant": "primary"},
        ]
    elif state == CandidateState.ONBOARDED.value:
        buttons = [
            {"action": "generate_id", "label": "Generate ID Card", "variant": "success"},
        ]

    buttons.append({"action": "view_report", "label": "View Report", "variant": "outline"})

    return buttons