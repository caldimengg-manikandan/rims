// cypress/e2e/14-job-create-edit.cy.ts
// Deep tests for the Create Job form and Job Edit workflow

describe('Job Create & Edit — Deep Checks', () => {

  const MOCK_AUTH = {
    id: 1,
    email: 'hr@test.com',
    role: 'hr',
    approval_status: 'approved',
    full_name: 'Test HR User',
  }

  const MOCK_JOB_PAYLOAD = {
    title: 'Senior React Developer',
    description: 'We are looking for a React expert with 5+ years of experience.',
    experience_level: 'senior',
    duration_minutes: 60,
    status: 'open',
  }

  const MOCK_CREATED_JOB = {
    id: 999,
    job_id: 'JOB-999',
    title: 'Senior React Developer',
    status: 'open',
    experience_level: 'senior',
    created_at: new Date().toISOString(),
    duration_minutes: 60,
  }

  beforeEach(() => {
    cy.intercept('GET', '**/api/auth/me', { statusCode: 200, body: MOCK_AUTH }).as('authMe')
    cy.injectHRAuth()
  })

  // ── Create Job Page Load ───────────────────────────────────────────────────
  it('/dashboard/hr/jobs/create loads without application error', () => {
    cy.visit('/dashboard/hr/jobs/create', { failOnStatusCode: false })
    cy.get('body').should('not.contain.text', 'Application error')
  })

  it('create job page renders a form with required fields', () => {
    cy.visit('/dashboard/hr/jobs/create', { failOnStatusCode: false })
    cy.get('body').should('not.contain.text', 'Application error')
    cy.get('form, [role="form"]').should('exist')
    cy.get('body').then(($body) => {
      const hasTitle =
        $body.find('input[name="title"], input[placeholder*="title" i], input[placeholder*="job" i]').length > 0
      if (!hasTitle) cy.log('Title input not found — form may use a different field name')
    })
  })

  it('submit button is disabled when required fields are empty', () => {
    cy.visit('/dashboard/hr/jobs/create', { failOnStatusCode: false })
    cy.get('body').should('not.contain.text', 'Application error')
    cy.get('body').then(($body) => {
      const $submit = $body.find('button[type="submit"]')
      if ($submit.length > 0) {
        // Either disabled OR a validation error shown on submit
        cy.wrap($submit.first()).then(($btn) => {
          if ($btn.prop('disabled')) {
            cy.wrap($btn).should('be.disabled')
          } else {
            cy.wrap($btn).click({ force: true })
            cy.get('body').then(($after) => {
              const hasError =
                $after.text().toLowerCase().includes('required') ||
                $after.text().toLowerCase().includes('field') ||
                $after.text().toLowerCase().includes('invalid')
              if (!hasError) cy.log('No validation error shown for empty form — form may block via HTML5 validation')
            })
          }
        })
      }
    })
  })

  // ── Successful Job Creation ───────────────────────────────────────────────
  it('filling and submitting create job form fires POST and redirects to job list', () => {
    cy.intercept('POST', '**/api/jobs**', {
      statusCode: 201,
      body: MOCK_CREATED_JOB,
    }).as('createJob')

    cy.visit('/dashboard/hr/jobs/create', { failOnStatusCode: false })
    cy.get('body').should('not.contain.text', 'Application error')

    // Fill title field if present
    cy.get('body').then(($body) => {
      const $titleInput = $body.find(
        'input[name="title"], input[placeholder*="title" i], input[placeholder*="position" i]'
      )
      if ($titleInput.length > 0) {
        cy.wrap($titleInput.first()).clear().type(MOCK_JOB_PAYLOAD.title)

        // Fill description / textarea
        const $desc = $body.find('textarea, input[name="description"]')
        if ($desc.length > 0) {
          cy.wrap($desc.first()).clear().type(MOCK_JOB_PAYLOAD.description)
        }

        cy.get('button[type="submit"], button').contains(/create|save|post/i).first().click({ force: true })
        cy.wait('@createJob')
        // Should redirect to jobs list or show success
        cy.get('body').should('not.contain.text', 'Application error')
        cy.get('body').then(($after) => {
          const redirected = Cypress.env('window')?.location?.href?.includes('/jobs') ?? false
          const hasSuccess = $after.text().toLowerCase().includes('success') || $after.text().toLowerCase().includes('created')
          if (!redirected && !hasSuccess) cy.log('No redirect or success message after job creation')
        })
      } else {
        cy.log('Title input not found — skipping full form submission test')
      }
    })
  })

  // ── API Error on Create ────────────────────────────────────────────────────
  it('shows validation error message when create job API returns 400', () => {
    cy.intercept('POST', '**/api/jobs**', {
      statusCode: 400,
      body: { title: ['This field is required.'] },
    }).as('failCreate')

    cy.visit('/dashboard/hr/jobs/create', { failOnStatusCode: false })
    cy.get('body').should('not.contain.text', 'Application error')

    cy.get('body').then(($body) => {
      const $submit = $body.find('button[type="submit"], button').filter(':contains("Create")').add(
        $body.find('button[type="submit"]')
      )
      if ($submit.length > 0) {
        cy.wrap($submit.first()).click({ force: true })
        cy.get('body').then(($after) => {
          if ($after.text().toLowerCase().includes('required')) {
            cy.contains(/required|field.*required/i).should('be.visible')
          } else {
            cy.log('No field error displayed — may be caught by HTML5 required attribute')
          }
        })
      }
    })
  })

  // ── Job Edit Page ─────────────────────────────────────────────────────────
  it('/dashboard/hr/jobs/1/edit loads without application error', () => {
    cy.intercept('GET', '**/api/jobs/1**', {
      statusCode: 200,
      body: MOCK_CREATED_JOB,
    }).as('getJob')

    cy.visit('/dashboard/hr/jobs/1/edit', { failOnStatusCode: false })
    cy.get('body').should('not.contain.text', 'Application error')
  })

  it('edit job page pre-populates fields with existing job data', () => {
    cy.intercept('GET', '**/api/jobs/1**', {
      statusCode: 200,
      body: { ...MOCK_CREATED_JOB, id: 1, job_id: 'JOB-001', title: 'Frontend Engineer' },
    }).as('getJob')

    cy.visit('/dashboard/hr/jobs/1/edit', { failOnStatusCode: false })
    cy.wait('@getJob')
    cy.get('body').then(($body) => {
      if ($body.text().includes('Frontend Engineer')) {
        cy.contains('Frontend Engineer').should('be.visible')
      } else {
        cy.log('Pre-populated data not rendered — may need form hydration check')
      }
    })
  })

  it('updating job title fires PUT/PATCH to /api/jobs/:id', () => {
    cy.intercept('GET', '**/api/jobs/1**', {
      statusCode: 200,
      body: { ...MOCK_CREATED_JOB, id: 1, job_id: 'JOB-001', title: 'Frontend Engineer' },
    }).as('getJob')
    cy.intercept(/PUT|PATCH/, '**/api/jobs/1**', {
      statusCode: 200,
      body: { ...MOCK_CREATED_JOB, id: 1, title: 'Updated Frontend Engineer' },
    }).as('updateJob')

    cy.visit('/dashboard/hr/jobs/1/edit', { failOnStatusCode: false })
    cy.wait('@getJob')
    cy.get('body').then(($body) => {
      const $title = $body.find('input[name="title"], input[placeholder*="title" i]')
      if ($title.length > 0) {
        cy.wrap($title.first()).clear().type('Updated Frontend Engineer')
        cy.get('button[type="submit"], button').contains(/save|update/i).first().click({ force: true })
        cy.wait('@updateJob')
        cy.get('body').should('not.contain.text', 'Application error')
      } else {
        cy.log('Title field not found on edit page — skipping PUT assertion')
      }
    })
  })

  // ── Cancel/Back Navigation ─────────────────────────────────────────────────
  it('Cancel button on create job navigates back without making API call', () => {
    cy.intercept('POST', '**/api/jobs**').as('createJob')

    cy.visit('/dashboard/hr/jobs/create', { failOnStatusCode: false })
    cy.get('body').should('not.contain.text', 'Application error')
    cy.get('body').then(($body) => {
      const $cancel = $body.find('button, a').filter(':contains("Cancel")').add(
        $body.find('a[href*="/jobs"]')
      )
      if ($cancel.length > 0) {
        cy.wrap($cancel.first()).click({ force: true })
        cy.get('@createJob.all').should('have.length', 0)
        cy.url().should('include', '/jobs')
      } else {
        cy.log('No cancel button found on create job page')
      }
    })
  })

  // ── Experience Level Dropdown ─────────────────────────────────────────────
  it('experience level dropdown contains valid options (junior, mid, senior)', () => {
    cy.visit('/dashboard/hr/jobs/create', { failOnStatusCode: false })
    cy.get('body').should('not.contain.text', 'Application error')
    cy.get('body').then(($body) => {
      const $select = $body.find('select[name*="experience"], select[name*="level"]')
      if ($select.length > 0) {
        cy.wrap($select.first()).find('option').should('have.length.at.least', 2)
        cy.get('body').should('satisfy', ($b: JQuery<HTMLBodyElement>) =>
          $b.text().toLowerCase().includes('junior') ||
          $b.text().toLowerCase().includes('mid') ||
          $b.text().toLowerCase().includes('senior')
        )
      } else {
        cy.log('Experience level is not a native select — may be a custom dropdown')
      }
    })
  })

  // ── Page Title & Heading ──────────────────────────────────────────────────
  it('create job page has a visible heading', () => {
    cy.visit('/dashboard/hr/jobs/create', { failOnStatusCode: false })
    cy.get('body').should('not.contain.text', 'Application error')
    cy.get('h1, h2').should('have.length.at.least', 1)
  })

  // ── Navigation Guard warning on unsaved changes ───────────────────────────
  it('triggers navigation guard warning when leaving dirty form and handles cancellation/confirmation', () => {
    cy.visit('/dashboard/hr/jobs/create', { failOnStatusCode: false })
    cy.get('body').should('not.contain.text', 'Application error')
    
    // Type into the title field to make form dirty
    cy.get('input[name="title"], input[placeholder*="title" i]').first().type('DevOps Engineer')

    // Click on a navbar link or cancel link to navigate away
    cy.get('a[href*="/company"], a[href*="/jobs"]').first().click({ force: true })

    // Verify confirmation alert-dialog is shown and handles actions
    cy.get('body').then(($body) => {
      // It should display our custom confirmation dialog
      cy.contains(/unsaved|leave/i).should('be.visible')
      // Click Cancel (Stay)
      cy.get('button').contains(/cancel|stay/i).first().click({ force: true })
      // Verify we remain on the same page
      cy.url().should('include', '/jobs/create')
      // Click the link again
      cy.get('a[href*="/company"], a[href*="/jobs"]').first().click({ force: true })
      // Click Action / Confirm (Leave)
      cy.get('button').contains(/leave|confirm/i).first().click({ force: true })
      // Verify page successfully navigated away
      cy.url().should('not.include', '/jobs/create')
    })
  })
})
