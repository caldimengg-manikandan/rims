from fastapi import HTTPException, status


def validate_hr_ownership_for_interview(interview, current_user, *, resource_name: str = "interview") -> None:
    """Ensure the HR (or super_admin) owns the application attached to this interview."""
    if interview is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview not found")
    
    # Super admins can bypass
    if current_user.role.lower() == "super_admin":
        return

    application = getattr(interview, "application", None)
    if application is None:
        # If application was deleted or is missing, treat as not found for safety
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview context not found")
        
    validate_hr_ownership(application, current_user, resource_name=resource_name)


def validate_hr_ownership(resource, current_user, *, resource_name: str = "resource") -> None:
    """
    Centralized ownership guard for all non-admin users.
    Checks both direct assignment (hr_id) and job-level ownership.
    """
    if current_user.role.lower() == "super_admin":
        return


    # Check Direct Ownership (Resource assigned to this HR)
    owner_id = getattr(resource, "hr_id", None)
    if owner_id is not None and owner_id == current_user.id:
        return

    # Check Job-Level Ownership (HR owns the job this application is for)
    # This works for both Job and Application objects
    job = getattr(resource, "job", None)
    if job and getattr(job, "hr_id", None) == current_user.id:
        return
        
    # Standard Job check (if resource is a Job)
    if hasattr(resource, "title") and hasattr(resource, "hr_id") and resource.hr_id == current_user.id:
        return

    # If all checks fail, DENY.
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Access denied: You do not have permission to manage this {resource_name}.",
    )

