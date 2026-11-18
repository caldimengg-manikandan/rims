# CALRIMS Release & QA Testing Specification
## Detailed Analysis of Changes Across the Last 12 Commits (`ec66e2c` → `2f00f7e`)

> **Document Purpose:** Comprehensive feature breakdown, architecture changes, API additions, UI updates, and test validation checklists for QA, Automation, and Security testing teams.  
> **Commit Range:** `ec66e2c` to `2f00f7e` (12 Commits)  
> **Repository:** CALRIMS (`c:\Users\user\Aashif\CALRIMS`)  
> **Date Generated:** November 2026  

---

## 1. Commit Log & Scope Overview

The last 12 commits represent a major platform evolution delivering two foundational enterprise subsystems (**Enterprise Multi-Tenancy** and **Sandboxed Coding Assessments**) alongside comprehensive UI/UX updates, reporting dashboards, transactional email overhaul, and performance optimizations.

| Commit Hash | Author | Date | Subject / Scope |
| :--- | :--- | :--- | :--- |
| **`ec66e2c`** | caldimengg-manikandan | 2026-09-02 | `multi tenancy implemention` — Initial database schema, middleware, and tenant models |
| **`b5a2c90`** | Aashif-Codehub | 2026-09-03 | `multitenancy and integration of coding assessment round in interviews` — Core coding executor, models, candidate workspace |
| **`eda3f9a`** | Aashif-Codehub | 2026-09-04 | `multi tenancy bugs resolved` — Super Admin tenant management, domain routing, branding, security fixes |
| **`9558eb9`** | Aashif-Codehub | 2026-09-04 | `coding repo enhancements and added validation` — Language registry, solution validator, problem bank |
| **`25d952e`** | Aashif-Codehub | 2026-09-07 | `ui enhancements and added import/export functionality in coding repo` — JSON import/export, reporting hooks |
| **`6e2b735`** | caldimengg-manikandan | 2026-09-08 | `optimized performance0` — Build configs, startup scripts, and server tuning |
| **`537b721`** | Aashif-Codehub | 2026-09-08 | `feat: implement email service with tenant-aware branding and HTML-to-text conversion support` |
| **`b43459a`** | Aashif-Codehub | 2026-09-08 | `Merge branch 'main' of aashif:CodehubDAS/CALRIMS` |
| **`a5893bf`** | Aashif-Codehub | 2026-09-16 | `feat: implement backend APIs, execution services, and frontend workspaces for interview management` |
| **`93eddc3`** | Aashif-Codehub | 2026-09-17 | `feat: implement code execution services, analytics API, and reporting dashboard components` |
| **`25df5a2`** | Aashif-Codehub | 2026-09-18 | `improved performance and optimized resource usage` — Asset compression, Nginx configs, memory optimization |
| **`2f00f7e`** | Aashif-Codehub | 2026-09-21 | `feat: implement coding assessment module with Redis store, language registry, and workspace UI` |

---

## 2. Module 1: Enterprise Multi-Tenancy & Organization Management

### 2.1 Overview & Architecture
Transforms CALRIMS from a single-tenant system into an enterprise-grade, shared-database, isolated-schema multi-tenant platform. Each organization (tenant) operates with its own branding, users, jobs, applications, questions, coding assessments, and audit trails.

### 2.2 Features Added
1. **Self-Service Organization Onboarding (`/company/register`):**
   - Public multi-step registration wizard for new corporate tenants.
   - Form inputs: Company Name, Subdomain Slug (e.g. `acme`), Logo URL, Primary Brand Color, Industry Domain, Company Size, Corporate Address with interactive OpenStreetMap/Nominatim Geocoding integration (`/api/geocode`).
   - Primary Super Admin account creation during registration.
   - Initial status: Organization defaults to `pending` status awaiting Platform Root Admin review and approval.
2. **Platform Tenant Management Portal (`/dashboard/tenants`):**
   - Dedicated dashboard accessible exclusively by Platform Root Admins (`root-admin` role).
   - Metrics bar: Total Organizations, Active Tenants, Pending Review, Suspended Accounts.
   - Filterable data table with search by company name, slug, or custom domain.
   - Direct administrative actions:
     - **Approve Tenant (`POST /api/tenants/{id}/approve`):** Activates tenant and auto-approves their primary admin.
     - **Reject Tenant (`POST /api/tenants/{id}/reject`):** Rejects tenant and deactivates associated user accounts.
     - **Update Status (`PUT /api/tenants/{id}/status`):** Change status between `active`, `suspended`, `deactivated`, or `trial`.
     - **Update Tenant Profile (`PUT /api/tenants/{id}`):** Configure custom domains, branding assets, and organization metadata.
3. **Tenant Switcher UI (`frontend/components/tenant-switcher.tsx`):**
   - Header dropdown component for Root Admins allowing seamless switching between tenant workspaces.
   - Persists active organization in cookies (`x-tenant-slug`, `x-tenant-id`), React Context, and SWR cache keys.
   - Normal HR and Tenant Super Admins are locked into their own organization and cannot switch.
4. **Dynamic White-Labeling & Runtime Branding (`frontend/components/dynamic-branding.tsx`):**
   - Runtime brand injection into document `<title>`, favicon, sidebar logos, and CSS custom properties (`--primary-color`).
   - Server-side resolution (`branding-server.ts`) and client-side resolution (`branding-client.ts`) with neutral fallback branding when accessing via default domain.
5. **Multi-Tenant Request Isolation Middleware (`backend/app/core/middleware.py`):**
   - Multi-tier tenant resolution order:
     1. Host header (Custom domain lookup, e.g., `careers.acme.com`).
     2. Subdomain lookup (e.g., `acme.calrims.com`).
     3. Request Header `X-Tenant-ID` or `X-Tenant-Slug`.
     4. Auth token tenant claim (`tenant_id`).
   - Injects resolved `TenantContext` into `request.state.tenant`.
   - Automatically sets PostgreSQL session variable `SET LOCAL app.current_tenant_id = '<uuid>'` for Row-Level Security (RLS) enforcement.
   - Validates organization status: returns HTTP 403 Forbidden if a tenant is `suspended` or `deactivated`.

### 2.3 Files Modified / Added
- **Backend:**
  - `backend/app/api/tenants.py` *(New)*
  - `backend/app/core/tenant_context.py` *(New)*
  - `backend/app/core/middleware.py`
  - `backend/app/core/ownership.py`
  - `backend/app/core/branding.py`
  - `backend/app/infrastructure/database.py`
  - `backend/app/domain/models.py` (`Tenant` model added, `tenant_id` FK on all tables)
  - `supabase/migrations/20260901000000_enable_multitenancy.sql`
  - `supabase/migrations/20260903150000_extend_multitenancy_tables.sql`
  - `supabase/migrations/20260904000000_allow_pending_tenant_status.sql`
  - `supabase/migrations/20260918000002_tenant_ownership.sql`
- **Frontend:**
  - `frontend/app/company/register/page.tsx` *(New)*
  - `frontend/app/dashboard/tenants/page.tsx` *(New)*
  - `frontend/components/tenant-switcher.tsx` *(New)*
  - `frontend/components/dynamic-branding.tsx` *(New)*
  - `frontend/lib/branding-client.ts` & `frontend/lib/branding-server.ts`
  - `frontend/middleware.ts` *(Next.js Edge middleware updated)*

### 2.4 QA Testing Checklist
- [ ] Test public organization registration at `/company/register` with valid and duplicate subdomain slugs.
- [ ] Verify Root Admin approval workflow from `/dashboard/tenants` activates the tenant and sends confirmation.
- [ ] Verify that a tenant with `status = 'suspended'` or `'pending'` blocks user logins with an informative error.
- [ ] Test Tenant Switcher: switch from Organization A to Organization B and verify that jobs, applications, and reports are completely partitioned.
- [ ] Verify custom domain resolution (e.g., map a local host in `setup_hosts.ps1` to test custom domain routing).
- [ ] Run automated tests: `pytest backend/tests/test_multitenancy.py backend/tests/test_tenant_management.py`.

---

## 3. Module 2: Sandboxed Coding Assessment & Execution Engine

### 3.1 Overview & Architecture
An integrated, secure coding assessment system allowing HR to curate algorithmic programming problems with hidden test cases and execute candidate code submissions inside ephemeral, resource-capped Docker sandboxes.

### 3.2 Features Added
1. **Coding Repository Management (`/dashboard/coding-repository`):**
   - **Problem Editor:**
     - Title, difficulty level (`easy`, `medium`, `hard`), markdown description, input/output specifications, and constraints.
     - Starter boilerplate code templates per language.
     - Encrypted reference solution storage (`solution_code`).
     - Resource limits: configurable CPU time limit (ms) and RAM memory limit (MB).
   - **Test Case Manager:**
     - Add multiple input/output test cases.
     - Weight per test case for proportional score calculation.
     - Toggle test case visibility (`is_hidden`): visible sample cases for candidate testing vs. hidden cases for formal grading.
   - **Built-in Reference Solution Validator:**
     - Interactive tool in the problem editor allowing HR to execute the reference solution against all configured test cases before publishing (`POST /api/coding/problems/{id}/validate-solution`).
   - **Bulk Import & Export Tooling:**
     - Export entire problem banks or question sets as standard JSON files (`POST /api/coding/export`).
     - Import question set JSON files with schema validation, sanitization, and duplicate title checks (`POST /api/coding/import`).
   - **Coding Question Sets:**
     - Group multiple problems into reusable question sets.
     - Configure supported programming languages per set (e.g., Python 3, Java 21).
     - Order problems within a set using `display_order`.
2. **Language Registry & Execution Engine (`backend/app/execution/`):**
   - Support for **Python 3**, **Java 21**, **C++ (g++)**, and **Node.js (JavaScript)**.
   - Strict rejection of deprecated/unsupported languages (`csharp`, `typescript`) at both schema and API levels.
   - **Docker Sandbox Executor (`docker_executor.py`):**
     - Ephemeral container creation with read-only file systems and tmpfs volume mounts.
     - Execution timeouts (`time_limit_ms`, default 2000 ms) preventing infinite loops.
     - Hard memory limits (`memory_limit_mb`, default 256 MB) preventing out-of-memory crashes.
     - Disabled networking (`network_mode="none"`) preventing external network calls or data exfiltration.
     - Non-root user execution.
   - **Judge Comparison Engine (`judge.py`):**
     - Normalizes carriage returns (`\r\n` vs. `\n`) and trailing whitespace.
     - Produces standard algorithmic verdicts:
       - `accepted`: Output matches expected output exactly.
       - `wrong_answer`: Output mismatch.
       - `time_limit_exceeded` (TLE): Process exceeded CPU timeout.
       - `runtime_error`: Non-zero exit code or uncaught exceptions.
       - `compilation_error`: Compilation failure (Java/C++).
3. **Candidate Coding Workspace (`frontend/modules/interview/CodingWorkspace.tsx`):**
   - Full-screen IDE embedded inside the live interview room.
   - Problem statement panel with tabbed navigation across all assigned problems.
   - Multi-language code editor with syntax highlighting, autocomplete, and indentation formatting.
   - **"Run Code" Button:** Rate-limited test execution against visible sample cases showing Input, Expected Output, Actual Output, and compiler messages.
   - **"Submit Solution" Button:** Formal submission executed against hidden weighted test cases; calculates problem score (0–100%) and records submission in database.
   - **Authoritative Server Deadline:** Timer displays remaining duration; backend strictly rejects runs and submissions after `coding_started_at + duration`.
   - **"Complete Coding Round" Modal:** Confirms final submission, calculates aggregate coding score across all problems, and transitions session to the next stage or final report generation.

### 3.3 Files Modified / Added
- **Backend:**
  - `backend/app/api/coding.py` *(New, 932 lines)*
  - `backend/app/core/language_registry.py` *(New)*
  - `backend/app/execution/` (`__init__.py`, `executor.py`, `docker_executor.py`, `judge.py`, `service.py`) *(New)*
  - `backend/domain/models.py` (`CodingProblem`, `CodingTestCase`, `CodingQuestionSet`, `CodingQuestionSetItem`, `CodingSubmission`)
  - `supabase/migrations/20260903130000_add_coding_assessment.sql`
  - `supabase/migrations/20260918000001_coding_deadline.sql`
- **Frontend:**
  - `frontend/app/dashboard/coding-repository/page.tsx` *(New, 1866 lines)*
  - `frontend/modules/interview/CodingWorkspace.tsx` *(New, 821 lines)*
  - `frontend/lib/coding-languages.ts` *(New)*

### 3.4 QA Testing Checklist
- [ ] Test problem creation with sample input, expected output, and reference solution.
- [ ] Test "Validate Solution" button in Problem Editor to ensure reference code passes all test cases.
- [ ] Test candidate code execution in Python, Java, C++, and Node.js.
- [ ] Verify security sandboxing: attempt infinite loop (`while True: pass`) and verify `time_limit_exceeded` (TLE) is returned within 2 seconds.
- [ ] Verify memory capping: attempt memory bomb (`a = [0] * (10**9)`) and verify execution fails safely without crashing the backend.
- [ ] Verify network isolation: attempt `socket.connect()` or `requests.get()` from candidate code and verify network connection is refused.
- [ ] Test Import/Export: Export a question set to JSON, delete a problem, re-import, and verify structure integrity.
- [ ] Test submission score calculation: ensure problem score accurately weights passed test cases.
- [ ] Run automated tests: `pytest backend/tests/test_coding_assessment.py`.

---

## 4. Module 3: Job Requisition & Round Configuration

### 4.1 Overview & Architecture
Enhances the Job Requisition module to support configurable multi-round interviews, dynamic stage selection, coding round parameters, and tenant scoping.

### 4.2 Features Added
1. **Coding Round Requisition Configuration (`components/job-form.tsx`):**
   - **Coding Round Toggle:** `coding_round_enabled` switch on the job creation/edit form.
   - **Duration Setting:** `coding_round_duration_minutes` input field (default: 60 minutes).
   - **Question Set Selector:** `coding_repo_set_id` dropdown populated with existing Coding Question Sets from the repository.
   - **Language Multi-Select:** `coding_allowed_languages` picker enabling recruiters to restrict candidate languages (e.g. only Python 3 and Java 21 for a Backend position).
2. **Unified Interview Rounds Architecture (`interview_rounds`):**
   - Replaced flat boolean flags with a structured JSON schema in `Job.interview_rounds`.
   - Supports any combination of interview stages: Aptitude, First-Level AI Technical/Behavioral, and Coding Round.
   - Flat compatibility flags (`aptitude_enabled`, `first_level_enabled`, `coding_round_enabled`) remain backward-compatible and synchronized.
3. **Tenant Stamping & Isolation on Jobs:**
   - Jobs are stamped with `tenant_id` from the current recruiter's organization.
   - Public job board (`/api/jobs/public`) filters listings by the active tenant domain or subdomain.

### 4.3 Files Modified / Added
- `backend/app/api/jobs.py`
- `backend/app/domain/models.py` (`Job` schema extensions)
- `backend/app/domain/schemas.py` (`JobCreate`, `JobUpdate`, `JobResponse`)
- `frontend/components/job-form.tsx`

### 4.4 QA Testing Checklist
- [ ] Create a new job with Aptitude, First-Level, and Coding rounds all enabled.
- [ ] Create a job with only Coding Round enabled and verify Aptitude/First-level are skipped.
- [ ] Edit an existing job to change the Coding Question Set and verify updates persist.
- [ ] Verify that a recruiter from Organization A cannot see or select Question Sets belonging to Organization B.

---

## 5. Module 4: AI Live Interview Session & Round Progression

### 5.1 Overview & Architecture
Upgrades the candidate live interview session to seamlessly transition across multiple round types (Aptitude -> Technical/Behavioral -> Coding) under continuous anti-cheat proctoring.

### 5.2 Features Added
1. **Dynamic Stage Progression Engine (`backend/app/api/interviews.py`):**
   - `get_next_interview_stage()`: Dynamically calculates the next pending round for a candidate based on completed stages:
     - `not_started` → `aptitude` (if enabled)
     - `aptitude` completion → `first_level` (if enabled)
     - `first_level` completion → `coding` (if enabled)
     - `coding` completion → `completed`
2. **Server-Enforced Coding Deadline:**
   - When candidate enters the coding stage, `coding_started_at` is timestamped in the database.
   - Deadline calculation: `deadline = coding_started_at + Job.coding_round_duration_minutes`.
   - Candidate client syncs with server timestamp to display countdown.
   - Code runs and submissions attempted after the deadline are rejected with HTTP 400.
3. **Provisional Demo Interview Flow (`frontend/app/demo/page.tsx` & `/api/interviews/demo`):**
   - Allows HR managers and prospects to experience the full multi-round interview workflow (including coding problems) without creating permanent candidate clutter.
   - Ephemeral database records flagged with `is_demo = True`.
   - Cleanup handlers: application and interview records are automatically purged if the demo is abandoned or terminated early.

### 5.3 Files Modified / Added
- `backend/app/api/interviews.py`
- `frontend/modules/interview/InterviewSession.tsx`
- `frontend/app/demo/page.tsx`
- `supabase/migrations/20260904120000_allow_null_application_id_for_demo_interviews.sql`

### 5.4 QA Testing Checklist
- [ ] Start an interview for a 3-round job: complete Aptitude, verify smooth transition to First-Level AI interview, complete First-Level, verify smooth transition to Coding Workspace.
- [ ] In the Coding stage, verify that refreshing the browser restores the active session and maintains the correct elapsed timer.
- [ ] Test the Demo Interview at `/demo` and verify that all stages operate cleanly.
- [ ] Run automated tests: `pytest backend/tests/test_demo_auth.py`.

---

## 6. Module 5: Reporting, Analytics & Candidate Scorecard

### 6.1 Overview & Architecture
Extends the evaluation scorecard and executive analytics dashboards to display coding assessment metrics, code diffs, execution statistics, and multi-tenant funnel analytics.

### 6.2 Features Added
1. **Coding Evaluation Report Component (`frontend/components/reports/CodingReportView.tsx`):**
   - New dedicated report panel embedded in the candidate scorecard (`/dashboard/hr/scorecard/[id]`):
     - Overall Coding Score badge (0–100%).
     - Overall Passed vs. Total test cases counter.
     - Problem-by-problem breakdown table:
       - Problem title & difficulty badge.
       - Language used (Python, Java, etc.).
       - Execution runtime (ms) and peak memory (KB).
       - Status badge (`Accepted`, `Wrong Answer`, `Time Limit Exceeded`, `Runtime Error`).
       - Full submitted source code viewer with syntax highlighting and one-click copy.
       - Individual test case results (hidden test case details are masked; visible test case inputs and diffs are viewable).
2. **Composite Scorecard Integration (`interview_reporting_service.py`):**
   - Coding assessment score is integrated into the final evaluation report (`InterviewReport.coding_score`).
   - Final composite score calculation factors in coding proficiency when coding is enabled.
3. **Analytics Dashboard Multi-Tenancy Scoping (`/api/analytics/dashboard`):**
   - Dashboard KPI metrics (Total Applications, Interviews, Offers Released, Total Onboarded) are strictly scoped to the active tenant.
   - Stage distribution chart reflects real-time counts across the 11 candidate states.
   - Heatmap calendar (`/api/analytics/reports/heatmap`) reflects tenant-specific application frequency.
   - Report export (`/api/analytics/reports/export`) streams full CSV filtered by active tenant and date filters.
4. **Report Deletion & Cleanup Cascade:**
   - Safe deletion endpoint (`DELETE /api/analytics/reports/{id}`) cleans up orphan report records without breaking application relationships (`test_report_deletion.py`).

### 6.3 Files Modified / Added
- `frontend/components/reports/CodingReportView.tsx` *(New, 624 lines)*
- `frontend/components/reports/ReportCard.tsx`
- `frontend/components/reports/ReportDashboard.tsx`
- `frontend/app/dashboard/hr/reports/page.tsx`
- `backend/app/api/analytics.py`
- `backend/app/services/interview_reporting_service.py`
- `backend/tests/test_report_deletion.py` *(New)*

### 6.4 QA Testing Checklist
- [ ] Complete a candidate coding assessment, navigate to their scorecard, and verify the Coding Report panel renders accurately.
- [ ] Verify that source code formatting and test case execution times match the backend submission records.
- [ ] Verify that the candidate leaderboard on `/dashboard/hr/ranking/[id]` ranks candidates correctly factoring in coding scores.
- [ ] Test the CSV export on the Reports page and verify all columns (including coding metrics) download properly.

---

## 7. Module 6: Transactional Email Service Overhaul

### 7.1 Overview & Architecture
Complete re-architecture of `email_service.py` to support dynamic multi-tenant white-labeling, brand identity injection, automated HTML-to-text MIME multi-part generation, and local developer file logging.

### 7.2 Features Added
1. **Tenant-Aware Email Branding:**
   - Every transactional email automatically resolves the sender tenant's corporate identity:
     - Company Name in sender name (`"Acme Recruiting <noreply@calrims.com>"`).
     - Organization logo header in the email template.
     - Brand accent color applied to call-to-action buttons.
     - Physical corporate address in the email footer for CAN-SPAM compliance.
2. **Automated HTML-to-Plain-Text Conversion:**
   - Added regex and HTML parser in `email_service.py` that strips HTML tags, formats links, and generates a clean plain-text alternative.
   - All outgoing emails are dispatched as `multipart/alternative` (HTML + Plain Text) to maximize deliverability and prevent spam filtering.
3. **Comprehensive Transactional Email Templates:**
   - `send_application_received_email`: Confirmation to candidate upon applying.
   - `send_approved_for_interview_email`: Invitation email with direct link and one-time access key.
   - `send_interview_completed_email`: Notice of successful interview completion.
   - `send_interview_terminated_email`: Notification if session was terminated due to policy violations.
   - `send_offer_letter_email`: Formal offer issuance with secure review link.
   - `send_onboarding_reminder_email`: Automated 7-day, 3-day, and 1-day joining reminders.
   - `send_ticket_resolved_email`: Candidate support ticket resolution and reissued keys.
4. **Local Development Fallback:**
   - When SMTP credentials are unconfigured in development, emails are automatically written to `backend/debug_emails/` as timestamped `.html` files for verification.

### 7.3 Files Modified / Added
- `backend/app/services/email_service.py` *(666 lines modified/added)*
- `backend/tests/test_email_service_delivery.py` *(New)*

### 7.4 QA Testing Checklist
- [ ] Trigger an interview invitation from Organization A and verify the email contains Organization A's name, logo, and colors.
- [ ] Trigger an interview invitation from Organization B and verify Organization B's branding is used.
- [ ] Check outgoing email MIME headers to confirm both `text/html` and `text/plain` parts exist.
- [ ] Run automated tests: `pytest backend/tests/test_email_service_delivery.py`.

---

## 8. Module 7: Real-Time Infrastructure (WebSockets & Redis)

### 8.1 Overview & Architecture
Upgrades the real-time notification engine to use Redis pub/sub with in-memory fallbacks, fully partitioned by tenant ID to prevent cross-tenant message leakage.

### 8.2 Features Added
1. **Redis Store Manager (`backend/app/core/redis_store.py`):**
   - High-performance async Redis connection pool.
   - In-memory fallback if Redis is unavailable in local development.
   - Rate limiting store and ephemeral session caching.
2. **Tenant-Partitioned WebSocket Broadcaster (`backend/app/core/websocket.py`):**
   - Real-time notification channels are prefixed by `tenant_id` (e.g. `channel:tenant_{uuid}:user_{id}`).
   - Guards ensure HR managers only receive notifications for applications and interviews within their organization.
   - Client WebSocket connection authenticated via dedicated short-lived tokens (`/api/auth/ws-token`).
3. **Frontend WebSocket Hook (`frontend/hooks/use-websocket.ts`):**
   - Auto-reconnect with exponential backoff.
   - Real-time toast alerts and notification badge increments in the navbar (`notification-bell.tsx`).

### 8.3 Files Modified / Added
- `backend/app/core/redis_store.py` *(New)*
- `backend/app/core/websocket.py`
- `docker-compose.prod.yml` (Added Redis service)
- `frontend/hooks/use-websocket.ts`
- `backend/tests/test_websocket_redis.py` *(New)*

### 8.4 QA Testing Checklist
- [ ] Submit an application on Organization A; verify that Organization A's HR receives a real-time notification popup.
- [ ] Verify that an HR user logged into Organization B receives zero alerts for Organization A's events.
- [ ] Test WebSocket reconnection: temporarily disconnect network, reconnect, and verify connection resumes without browser refresh.

---

## 9. Module 8: Performance, Image Optimization & Reverse Proxy

### 9.1 Overview & Architecture
Significant performance optimization targeting resource consumption, frontend initial page load, and backend throughput.

### 9.2 Features Added
1. **Image Asset Compression:**
   - High-resolution landing page and auth images were optimized:
     - `frontend/public/1person.png`: Reduced from **7.95 MB** to **1.18 MB** (85% reduction).
     - `frontend/public/GLOBE.jpg`: Reduced from **10.87 MB** to **0.19 MB** (98% reduction).
     - `frontend/public/aim.png`: Reduced from **2.34 MB** to **0.40 MB** (83% reduction).
     - Total asset payload reduced by **over 19 MB**, drastically improving mobile and initial page load times.
2. **Nginx Reverse Proxy Hardening (`nginx.conf`):**
   - Added gzip compression for JSON, JavaScript, CSS, and SVG.
   - Tuned client body buffer size and timeouts.
   - Static asset caching headers (`max-age=31536000, immutable`).
3. **Database Query & Serialization Optimization:**
   - Replaced heavy SQLAlchemy eager loads in high-traffic endpoints with targeted `load_only` fields.
   - Used Pydantic `model_construct()` in `applications.py` to bypass unnecessary validation overhead during high-volume application listings.

### 9.3 Files Modified / Added
- `nginx.conf`
- `frontend/public/1person.png`
- `frontend/public/GLOBE.jpg`
- `frontend/public/aim.png`
- `backend/app/api/applications.py`
- `backend/app/services/analytics_service.py`

### 9.4 QA Testing Checklist
- [ ] Verify public landing page (`/`) loads without image lag or layout shifts.
- [ ] Inspect Network tab in browser DevTools to ensure static assets return `Content-Encoding: gzip` and appropriate cache headers.
- [ ] Verify high-volume application list (`/dashboard/hr/applications`) loads smoothly without query timeouts.

---

## 10. Summary Matrix of Endpoints & Component Changes

| Module / Area | New / Modified Endpoint or Component | Type | Access Level | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Multi-Tenancy** | `POST /api/tenants/register` | API | Public | Organization self-registration wizard |
| **Multi-Tenancy** | `GET /api/tenants` | API | Root Admin | List all tenants with stats & admin info |
| **Multi-Tenancy** | `POST /api/tenants/{id}/approve` | API | Root Admin | Approve and activate pending tenant |
| **Multi-Tenancy** | `POST /api/tenants/{id}/reject` | API | Root Admin | Reject tenant & deactivate user accounts |
| **Multi-Tenancy** | `PUT /api/tenants/{id}/status` | API | Root Admin | Update tenant status (active/suspended) |
| **Multi-Tenancy** | `GET /api/tenants/me` | API | Super Admin | Get current tenant settings & branding |
| **Multi-Tenancy** | `PUT /api/tenants/me` | API | Super Admin | Update current tenant settings & branding |
| **Multi-Tenancy** | `GET /api/auth/tenants` | API | Authenticated | List accessible tenants for switcher |
| **Multi-Tenancy** | `GET /api/auth/ws-token` | API | Authenticated | Generate short-lived WebSocket token |
| **Multi-Tenancy** | `CompanyRegistrationPage` | UI Page | Public | `/company/register` wizard |
| **Multi-Tenancy** | `TenantManagementPage` | UI Page | Root Admin | `/dashboard/tenants` portal |
| **Multi-Tenancy** | `TenantSwitcher` | UI Component | Root Admin | Header dropdown to switch workspaces |
| **Coding Assessment**| `GET /api/coding/languages` | API | Public | List supported languages & starter code |
| **Coding Assessment**| `GET /api/coding/problems` | API | HR / Admin | List coding problems with difficulty filters |
| **Coding Assessment**| `POST /api/coding/problems` | API | HR / Admin | Create coding problem & test cases |
| **Coding Assessment**| `GET /api/coding/problems/{id}` | API | HR / Admin | Get problem details & reference code |
| **Coding Assessment**| `PUT /api/coding/problems/{id}` | API | HR / Admin | Update problem & test cases |
| **Coding Assessment**| `DELETE /api/coding/problems/{id}`| API | HR / Admin | Delete coding problem |
| **Coding Assessment**| `POST /api/coding/problems/{id}/validate-solution` | API | HR / Admin | Test reference solution against cases |
| **Coding Assessment**| `POST /api/coding/export` | API | HR / Admin | Bulk JSON export of question sets |
| **Coding Assessment**| `POST /api/coding/import` | API | HR / Admin | Bulk JSON import of question sets |
| **Coding Assessment**| `GET /api/coding/question-sets` | API | HR / Admin | List reusable coding question sets |
| **Coding Assessment**| `POST /api/coding/question-sets` | API | HR / Admin | Create coding question set |
| **Coding Assessment**| `GET /api/coding/session` | API | Candidate Token | Load active candidate coding workspace |
| **Coding Assessment**| `POST /api/coding/run` | API | Candidate Token | Execute code against sample test cases |
| **Coding Assessment**| `POST /api/coding/submit` | API | Candidate Token | Submit solution against all test cases |
| **Coding Assessment**| `POST /api/coding/complete` | API | Candidate Token | Complete coding round & compute score |
| **Coding Assessment**| `CodingRepositoryPage` | UI Page | HR / Admin | `/dashboard/coding-repository` UI |
| **Coding Assessment**| `CodingWorkspace` | UI Component | Candidate | Live interview coding IDE & console |
| **Reporting** | `CodingReportView` | UI Component | HR / Admin | Candidate scorecard coding inspector |
| **Jobs** | `JobForm` | UI Component | HR / Admin | Coding round config & language selector |
| **Interviews** | `InterviewSession` | UI Component | Candidate | Multi-round live interview coordinator |
| **Demo** | `DemoPage` | UI Page | Public / HR | `/demo` interactive test interview |

---

## 11. Automated Test Suites Reference

All new modules include dedicated pytest test files located in `backend/tests/`:

```bash
# Run all newly added test suites
pytest backend/tests/test_multitenancy.py \
       backend/tests/test_tenant_management.py \
       backend/tests/test_multitenancy_routes.py \
       backend/tests/test_multitenant_branding_and_auth.py \
       backend/tests/test_coding_assessment.py \
       backend/tests/test_demo_auth.py \
       backend/tests/test_email_service_delivery.py \
       backend/tests/test_websocket_redis.py \
       backend/tests/test_report_deletion.py \
       backend/tests/test_audit_logs.py -v
```

---
*End of CALRIMS Testing & Release Specification.*
