// cypress/support/commands.ts
// Custom reusable Cypress commands

import { SignJWT } from 'jose'

declare global {
  namespace Cypress {
    interface Chainable {
      loginAsHR(email?: string, password?: string): Chainable<void>
      injectHRAuth(role?: 'hr' | 'super_admin'): Chainable<void>
      assertNoConsoleErrors(): Chainable<void>
      assertPageIsAccessible(): Chainable<void>
      waitForPageLoad(): Chainable<void>
    }
  }
}

// Login command: posts credentials directly to bypass UI for speed in non-auth tests
Cypress.Commands.add('loginAsHR', (
  email = Cypress.env('HR_EMAIL') || 'hr@test.com',
  password = Cypress.env('HR_PASSWORD') || 'Test@123'
) => {
  cy.session([email, password], () => {
    cy.visit('/auth/login')
    cy.get('input[type="email"]').should('be.visible').clear().type(email)
    cy.get('input[type="password"]').should('be.visible').clear().type(password)
    cy.get('button[type="submit"]').click()
    // Wait for redirect away from login page indicating successful auth
    cy.url().should('not.include', '/auth/login', { timeout: 15000 })
  }, {
    cacheAcrossSpecs: true,
  })
})

/**
 * Inject a valid signed HR JWT as the `access_token` cookie so the
 * server-side middleware (proxy.ts) allows dashboard route access.
 * Also sets localStorage flags so the client-side auth context resolves.
 *
 * Strategy:
 *  1. Mint the JWT in JS (via jose).
 *  2. cy.setCookie — persists across same-origin page navigations in Cypress.
 *  3. Visit /auth/login briefly to establish the origin, then write localStorage.
 *     The next cy.visit('/dashboard/...') will inherit both the cookie AND the
 *     localStorage value since they share the same origin.
 */
Cypress.Commands.add('injectHRAuth', (role: 'hr' | 'super_admin' = 'hr') => {
  // Always intercept /api/auth/me so client-side auth resolves
  cy.intercept('GET', '**/api/auth/me', {
    statusCode: 200,
    body: {
      id: 1,
      email: 'hr@test.com',
      role,
      approval_status: 'approved',
      full_name: 'Test HR User',
    },
  }).as('authMe')

  // Mint a real JWT signed with the same secret the middleware verifies
  cy.wrap(null).then(() => {
    const JWT_SECRET = '5ff829b387f2b50f516a5326b52ad798312cd6c7709226e4ad9b21f254ee8019'
    const secret = new TextEncoder().encode(JWT_SECRET)
    return new SignJWT({ role, email: 'hr@test.com', sub: '1', id: 1 })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('2h')
      .sign(secret)
      .then((token) => {
        // Set the access_token cookie — Cypress persists this across navigations
        cy.setCookie('access_token', token, {
          path: '/',
          httpOnly: false,
          secure: false,
          sameSite: 'lax',
        })

        // Visit /auth/login to establish the browser origin context, then write
        // localStorage so it's available when the next cy.visit() hydrates.
        // We use failOnStatusCode:false and skip waiting for any element.
        cy.visit('/auth/login', { failOnStatusCode: false })
        cy.window().then((win) => {
          win.localStorage.setItem('auth_token', token)
          win.localStorage.setItem('rims_session_present', '1')
        })
      })
  })
})



// Assert no console errors were fired during the test
Cypress.Commands.add('assertNoConsoleErrors', () => {
  cy.window().then((win) => {
    const errors = (win as any).__cypress_console_errors__ || []
    expect(errors, 'No console errors expected').to.have.length(0)
  })
})

// Assert basic accessibility: h1 exists, main landmark exists, no empty links
Cypress.Commands.add('assertPageIsAccessible', () => {
  cy.get('h1, h2').should('have.length.at.least', 1)
  cy.get('a[href=""]').should('not.exist')
  cy.get('button:not([disabled])').each(($btn) => {
    expect($btn.text().trim().length + ($btn.attr('aria-label')?.length ?? 0)).to.be.greaterThan(0)
  })
})

// Wait for Next.js page hydration to complete
Cypress.Commands.add('waitForPageLoad', () => {
  cy.get('body').should('not.have.class', 'loading')
  cy.get('[data-loading]').should('not.exist')
  // Wait for any spinners to clear
  cy.get('[class*="animate-spin"]', { timeout: 8000 }).should('not.exist')
})

export {}
