# CALRIMS — New Features Overview for Testing & QA

This document outlines the new features and platform enhancements introduced across the latest release commits, organized by functional module for testing and verification.

---

## Module 1: Enterprise Multi-Tenancy & Organization Management

- **Self-Service Company Registration:** Organizations can onboard through a multi-step registration wizard by providing their company details, preferred workspace subdomain slug, branding assets (logo, brand colors), company size, industry domain, and official corporate address with integrated map geocoding.
- **Central Platform Administration:** Platform administrators can review incoming organization registration requests from a centralized dashboard, with controls to approve, reject, or manage an organization's operating status (active, suspended, or deactivated).
- **Workspace Switcher:** Authorized platform administrators can seamlessly switch between organization workspaces from the navigation header, instantly updating the active context without re-authenticating.
- **Strict Data & User Isolation:** Complete logical separation ensuring each organization's jobs, candidates, applications, question banks, coding problems, interviews, and settings remain private to that organization.
- **Dynamic White-Labeling & Branding:** Runtime branding dynamically applies the active organization’s logo, company title, custom favicon, and primary brand colors across the entire user interface and public career pages.

---

## Module 2: Coding Assessment Engine & Execution Sandbox

- **Coding Problem Bank:** Recruiters and administrators can build and maintain a repository of programming problems categorized by difficulty (easy, medium, hard), complete with descriptions, input/output formats, constraints, and language-specific starter boilerplate code.
- **Configurable Test Cases:** Support for adding test cases with custom scoring weights and visibility controls, separating visible sample cases used by candidates for practice from hidden cases used for final grading.
- **Reference Solution Validator:** An interactive tool within the problem editor that allows recruiters to execute their reference solutions against all configured test cases to verify problem validity before publishing.
- **Reusable Question Sets:** Multiple coding problems can be grouped into ordered question sets and assigned to specific job openings, with controls to specify which programming languages are permitted.
- **Bulk Import & Export:** Built-in JSON import and export utilities allow teams to export problem banks and question sets or import them with automated schema and integrity checks.
- **Isolated Docker Sandboxing:** Candidate code runs inside ephemeral, secure Docker containers with strict resource limits, including execution timeouts, memory caps, non-root user execution, and disabled network access to prevent system abuse or infinite loops.
- **Multi-Language Runtime Support:** Built-in compiler and runtime support for Python 3, Java 21, C++, and Node.js (JavaScript).
- **Candidate In-Browser IDE:** A full-screen coding environment in the live interview room featuring syntax highlighting, code autocomplete, a problem specification pane, a console for standard input/output and compiler feedback, real-time sample case testing, formal submission capabilities, and a server-synchronized deadline countdown timer.

---

## Module 3: Job Requisition & Interview Round Configuration

- **Coding Round Setup on Job Requisitions:** Job creation and edit forms allow recruiters to enable a dedicated coding round, define custom round durations (in minutes), select a coding question set from the repository, and restrict allowed programming languages.
- **Flexible Multi-Round Sequencing:** Support for configuring any combination of interview stages (Aptitude Round, AI Voice/Text Technical & Behavioral Round, and Coding Assessment) under a unified round structure.
- **Organization-Scoped Postings:** All job listings and associated question sets are automatically stamped with and partitioned by the recruiter’s organization.

---

## Module 4: Multi-Round AI Interview Progression

- **Automated Stage Progression:** The interview engine intelligently navigates candidates through each configured stage in sequence: from Aptitude MCQs, to the AI Technical & Behavioral round, to the Sandboxed Coding Assessment, before finalizing the submission.
- **Server-Authoritative Deadline Enforcement:** Coding round timers are governed server-side from the moment the candidate begins the assessment, ensuring deadlines cannot be bypassed or manipulated locally.
- **Session Continuity:** Candidates who experience temporary disconnects or browser refreshes can re-enter their active interview session with their progress and remaining time preserved.

---

## Module 5: Reports and Analytics for Coding Round

- **Candidate Coding Evaluation Inspector:** A dedicated panel in the candidate scorecard that breaks down overall coding performance, including total score percentage, passed versus total test cases, execution time (in milliseconds), and peak memory usage (in kilobytes).
- **Source Code & Verdict Review:** Evaluators can review the exact code submitted by the candidate with syntax highlighting, language used, submission timestamp, and per-test-case verdicts (Accepted, Wrong Answer, Time Limit Exceeded, or Runtime Error).
- **Scorecard & Ranking Integration:** Automatically rolls up the candidate's coding performance into their overall interview evaluation and composite score, directly influencing hiring recommendations (Strong Hire, Hire, Borderline, Reject) on the job candidate leaderboard.
- **Organization-Level Performance Reporting:** Coding assessment statistics and completion metrics are seamlessly integrated into the organization's hiring analytics and exportable reports.

---

## Module 6: Communications & Real-Time Notifications

- **Tenant-Aware Email Branding:** Outgoing candidate emails automatically resolve and apply the hiring organization's branding, including the sender name, company logo header, brand accent color on action buttons, and official physical address in the footer.
- **Multi-Part MIME Formatting:** All transactional emails (such as application confirmations, interview invitations with access credentials, interview completion notices, offer letters, and onboarding reminders) automatically generate clean plain-text versions alongside HTML to maximize inbox delivery and prevent spam classification.
- **Local Email Simulation:** A developer inspection mode logs outgoing email layouts locally when running in environments without configured email credentials.
- **Tenant-Isolated Real-Time Alerts:** Background notification messaging uses isolated channels per organization, ensuring recruiters only receive alerts for applications, interviews, and updates belonging to their own organization.
- **Resilient Connection Handling:** Real-time listeners automatically reconnect upon network interruption and immediately synchronize unread notification counts and navbar alerts.
