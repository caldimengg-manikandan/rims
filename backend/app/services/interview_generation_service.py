
from app.services.ai_service import analyze_introduction
from fastapi import APIRouter, HTTPException, status, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from datetime import datetime
import json
import os
import random
import logging
import tempfile
from app.core.config import get_settings
from app.domain.models import Interview, Application, InterviewQuestion, Job
from app.core.rate_limiter import limiter
from app.services.ai_service import (
    generate_behavioral_question,
    generate_custom_domain_questions_with_meta,
    generate_behavioral_batch,
    extract_questions_from_text,
)
from app.services.resume_parser import parse_content_from_path
from app.services.job_queue import complete_job, fail_job, get_job

# Import termination checker (reuse analyzer singleton from ai_service)
try:
    from backend.interview_process.response_analyzer import ResponseAnalyzer as _RA
except ImportError:
    from interview_process.response_analyzer import ResponseAnalyzer as _RA
_termination_checker = _RA()


router = APIRouter(prefix="/api/interviews", tags=["interviews"])
logger = logging.getLogger(__name__)
settings = get_settings()



def _load_questions_from_repo_set(set_id: int, db: Session) -> list:
    """Fetch questions from a QuestionSet record in the repository."""
    from app.domain.models import QuestionSet
    import json as _json
    logger.info(f"[Repo] Loading questions from repository set id={set_id}")
    qs = db.query(QuestionSet).filter(QuestionSet.id == set_id).first()
    if not qs:
        logger.warning(f"[Repo] Repository set id={set_id} NOT FOUND in DB — falling back to AI.")
        return []
    try:
        questions = _json.loads(qs.questions) if isinstance(qs.questions, str) else qs.questions
        result = questions if isinstance(questions, list) else []
        logger.info(f"[Repo] Set id={set_id} title={qs.title!r} loaded {len(result)} questions successfully.")
        return result
    except Exception as e:
        logger.warning(f"[Repo] Failed to parse questions from set id={set_id}: {e} — falling back to AI.")
        return []

@router.get("/jobs/{job_id}")
async def check_job_status(job_id: str):
    """Polling endpoint for async AI generation tasks"""
    job = get_job(job_id)
    if not job:
        return JSONResponse(
            status_code=404,
            content={"success": False, "data": None, "error": "Job not found"}
        )
    return job

async def background_generate_questions(interview_id: int, job_id_db: int, application_id: int, ai_job_id: str):
    """Background task to pre-generate all questions without blocking Uvicorn threads"""
    from app.infrastructure.database import SessionLocal
    db: Session = SessionLocal()
    try:
        # Rehydrate objects from db
        interview = db.query(Interview).filter(Interview.id == interview_id).first()
        job_obj = db.query(Job).filter(Job.id == job_id_db).first()
        application = db.query(Application).filter(Application.id == application_id).first()
        
        if interview.interview_stage == STAGE_APTITUDE:
            if job_obj and job_obj.aptitude_enabled:
                await _generate_aptitude_questions(interview, job_obj, db)
                # After aptitude, we might also want to pre-generate first-level
                await _generate_first_level_questions(interview, job_obj, application, db)
        else:
            await _generate_first_level_questions(interview, job_obj, application, db)
            
        complete_job(ai_job_id)
    except Exception as e:
        logger.error(f"Failed background generation for {ai_job_id}: {e}")
        fail_job(ai_job_id, str(e))
    finally:
        try:
            # Always clear the generation lock so the candidate isn't stuck if a retry is needed
            from app.domain.models import GlobalSettings
            db.query(GlobalSettings).filter(GlobalSettings.key == f"lock_gen_{interview_id}").delete()
            db.commit()
        except Exception as lock_err:
            logger.warning(f"Failed to clear generation lock for interview {interview_id}: {lock_err}")
        db.close()

# ─── Stage Constants ──────────────────────────────────────────────────────────
STAGE_APTITUDE = "aptitude"
STAGE_FIRST_LEVEL = "first_level"
STAGE_COMPLETED = "completed"
VALID_INTERVIEW_STATUSES = {"not_started", "in_progress", "completed", "cancelled", "terminated", "expired"}

APTITUDE_QUESTION_COUNT = 10  # Number of aptitude questions to pick from uploaded file


def _set_interview_status(interview: Interview, value: str) -> None:
    if value not in VALID_INTERVIEW_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid interview status: {value}")
    interview.status = value


def _determine_initial_stage(job: Job) -> str:
    """Determine the initial interview stage based on job configuration."""
    if job.aptitude_enabled and job.experience_level.lower() == "junior":
        return STAGE_APTITUDE
    return STAGE_FIRST_LEVEL


def _enforce_stage(interview: Interview, required_stage: str):
    """Raise 403 if the interview is not in the required stage."""
    if interview.interview_stage == STAGE_COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This interview has been fully completed."
        )
    if interview.interview_stage != required_stage:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied. Current stage is '{interview.interview_stage}', but '{required_stage}' is required."
        )


def _question_count_for_stage(db: Session, interview_id: int, stage: str) -> int:
    q_query = db.query(InterviewQuestion).filter(InterviewQuestion.interview_id == interview_id)
    if stage == STAGE_APTITUDE:
        q_query = q_query.filter(InterviewQuestion.question_type == "aptitude")
    else:
        q_query = q_query.filter(InterviewQuestion.question_type != "aptitude")
    return q_query.count()


async def _generate_aptitude_questions(interview: Interview, job: Job, db: Session):
    """Generate aptitude questions from uploaded file (random selection) or fallback defaults."""
    aptitude_prompts = []

    aptitude_mode = getattr(job, 'aptitude_mode', 'ai')
    
    # Repository source takes priority over file upload
    aptitude_repo_set_id = getattr(job, 'aptitude_repo_set_id', None)
    logger.info(
        f"[Aptitude] interview={interview.id} mode={aptitude_mode!r} "
        f"aptitude_repo_set_id={aptitude_repo_set_id} "
        f"aptitude_questions_file={getattr(job, 'aptitude_questions_file', None)!r}"
    )
    if aptitude_mode == 'upload' and aptitude_repo_set_id:
        repo_questions = _load_questions_from_repo_set(aptitude_repo_set_id, db)
        if repo_questions:
            random.shuffle(repo_questions)
            selected = repo_questions[:APTITUDE_QUESTION_COUNT]
            for item in selected:
                if isinstance(item, dict) and 'question' in item:
                    aptitude_prompts.append(item)
                elif isinstance(item, str):
                    aptitude_prompts.append(item)
            logger.info(f"Loaded {len(aptitude_prompts)} aptitude questions from repo set {aptitude_repo_set_id}")

    if not aptitude_prompts and aptitude_mode == 'upload' and getattr(job, 'aptitude_questions_file', None):
        try:
            file_path = settings.base_dir / job.aptitude_questions_file
            uploaded_questions = None
            if file_path.exists():
                # Robust reading for potential encoding issues
                for encoding in ['utf-8-sig', 'latin-1']:
                    try:
                        with open(file_path, 'r', encoding=encoding) as f:
                            uploaded_questions = json.load(f)
                        break
                    except (UnicodeDecodeError, json.JSONDecodeError):
                        continue
                
                if uploaded_questions is None:
                    # Fallback: Extract text and use AI to structure it
                    raw_text = parse_content_from_path(str(file_path))
                    if raw_text:
                        logger.info(f"Non-JSON aptitude file detected. Extracting via AI...")
                        uploaded_questions = await extract_questions_from_text(raw_text)
            else:
                # Try downloading from Supabase Storage
                from app.core.storage import download_file
                logger.info(f"Local file {file_path} not found. Attempting to download from Supabase storage: {job.aptitude_questions_file}")
                file_bytes = download_file(settings.supabase_bucket_resumes, job.aptitude_questions_file)
                if file_bytes:
                    for encoding in ['utf-8-sig', 'latin-1', 'utf-8']:
                        try:
                            uploaded_questions = json.loads(file_bytes.decode(encoding))
                            break
                        except Exception:
                            continue
                    
                    if uploaded_questions is None:
                        # Fallback: Save to temp file and parse text
                        import tempfile
                        suffix = os.path.splitext(job.aptitude_questions_file)[1]
                        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp_f:
                            temp_f.write(file_bytes)
                            temp_path = temp_f.name
                        try:
                            raw_text = parse_content_from_path(temp_path)
                            if raw_text:
                                logger.info(f"Non-JSON downloaded aptitude file detected. Extracting via AI...")
                                uploaded_questions = await extract_questions_from_text(raw_text)
                        finally:
                            try:
                                os.unlink(temp_path)
                            except Exception:
                                pass

            if uploaded_questions and isinstance(uploaded_questions, list) and len(uploaded_questions) > 0:
                # Shuffle and pick N
                random.shuffle(uploaded_questions)
                selected = uploaded_questions[:APTITUDE_QUESTION_COUNT]
                for item in selected:
                    if isinstance(item, dict) and 'question' in item:
                        aptitude_prompts.append(item)
                    elif isinstance(item, str):
                        aptitude_prompts.append(item)
        except Exception as e:
            logger.error(f"Error loading uploaded aptitude questions: {e}")

    # Fallback/AI mode
    if not aptitude_prompts:
        if aptitude_mode == 'ai':
            from app.services.ai_service import generate_aptitude_batch
            try:
                # We request 10 questions for aptitude as per new requirements
                aptitude_prompts = await generate_aptitude_batch(10)
            except Exception as e:
                logger.error(f"AI generation for aptitude failed: {e}")
                aptitude_prompts = []
                
        if not aptitude_prompts:
            default_prompts = [
                {
                    "question": "You have 5 machines that each produce 5 widgets in 5 minutes. How long would it take 100 machines to produce 100 widgets?",
                    "options": ["5 minutes", "100 minutes", "25 minutes", "1 minute"],
                    "answer": 0
                },
                {
                    "question": "If a train travels 60 km in the first hour and 40 km in the second hour, what is the average speed?",
                    "options": ["50 km/h", "45 km/h", "55 km/h", "60 km/h"],
                    "answer": 0
                },
                {
                    "question": "A is twice as old as B. 10 years ago, A was three times as old as B. How old is B now?",
                    "options": ["20", "15", "25", "30"],
                    "answer": 0
                },
                {
                    "question": "What comes next in the sequence: 2, 6, 12, 20, 30, ?",
                    "options": ["42", "40", "36", "44"],
                    "answer": 0
                },
                {
                    "question": "If all Bloops are Razzies and all Razzies are Lazzies, are all Bloops definitely Lazzies?",
                    "options": ["Yes", "No", "Maybe", "Depends on Bloops"],
                    "answer": 0
                },
                {
                    "question": "A farmer has 17 sheep. All but 9 die. How many are left?",
                    "options": ["9", "17", "8", "0"],
                    "answer": 0
                },
                {
                    "question": "You have a 3-liter jug and a 5-liter jug. How do you measure exactly 4 liters?",
                    "options": ["Fill 5L, pour to 3L, empty 3L, pour rem. 2L to 3L, fill 5L, pour to 3L", "Fill 3L twice", "Fill 5L once", "Not possible"],
                    "answer": 0
                },
                {
                    "question": "If it takes 5 hours for 5 people to dig 5 holes, how long does it take 1 person to dig 1 hole?",
                    "options": ["5 hours", "1 hour", "10 hours", "1/5 hour"],
                    "answer": 0
                },
                {
                    "question": "What is the next number: 1, 1, 2, 3, 5, 8, ?",
                    "options": ["13", "11", "15", "10"],
                    "answer": 0
                },
                {
                    "question": "A clock shows 3:15. What is the angle between the hour and minute hand?",
                    "options": ["7.5 degrees", "0 degrees", "15 degrees", "5 degrees"],
                    "answer": 0
                }
            ]
            random.shuffle(default_prompts)
            # Standardize exactly 10 questions per the spec
            aptitude_prompts = default_prompts[:10]

    try:
        for i, item in enumerate(aptitude_prompts):
            q_text = ""
            options = None
            correct = None
            
            if isinstance(item, dict):
                q_text = item.get("question", "")
                options = json.dumps(item.get("options", []))
                correct = item.get("answer", 0)
            else:
                q_text = str(item)

            q = InterviewQuestion(
                interview_id=interview.id,
                question_number=i + 1,
                question_text=q_text,
                options=options,
                correct_answer=str(correct) if correct is not None else None,
                question_type="aptitude"
            )
            db.add(q)
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"Error saving aptitude questions: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate aptitude questions safely.")
    logger.info(f"Generated {len(aptitude_prompts)} aptitude questions (sample test)")


async def _generate_first_level_questions(interview: Interview, job: Job, application, db: Session):
    """Generate first-level interview questions (existing logic)."""
    # Initialize default state
    locked_skill = "general"
    experience = "mid"
    
    # 0. Fail-safe: Ensure locked_skill is initialized in DB before any AI processing
    try:
        if not interview.locked_skill:
            interview.locked_skill = locked_skill
            db.add(interview)
            db.commit()
            db.refresh(interview)
    except Exception as init_err:
        logger.error(f"Failed to initialize locked_skill for interview {interview.id}: {init_err}")
        db.rollback()

    # Idempotency check: if non-aptitude questions already exist, skip generation
    existing_count = db.query(InterviewQuestion).filter(
        InterviewQuestion.interview_id == interview.id,
        InterviewQuestion.question_type != "aptitude",
    ).count()
    if existing_count > 0:
        logger.info(
            f"Interview {interview.id}: {existing_count} first-level questions already exist; skipping generation."
        )
        return

    def _first_level_fallback_questions() -> tuple[list[str], list[str]]:
        technical_fallbacks = [
            "Please describe your professional background and key technical skills.",
            "Describe a challenging project you worked on.",
            "What are the most important technical skills in your domain?",
            "How do you approach debugging a production issue?",
            "Explain a complex system you have built or contributed to.",
            "How do you ensure code quality in your work?",
            "Describe your experience with version control systems and CI/CD pipelines.",
            "How do you handle performance optimization in your projects?",
            "What is your approach to writing maintainable and scalable code?",
            "Describe a time when you had to learn a new technology quickly.",
            "How do you approach system design and architecture decisions?",
            "What testing strategies do you use in your development process?",
            "How do you handle technical debt in a project?",
            "Describe your experience working with APIs and integrations.",
            "How do you stay updated on new technologies and best practices?",
        ]
        behavioral_fallbacks = [
            "Tell me about a time you faced an unexpected challenge at work.",
            "Describe a situation where you had to collaborate with a difficult team member.",
            "How do you handle tight deadlines and competing priorities?",
            "Tell me about a time you received constructive feedback and how you responded.",
            "Describe a situation where you took initiative beyond your assigned responsibilities.",
        ]
        return technical_fallbacks, behavioral_fallbacks

    # ── Phase 1: analysis + AI/question generation (fallback allowed here) ──
    resume_extraction = application.resume_extraction if application else None
    resume_text = resume_extraction.extracted_text if resume_extraction else ""
    job_title = job.title if job else "General Role"

    logger.info(
        "Interview question generation start",
        extra={
            "interview_id": interview.id,
            "mode": getattr(job, "interview_mode", "ai") if job else "ai",
            "job_title": job_title,
        },
    )

    try:
        logger.debug(f"Interview {interview.id}: starting intro analysis (resume_len={len(resume_text)})")
        analysis = await analyze_introduction(resume_text, job_title)
        locked_skill = analysis.get("primary_skill", "general")
        experience = analysis.get("experience", "mid")
        logger.debug(
            f"Interview {interview.id}: intro analysis result locked_skill={locked_skill!r} experience={experience!r}"
        )
    except Exception as e:
        # Intro analysis failure is treated as AI failure for question generation.
        logger.warning(f"Interview {interview.id}: intro analysis failed; will use fallback questions. err={e}")
        locked_skill = "general"
        experience = "mid"

    # If the analyzer couldn't confidently infer a domain, fall back to job metadata.
    if not locked_skill or str(locked_skill).lower() == "general":
        job_text = f"{(job.title or '')} {(job.description or '')}".lower() if job else ""
        
        # Priority 1: specialized core engineering domains
        if any(k in job_text for k in ["mechanical", "cae", "cad", "ansys", "solidworks", "thermal", "structures", "structural engineering", "manufacturing"]):
            locked_skill = "CAE-MECHANICAL"
        elif any(k in job_text for k in ["tekla", "detailing", "steel detailing", "sds2", "aisc"]):
            locked_skill = "Steel_detailing"
        elif any(k in job_text for k in ["electrical", "electronics", "circuit", "wiring", "power distribution"]):
            if (experience or "mid").lower() in ["junior", "intern", "fresh", "fresher"]:
                locked_skill = "electrical_junior"
            else:
                locked_skill = "electrical_senior"
        
        # Priority 2: Software domains (backend keyword 'python' is common in engineering, so check it AFTER mechanical)
        elif any(k in job_text for k in ["backend", "api", "rest", "python", "django", "fastapi", "microservice", "fast api"]):
            locked_skill = "backend"
        elif any(k in job_text for k in ["frontend", "react", "ui", "ux", "javascript", "typescript", "web development"]):
            locked_skill = "frontend"
        elif any(k in job_text for k in ["devops", "aws", "docker", "kubernetes", "ci/cd", "terraform", "sre", "infrastructure"]):
            locked_skill = "devops"
        elif any(k in job_text for k in ["data", "machine learning", "ml", "sql", "analytics", "data science"]):
            locked_skill = "data_analysis"
        elif any(k in job_text for k in ["qa", "testing", "automation", "selenium", "cypress", "quality"]):
            locked_skill = "qa_testing"
        elif any(k in job_text for k in ["cyber", "security", "infosec", "network", "firewall"]):
            locked_skill = "cybersecurity"
        elif any(k in job_text for k in ["marketing", "seo", "sem", "social media", "content strategy", "google ads", "branding", "copywriter"]):
            locked_skill = "digital_marketing"
        elif any(k in job_text for k in ["embedded", "microcontroller", "stm32", "rtos", "esp32", "firmware", "low level programming", "bare metal"]):
            locked_skill = "embedded_systems"
        elif any(k in job_text for k in ["instrumentation", "scada", "plc", "hmi", "dcs", "automation control", "field instruments"]):
            locked_skill = "instrumentation"
        elif any(k in job_text for k in ["genai", "generative ai", "llm", "large language model", "rag", "langchain", "prompt engineering"]):
            locked_skill = "generative_ai"
        elif any(k in job_text for k in ["power bi", "tableau", "business intelligence", "bi specialist", "looker", "dashboards"]):
            locked_skill = "business_intelligence"
        elif any(k in job_text for k in ["dba", "database administrator", "database performance", "oracle dba", "mysql dba", "postgres dba", "backup and recovery"]):
            locked_skill = "database_admin"
        elif any(k in job_text for k in ["project manager", "pmp", "scrum master", "project management", "delivery manager"]):
            locked_skill = "project_management"
        elif any(k in job_text for k in ["business analyst", "requirement gathering", "brd", "frd", "use case", "user stories", "gap analysis"]):
            locked_skill = "business_analyst"
        elif any(k in job_text for k in ["finance", "accounting", "tally", "taxation", "auditor", "chartered accountant", "accounts payable", "accounts receivable"]):
            locked_skill = "finance_accounting"
        elif any(k in job_text for k in ["sales", "crm", "business development", "lead generation", "b2b sales", "account executive"]):
            locked_skill = "sales_crm"
        elif any(k in job_text for k in ["customer support", "customer service", "helpdesk", "technical support officer", "zendesk", "ticketing"]):
            locked_skill = "customer_support"
        elif any(k in job_text for k in ["legal", "lawyer", "contracts", "compliance officer", "statutory", "litigation", "paralegal"]):
            locked_skill = "legal"
        elif any(k in job_text for k in ["healthcare it", "hl7", "fhir", "his", "emr", "ehr", "medical coding", "hospital management"]):
            locked_skill = "healthcare_it"
        elif any(k in job_text for k in ["graphic designer", "photoshop", "illustrator", "creative design", "branding design", "logo designer"]):
            locked_skill = "graphic_design"
        elif any(k in job_text for k in ["video editor", "premiere pro", "after effects", "motion graphics", "davinci resolve", "post production"]):
            locked_skill = "video_editing"
        else:
            locked_skill = "general"

    # Persist locked_skill BEFORE entering the long-running question generation phase.
    # This prevents holding a DB transaction open while calling external AI APIs.
    try:
        interview.locked_skill = locked_skill
        db.add(interview)
        db.commit()
        db.refresh(interview)
    except Exception as e:
        db.rollback()
        logger.warning(f"Interview {interview.id}: failed to persist locked_skill={locked_skill!r}. err={e}")

    # Extract candidate skills from stored resume extraction
    candidate_skills = []
    if resume_extraction and resume_extraction.extracted_skills:
        try:
            candidate_skills = json.loads(resume_extraction.extracted_skills)
        except Exception:
            candidate_skills = []
    if not candidate_skills:
        skills_str = analysis.get("skills", "") if isinstance(locals().get("analysis"), dict) else ""
        if isinstance(skills_str, str) and skills_str:
            candidate_skills = [s.strip() for s in skills_str.split(",")]
        elif isinstance(skills_str, list):
            candidate_skills = skills_str

    logger.info(f"Interview {interview.id}: skill={locked_skill} level={experience} skills={candidate_skills}")

    # Level-based question split
    level_lower = (experience or "mid").lower()
    if "senior" in level_lower or "lead" in level_lower or "manager" in level_lower:
        basic_count, deep_count = 2, 8
    elif "junior" in level_lower or "intern" in level_lower or "fresh" in level_lower:
        basic_count, deep_count = 8, 2
    else:
        basic_count, deep_count = 5, 5

    interview_mode = getattr(job, "interview_mode", "ai") or "ai"
    behavioral_role = getattr(job, "behavioral_role", "general") if job else "general"
    uploaded_tech: list[str] = []
    uploaded_behav: list[str] = []

    if interview_mode in ["upload", "mixed"]:
        # Repository source takes priority over file upload
        technical_repo_set_id = getattr(job, 'technical_repo_set_id', None)
        behavioural_repo_set_id = getattr(job, 'behavioural_repo_set_id', None)
        logger.info(
            f"[FirstLevel] interview={interview.id} mode={interview_mode!r} "
            f"technical_repo_set_id={technical_repo_set_id} "
            f"behavioural_repo_set_id={behavioural_repo_set_id} "
            f"uploaded_question_file={getattr(job, 'uploaded_question_file', None)!r}"
        )

        if technical_repo_set_id:
            repo_qs = _load_questions_from_repo_set(technical_repo_set_id, db)
            for item in repo_qs:
                if isinstance(item, dict) and "question" in item:
                    q_type = str(item.get("type", "technical")).lower()
                    if "behavioural" in q_type or "behavioral" in q_type:
                        uploaded_behav.append(item["question"])
                    else:
                        uploaded_tech.append(item["question"])
                elif isinstance(item, str):
                    uploaded_tech.append(item)
            logger.info(f"Interview {interview.id}: loaded {len(uploaded_tech)} tech questions from repo set {technical_repo_set_id}")

        if behavioural_repo_set_id:
            repo_bqs = _load_questions_from_repo_set(behavioural_repo_set_id, db)
            for item in repo_bqs:
                q_text = item["question"] if isinstance(item, dict) and "question" in item else str(item)
                uploaded_behav.append(q_text)
            logger.info(f"Interview {interview.id}: loaded {len(uploaded_behav)} behavioural questions from repo set {behavioural_repo_set_id}")

        # Fall back to file upload if no repo set provided
        if not technical_repo_set_id and not behavioural_repo_set_id:
            logger.info(f"[FirstLevel] interview={interview.id}: no repo sets — falling back to uploaded file")
            file_name = getattr(job, "uploaded_question_file", None) if job else None
            if file_name:
                file_path = settings.base_dir / file_name
                if file_path.exists():
                    try:
                        data = None
                        for encoding in ["utf-8-sig", "latin-1"]:
                            try:
                                with open(file_path, "r", encoding=encoding) as f:
                                    data = json.load(f)
                                break
                            except (UnicodeDecodeError, json.JSONDecodeError):
                                continue

                        if data is None:
                            raw_text = parse_content_from_path(str(file_path))
                            if raw_text:
                                logger.info(
                                    f"Interview {interview.id}: non-JSON question file detected; extracting via AI"
                                )
                                data = await extract_questions_from_text(raw_text)

                        if data and isinstance(data, list):
                            for item in data:
                                if isinstance(item, dict) and "question" in item:
                                    q_text = item["question"]
                                    q_type = str(item.get("type", "technical")).lower()
                                    options = item.get("options", [])
                                    if options:
                                        q_text += "\n" + "\n".join(
                                            [f"{chr(65 + j)}) {opt}" for j, opt in enumerate(options)]
                                        )
                                    if "behavioral" in q_type:
                                        uploaded_behav.append(q_text)
                                    else:
                                        uploaded_tech.append(q_text)
                                elif isinstance(item, str):
                                    uploaded_tech.append(item)
                    except Exception as e:
                        logger.warning(f"Interview {interview.id}: uploaded question file unreadable: {e}")
                else:
                    logger.warning(
                        f"Interview {interview.id}: uploaded question file missing at {file_path}; will use AI."
                    )
            else:
                logger.warning(
                    f"Interview {interview.id}: uploaded_question_file missing for mode='{interview_mode}'; will use AI."
                )

    expected_tech = 15
    expected_behav = 5
    tech_questions: list[str] = []
    behav_questions: list[str] = []
    used_fallback = False
    fallback_reason = None

    try:
        if interview_mode == "upload":
            tech_questions = uploaded_tech[:expected_tech]
            behav_questions = uploaded_behav[:expected_behav]

            missing_tech = expected_tech - len(tech_questions)
            if missing_tech > 0:
                logger.info(f"Interview {interview.id}: upload mode filling {missing_tech} technical via AI")
                eval_skills = job.primary_evaluated_skills if job else None
                ai_meta = await generate_custom_domain_questions_with_meta(
                    locked_skill,
                    missing_tech,
                    "basic",
                    candidate_skills,
                    eval_skills,
                    job_title=job.title if job else "",
                    job_description=job.description if job else "",
                )
                ai_tech = ai_meta.get("questions", [])
                logger.info(
                    f"Interview {interview.id}: upload-mode tech source={ai_meta.get('source')} reason={ai_meta.get('reason', '')} partial={ai_meta.get('partial', False)} count={len(ai_tech)}"
                )
                tech_questions.extend(ai_tech)

            missing_behav = expected_behav - len(behav_questions)
            if missing_behav > 0:
                logger.info(f"Interview {interview.id}: upload mode filling {missing_behav} behavioral via AI")
                ai_behav = await generate_behavioral_batch(missing_behav, behavioral_role=behavioral_role, job_title=job.title if job else "", job_description=job.description if job else "")
                behav_questions.extend(ai_behav)

        elif interview_mode == "mixed":
            random.shuffle(uploaded_tech)
            tech_questions = uploaded_tech[:10]
            missing_tech = expected_tech - len(tech_questions)
            logger.info(
                f"Interview {interview.id}: mixed mode using {len(tech_questions)} uploaded tech; generating {missing_tech} AI tech"
            )
            if missing_tech > 0:
                eval_skills = job.primary_evaluated_skills if job else None
                ai_meta = await generate_custom_domain_questions_with_meta(
                    locked_skill,
                    missing_tech,
                    "basic",
                    candidate_skills,
                    eval_skills,
                    job_title=job.title if job else "",
                    job_description=job.description if job else "",
                )
                ai_tech = ai_meta.get("questions", [])
                logger.info(
                    f"Interview {interview.id}: mixed-mode tech source={ai_meta.get('source')} reason={ai_meta.get('reason', '')} partial={ai_meta.get('partial', False)} count={len(ai_tech)}"
                )
                tech_questions.extend(ai_tech)

            logger.info(f"Interview {interview.id}: mixed mode generating {expected_behav} AI behavioral questions")
            behav_questions = await generate_behavioral_batch(expected_behav, behavioral_role=behavioral_role, job_title=job.title if job else "", job_description=job.description if job else "")

        else:
            total_basic_count = 5 + basic_count
            eval_skills = job.primary_evaluated_skills if job else None
            logger.debug(f"Interview {interview.id}: AI mode generating {total_basic_count} basic tech")
            all_basic_meta = await generate_custom_domain_questions_with_meta(
                locked_skill,
                total_basic_count,
                "basic",
                candidate_skills,
                eval_skills,
                job_title=job.title if job else "",
                job_description=job.description if job else "",
            )
            all_basic = all_basic_meta.get("questions", [])
            logger.info(
                f"Interview {interview.id}: ai-mode basic source={all_basic_meta.get('source')} reason={all_basic_meta.get('reason', '')} partial={all_basic_meta.get('partial', False)} count={len(all_basic)}"
            )
            questions_q1_q5 = all_basic[:5]
            questions_mid_basic = all_basic[5:]

            logger.debug(f"Interview {interview.id}: AI mode generating {deep_count} deep tech")
            questions_mid_deep_meta = await generate_custom_domain_questions_with_meta(
                locked_skill,
                deep_count,
                "scenario-based/followup",
                candidate_skills,
                eval_skills,
                job_title=job.title if job else "",
                job_description=job.description if job else "",
            )
            questions_mid_deep = questions_mid_deep_meta.get("questions", [])
            logger.info(
                f"Interview {interview.id}: ai-mode deep source={questions_mid_deep_meta.get('source')} reason={questions_mid_deep_meta.get('reason', '')} partial={questions_mid_deep_meta.get('partial', False)} count={len(questions_mid_deep)}"
            )

            tech_questions = questions_q1_q5 + questions_mid_basic + questions_mid_deep
            logger.debug(f"Interview {interview.id}: AI mode generating {expected_behav} behavioral")
            behav_questions = await generate_behavioral_batch(expected_behav, behavioral_role=behavioral_role, job_title=job.title if job else "", job_description=job.description if job else "")

        # Strict validation: must be non-empty strings; do not treat empty/None as success.
        if not isinstance(tech_questions, list) or not isinstance(behav_questions, list):
            raise ValueError("AI returned non-list question payloads")
        if any((not isinstance(q, str)) for q in tech_questions + behav_questions):
            raise ValueError("AI returned non-string question entries")

        tech_questions = [q.strip() for q in tech_questions if isinstance(q, str) and q.strip()]
        behav_questions = [q.strip() for q in behav_questions if isinstance(q, str) and q.strip()]

        if len(tech_questions) < expected_tech or len(behav_questions) < expected_behav:
            # Do not silently pad. Mark explicit PARTIAL_RESPONSE and fill deterministically.
            logger.warning(
                f"Interview {interview.id}: PARTIAL_RESPONSE tech={len(tech_questions)}/{expected_tech} behav={len(behav_questions)}/{expected_behav}; filling missing with fallback_internal"
            )
            fb_tech, fb_behav = _first_level_fallback_questions()
            needed_tech = max(0, expected_tech - len(tech_questions))
            needed_behav = max(0, expected_behav - len(behav_questions))
            tech_questions.extend(fb_tech[:needed_tech])
            behav_questions.extend(fb_behav[:needed_behav])
            used_fallback = True
            fallback_reason = "PARTIAL_RESPONSE"

        tech_questions = tech_questions[:expected_tech]
        behav_questions = behav_questions[:expected_behav]

        logger.info(
            f"Interview {interview.id}: AI questions generated ok (tech={len(tech_questions)} behav={len(behav_questions)})"
        )
    except Exception as e:
        used_fallback = True
        fallback_reason = str(e)
        logger.warning(
            f"Interview {interview.id}: AI generation failed/invalid; using fallback_hard questions. reason={fallback_reason}"
        )
        tech_questions, behav_questions = _first_level_fallback_questions()

    all_questions = tech_questions + behav_questions
    # ── Phase 2: DB persistence (NO fallback here) ──
    q_offset = db.query(InterviewQuestion).filter(InterviewQuestion.interview_id == interview.id).count()
    try:
        # Verify connection is still alive after long AI calls to avoid OperationalError
        try:
            from sqlalchemy import text
            db.execute(text("SELECT 1"))
        except Exception:
            logger.warning(f"Interview {interview.id}: DB connection lost during AI phase; re-establishing for save.")
            db.rollback()

        for i, q_text in enumerate(all_questions):
            q_num = q_offset + i + 1
            q_type = "behavioral" if i >= (len(all_questions) - expected_behav) else "technical"
            db.add(
                InterviewQuestion(
                    interview_id=interview.id,
                    question_number=q_num,
                    question_text=q_text,
                    question_type=q_type,
                    options=None,
                    correct_answer=None,
                )
            )

        interview.total_questions = q_offset + len(all_questions)
        db.add(interview)
        db.commit()
        source_tag = "ai"
        if used_fallback and fallback_reason == "PARTIAL_RESPONSE":
            source_tag = "fallback_internal"
        elif used_fallback:
            source_tag = "fallback_hard"
        logger.info(
            f"Interview {interview.id}: first-level questions persisted (count={len(all_questions)} offset={q_offset} source={source_tag} fallback_reason={fallback_reason or ''})"
        )
    except Exception as e:
        db.rollback()
        logger.error(
            f"Interview {interview.id}: DB persistence failed for generated questions (fallback={used_fallback}). err={e}"
        )
        raise HTTPException(status_code=500, detail="Failed to save generated interview questions safely.")


async def _generate_fallback_questions_direct(interview_id: int):
    """Helper to generate fallback questions outside of the request flow if app data is missing."""
    from app.infrastructure.database import SessionLocal
    db = SessionLocal()
    try:
        interview = db.query(Interview).filter(Interview.id == interview_id).first()
        if interview:
            # Re-use existing fallback logic
            await _generate_first_level_questions(interview, None, None, db)
    finally:
        db.close()


