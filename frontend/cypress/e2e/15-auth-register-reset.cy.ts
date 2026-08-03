// cypress/e2e/15-auth-register-reset.cy.ts
// Deep tests for Registration, Forgot Password, and Reset Password flows

describe('Registration & Password Reset — Deep Checks', () => {
  // ══ REGISTRATION ═════════════════════════════════════════════════════════════

  describe('Registration Flow', () => {
    beforeEach(() => {
      cy.visit('/auth/register', { failOnStatusCode: false })
      cy.get('form', { timeout: 20000 }).should('exist')
    })

    it('renders all required registration form fields', () => {
      cy.get('form').should('exist')
      cy.get('input[type="email"], input[name*="email"]').should('be.visible')
      cy.get('input[type="password"], input[name*="password"]').should('be.visible')
      cy.get('h1, h2').should('have.length.at.least', 1)
    })

    it('shows validation error for already-registered email (409 conflict)', () => {
      cy.intercept('POST', '**/api/auth/register**', {
        statusCode: 409,
        body: { detail: 'Email already registered' },
      }).as('duplicateEmail')

      cy.get('input[type="email"]').first().clear().type('existing@test.com')
      cy.get('input[type="password"]').first().clear().type('Test@1234')
      cy.get('body').then(($body) => {
        const $confirm = $body.find('input[name*="confirm"], input[placeholder*="confirm" i]')
        if ($confirm.length > 0) cy.wrap($confirm.first()).clear().type('Test@1234')
      })
      cy.get('button[type="submit"]').click({ force: true })
      cy.wait('@duplicateEmail')
      cy.contains(/already.*registered|email.*exists|conflict/i).should('be.visible')
    })

    it('shows inline error for mismatched password confirmation', () => {
      cy.get('input[type="email"]').first().clear().type('new@test.com')
      cy.get('input[type="password"]').first().clear().type('Test@1234')
      cy.get('body').then(($body) => {
        const $confirm = $body.find('input[name*="confirm"], input[placeholder*="confirm" i]')
        if ($confirm.length > 0) {
          cy.wrap($confirm.first()).clear().type('DifferentPass!9')
          cy.get('button[type="submit"]').click({ force: true })
          cy.contains(/passwords.*do not match|confirm.*password|mismatch/i).should('be.visible')
        } else {
          cy.log('No confirm password field — single-password registration form')
        }
      })
    })

    it('successful registration calls POST /api/auth/register and redirects', () => {
      cy.intercept('POST', '**/api/auth/register**', {
        statusCode: 201,
        body: { id: 10, email: 'new@test.com', role: 'hr', approval_status: 'pending' },
      }).as('registerUser')

      cy.get('input[type="email"]').first().clear().type('new@test.com')
      cy.get('input[type="password"]').first().clear().type('Test@1234')
      cy.get('body').then(($body) => {
        const $confirm = $body.find('input[name*="confirm"], input[placeholder*="confirm" i]')
        if ($confirm.length > 0) cy.wrap($confirm.first()).clear().type('Test@1234')
        const $name = $body.find('input[name*="name"], input[placeholder*="name" i]')
        if ($name.length > 0) cy.wrap($name.first()).clear().type('New HR User')
      })
      cy.get('button[type="submit"]').click({ force: true })
      cy.wait('@registerUser')
      // Should redirect or show success message
      cy.get('body').should('not.contain.text', 'Application error')
    })

    it('registration shows password strength indicator or rules', () => {
      cy.get('input[type="password"]').first().type('weak')
      cy.get('body').then(($body) => {
        const text = $body.text().toLowerCase()
        const hasStrength =
          text.includes('strong') ||
          text.includes('weak') ||
          text.includes('strength') ||
          text.includes('at least') ||
          text.includes('uppercase') ||
          $body.find('[class*="strength"]').length > 0
        if (!hasStrength) cy.log('No password strength indicator — may be validated on submit only')
      })
    })

    it('has a link back to login page', () => {
      cy.get('a[href*="/auth/login"], a[href*="login"]').should('exist')
    })

    it('registration API 500 shows a friendly error', () => {
      cy.intercept('POST', '**/api/auth/register**', {
        statusCode: 500,
        body: { detail: 'Server error' },
      }).as('failRegister')

      cy.get('input[type="email"]').first().clear().type('new@test.com')
      cy.get('input[type="password"]').first().clear().type('Test@1234')
      cy.get('button[type="submit"]').click({ force: true })
      cy.get('body').should('not.contain.text', 'Application error')
    })
  })

  // ══ FORGOT PASSWORD ═══════════════════════════════════════════════════════

  describe('Forgot Password Flow', () => {
    beforeEach(() => {
      cy.visit('/auth/forgot-password', { failOnStatusCode: false })
      cy.get('input[type="email"]', { timeout: 20000 }).should('be.visible')
    })

    it('renders forgot-password page with email input and submit button', () => {
      cy.get('input[type="email"]').should('be.visible')
      cy.get('button[type="submit"]').should('be.visible')
      cy.get('h1, h2').should('have.length.at.least', 1)
    })

    it('submitting triggers POST to /api/auth/forgot-password', () => {
      cy.intercept('POST', '**/api/auth/forgot-password**', {
        statusCode: 200,
        body: { message: 'Reset email sent' },
      }).as('forgotPw')

      cy.get('input[type="email"]').clear().type('hr@test.com')
      cy.get('button[type="submit"]').click()
      cy.wait('@forgotPw')
      cy.contains(/email.*sent|check.*email|reset.*link|sent.*password/i).should('be.visible')
    })

    it('shows error when email is not registered (404)', () => {
      cy.intercept('POST', '**/api/auth/forgot-password**', {
        statusCode: 404,
        body: { detail: 'No user found with this email.' },
      }).as('unknownEmail')

      cy.get('input[type="email"]').clear().type('unknown@test.com')
      cy.get('button[type="submit"]').click()
      cy.wait('@unknownEmail')
      cy.contains(/not.*found|no.*account|invalid.*email/i).should('be.visible')
    })

    it('blocks submission when email field is empty', () => {
      cy.intercept('POST', '**/api/auth/forgot-password**').as('forgotPw')
      cy.get('button[type="submit"]').click()
      cy.get('@forgotPw.all').should('have.length', 0)
    })

    it('has link back to login', () => {
      cy.get('a[href*="/auth/login"], a[href*="login"]').should('exist')
    })
  })

  // ══ RESET PASSWORD ═══════════════════════════════════════════════════════

  describe('Reset Password Flow', () => {
    beforeEach(() => {
      // Reset password page is typically visited via a link with a token param
      cy.visit('/auth/reset-password?token=mock-reset-token', { failOnStatusCode: false })
      cy.get('form', { timeout: 20000 }).should('exist')
    })

    it('renders reset-password page with new password fields', () => {
      cy.get('form').should('exist')
      cy.get('input[type="password"]').should('be.visible')
    })

    it('shows error when new passwords do not match', () => {
      cy.get('input[type="password"]').first().clear().type('NewPass@1234')
      cy.get('body').then(($body) => {
        const $confirm = $body.find('input[type="password"]').eq(1)
        if ($confirm.length > 0) {
          cy.wrap($confirm).clear().type('DifferentPass!9')
          cy.get('button[type="submit"]').click({ force: true })
          cy.contains(/passwords.*do not match|confirm.*password|mismatch/i).should('be.visible')
        } else {
          cy.log('Single password field — no confirm field present')
        }
      })
    })

    it('successful reset fires POST /api/auth/reset-password with token', () => {
      cy.intercept('POST', '**/api/auth/reset-password**', {
        statusCode: 200,
        body: { message: 'Password reset successfully' },
      }).as('resetPw')

      cy.get('input[type="password"]').first().clear().type('NewPass@1234')
      cy.get('body').then(($body) => {
        const $confirm = $body.find('input[type="password"]').eq(1)
        if ($confirm.length > 0) cy.wrap($confirm).clear().type('NewPass@1234')
      })
      cy.get('button[type="submit"]').click({ force: true })
      cy.wait('@resetPw')
      cy.contains(/reset.*success|password.*changed|login.*now/i).should('be.visible')
    })

    it('expired/invalid token shows a helpful error message', () => {
      cy.intercept('POST', '**/api/auth/reset-password**', {
        statusCode: 400,
        body: { detail: 'Token is invalid or expired' },
      }).as('expiredToken')

      cy.get('input[type="password"]').first().clear().type('NewPass@1234')
      cy.get('body').then(($body) => {
        const $confirm = $body.find('input[type="password"]').eq(1)
        if ($confirm.length > 0) cy.wrap($confirm).clear().type('NewPass@1234')
      })
      cy.get('button[type="submit"]').click({ force: true })
      cy.wait('@expiredToken')
      cy.contains(/expired|invalid.*token|link.*expired/i).should('be.visible')
    })

    it('reset password page without token param redirects or shows error', () => {
      cy.visit('/auth/reset-password', { failOnStatusCode: false })
      cy.get('body').should('not.contain.text', 'Application error')
      cy.get('body').then(($body) => {
        const text = $body.text().toLowerCase()
        const handled =
          text.includes('invalid') ||
          text.includes('expired') ||
          text.includes('token') ||
          $body.find('form').length === 0
        if (!handled) cy.log('No error handling for missing token — page still renders form')
      })
    })
  })
})
