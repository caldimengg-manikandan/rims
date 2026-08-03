// cypress/e2e/05-dashboard-hr.cy.ts
// Deep HR dashboard tests — jobs CRUD, applications, pipeline, routing integrity

describe('HR Dashboard — Deep Route & Feature Checks', () => {
  beforeEach(() => {
    cy.injectHRAuth()
  })

  // ── Dashboard Index Redirect ───────────────────────────────────────────────
  it('/dashboard redirects to appropriate role page or shows dashboard content', () => {
    cy.visit('/dashboard', { failOnStatusCode: false })
    cy.get('body').should('not.contain.text', 'Application error')
  })

  // ── Jobs Page API Interaction ──────────────────────────────────────────────
  it('/dashboard/hr/jobs fetches and renders jobs from API', () => {
    cy.intercept('GET', '**/api/jobs*', {
      statusCode: 200,
      body: [
        {
          id: 1,
          job_id: 'JOB-001',
          title: 'Frontend Engineer',
          status: 'open',
          experience_level: 'mid',
          created_at: new Date().toISOString(),
          duration_minutes: 60,
        },
        {
          id: 2,
          job_id: 'JOB-002',
          title: 'Backend Engineer',
          status: 'closed',
          experience_level: 'senior',
          created_at: new Date().toISOString(),
          duration_minutes: 90,
        },
      ],
    }).as('getJobs')

    cy.visit('/dashboard/hr/jobs', { failOnStatusCode: false })
    cy.wait('@getJobs')
    cy.contains('Frontend Engineer').should('be.visible')
    cy.contains('JOB-001').should('be.visible')
    cy.contains('Backend Engineer').should('be.visible')
  })

  // ── Jobs Search Filter ─────────────────────────────────────────────────────
  it('job search filter narrows down job list', () => {
    cy.intercept('GET', '**/api/jobs*', {
      statusCode: 200,
      body: [
        { id: 1, job_id: 'JOB-001', title: 'Frontend Engineer', status: 'open', experience_level: 'mid', created_at: new Date().toISOString() },
        { id: 2, job_id: 'JOB-002', title: 'Data Scientist', status: 'open', experience_level: 'senior', created_at: new Date().toISOString() },
      ],
    }).as('getJobs')

    cy.visit('/dashboard/hr/jobs', { failOnStatusCode: false })
    cy.wait('@getJobs')
    cy.get('input[placeholder*="search" i], input[type="search"]').first().type('Data')
    cy.contains('Data Scientist').should('be.visible')
    cy.contains('Frontend Engineer').should('not.exist')
  })

  // ── Jobs Status Badges ─────────────────────────────────────────────────────
  it('job list displays appropriate open/closed status badges', () => {
    cy.intercept('GET', '**/api/jobs*', {
      statusCode: 200,
      body: [
        { id: 1, job_id: 'JOB-001', title: 'Frontend Engineer', status: 'open', experience_level: 'mid', created_at: new Date().toISOString() },
        { id: 2, job_id: 'JOB-002', title: 'Backend Engineer', status: 'closed', experience_level: 'senior', created_at: new Date().toISOString() },
      ],
    }).as('getJobs')

    cy.visit('/dashboard/hr/jobs', { failOnStatusCode: false })
    cy.wait('@getJobs')
    cy.contains(/open/i).should('be.visible')
    cy.contains(/closed/i).should('be.visible')
  })

  // ── Create Job Navigation ──────────────────────────────────────────────────
  it('Create Job button navigates to /dashboard/hr/jobs/create', () => {
    cy.intercept('GET', '**/api/jobs*', { statusCode: 200, body: [] }).as('getJobs')
    cy.visit('/dashboard/hr/jobs', { failOnStatusCode: false })
    cy.wait('@getJobs')
    cy.get('a[href*="/jobs/create"], button').contains(/create|new job/i).first().click({ force: true })
    cy.url().should('include', '/jobs/create')
  })

  // ── Applications Page ──────────────────────────────────────────────────────
  it('/dashboard/hr/applications renders applications list', () => {
    cy.intercept('GET', '**/api/applications*', {
      statusCode: 200,
      body: {
        applications: [
          {
            id: 101,
            candidate_name: 'Alice Smith',
            candidate_email: 'alice@test.com',
            job_title: 'Frontend Engineer',
            job_id_code: 'JOB-001',
            status: 'applied',
            applied_at: new Date().toISOString(),
            composite_score: 78.5,
          },
        ],
        total: 1,
      },
    }).as('getApplications')

    cy.visit('/dashboard/hr/applications', { failOnStatusCode: false })
    cy.wait('@getApplications')
    cy.contains('Alice Smith').should('be.visible')
    cy.contains('JOB-001').should('be.visible')
  })

  // ── Application Detail Navigation ─────────────────────────────────────────
  it('clicking an application navigates to its detail page', () => {
    cy.intercept('GET', '**/api/applications*', {
      statusCode: 200,
      body: {
        applications: [
          { id: 101, candidate_name: 'Bob Jones', candidate_email: 'bob@test.com', job_title: 'Engineer', job_id_code: 'JOB-001', status: 'applied', applied_at: new Date().toISOString(), composite_score: 60 },
        ],
        total: 1,
      },
    })
    cy.intercept('GET', '**/api/applications/101**', {
      statusCode: 200,
      body: {
        id: 101,
        candidate_name: 'Bob Jones',
        candidate_email: 'bob@test.com',
        status: 'applied',
        job_title: 'Engineer',
      },
    }).as('getAppDetail')

    cy.visit('/dashboard/hr/applications', { failOnStatusCode: false })
    cy.contains('Bob Jones').click({ force: true })
    cy.url().should('include', '/applications/101')
  })

  // ── Back Button on Application Detail ─────────────────────────────────────
  it('Back button on application detail returns to applications list', () => {
    cy.intercept('GET', '**/api/applications/101**', {
      statusCode: 200,
      body: { id: 101, candidate_name: 'Test', candidate_email: 'x@x.com', status: 'applied', job_title: 'Engineer' },
    })
    cy.visit('/dashboard/hr/applications/101', { failOnStatusCode: false })
    cy.get('button').contains(/back|return/i).first().click()
    cy.url().should('include', '/applications')
    cy.url().should('not.include', '/101')
  })

  // ── API Error State ────────────────────────────────────────────────────────
  it('shows a friendly error state when jobs API returns 500', () => {
    cy.intercept('GET', '**/api/jobs*', { statusCode: 500, body: { detail: 'Server error' } }).as('failJobs')
    cy.visit('/dashboard/hr/jobs', { failOnStatusCode: false })
    cy.wait('@failJobs')
    cy.get('body').should('not.contain.text', 'Application error')
    cy.contains(/error|failed|try again|something went wrong/i).should('be.visible')
  })

  // ── Ingested Emails Route ──────────────────────────────────────────────────
  it('/dashboard/hr/ingested-emails renders without crash', () => {
    cy.intercept('GET', '**/api/email**', { statusCode: 200, body: { emails: [], total: 0 } })
    cy.visit('/dashboard/hr/ingested-emails', { failOnStatusCode: false })
    cy.get('body').should('not.contain.text', 'Application error')
  })
})
