from enum import Enum

class CandidateState(str, Enum):
    # Core Production Workflow
    APPLIED = "applied"
    SCREENED = "screened"  # After resume parsing/screening
    APTITUDE_ROUND = "aptitude_round"
    AI_INTERVIEW = "ai_interview"
    INTERVIEW_SCHEDULED = "interview_scheduled"
    IN_PROGRESS = "in_progress"
    INTERVIEW_COMPLETED = "interview_completed"
    HIRED = "hired"
    PENDING_APPROVAL = "pending_approval"
    OFFER_SENT = "offer_sent"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    ONBOARDED = "onboarded"
    PHYSICAL_INTERVIEW = "physical_interview"
    REVIEW_LATER = "review_later"
    PERMANENT_FAILURE = "permanent_failure"

class TransitionAction(str, Enum):
    """Actions that trigger state transitions."""
    # Core Workflow Actions
    APPROVE_FOR_INTERVIEW = "approve_for_interview"
    REJECT = "reject"
    CALL_FOR_INTERVIEW = "call_for_interview"
    REVIEW_LATER = "review_later"
    HIRE = "hire"
    MARK_SCREENED = "mark_screened"
    SCHEDULE_INTERVIEW = "schedule_interview"
    COMPLETE_INTERVIEW = "complete_interview"

    # Onboarding Actions
    SEND_FOR_APPROVAL = "send_for_approval"
    SEND_OFFER = "send_offer"
    ACCEPT_OFFER = "accept_offer"

    # System/Heuristic actions
    SYSTEM_RETRY_EXTRACTION = "system_retry_extraction"
    SYSTEM_MARK_DEGRADED = "system_mark_degraded"
    SYSTEM_PARSING_COMPLETE = "system_parsing_complete"
    SYSTEM_APTITUDE_COMPLETE = "system_aptitude_complete"
    SYSTEM_INTERVIEW_COMPLETE = "system_interview_complete"
    SYSTEM_ONBOARD = "system_onboard"
    MARK_PERMANENT_FAILURE = "mark_permanent_failure"
