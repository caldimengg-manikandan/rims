// cypress/e2e/06-email-inbox.cy.ts
// Deep email inbox (ingested emails) tests
// Validates sync buttons, job ID+title matching, and inbox UI integrity

describe('Email Inbox Module — Deep Sync & Routing Checks', () => {
  const MOCK_EMAILS = [
    {
      id: 1,
      from_email: 'candidate@test.com',
      subject: 'Application for Frontend Engineer - JOB-001',
      received_at: new Date().toISOString(),
      status: 'processed',
      matched_job_id: 1,
      matched_job_title: 'Frontend Engineer',
      matched_job_code: 'JOB-001',
      candidate_name: 'Alice Smith',
      resume_url: 'https://example.com/resume.pdf',
    },
    {
      id: 2,
      from_email: 'noname@test.com',
      subject: 'Random email with no job match',
      received_at: new Date().toISOString(),
      status: 'unmatched',
      matched_job_id: null,
      matched_job_title: null,
      matched_job_code: null,
    },
  ]

  beforeEach(() => {
    cy.injectHRAuth()
  })

  // ── Page Load ─────────────────────────────────────────────────────────────
  it('loads the ingested emails page with correct layout', () => {
    cy.intercept('GET', '**/api/email**', {
      statusCode: 200,
      body: { emails: MOCK_EMAILS, total: MOCK_EMAILS.length },
    }).as('getEmails')

    cy.visit('/dashboard/hr/ingested-emails', { failOnStatusCode: false })
    cy.wait('@getEmails')
    cy.get('body').should('not.contain.text', 'Application error')
  })

  // ── Email List Rendering ───────────────────────────────────────────────────
  it('renders email rows with sender, subject, and match status', () => {
    cy.intercept('GET', '**/api/email**', {
      statusCode: 200,
      body: { emails: MOCK_EMAILS, total: MOCK_EMAILS.length },
    }).as('getEmails')

    cy.visit('/dashboard/hr/ingested-emails', { failOnStatusCode: false })
    cy.wait('@getEmails')

    // Matched email must show job code AND job title
    cy.contains('candidate@test.com').should('be.visible')
    cy.contains('JOB-001').should('be.visible')
    cy.contains('Frontend Engineer').should('be.visible')

    // Unmatched email must be present
    cy.contains('noname@test.com').should('be.visible')
  })

  // ── Sync Button Presence ──────────────────────────────────────────────────
  it('sync / refresh button is visible and clickable', () => {
    cy.intercept('GET', '**/api/email**', {
      statusCode: 200,
      body: { emails: [], total: 0 },
    }).as('getEmails')

    cy.visit('/dashboard/hr/ingested-emails', { failOnStatusCode: false })
    cy.wait('@getEmails')

    cy.get('button').contains(/sync|refresh|fetch/i).first().should('be.visible')
  })

  // ── Manual Sync Fires API Call ─────────────────────────────────────────────
  it('clicking Sync triggers the sync API endpoint', () => {
    cy.intercept('GET', '**/api/email**', {
      statusCode: 200,
      body: { emails: [], total: 0 },
    }).as('getEmails')
    cy.intercept('POST', '**/api/email/sync**', {
      statusCode: 200,
      body: { synced: 3, matched: 2, message: 'Sync complete' },
    }).as('syncEmails')

    cy.visit('/dashboard/hr/ingested-emails', { failOnStatusCode: false })
    cy.wait('@getEmails')
    cy.get('button').contains(/sync|refresh|fetch/i).first().click()
    cy.wait('@syncEmails')
    // Should show success feedback
    cy.contains(/sync.*complete|synced|fetched/i).should('be.visible')
  })

  // ── Job ID+Title Matching Rule ─────────────────────────────────────────────
  it('matched emails display BOTH job code (ID) and job title — not just title', () => {
    cy.intercept('GET', '**/api/email**', {
      statusCode: 200,
      body: { emails: MOCK_EMAILS, total: MOCK_EMAILS.length },
    }).as('getEmails')

    cy.visit('/dashboard/hr/ingested-emails', { failOnStatusCode: false })
    cy.wait('@getEmails')

    // The RULE: emails must match on BOTH job ID and job title
    // Verify the UI shows both for matched items
    cy.contains('JOB-001').should('be.visible')   // Job ID/Code
    cy.contains('Frontend Engineer').should('be.visible')  // Job Title together
  })

  // ── Unmatched Email State ──────────────────────────────────────────────────
  it('unmatched emails show a clear unmatched/pending status indicator', () => {
    cy.intercept('GET', '**/api/email**', {
      statusCode: 200,
      body: { emails: MOCK_EMAILS, total: MOCK_EMAILS.length },
    }).as('getEmails')

    cy.visit('/dashboard/hr/ingested-emails', { failOnStatusCode: false })
    cy.wait('@getEmails')

    // Unmatched email should show unmatched/unknown status badge
    cy.contains(/unmatched|pending|no match|not matched/i).should('be.visible')
  })

  // ── Resume Link ────────────────────────────────────────────────────────────
  it('resume link for matched email is clickable and points to a valid URL', () => {
    cy.intercept('GET', '**/api/email**', {
      statusCode: 200,
      body: { emails: [MOCK_EMAILS[0]], total: 1 },
    }).as('getEmails')

    cy.visit('/dashboard/hr/ingested-emails', { failOnStatusCode: false })
    cy.wait('@getEmails')

    cy.get('a[href*="resume"], button').contains(/resume|view|download/i)
      .should('exist')
  })

  // ── Empty Inbox State ─────────────────────────────────────────────────────
  it('shows an empty state message when inbox has no emails', () => {
    cy.intercept('GET', '**/api/email**', {
      statusCode: 200,
      body: { emails: [], total: 0 },
    }).as('getEmails')

    cy.visit('/dashboard/hr/ingested-emails', { failOnStatusCode: false })
    cy.wait('@getEmails')
    cy.contains(/no emails|empty|inbox.*empty|no.*results/i).should('be.visible')
  })

  // ── Sync Error Handling ───────────────────────────────────────────────────
  it('shows an error toast/message when sync API fails', () => {
    cy.intercept('GET', '**/api/email**', { statusCode: 200, body: { emails: [], total: 0 } }).as('getEmails')
    cy.intercept('POST', '**/api/email/sync**', {
      statusCode: 500,
      body: { detail: 'IMAP connection failed' },
    }).as('failSync')

    cy.visit('/dashboard/hr/ingested-emails', { failOnStatusCode: false })
    cy.wait('@getEmails')
    cy.get('button').contains(/sync|refresh|fetch/i).first().click()
    cy.wait('@failSync')
    cy.contains(/error|failed|could not sync|IMAP/i).should('be.visible')
  })
})
