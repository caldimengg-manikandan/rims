from enum import Enum

class CandidateState(str, Enum):
    # ── Core Pipeline ──────────────────────────────────────────────────────
    APPLIED = "applied"
    SCREENED = "screened"
    INTERVIEW_SCHEDULED = "interview_scheduled"
    INTERVIEW_COMPLETED = "interview_completed"
    REVIEW_LATER = "review_later"
    PHYSICAL_INTERVIEW = "physical_interview"

    # ── Onboarding ─────────────────────────────────────────────────────────
    OFFER_SENT = "offer_sent"
    OFFER_ACCEPTED = "offer_accepted"   # Candidate accepted via email
    OFFER_REJECTED = "offer_rejected"   # Candidate declined via email
    ONBOARDED = "onboarded"

    # ── Terminal (HR-driven) ────────────────────────────────────────────────
    REJECTED = "rejected"               # HR manually rejected the candidate


class TransitionAction(str, Enum):
    """Actions that trigger state transitions."""
    # Core Pipeline Actions
    MARK_SCREENED = "mark_screened"
    APPROVE_FOR_INTERVIEW = "approve_for_interview"
    CALL_FOR_INTERVIEW = "call_for_interview"
    COMPLETE_INTERVIEW = "complete_interview"
    REVIEW_LATER = "review_later"
    HIRE = "hire"
    REJECT = "reject"

    # Onboarding Actions
    SEND_OFFER = "send_offer"
    ACCEPT_OFFER = "accept_offer"
    DECLINE_OFFER = "decline_offer"     # Candidate-driven (email link)

    # System Actions
    SYSTEM_PARSING_COMPLETE = "system_parsing_complete"
    SYSTEM_INTERVIEW_COMPLETE = "system_interview_complete"
    SYSTEM_ONBOARD = "system_onboard"
