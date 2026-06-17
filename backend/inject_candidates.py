import os
import sys

# Ensure backend directory is in path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.infrastructure.database import SessionLocal
from app.domain.models import Application, Job, User
from app.domain.constants import CandidateState

def main():
    db = SessionLocal()
    try:
        # We need an HR/Super Admin user
        hr = db.query(User).filter(User.role == "hr").first()
        if not hr:
            hr = db.query(User).first()
        if not hr:
            print("No user exists in the database. Please register/create a user first.")
            return

        hr_id = hr.id

        # We need 3 different jobs. Fetch existing ones, or create if we need more.
        existing_jobs = db.query(Job).filter(Job.status == "open").all()
        jobs = list(existing_jobs)
        
        needed_titles = ["Software Engineer", "Product Manager", "Data Analyst"]
        while len(jobs) < 3:
            title = needed_titles[len(jobs) % len(needed_titles)]
            # If a job with this title already exists in the list, differentiate it
            if any(j.title == title for j in jobs):
                title = f"{title} (Level {len(jobs) + 1})"
            
            new_job = Job(
                title=title,
                description=f"This is a test job description for {title}.",
                experience_level="Mid-Level",
                status="open",
                hr_id=hr_id,
                primary_evaluated_skills="Python, SQL, Communication"
            )
            db.add(new_job)
            db.commit()
            db.refresh(new_job)
            jobs.append(new_job)
            print(f"Created Job '{new_job.title}' with ID {new_job.id}")

        # Pick the first 3 jobs
        jobs = jobs[:3]
        print(f"Using 3 different jobs:")
        for idx, job in enumerate(jobs):
            print(f"  Job {idx+1}: '{job.title}' (ID: {job.id})")

        # Inject 3 candidates (1 for each job) in the stage 'interview_completed'
        candidates_to_inject = [
            ("Alice Johnson", "alice.johnson@example.com"),
            ("Bob Smith", "bob.smith@example.com"),
            ("Charlie Davis", "charlie.davis@example.com")
        ]

        print("Injecting candidates...")
        for idx, (name, email) in enumerate(candidates_to_inject):
            job = jobs[idx]
            # Check if application already exists for this email and job
            existing = db.query(Application).filter(
                Application.job_id == job.id,
                Application.candidate_email == email
            ).first()
            
            if existing:
                print(f"  Candidate '{name}' ({email}) already exists in Job '{job.title}'. Updating status to 'interview_completed'...")
                existing.status = 'interview_completed'
            else:
                print(f"  Creating candidate '{name}' ({email}) in Job '{job.title}' in stage 'interview_completed'...")
                app = Application(
                    job_id=job.id,
                    hr_id=hr_id,
                    candidate_name=name,
                    candidate_email=email,
                    status='interview_completed',
                    resume_status='parsed',
                    resume_score=85.0,
                    aptitude_score=75.0,
                    interview_score=80.0,
                    composite_score=80.0
                )
                db.add(app)
        
        db.commit()
        print("Done! All candidates injected successfully.")
    except Exception as e:
        db.rollback()
        print("Error during candidate injection:", e)
    finally:
        db.close()

if __name__ == "__main__":
    main()
