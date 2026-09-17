from sqlalchemy.orm import Session
from datetime import datetime, timezone
import json
import logging
import asyncio
from app.core.config import get_settings
from app.domain.models import Interview, Application, Job, InterviewReportVersion
from app.core.timezone import get_ist_now

# Import termination checker (reuse analyzer singleton from ai_service)
try:
    from backend.interview_process.response_analyzer import ResponseAnalyzer as _RA
except ImportError:
    from interview_process.response_analyzer import ResponseAnalyzer as _RA
_termination_checker = _RA()


logger = logging.getLogger(__name__)
settings = get_settings()



async def _finalize_interview_and_report(interview_id: int):
    """
    Background-task safe wrapper that creates its own DB session.
    """
    from app.infrastructure.database import SessionLocal

    last_err = None
    for attempt in range(1, 4):
        db = SessionLocal()
        try:
            await _finalize_interview_and_report_internal(db, interview_id)
            return
        except Exception as e:
            last_err = e
            logger.error(f"Finalize/report retry attempt {attempt} failed for interview {interview_id}: {e}")
        finally:
            db.close()
    logger.error(f"Finalize/report failed after retries for interview {interview_id}: {last_err}")


async def _finalize_interview_and_report_internal(db: Session, interview_id: int, term_reason: str = None):
    """
    Internal helper to calculate final scores, generate the AI report, 
    and send notifications. Reusable for normal completion and auto-termination.
    """
    from app.services.ai_service import generate_interview_report
    from app.core.config import get_settings
    from app.domain.models import InterviewReport, InterviewQuestion, Notification
    from app.services.email_service import send_interview_completed_email, send_interview_terminated_email
    from app.services.interview_generation_service import _set_interview_status
    
    # 1. Fetch live interview state with row-level lock to prevent double reporting
    interview = db.query(Interview).filter(Interview.id == interview_id).with_for_update().first()
    if not interview:
        logger.error(f"Finalization failed: Interview {interview_id} not found.")
        return None

    # Determine status if not already set (default to completed)
    if interview.status == "in_progress":
        _set_interview_status(interview, "completed")
    if not interview.ended_at:
        interview.ended_at = get_ist_now()

    # Auto-resolve any pending support tickets for this interview upon successful completion
    if interview.status == "completed":
        try:
            from app.domain.models import InterviewIssue
            pending_tickets = db.query(InterviewIssue).filter(
                InterviewIssue.interview_id == interview_id,
                InterviewIssue.status == "pending"
            ).all()
            for ticket in pending_tickets:
                ticket.status = "resolved"
                ticket.resolved_at = get_ist_now()
                ticket.hr_response = "Resolved automatically upon successful interview completion."
        except Exception as e:
            logger.error(f"Failed to auto-resolve pending tickets for interview {interview_id}: {e}")
    
    # 2. Calculate scores
    # Optimized: Fetch questions and latest answers in a single join to avoid N+1 queries
    from sqlalchemy.orm import contains_eager
    
    questions = (
        db.query(InterviewQuestion)
        .outerjoin(InterviewQuestion.answers)
        .filter(
            InterviewQuestion.interview_id == interview_id,
            InterviewQuestion.question_type != "aptitude"
        )
        .options(contains_eager(InterviewQuestion.answers))
        .order_by(InterviewQuestion.question_number)
        .all()
    )
    
    technical_scores = []
    behavioral_scores = []
    all_scores = []
    qa_pairs = []
    
    for question in questions:
        # Get the latest answer for this question
        latest_answer = sorted(question.answers, key=lambda x: x.id)[-1] if question.answers else None
        
        if latest_answer:
            score = latest_answer.answer_score if latest_answer.answer_score is not None else 0.0
            ans_text = latest_answer.answer_text
            eval_raw = latest_answer.answer_evaluation
        else:
            score = 0.0
            ans_text = "[No Answer Provided]"
            eval_raw = json.dumps({"auto_graded": False, "reason": "skipped", "score": 0.0})
            
        # Robust classification based on question_type
        if (question.question_type or "").lower() == 'behavioral':
            behavioral_scores.append(score)
        else:
            technical_scores.append(score)

        all_scores.append(score)
            
        qa_pairs.append({
            "question": question.question_text,
            "answer": ans_text,
            "score": score,
            "evaluation_raw": eval_raw,
            "question_type": question.question_type
        })
    
    technical_avg = sum(technical_scores) / len(technical_scores) if technical_scores else 0.0
    behavioral_avg = sum(behavioral_scores) / len(behavioral_scores) if behavioral_scores else 0.0

    # Weighted rollup (Robust calculation)
    # If both categories exist: 70% technical, 30% behavioral
    # If only one exists: 100% of that category
    calculated_overall_score = 0.0
    if technical_scores and behavioral_scores:
        calculated_overall_score = round((technical_avg * 0.7 + behavioral_avg * 0.3), 2)
    elif technical_scores:
        calculated_overall_score = round(technical_avg, 2)
    elif behavioral_scores:
        calculated_overall_score = round(behavioral_avg, 2)
    
    interview_score = calculated_overall_score

    behavioral_score = round(behavioral_avg, 2)
    technical_score_val = round(technical_avg, 2)
    ai_used_count = 0
    fallback_used_count = 0
    confidence_values = []
    for question in questions:
        ans = sorted(question.answers, key=lambda x: x.id)[-1] if question.answers else None
        if not ans:
            continue
        if getattr(ans, "ai_used", False):
            ai_used_count += 1
        if getattr(ans, "fallback_used", False):
            fallback_used_count += 1
        if getattr(ans, "confidence_score", None) is not None:
            confidence_values.append(float(ans.confidence_score))

    interview.overall_score = interview_score
    interview.questions_asked = len(questions)
    interview.first_level_completed = True
    interview.first_level_score = interview_score
    
    # 2.5 Update Application Status via State Machine
    if interview.application and interview.status in ("completed", "terminated"):
        from app.services.state_machine import CandidateStateMachine, TransitionAction
        from app.domain.constants import CandidateState
        
        active_states = {
            "applied",
            "screened",
            "interview_scheduled"
        }
        if interview.application.status in active_states:
            fsm = CandidateStateMachine(db)
            try:
                action = TransitionAction.SYSTEM_INTERVIEW_COMPLETE
                if interview.application.status == "interview_scheduled":
                    action = TransitionAction.COMPLETE_INTERVIEW
                fsm.transition(interview.application, action)
            except Exception as e:
                logger.warning(f"FSM transition failed for interview {interview_id}: {e}")

            
        # ── Phase 6: Critical Audit Logging ──
        from app.services.candidate_service import CandidateService
        cand_service = CandidateService(db)
        cand_service.create_audit_log(
            None, 
            "INTERVIEW_COMPLETED", 
            "Interview", 
            interview_id, 
            {"overall_score": interview_score, "status": interview.status},
            is_critical=True
        )
            
    db.commit()

    # 3. Check for termination reason (from InterviewIssue)
    from app.domain.models import InterviewIssue
    if not term_reason:
        issue = db.query(InterviewIssue).filter(InterviewIssue.interview_id == interview_id).order_by(InterviewIssue.id.desc()).first()
        if issue:
            term_reason = f"{issue.issue_type}: {issue.description}"
        elif interview.status == "terminated":
            term_reason = "System manual termination"

    # 4. Generate AI Report
    existing_report = db.query(InterviewReport).filter(InterviewReport.interview_id == interview_id).first()
    if existing_report:
        # ── Phase 3: Versioning (Save old report before generating new) ──
        try:
            version_count = db.query(InterviewReportVersion).filter(InterviewReportVersion.interview_id == interview_id).count()
            old_version = InterviewReportVersion(
                interview_id=interview_id,
                version_number=version_count + 1,
                overall_score=existing_report.overall_score,
                summary=existing_report.summary
            )
            db.add(old_version)
            db.flush() 
        except Exception as e:
            logger.warning(f"Failed to version old interview report: {e}")

    try:
        job = interview.application.job if interview.application else None
        primary_skills = []
        if getattr(job, 'primary_evaluated_skills', None):
            try:
                parsed = json.loads(job.primary_evaluated_skills)
                if isinstance(parsed, list): primary_skills = parsed
            except: pass

        report_data = None
        last_rep_err = None
        
        # Prepare aptitude summary for the report context
        aptitude_context = None
        if interview.aptitude_completed and interview.aptitude_score is not None:
            aptitude_context = {
                "score": round(interview.aptitude_score, 2),
                "status": "Completed"
            }

        is_terminated_by_violations = getattr(interview, "is_terminated_by_violations", False)

        for attempt in range(1, 4):
            try:
                report_data = await generate_interview_report(
                    job_title=job.title if job else "Demo Interview",
                    all_qa_pairs=qa_pairs,
                    overall_score=interview_score,
                    primary_evaluated_skills=primary_skills,
                    termination_reason=term_reason,
                    aptitude_context=aptitude_context, # Pass aptitude performance
                    is_terminated_by_violations=is_terminated_by_violations,
                )
                break
            except Exception as rep_e:
                last_rep_err = rep_e
                logger.warning(
                    "interview_report_ai_retry",
                    extra={"interview_id": interview_id, "attempt": attempt, "error_preview": str(rep_e)[:240]},
                )
                if attempt < 3:
                    await asyncio.sleep(0.45 * attempt)

        if report_data is None:
            logger.error(
                "generate_interview_report failed after retries for interview %s: %s",
                interview_id,
                last_rep_err,
            )
            return None

        detailed_feedback_val = report_data["detailed_feedback"]
        if isinstance(detailed_feedback_val, (dict, list)):
            detailed_feedback_val = json.dumps(detailed_feedback_val)
            
        rec_val = str(report_data.get("recommendation", "consider")).lower()
        is_demo = getattr(interview, "is_demo", False) or interview.application is None
        base_summary = str(report_data.get("summary", ""))
        formatted_summary = f"[DEMO INTERVIEW] {base_summary}" if is_demo and not base_summary.startswith("[DEMO INTERVIEW]") else base_summary

        if existing_report:
            report = existing_report
            report.overall_score = report_data["overall_score"]
            # Fallback to calculated scores if AI didn't provide them
            report.technical_skills_score = report_data.get("technical_skills_score") or technical_score_val
            report.communication_score = report_data.get("communication_score") or behavioral_score
            report.problem_solving_score = report_data.get("problem_solving_score") or ((technical_score_val + behavioral_score) / 2)
            report.summary = formatted_summary
            report.detailed_feedback = detailed_feedback_val
            report.recommendation = rec_val
            report.reasoning = {"ai_summary": report_data.get("reasoning")}
            report.updated_at = get_ist_now()
        else:
            report = InterviewReport(
                interview_id=interview_id,
                application_id=None if is_demo else (interview.application.id if interview.application else None),
                job_id=None if is_demo else (job.id if job else None),
                candidate_name="Demo Candidate" if is_demo else (interview.application.candidate_name if interview.application else "Candidate"),
                candidate_email="demo@calrims.local" if is_demo else (interview.application.candidate_email if interview.application else "Email N/A"),
                applied_role="Demo Interview" if is_demo else (job.title if job else "N/A"),
                overall_score=report_data["overall_score"],
                # Fallback to calculated scores if AI didn't provide them
                technical_skills_score=report_data.get("technical_skills_score") or technical_score_val,
                communication_score=report_data.get("communication_score") or behavioral_score,
                problem_solving_score=report_data.get("problem_solving_score") or ((technical_score_val + behavioral_score) / 2),
                strengths=str(report_data.get("strengths", "[]")),
                weaknesses=str(report_data.get("weaknesses", "[]")),
                summary=formatted_summary,
                recommendation=rec_val,
                detailed_feedback=detailed_feedback_val,
                aptitude_score=interview.aptitude_score,
                behavioral_score=behavioral_score,
                combined_score=interview_score,
                evaluated_skills=str(report_data.get("evaluated_skills", "[]")),
                termination_reason=term_reason,
                ai_used=ai_used_count > 0,
                fallback_used=fallback_used_count > 0,
                confidence_score=(sum(confidence_values) / len(confidence_values)) if confidence_values else 0.0,
                reasoning={"ai_summary": report_data.get("reasoning")},
            )
            db.add(report)
        
        try:
            db.commit()
        except Exception as commit_err:
            db.rollback()
            existing_report = db.query(InterviewReport).filter(InterviewReport.interview_id == interview_id).first()
            if existing_report:
                logger.info(f"Concurrent report creation resolved: returning existing report for {interview_id}.")
                report = existing_report
            else:
                raise commit_err

        # Notification
        try:
            apt_score = interview.aptitude_score
            apt_info = f" | Aptitude: {apt_score:.1f}" if apt_score is not None else ""
            status_desc = "completed" if interview.status == "completed" else "terminated early"
            hr_id = job.hr_id if job else None
            cand_name = "Demo Candidate" if is_demo else (interview.application.candidate_name if interview.application else "Candidate")
            job_name = "Demo Interview" if is_demo else (job.title if job else "Job")
            if hr_id:
                from app.core.websocket import trigger_realtime_notification
                trigger_realtime_notification(
                    db=db,
                    user_id=hr_id,
                    notification_type="INTERVIEW_COMPLETED",
                    title=f"Interview {status_desc.capitalize()}: {cand_name}",
                    message_content=f"{cand_name} {status_desc} for {job_name}. Score: {interview_score:.1f}{apt_info}",
                    related_application_id=interview.application_id,
                    related_interview_id=interview_id
                )
                db.commit()
        except Exception as e:
            logger.error(f"Error creating notification: {e}")

        # 5. Send Automated Candidate Email
        try:
            if not is_demo and interview.application:
                if interview.status == "terminated":
                    await send_interview_terminated_email(interview.application, term_reason or "policy violations")
                else:
                    await send_interview_completed_email(interview.application)
        except Exception as e:
            logger.error(f"Failed to send automated candidate interview email: {e}")

        return report
    except Exception as e:
        logger.error(f"Error in _finalize_interview_and_report_internal: {e}")
        return None


def delete_report_and_interview_data(
    db: Session,
    report_id: str,
    current_user,
    tenant_ctx=None
) -> dict:
    """
    Permanently delete an interview report and all associated interview child records:
    - InterviewReport and InterviewReportVersion
    - InterviewQuestion and InterviewAnswer
    - InterviewAnswerVersion and AIEvaluation
    - InterviewMonitoringEvent (snapshots) + stored image files
    - CodingSubmission
    - InterviewIssue and InterviewFeedback
    - Notifications referencing this interview
    - Interview itself
    
    MUST NOT delete:
    - Candidate (User)
    - Candidate profile (ResumeExtraction, CandidateSkill)
    - Application
    - Job
    """
    from fastapi import HTTPException, status
    from app.core.ownership import validate_hr_ownership
    from app.core.storage import delete_file
    from app.domain.models import InterviewReport, Interview, Application, InterviewMonitoringEvent

    clean_id = str(report_id).strip()
    report = None
    interview = None
    app_record = None

    if clean_id.startswith("skel_"):
        iv_id_str = clean_id.replace("skel_", "")
        interview_id = int(iv_id_str) if iv_id_str.isdigit() else None
        interview = db.query(Interview).filter(Interview.id == interview_id).first() if interview_id else None
        if interview:
            report = interview.report
            app_record = interview.application
    elif clean_id.startswith("app_"):
        aid_str = clean_id.replace("app_", "")
        app_id = int(aid_str) if aid_str.isdigit() else None
        if app_id:
            app_record = db.query(Application).filter(Application.id == app_id).first()
            if app_record:
                if app_record.interview:
                    interview = app_record.interview
                    report = interview.report
    else:
        rep_id_int = int(clean_id) if clean_id.isdigit() else None
        if rep_id_int:
            report = db.query(InterviewReport).filter(InterviewReport.id == rep_id_int).first()
            if not report:
                # Also check by interview_id
                report = db.query(InterviewReport).filter(InterviewReport.interview_id == rep_id_int).first()
            interview = report.interview if report else db.query(Interview).filter(Interview.id == rep_id_int).first()
            if interview:
                app_record = interview.application
            elif report:
                app_record = report.application

    if not report and not interview and not app_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Interview report not found."
        )

    # 1. Authorization: Role check
    is_admin = getattr(current_user, "role", "").lower() in ("root-admin", "root_admin", "super_admin")

    # 2. Multi-tenant Authorization
    if not is_admin and tenant_ctx:
        res_tenant_id = getattr(interview, "tenant_id", None)
        if not res_tenant_id and report and report.interview:
            res_tenant_id = getattr(report.interview, "tenant_id", None)
        if not res_tenant_id and app_record:
            res_tenant_id = getattr(app_record, "tenant_id", None)
        if res_tenant_id and str(res_tenant_id) != str(tenant_ctx.id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: Report belongs to another organization."
            )

    # 3. HR Ownership Check
    if not is_admin:
        target_app = app_record or getattr(interview, "application", None) or (report and getattr(report, "application", None))
        if target_app:
            validate_hr_ownership(target_app, current_user, resource_name="interview report")

    # 4. Storage cleanup for snapshots and recordings
    if interview:
        try:
            events = db.query(InterviewMonitoringEvent).filter(
                InterviewMonitoringEvent.interview_id == interview.id
            ).all()
            for ev in events:
                if ev.frame_image_path:
                    try:
                        delete_file(settings.supabase_bucket_resumes, ev.frame_image_path)
                    except Exception as fe:
                        logger.warning(f"Failed to delete frame image file {ev.frame_image_path}: {fe}")

            if interview.video_recording_path:
                try:
                    delete_file(settings.supabase_bucket_videos, interview.video_recording_path)
                except Exception as ve:
                    logger.warning(f"Failed to delete video recording {interview.video_recording_path}: {ve}")
        except Exception as se:
            logger.warning(f"Storage cleanup encountered error for interview {interview.id}: {se}")

    # 5. Database Cascade Deletion
    # Reset Application status to 'applied' and unlink interview so candidate pipeline remains intact
    # without lingering in reportable interview statuses.
    if interview:
        target_app = app_record or interview.application
        if target_app:
            target_app.interview = None
            target_app.status = "applied"
        db.delete(interview)
    elif report:
        target_app = app_record or report.application
        if target_app:
            target_app.status = "applied"
        db.delete(report)
    elif app_record:
        app_record.status = "applied"

    db.commit()
    logger.info(f"[Reports] Permanently deleted report {report_id} and associated interview data.")

    return {
        "success": True,
        "message": "Interview report and all associated data permanently deleted.",
        "deleted_report_id": report_id,
    }


