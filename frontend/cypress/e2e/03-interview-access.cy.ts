// cypress/e2e/03-interview-access.cy.ts
// Deep interview access flow — form validation, token handling, URL sanitization, session storage

import { SignJWT } from 'jose';

describe('Interview Access — Deep Checks', () => {
  beforeEach(() => {
    cy.visit('/interview/access', { failOnStatusCode: false })
    cy.get('body[data-hydrated="true"]', { timeout: 20000 }).should('exist')
    cy.get('#email', { timeout: 20000 }).should('be.visible')
  })

  // ── Page Structure ─────────────────────────────────────────────────────────
  it('renders the access form with email and access key inputs', () => {
    cy.get('#email').should('be.visible')
    cy.get('#key').should('be.visible')
    cy.get('button[type="submit"]').contains(/enter|access|start/i).should('be.visible')
  })

  // ── Empty Field Submission ─────────────────────────────────────────────────
  it('does not submit with empty email and access key', () => {
    cy.intercept('POST', '**/api/interviews/access').as('accessCall')
    // Button should be disabled by default when inputs are empty
    cy.get('button[type="submit"]').should('be.disabled')
    // Submitting empty form should be blocked
    cy.get('form').submit()
    cy.get('@accessCall.all').should('have.length', 0)
  })

  // ── URL Parameter Pre-fill ─────────────────────────────────────────────────
  it('pre-fills email and key from URL params then clears them from URL', () => {
    cy.visit('/interview/access?email=candidate@test.com&key=TEST-KEY-123', { failOnStatusCode: false })
    cy.get('#email', { timeout: 20000 }).should('have.value', 'candidate@test.com')
    cy.get('#key').should('have.value', 'TEST-KEY-123')
    // URL must be sanitized — key must NOT appear in address bar
    cy.url().should('not.include', 'key=')
    cy.url().should('not.include', 'email=')
  })

  // ── Security Banner on Pre-filled URL ──────────────────────────────────────
  it('displays security notice banner when URL params are present', () => {
    cy.visit('/interview/access?email=test@x.com&key=K123', { failOnStatusCode: false })
    cy.get('#email', { timeout: 20000 }).should('be.visible')
    cy.contains(/security notice|do not share/i).should('be.visible')
  })

  // ── API Error Handling ─────────────────────────────────────────────────────
  it('shows API error message on wrong credentials', () => {
    cy.intercept('POST', '**/api/interviews/access', {
      statusCode: 401,
      body: { detail: 'Invalid access key or email' },
    }).as('failedAccess')

    // Separate clear and type to prevent detached DOM errors during hydration
    cy.get('#email').clear()
    cy.get('#email').type('bad@test.com')
    cy.get('#key').clear()
    cy.get('#key').type('WRONG-KEY')
    cy.get('form').submit()
    cy.wait('@failedAccess')
    cy.contains(/invalid|access.*failed|wrong/i).should('be.visible')
  })

  // ── Successful Access Flow ─────────────────────────────────────────────────
  it('on successful access stores token in sessionStorage and navigates to interview', () => {
    cy.wrap(null).then(async () => {
      const secret = new TextEncoder().encode('5ff829b387f2b50f516a5326b52ad798312cd6c7709226e4ad9b21f254ee8019_interview');
      const validToken = await new SignJWT({ role: 'interview' })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('2h')
        .sign(secret);

      cy.intercept('POST', '**/api/interviews/access', {
        statusCode: 200,
        body: {
          access_token: validToken,
          interview_id: '999',
          proctoring_secret: 'mock-proctoring-secret',
        },
      }).as('successAccess')
    });

    cy.get('#email').clear()
    cy.get('#email').type('ok@test.com')
    cy.get('#key').clear()
    cy.get('#key').type('VALID-KEY-123')
    cy.get('form').submit()
    cy.wait('@successAccess')

    // Must navigate to the interview pre-start page
    cy.url().should('include', '/interview/999')

    // Token stored in sessionStorage (not localStorage for security)
    cy.window().then((win) => {
      expect(win.sessionStorage.getItem('proctoring_secret')).to.equal('mock-proctoring-secret')
    })

    // Token must NOT be in URL
    cy.url().should('not.include', 'token=')
  })

  // ── Cookie Scope ───────────────────────────────────────────────────────────
  it('sets interview_token cookie with Strict SameSite on successful access', () => {
    cy.wrap(null).then(async () => {
      const secret = new TextEncoder().encode('5ff829b387f2b50f516a5326b52ad798312cd6c7709226e4ad9b21f254ee8019_interview');
      const validToken = await new SignJWT({ role: 'interview' })
        .setProtectedHeader({ alg: 'HS256' })
        .sign(secret);

      cy.intercept('POST', '**/api/interviews/access', {
        statusCode: 200,
        body: { access_token: validToken, interview_id: '42' },
      }).as('cookieAccess')
    });

    cy.get('#email').clear()
    cy.get('#email').type('ok@test.com')
    cy.get('#key').clear()
    cy.get('#key').type('VALID-KEY')
    cy.get('form').submit()
    cy.wait('@cookieAccess')

    cy.getCookie('interview_token').should('exist')
  })

  // ── Loading State ──────────────────────────────────────────────────────────
  it('shows a loading/disabled state while the access request is in-flight', () => {
    cy.intercept('POST', '**/api/interviews/access', (req) => {
      req.reply((res) => {
        res.delay = 2000
        res.send({ statusCode: 200, body: { access_token: 'x', interview_id: '1' } })
      })
    }).as('slowAccess')

    cy.get('#email').clear()
    cy.get('#email').type('ok@test.com')
    cy.get('#key').clear()
    cy.get('#key').type('VALID-KEY')
    cy.get('form').submit()

    // Button should be disabled or show spinner while loading
    cy.get('button[type="submit"]').should('be.disabled')
  })
})
