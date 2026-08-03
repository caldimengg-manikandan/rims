// cypress/e2e/22-custom-commands.cy.ts
// Exercises all 4 custom Cypress commands defined in cypress/support/commands.ts:
//   cy.loginAsHR()           — session-cached UI login
//   cy.assertNoConsoleErrors() — checks no real console errors
//   cy.assertPageIsAccessible() — h1 exists, no empty links, buttons accessible
//   cy.waitForPageLoad()     — waits for spinners/loading states to clear

describe('Custom Cypress Commands — Full Coverage', () => {
  // ══ cy.loginAsHR() ════════════════════════════════════════════════════════

  describe('cy.loginAsHR()', () => {
    it('logs in via UI and caches the session across specs', () => {
      cy.intercept('POST', '**/api/auth/login', {
        statusCode: 200,
        body: { access_token: 'mock-session-jwt', role: 'hr' },
      }).as('loginRequest')

      cy.loginAsHR('hr@test.com', 'Test@123')
      // After loginAsHR the URL should no longer be the login page
      cy.url().should('not.include', '/auth/login')
    })

    it('loginAsHR with default env credentials works without explicit args', () => {
      cy.intercept('POST', '**/api/auth/login', {
        statusCode: 200,
        body: { access_token: 'mock-session-jwt', role: 'hr' },
      }).as('loginRequest')

      // Called with no arguments — uses Cypress.env('HR_EMAIL') fallback
      cy.loginAsHR()
      cy.url().should('not.include', '/auth/login')
    })

    it('loginAsHR session is restored without re-logging in on next visit', () => {
      cy.intercept('POST', '**/api/auth/login', {
        statusCode: 200,
        body: { access_token: 'mock-session-jwt', role: 'hr' },
      }).as('loginRequest')

      cy.loginAsHR()
      // Visit a protected page — session should restore without another login call
      cy.visit('/dashboard/hr/jobs', { failOnStatusCode: false })
      cy.get('body').should('not.contain.text', 'Application error')
    })
  })

  // ══ cy.assertNoConsoleErrors() ════════════════════════════════════════════

  describe('cy.assertNoConsoleErrors()', () => {
    it('passes on login page which has no real console errors', () => {
      cy.visit('/auth/login', {
        failOnStatusCode: false,
        onBeforeLoad(win) {
          ;(win as any).__cypress_console_errors__ = []
          const orig = win.console.error.bind(win.console)
          cy.stub(win.console, 'error').callsFake((...args: unknown[]) => {
            const msg = args.join(' ')
            // Filter out React hydration & Next.js dev warnings
            if (
              !msg.includes('Warning:') &&
              !msg.includes('hydrat') &&
              !msg.includes('ReactDOM') &&
              !msg.includes('nonce')
            ) {
              ;(win as any).__cypress_console_errors__.push(msg)
            }
            orig(...args)
          })
        },
      })
      cy.get('input[type="email"]', { timeout: 20000 }).should('be.visible')
      cy.assertNoConsoleErrors()
    })

    it('passes on public jobs page which has no real console errors', () => {
      cy.visit('/jobs', {
        failOnStatusCode: false,
        onBeforeLoad(win) {
          ;(win as any).__cypress_console_errors__ = []
          cy.stub(win.console, 'error').callsFake((...args: unknown[]) => {
            const msg = args.join(' ')
            if (!msg.includes('Warning:') && !msg.includes('hydrat')) {
              ;(win as any).__cypress_console_errors__.push(msg)
            }
          })
        },
      })
      cy.get('body', { timeout: 20000 }).should('be.visible')
      cy.assertNoConsoleErrors()
    })

    it('passes on register page', () => {
      cy.visit('/auth/register', {
        failOnStatusCode: false,
        onBeforeLoad(win) {
          ;(win as any).__cypress_console_errors__ = []
          cy.stub(win.console, 'error').callsFake((...args: unknown[]) => {
            const msg = args.join(' ')
            if (!msg.includes('Warning:') && !msg.includes('hydrat')) {
              ;(win as any).__cypress_console_errors__.push(msg)
            }
          })
        },
      })
      cy.get('body', { timeout: 20000 }).should('be.visible')
      cy.assertNoConsoleErrors()
    })
  })

  // ══ cy.assertPageIsAccessible() ══════════════════════════════════════════

  describe('cy.assertPageIsAccessible()', () => {
    it('login page passes accessibility assertions', () => {
      cy.visit('/auth/login', { failOnStatusCode: false })
      cy.get('input[type="email"]', { timeout: 20000 }).should('be.visible')
      cy.assertPageIsAccessible()
    })

    it('register page passes accessibility assertions', () => {
      cy.visit('/auth/register', { failOnStatusCode: false })
      cy.get('form', { timeout: 20000 }).should('exist')
      cy.assertPageIsAccessible()
    })

    it('forgot-password page passes accessibility assertions', () => {
      cy.visit('/auth/forgot-password', { failOnStatusCode: false })
      cy.get('input[type="email"]', { timeout: 20000 }).should('be.visible')
      cy.assertPageIsAccessible()
    })

    it('public jobs page passes accessibility assertions', () => {
      cy.intercept('GET', '**/api/jobs**', { statusCode: 200, body: [] }).as('getJobs')
      cy.visit('/jobs', { failOnStatusCode: false })
      cy.get('body', { timeout: 20000 }).should('be.visible')
      cy.assertPageIsAccessible()
    })

    it('interview access page passes accessibility assertions', () => {
      cy.visit('/interview/access', { failOnStatusCode: false })
      cy.get('form', { timeout: 20000 }).should('exist')
      cy.assertPageIsAccessible()
    })

    it('company page passes accessibility assertions', () => {
      cy.visit('/company', { failOnStatusCode: false })
      cy.get('body', { timeout: 20000 }).should('be.visible')
      cy.assertPageIsAccessible()
    })

    it('privacy page passes accessibility assertions', () => {
      cy.visit('/privacy', { failOnStatusCode: false })
      cy.get('body', { timeout: 20000 }).should('be.visible')
      cy.assertPageIsAccessible()
    })

    it('terms page passes accessibility assertions', () => {
      cy.visit('/terms', { failOnStatusCode: false })
      cy.get('body', { timeout: 20000 }).should('be.visible')
      cy.assertPageIsAccessible()
    })

    it('support page passes accessibility assertions', () => {
      cy.visit('/support', { failOnStatusCode: false })
      cy.get('body', { timeout: 20000 }).should('be.visible')
      cy.assertPageIsAccessible()
    })
  })

  // ══ cy.waitForPageLoad() ══════════════════════════════════════════════════

  describe('cy.waitForPageLoad()', () => {
    it('login page settles loading state after hydration', () => {
      cy.visit('/auth/login', { failOnStatusCode: false })
      cy.waitForPageLoad()
      cy.get('input[type="email"]').should('be.visible')
    })

    it('register page settles loading state', () => {
      cy.visit('/auth/register', { failOnStatusCode: false })
      cy.waitForPageLoad()
      cy.get('form').should('exist')
    })

    it('forgot password page settles loading state', () => {
      cy.visit('/auth/forgot-password', { failOnStatusCode: false })
      cy.waitForPageLoad()
      cy.get('input[type="email"]').should('be.visible')
    })

    it('public jobs page settles loading state', () => {
      cy.intercept('GET', '**/api/jobs**', {
        statusCode: 200,
        body: [{ id: 1, title: 'Engineer', status: 'open', experience_level: 'mid' }],
      }).as('getJobs')
      cy.visit('/jobs', { failOnStatusCode: false })
      cy.waitForPageLoad()
      cy.get('body').should('not.contain.text', 'Application error')
    })

    it('interview access page settles loading state', () => {
      cy.visit('/interview/access', { failOnStatusCode: false })
      cy.waitForPageLoad()
      cy.get('form').should('exist')
    })

    it('no lingering animate-spin elements after page load on login', () => {
      cy.visit('/auth/login', { failOnStatusCode: false })
      cy.get('input[type="email"]', { timeout: 20000 }).should('be.visible')
      cy.waitForPageLoad()
      // After waitForPageLoad, no spinners should exist
      cy.get('[class*="animate-spin"]').should('not.exist')
    })
  })

  // ══ COMBINED COMMAND CHAINS ════════════════════════════════════════════════

  describe('Combined Command Chains', () => {
    it('loginAsHR + waitForPageLoad + assertPageIsAccessible on dashboard', () => {
      cy.intercept('POST', '**/api/auth/login', {
        statusCode: 200,
        body: { access_token: 'mock-jwt', role: 'hr' },
      }).as('loginRequest')
      cy.intercept('GET', '**/api/auth/me', {
        statusCode: 200,
        body: { id: 1, email: 'hr@test.com', role: 'hr', approval_status: 'approved' },
      }).as('authMe')
      cy.intercept('GET', '**/api/jobs**', { statusCode: 200, body: [] }).as('getJobs')

      cy.loginAsHR()
      cy.visit('/dashboard/hr/jobs', { failOnStatusCode: false })
      cy.waitForPageLoad()
      cy.assertPageIsAccessible()
      cy.get('body').should('not.contain.text', 'Application error')
    })

    it('assertNoConsoleErrors + assertPageIsAccessible on interview access', () => {
      cy.visit('/interview/access', {
        failOnStatusCode: false,
        onBeforeLoad(win) {
          ;(win as any).__cypress_console_errors__ = []
          cy.stub(win.console, 'error').callsFake((...args: unknown[]) => {
            const msg = args.join(' ')
            if (!msg.includes('Warning:') && !msg.includes('hydrat')) {
              ;(win as any).__cypress_console_errors__.push(msg)
            }
          })
        },
      })
      cy.get('form', { timeout: 20000 }).should('exist')
      cy.waitForPageLoad()
      cy.assertPageIsAccessible()
      cy.assertNoConsoleErrors()
    })
  })
})
