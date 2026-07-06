# Candidate States and Actions Directory

This document provides a complete lookup of candidate application stages (states) and the corresponding actions (FSM transitions) or UI buttons available in each stage.

---

## 1. Main Application Pipeline

### `applied` (Applied)
* **Description:** Candidate has submitted their application and resume.
* **UI Buttons:**
  * **Mark as Screened** (`mark_screened`, Primary)
  * **Reject Candidate** (`reject`, Destructive)
  * **View Report** (`view_report`, Outline)
* **Allowed FSM Actions:**
  * `mark_screened` (Transitions to `screened`)
  * `reject` (Transitions to `rejected`)

### `screened` (Screened)
* **Description:** Candidate resume has been parsed and screened.
* **UI Buttons:**
  * **Approve for Interview** (`approve_for_interview`, Primary)
  * **Reject Candidate** (`reject`, Destructive)
  * **View Report** (`view_report`, Outline)
* **Allowed FSM Actions:**
  * `approve_for_interview` (Transitions to `interview_scheduled`)
  * `reject` (Transitions to `rejected`)

### `interview_scheduled` (Interview Scheduled)
* **Description:** Candidate is scheduled/authorized for the AI interview. No manual transitions are exposed to HR in the UI in this waiting state.
* **UI Buttons:**
  * **View Report** (`view_report`, Outline)
* **Allowed FSM Actions:**
  * `system_interview_complete` (Transitions to `interview_completed`)
  * `complete_interview` (Transitions to `interview_completed`)
  * `reject` (Transitions to `rejected`)

### `interview_completed` (Interview Completed)
* **Description:** Candidate has completed their online interview.
* **UI Buttons:**
  * **Hire Candidate** (`hire`, Success)
  * **Call for Physical Interview** (`call_for_interview`, Primary)
  * **Review Later** (`review_later`, Secondary)
  * **View Report** (`view_report`, Outline)
* **Allowed FSM Actions:**
  * `hire` - Triggers selection flow:
    1. Prompt: *"Are you sure to hire this candidate?"*
    2. Prompt: *"Issue offer letter?"* (previously asked on onboarding page)
    3. HR chooses the joining date and confirms.
    4. Successful validation transitions candidate directly to `offer_sent` and updates the onboarding pipeline.
    5. Rejection/cancellation at any prompt reverts back to the previous state.
  * `review_later` (Transitions to `review_later`)
  * `call_for_interview` (Transitions to `physical_interview`)

### `review_later` (Review Later)
* **Description:** HR has decided to evaluate the candidate at a later date.
* **UI Buttons:**
  * **Call for Physical Interview** (`call_for_interview`, Primary)
  * **Reject Candidate** (`reject`, Destructive)
  * **View Report** (`view_report`, Outline)
* **Allowed FSM Actions:**
  * `call_for_interview` (Transitions to `physical_interview`)
  * `reject` (Transitions to `rejected`)

### `physical_interview` (Physical Interview)
* **Description:** Candidate is scheduled for an offline in-person round.
* **UI Buttons:**
  * **Hire Candidate** (`hire`, Success)
  * **Reject Candidate** (`reject`, Destructive)
  * **View Report** (`view_report`, Outline)
* **Allowed FSM Actions:**
  * `hire` - Triggers selection flow:
    1. Prompt: *"Are you sure to hire this candidate?"*
    2. Prompt: *"Issue offer letter?"* (previously asked on onboarding page)
    3. HR chooses the joining date and confirms.
    4. Successful validation transitions candidate directly to `offer_sent` and updates the onboarding pipeline.
    5. Rejection/cancellation at any prompt reverts back to the previous state.
  * `reject` (Transitions to `rejected`)

---

## 2. Onboarding & Post-Selection Pipeline

### `offer_sent` (Offer Sent)
* **Description:** HR has selected the candidate, issued the offer letter, and moved them to the Onboarding Pipeline.
* **UI Buttons:**
  * **View Report** (`view_report`, Outline)
* **Allowed FSM Actions:** *(Only candidate-driven via email interaction)*
  * `accept_offer` (Transitions to `offer_accepted`)
  * `reject` (Transitions to `offer_rejected` — candidate declined or expired)

### `offer_accepted` (Offer Accepted)
* **Description:** Candidate has accepted the offer letter.
* **UI Buttons:**
  * **Capture Photo** (`capture_photo`, Primary)
  * **View Report** (`view_report`, Outline)
* **Allowed FSM Actions:**
  * `system_onboard` (Transitions to `onboarded`)

### `onboarded` (Onboarded)
* **Description:** Onboarding steps completed. This is a terminal state.
* **UI Buttons:**
  * **Generate ID Card** (`generate_id`, Success)
  * **View Report** (`view_report`, Outline)
* **Allowed FSM Actions:** None (Terminal state)

### `offer_rejected` (Offer Rejected)
* **Description:** Candidate has rejected the offer letter. This is a terminal state.
* **UI Buttons:**
  * **View Report** (`view_report`, Outline)
* **Allowed FSM Actions:** None (Terminal state)