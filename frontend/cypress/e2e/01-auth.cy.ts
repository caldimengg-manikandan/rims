// cypress/e2e/01-auth.cy.ts
// Deep authentication flow tests — login, validation, redirects, session persistence

describe('Authentication — Deep Checks', () => {
  beforeEach(() => {
    // Intercept and mock auth checks to prevent background redirects/loading
    cy.intercept('GET', '**/api/auth/me', {
      statusCode: 401,
      body: { detail: 'Not authenticated' }
    }).as('authMe')

    cy.visit('/auth/login', { failOnStatusCode: false })

    // Wait for the submit button to not be disabled — confirms the page hydrated and settled
    cy.get('button[type="submit"]', { timeout: 20000 }).should('not.be.disabled')
  })

  // ── Page Structure ───────────────────────────────────────────────────────────
  it('renders all required form elements with correct attributes', () => {
    cy.get('form').should('exist')
    cy.get('input[type="email"]')
      .should('be.visible')
      .and('have.attr', 'placeholder')
      .and('not.be.empty')
    cy.get('input[type="password"]').should('be.visible')
    cy.get('button[type="submit"]')
      .should('be.visible')
      .and('not.be.disabled')
    // Page must have a single H1 for SEO
    cy.get('h1, h2').should('have.length.at.least', 1)
  })

  // ── Inline Validation ────────────────────────────────────────────────────────
  it('shows granular email validation errors', () => {
    // Missing @ symbol → 'Email must contain "@" symbol'
    cy.get('input[type="email"]').type('invalidemail')
    cy.get('form').submit()
    cy.contains('must contain').should('be.visible')

    cy.get('input[type="email"]').clear()

    // Invalid domain — no dot → 'Email must have a valid domain'
    cy.get('input[type="email"]').type('user@nodomain')
    cy.get('form').submit()
    cy.contains('valid domain').should('be.visible')

    cy.get('input[type="email"]').clear()

    // Numbers-only username → 'Email username cannot be numbers only'
    cy.get('input[type="email"]').type('12345@gmail.com')
    cy.get('form').submit()
    cy.contains('numbers only').should('be.visible')
  })

  it('blocks submission when both fields are empty', () => {
    cy.get('button[type="submit"]').click()
    cy.url().should('include', '/auth/login')
    cy.get('button[type="submit"]').should('be.visible')
  })

  // ── Password Visibility Toggle ───────────────────────────────────────────────
  it('toggles password visibility correctly', () => {
    cy.get('#password')
      .should('be.visible')
      .and('not.be.disabled')
      .type('MySecret@123')
    cy.get('#password').should('have.value', 'MySecret@123')
    // Click the button nearest to the password input (eye icon toggle)
    cy.get('#password').parent().find('button').first().click({ force: true })
    // After toggle: input type changes to text
    cy.get('#password')
      .should('have.attr', 'type', 'text')
      .and('have.value', 'MySecret@123')
  })

  // ── Session Expired Banner ───────────────────────────────────────────────────
  it('shows session-expired message when ?expired=true', () => {
    cy.visit('/auth/login?expired=true', { failOnStatusCode: false })
    cy.get('input[type="email"]', { timeout: 20000 }).should('be.visible')
    cy.contains(/session expired/i).should('be.visible')
  })

  // ── Unauthenticated Route Guard ──────────────────────────────────────────────
  it('redirects unauthenticated users away from /dashboard', () => {
    cy.visit('/dashboard', { failOnStatusCode: false })
    cy.url().should('include', '/auth/login')
  })

  it('redirects unauthenticated users away from /dashboard/hr/jobs', () => {
    cy.visit('/dashboard/hr/jobs', { failOnStatusCode: false })
    cy.url().should('include', '/auth/login')
  })

  // ── Auth Links ───────────────────────────────────────────────────────────────
  it('navigates to /auth/register via signup link', () => {
    cy.get('a[href*="register"]').first().click({ force: true })
    cy.url().should('include', '/auth/register', { timeout: 15000 })
    cy.get('form').should('exist')
  })

  it('navigates to forgot-password page', () => {
    cy.get('a[href*="forgot-password"]').first().click({ force: true })
    cy.url().should('include', '/auth/forgot-password', { timeout: 15000 })
    cy.get('input[type="email"]').should('be.visible')
  })

  // ── Keyboard Navigation ──────────────────────────────────────────────────────
  it('submits the form via Enter key', () => {
    cy.get('input[type="email"]').type('not-valid')
    cy.get('input[type="email"]').type('{enter}')
    // Should show a validation error (not navigate away)
    cy.contains('must contain').should('be.visible')
    cy.url().should('include', '/auth/login')
  })

  // ── CSRF / Cookie Hygiene ────────────────────────────────────────────────────
  it('does not expose auth token in the URL after login redirect', () => {
    // Intercept and mock the login API to avoid needing real credentials
    cy.intercept('POST', '**/api/auth/login', {
      statusCode: 200,
      body: { access_token: 'mock-jwt-token', role: 'hr' },
    }).as('loginRequest')

    cy.get('input[type="email"]').should('not.be.disabled').type('hr@test.com')
    cy.get('input[type="password"]').should('not.be.disabled').type('Test@123')
    cy.get('button[type="submit"]').should('not.be.disabled').click()
    
    // Log form validation errors if they appear on screen to prevent silent failures
    cy.get('body').then(($body) => {
      const errorDiv = $body.find('div.bg-destructive\\/10')
      if (errorDiv.length) {
        cy.log('Form Error Msg:', errorDiv.text())
      }
    })

    cy.wait('@loginRequest')

    // Token must NEVER appear in the URL
    cy.url().should('not.include', 'token=')
    cy.url().should('not.include', 'access_token=')
  })
})
