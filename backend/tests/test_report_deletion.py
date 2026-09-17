import pytest
from unittest.mock import MagicMock, patch
from fastapi import HTTPException

from app.services.interview_reporting_service import delete_report_and_interview_data
from app.domain.models import Application, Interview, InterviewReport


def test_delete_app_report_without_interview_resets_status():
    db = MagicMock()
    app_record = MagicMock(spec=Application)
    app_record.id = 42
    app_record.interview = None
    app_record.status = "interview_completed"
    app_record.tenant_id = "t-1"
    app_record.hr_id = "hr-1"

    db.query.return_value.filter.return_value.first.return_value = app_record

    current_user = MagicMock()
    current_user.id = "hr-1"
    current_user.role = "hr"

    tenant_ctx = MagicMock()
    tenant_ctx.id = "t-1"

    with patch("app.core.ownership.validate_hr_ownership", return_value=True):
        res = delete_report_and_interview_data(db, "app_42", current_user, tenant_ctx)

    assert res["success"] is True
    assert res["deleted_report_id"] == "app_42"
    assert app_record.status == "applied"
    db.commit.assert_called_once()


def test_delete_app_report_with_existing_interview():
    db = MagicMock()
    app_record = MagicMock(spec=Application)
    app_record.id = 55
    interview = MagicMock(spec=Interview)
    interview.id = 101
    interview.tenant_id = "t-1"
    interview.report = None
    interview.video_recording_path = None
    interview.application = app_record
    app_record.interview = interview
    app_record.status = "review_later"
    app_record.tenant_id = "t-1"
    app_record.hr_id = "hr-1"

    db.query.return_value.filter.return_value.first.return_value = app_record
    db.query.return_value.filter.return_value.all.return_value = []

    current_user = MagicMock()
    current_user.id = "hr-1"
    current_user.role = "hr"

    tenant_ctx = MagicMock()
    tenant_ctx.id = "t-1"

    with patch("app.core.ownership.validate_hr_ownership", return_value=True):
        res = delete_report_and_interview_data(db, "app_55", current_user, tenant_ctx)

    assert res["success"] is True
    assert app_record.status == "applied"
    assert app_record.interview is None
    db.delete.assert_called_once_with(interview)
    db.commit.assert_called_once()


def test_delete_standard_report_resets_application_status():
    db = MagicMock()
    app_record = MagicMock(spec=Application)
    app_record.id = 77
    app_record.status = "interview_completed"
    app_record.tenant_id = "t-1"
    app_record.hr_id = "hr-1"

    interview = MagicMock(spec=Interview)
    interview.id = 202
    interview.tenant_id = "t-1"
    interview.video_recording_path = None
    interview.application = app_record
    app_record.interview = interview

    report = MagicMock(spec=InterviewReport)
    report.id = 303
    report.interview = interview
    interview.report = report

    # db.query(InterviewReport)... returns report
    db.query.return_value.filter.return_value.first.return_value = report
    db.query.return_value.filter.return_value.all.return_value = []

    current_user = MagicMock()
    current_user.id = "hr-1"
    current_user.role = "hr"

    tenant_ctx = MagicMock()
    tenant_ctx.id = "t-1"

    with patch("app.core.ownership.validate_hr_ownership", return_value=True):
        res = delete_report_and_interview_data(db, "303", current_user, tenant_ctx)

    assert res["success"] is True
    assert app_record.status == "applied"
    assert app_record.interview is None
    db.delete.assert_called_once_with(interview)
    db.commit.assert_called_once()


def test_delete_report_not_found():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None

    current_user = MagicMock()
    current_user.role = "hr"

    with pytest.raises(HTTPException) as exc:
        delete_report_and_interview_data(db, "9999", current_user)
    assert exc.value.status_code == 404


def test_delete_report_tenant_mismatch():
    db = MagicMock()
    app_record = MagicMock(spec=Application)
    app_record.id = 12
    app_record.interview = None
    app_record.status = "interview_completed"
    app_record.tenant_id = "tenant-other"

    db.query.return_value.filter.return_value.first.return_value = app_record

    current_user = MagicMock()
    current_user.role = "hr"

    tenant_ctx = MagicMock()
    tenant_ctx.id = "tenant-current"

    with pytest.raises(HTTPException) as exc:
        delete_report_and_interview_data(db, "app_12", current_user, tenant_ctx)
    assert exc.value.status_code == 403
