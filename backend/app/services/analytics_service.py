from sqlalchemy.orm import Session
from sqlalchemy import func, case, or_, and_
from app.domain.models import Job, Application, Interview, Offer
from typing import Dict, Any, List

class AnalyticsService:
    def __init__(self, db: Session):
        self.db = db

    @classmethod
    def get_dashboard(cls, db: Session, hr_id: int = None, job_id: int = None, from_date: str = None, to_date: str = None) -> Dict[str, Any]:
        """
        Get consistent dashboard metrics with null safety and zero defaults.
        """
        import logging
        from datetime import datetime
        logger = logging.getLogger(__name__)

        try:

            
            # Helper to apply shared filters — timestamps are stored as IST, compare directly
            def apply_filters(q, model_for_date=Application):
                if hr_id:
                    q = q.outerjoin(Job, Application.job_id == Job.id).filter(
                        or_(Job.hr_id == hr_id, Application.hr_id == hr_id)
                    )
                if job_id:
                    q = q.filter(Application.job_id == job_id)
                if from_date:
                    try:
                        sd = datetime.strptime(from_date, "%Y-%m-%d").date()
                        # Use applied_at for Application, created_at for Interview
                        date_col = Application.applied_at if model_for_date == Application else model_for_date.created_at
                        from sqlalchemy import func as sqlfunc
                        q = q.filter(sqlfunc.date(date_col) >= sd)
                    except: pass
                if to_date:
                    try:
                        ed = datetime.strptime(to_date, "%Y-%m-%d").date()
                        date_col = Application.applied_at if model_for_date == Application else model_for_date.created_at
                        from sqlalchemy import func as sqlfunc
                        q = q.filter(sqlfunc.date(date_col) <= ed)
                    except: pass
                return q

            # Combine all core metrics into a single row fetch to minimize network round-trips
            # Hired stages: hired, offer_sent, onboarded, offer_accepted, offer_rejected
            HIRED_STATUSES = ['hired', 'offer_sent', 'onboarded', 'offer_accepted', 'offer_rejected']
            CLOSED_STATUSES = ['hired', 'offer_sent', 'onboarded', 'offer_accepted', 'offer_rejected', 'rejected']
            metrics_query = db.query(
                func.count(Application.id).label("total_apps"),
                func.count(case((Application.status.in_(HIRED_STATUSES), Application.id))).label("hired_apps"),
                func.count(case((and_(Offer.offer_sent == True, Application.status.in_(['hired', 'pending_approval', 'offer_sent', 'accepted', 'onboarded'])), Application.id))).label("offered_apps"),
                func.count(case((Application.status.in_(CLOSED_STATUSES), Application.id))).label("closed_apps"),
                func.avg(case((Application.composite_score > 0, Application.composite_score))).label("avg_score")
            ).outerjoin(Offer, Application.id == Offer.application_id)
            
            metrics_query = apply_filters(metrics_query)
            
            m_res = metrics_query.first()
            total_applications = m_res.total_apps or 0
            hired_count = m_res.hired_apps or 0
            offered_count = m_res.offered_apps or 0
            closed_apps_count = m_res.closed_apps or 0
            average_score = m_res.avg_score or 0

            # Interview stats
            int_query = db.query(
                func.count(Interview.id).label("total_ints"),
                func.count(case((Interview.status == "completed", Interview.id))).label("completed_ints")
            ).outerjoin(Application, Interview.application_id == Application.id)
            
            int_query = apply_filters(int_query)
            
            i_res = int_query.first()
            total_interviews = i_res.total_ints or 0
            completed_interviews = i_res.completed_ints or 0
            
            # Success Rate = Hired (offer_sent/hired/onboarded/offer_accepted/offer_rejected) / Closed
            # Closed = all hired stages + rejected (excludes pending/in-progress candidates)
            success_rate = (hired_count / closed_apps_count * 100) if closed_apps_count > 0 else 0

            result = {
                "total_applications": total_applications,
                "total_interviews": total_interviews,
                "completed_interviews": completed_interviews,
                "success_rate": round(success_rate, 2),
                "average_score": round(float(average_score), 2),
                "offers_released": offered_count
            }

            # ── Application Pipeline (Chart Data) ──
            # Aggregate status counts for the chart
            pipeline_query = db.query(
                Application.status, 
                func.count(Application.id)
            )
            if hr_id:
                pipeline_query = pipeline_query.outerjoin(Job, Application.job_id == Job.id).filter(
                    or_(Job.hr_id == hr_id, Application.hr_id == hr_id)
                )
            
            pipeline_results = pipeline_query.group_by(Application.status).all()
            
            # Map of internal status -> visible chart bucket name.
            # offer_sent / accepted / hired / onboarded all roll up into 'Hired'
            # so the chart reflects the total candidates progressing beyond Physical.
            status_map = {
                'applied': 'Applied',
                'screened': 'Screened',
                'interview_scheduled': 'Interview scheduled',
                'interview_completed': 'Interview completed',
                'review_later': 'Review Later',  
                'physical_interview': 'Physical Interview',
                'offer_sent': 'Offer Sent',
                'hired': 'Hired',
                'onboarded': 'Onboarded',
                'rejected': 'Rejected'
            }
            
            # The 10 stages for the pipeline chart
            CHART_ORDER = [ 
                'Applied', 'Screened', 'Interview scheduled', 'Interview completed', 
                'Review Later', 'Physical Interview', 'Hired', 'Offer Sent', 'Onboarded', 'Rejected'
            ]

            # Initialize with 0s so all bars always appear
            counts = {name: 0 for name in CHART_ORDER}
            for stat, count in pipeline_results:
                display_name = status_map.get(stat)
                if display_name and display_name in counts:
                    counts[display_name] += count
                # Statuses not in status_map are silently ignored
                
            # 'Hired' should also include the counts from 'Offer Sent' and 'Onboarded'
            counts['Hired'] += counts['Offer Sent'] + counts['Onboarded']
            
            # Build the chart_data list – all 6 stages always included
            core_stages = list(CHART_ORDER)   # every stage is core
            result["chart_data"] = [
                {"name": name, "value": counts[name]}
                for name in CHART_ORDER
            ]

            logger.info(f"[ANALYTICS DATA] {result}")
            return result
        except Exception as e:
            logger.error(f"[ANALYTICS SERVICE ERROR] {str(e)}")
            return {
                "total_applications": 0,
                "total_interviews": 0,
                "completed_interviews": 0,
                "success_rate": 0,
                "average_score": 0
            }

    def get_enterprise_metrics(self, hr_id: int = None) -> Dict[str, Any]:
        """
        Calculate enterprise-level recruitment metrics (Point 5).
        """
        # Calculate all counts in a single query using CASE WHEN
        # Application Counts
        app_metrics = self.db.query(
            func.count(Application.id).label("total")
        ).outerjoin(Job, Application.job_id == Job.id)
        
        # Interview Counts 
        int_metrics = self.db.query(
            func.count(Interview.id).label("total"),
            func.count(case((Interview.status == "interview_completed", Interview.id))).label("completed")
        ).join(Application, Interview.application_id == Application.id).outerjoin(Job, Application.job_id == Job.id)
        
        # Hired Count and Offered Count
        hired_metrics = self.db.query(func.count(Application.id)).filter(Application.status.in_(['hired', 'offer_sent', 'onboarded','offer_accepted', 'offer_rejected'])).outerjoin(Job, Application.job_id == Job.id)
        offered_metrics = self.db.query(func.count(Application.id)).outerjoin(Offer, Application.id == Offer.application_id).filter(Offer.offer_sent == True).outerjoin(Job, Application.job_id == Job.id)

        if hr_id:
            app_metrics = app_metrics.filter(or_(Job.hr_id == hr_id, Application.hr_id == hr_id))
            int_metrics = int_metrics.filter(or_(Job.hr_id == hr_id, Application.hr_id == hr_id))
            hired_metrics = hired_metrics.filter(or_(Job.hr_id == hr_id, Application.hr_id == hr_id))
            offered_metrics = offered_metrics.filter(or_(Job.hr_id == hr_id, Application.hr_id == hr_id))
            
        total_applications = app_metrics.scalar() or 0
        valid_int_result = int_metrics.filter(Interview.status.in_(['interview_completed'])).first()
        valid_interviews = valid_int_result[0] if valid_int_result else 0
        completed_interviews = valid_int_result[1] if valid_int_result else 0
        hired_count = hired_metrics.scalar() or 0   
        offered_count = offered_metrics.scalar() or 0

        # Debug Logging for Correctness Verification
        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"[ANALYTICS] Accuracy Check - Total Apps: {total_applications}, Valid Ints: {valid_interviews}, Completed Ints: {completed_interviews}")

        # Validation Check
        if valid_interviews > total_applications:
            logger.warning(f"[ANALYTICS] Suspicious Data: Intervews ({valid_interviews}) exceed Applications ({total_applications})")
        if completed_interviews > valid_interviews:
            logger.error(f"[ANALYTICS] LOGIC ERROR: Completed ({completed_interviews}) exceeds Valid Total ({valid_interviews})")

        # Calculations
        completion_rate = (completed_interviews / valid_interviews * 100) if valid_interviews > 0 else 0
        hiring_success_rate = (hired_count / total_applications * 100) if total_applications > 0 else 0

        # Candidate aggregate metrics
        # Candidate aggregate metrics with COALESCE for null safety
        avg_resume_score_query = self.db.query(func.coalesce(func.avg(Application.resume_score), 0)).filter(Application.resume_score > 0).outerjoin(Job, Application.job_id == Job.id)
        avg_aptitude_score_query = self.db.query(func.coalesce(func.avg(Application.aptitude_score), 0)).filter(Application.aptitude_score > 0).outerjoin(Job, Application.job_id == Job.id)
        avg_interview_score_query = self.db.query(func.coalesce(func.avg(Application.interview_score), 0)).filter(Application.interview_score > 0).outerjoin(Job, Application.job_id == Job.id)
        avg_composite_score_query = self.db.query(func.coalesce(func.avg(Application.composite_score), 0)).filter(Application.composite_score > 0).outerjoin(Job, Application.job_id == Job.id)

        if hr_id:
            avg_resume_score_query = avg_resume_score_query.filter(or_(Job.hr_id == hr_id, Application.hr_id == hr_id))
            avg_aptitude_score_query = avg_aptitude_score_query.filter(or_(Job.hr_id == hr_id, Application.hr_id == hr_id))
            avg_interview_score_query = avg_interview_score_query.filter(or_(Job.hr_id == hr_id, Application.hr_id == hr_id))
            avg_composite_score_query = avg_composite_score_query.filter(or_(Job.hr_id == hr_id, Application.hr_id == hr_id))

        avg_resume_score = avg_resume_score_query.scalar() or 0
        avg_aptitude_score = avg_aptitude_score_query.scalar() or 0
        avg_interview_score = avg_interview_score_query.scalar() or 0
        avg_composite_score = avg_composite_score_query.scalar() or 0

        return {
            "recruitment_metrics": {
                "total_candidates": total_applications,
                "shortlisted_candidates": valid_interviews, # Shortlisted currently mapped to having an interview
                "interviewed_candidates": completed_interviews,
                "offers_released": offered_count,
                "hiring_success_rate": round(hiring_success_rate, 2),
                "completion_rate": round(completion_rate, 2)
            },
            "candidate_metrics": {
                "avg_job_compatibility": round(avg_resume_score, 2),
                "avg_aptitude_score": round(avg_aptitude_score, 2),
                "avg_interview_score": round(avg_interview_score, 2),
                "avg_composite_score": round(avg_composite_score, 2)
            }
        }

    def get_job_pipeline_stats(self, job_id: int) -> List[Dict[str, Any]]:
        """
        Get count of candidates in each stage for a specific job (Point 12).
        """
        stages = [
            'applied', 'screened', 'interview_completed',
            'review_later', 'physical_interview', 'offer_sent', 
            'hired', 'onboarded', 'rejected'
        ]
        # Calculate all stage counts in a single GROUP BY query
        results = self.db.query(
            Application.status, 
            func.count(Application.id)
        ).filter(Application.job_id == job_id).group_by(Application.status).all()
        
        counts_map = {status: count for status, count in results}
        
        stats = []
        for stage in stages:
            stats.append({"stage": stage, "count": counts_map.get(stage, 0)})
            
        return stats
