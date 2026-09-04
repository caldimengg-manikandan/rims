"""
Comprehensive verification test script for AI integrations and local development setup.
Tests each AI feature end-to-end and validates local PostgreSQL and local storage.
"""
import asyncio
import os
import json
import pytest
from app.services.ai_client import ai_client
from app.services.ai_service import (
    parse_resume_with_ai,
    extract_basic_candidate_info,
    extract_job_details,
)
from interview_process.question_generator import QuestionGenerator
from interview_process.response_analyzer import ResponseAnalyzer
from app.infrastructure.database import SessionLocal, engine
from app.domain.models import Job, Application, ResumeExtraction, Tenant
from app.core.storage import is_local_storage, upload_file, download_file, get_signed_url, delete_file

# Sample test data
SAMPLE_RESUME = """
Jane Doe
Senior Full-Stack Software Engineer
Phone: +1-555-987-6543
Email: jane.doe@techcorp.example.com
Location: Seattle, WA

Summary:
Experienced software engineer with 7+ years developing scalable backend distributed systems in Python, FastAPI, PostgreSQL, Docker, and Kubernetes. Led frontend redesign using React and TypeScript.

Skills: Python, FastAPI, PostgreSQL, Docker, Kubernetes, React, TypeScript, Redis, System Design.

Work Experience:
Senior Backend Engineer at TechCorp (2021 - Present):
- Architected and deployed microservices processing 50M requests daily.
- Reduced PostgreSQL query latency by 45% through composite indexing and query optimization.
"""

SAMPLE_JD = """
Senior Python Backend Developer
Location: Remote (US)
Domain: Software Engineering
Experience Level: Senior
Job Type: Full-Time

Job Description:
We are seeking a Senior Python Backend Developer to lead development of our core cloud platform.
Responsibilities:
- Build high-performance REST and GraphQL APIs using Python, FastAPI, and PostgreSQL.
- Architect resilient microservices deployed on Kubernetes with Redis caching.
- Mentor junior engineers and conduct technical design reviews.

Requirements:
- 5+ years of experience with Python and relational databases (PostgreSQL preferred).
- Deep experience with Docker, Kubernetes, and cloud platforms (AWS/GCP).
- Strong system architecture and API design principles.
"""


@pytest.mark.asyncio
async def test_ai_groq_connectivity():
    """Verify live Groq API connectivity using active model."""
    res = await ai_client.generate("Hello, reply with only the word 'OK'.", provider="groq")
    assert res != "AI_DISABLED"
    assert "OK" in res.upper()


@pytest.mark.asyncio
async def test_openrouter_routing_and_fallback():
    """Verify OpenRouter provider routing and graceful fallback to Groq when OpenRouter key is unset."""
    # When provider='openrouter' but no OPENROUTER_API_KEY is configured, it falls back to Groq automatically
    res = await ai_client.generate("Hello, reply with 'READY'.", provider="openrouter")
    assert res != "AI_DISABLED"
    assert "READY" in res.upper()


@pytest.mark.asyncio
async def test_resume_parsing():
    """Verify AI-powered resume processing and scoring."""
    result = await parse_resume_with_ai(SAMPLE_RESUME, job_id=1, job_description=SAMPLE_JD)
    assert isinstance(result, dict)
    assert "skills" in result
    assert "score" in result
    assert result["score"] > 0
    assert len(result["skills"]) > 0


@pytest.mark.asyncio
async def test_basic_candidate_info_autofill():
    """Verify AI auto-fill for candidate name and phone from resume."""
    info = await extract_basic_candidate_info(SAMPLE_RESUME)
    assert isinstance(info, dict)
    assert "Jane Doe" in info.get("name", "")
    assert "555" in info.get("phone", "")


@pytest.mark.asyncio
async def test_jd_analysis_autofill():
    """Verify AI-powered job description extraction and auto-fill."""
    details = await extract_job_details(SAMPLE_JD)
    assert isinstance(details, dict)
    assert "Senior Python Backend Developer" in details.get("title", "")
    assert len(details.get("primary_evaluated_skills", [])) > 0


@pytest.mark.asyncio
async def test_ai_question_generation():
    """Verify AI interview question generation."""
    generator = QuestionGenerator()
    questions = await generator.generate_initial_skill_questions(
        skill_category="Python",
        candidate_level="senior"
    )
    assert questions is not None
    assert len(questions) > 0
    assert any(len(q) > 10 for q in questions)


@pytest.mark.asyncio
async def test_ai_answer_evaluation():
    """Verify AI interview answer evaluation and scoring."""
    analyzer = ResponseAnalyzer()
    evaluation = await analyzer.evaluate_answer(
        question="How do you optimize slow queries in PostgreSQL?",
        answer="I analyze execution plans using EXPLAIN ANALYZE, check sequential scans, create targeted B-tree or GIN indexes, and tune work_mem.",
        question_type="technical"
    )
    assert evaluation is not None
    assert "overall" in evaluation
    assert evaluation["overall"] >= 0


def test_local_postgresql_isolation():
    """Verify all database queries connect to local PostgreSQL instance."""
    assert "127.0.0.1" in str(engine.url) or "localhost" in str(engine.url)
    assert "rims_db" in str(engine.url)

    with SessionLocal() as db:
        # Check active tenant
        tenant = db.query(Tenant).first()
        assert tenant is not None

        # Check jobs
        jobs_count = db.query(Job).count()
        assert jobs_count > 0


def test_local_resume_storage():
    """Verify resume files are stored on the local disk filesystem."""
    assert is_local_storage() is True

    test_bucket = "resumes"
    test_path = "local_test/sample_resume.pdf"
    content = b"%PDF-1.4 Mock local dev resume"

    # Upload
    uploaded = upload_file(test_bucket, test_path, content, "application/pdf")
    assert uploaded == test_path

    # Download
    data = download_file(test_bucket, test_path)
    assert data == content

    # URL Check
    url = get_signed_url(test_bucket, test_path)
    assert "http://127.0.0.1:10000/api/storage/resumes/local_test/sample_resume.pdf" in url

    # Clean up
    delete_file(test_bucket, test_path)
