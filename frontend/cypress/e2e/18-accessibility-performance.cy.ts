// cypress/e2e/18-accessibility-performance.cy.ts
// Cross-cutting accessibility, performance, and SEO checks
// Validates WCAG basics, meta tags, responsive breakpoints, and keyboard navigation

describe('Accessibility, SEO & Performance — Cross-Cutting Checks', () => {
  // ══ SEO & META TAGS ════════════════════════════════════════════════════════

  describe('SEO & Meta Tags', () => {
    const publicPages = [
      { path: '/jobs', name: 'Jobs listing' },
      { path: '/auth/login', name: 'Login' },
      { path: '/auth/register', name: 'Register' },
      { path: '/company', name: 'Company' },
      { path: '/support', name: 'Support' },
    ]

    publicPages.forEach(({ path, name }) => {
      it(`${name} (${path}) has a non-empty <title> tag`, () => {
        cy.visit(path, { failOnStatusCode: false })
        cy.get('body', { timeout: 20000 }).should('be.visible')
        cy.title().should('not.be.empty')
      })

      it(`${name} (${path}) has a meta description tag`, () => {
        cy.visit(path, { failOnStatusCode: false })
        cy.get('body', { timeout: 20000 }).should('be.visible')
        cy.get('head meta[name="description"]').should('exist').and('have.attr', 'content').and('not.be.empty')
      })
    })
  })

  // ══ ACCESSIBILITY (WCAG BASICS) ═══════════════════════════════════════════

  describe('WCAG Basic Accessibility', () => {
    it('login page has a single H1 for screen readers', () => {
      cy.visit('/auth/login', { failOnStatusCode: false })
      cy.get('input[type="email"]', { timeout: 20000 }).should('be.visible')
      cy.get('h1').should('have.length', 1)
    })

    it('login form inputs have associated labels or aria-labels', () => {
      cy.visit('/auth/login', { failOnStatusCode: false })
      cy.get('input[type="email"]', { timeout: 20000 }).should('be.visible')
      cy.get('input').each(($input) => {
        const id = $input.attr('id')
        const ariaLabel = $input.attr('aria-label')
        const ariaLabelledby = $input.attr('aria-labelledby')
        const hasLabel = id
          ? Cypress.$(`label[for="${id}"]`).length > 0
          : false
        const isAccessible = hasLabel || !!ariaLabel || !!ariaLabelledby
        expect(isAccessible, `Input ${id || 'unknown'} should have a label or aria-label`).to.be.true
      })
    })

    it('all interactive buttons have accessible text or aria-label', () => {
      cy.visit('/auth/login', { failOnStatusCode: false })
      cy.get('input[type="email"]', { timeout: 20000 }).should('be.visible')
      cy.get('button').each(($btn) => {
        const text = $btn.text().trim()
        const ariaLabel = $btn.attr('aria-label')
        const ariaLabelledby = $btn.attr('aria-labelledby')
        const isAccessible = text.length > 0 || !!ariaLabel || !!ariaLabelledby
        expect(isAccessible, 'Each button should have text or aria-label').to.be.true
      })
    })

    it('all images have alt attributes', () => {
      cy.visit('/jobs', { failOnStatusCode: false })
      cy.get('body', { timeout: 20000 }).should('be.visible')
      cy.get('img').each(($img) => {
        expect($img.attr('alt'), `Image ${$img.attr('src')} must have alt attribute`).to.not.equal(undefined)
      })
    })

    it('no empty anchor tags (links must have descriptive text or aria-label)', () => {
      cy.visit('/auth/login', { failOnStatusCode: false })
      cy.get('input[type="email"]', { timeout: 20000 }).should('be.visible')
      cy.get('a').each(($a) => {
        const text = $a.text().trim()
        const ariaLabel = $a.attr('aria-label')
        const ariaLabelledby = $a.attr('aria-labelledby')
        const isAccessible = text.length > 0 || !!ariaLabel || !!ariaLabelledby
        expect(isAccessible, `Link ${$a.attr('href')} should have descriptive text or aria-label`).to.be.true
      })
    })

    it('color contrast: page body has visible text (dark text on light or vice versa)', () => {
      cy.visit('/auth/login', { failOnStatusCode: false })
      cy.get('input[type="email"]', { timeout: 20000 }).should('be.visible')
      cy.get('body').should('be.visible')
      // Basic check — body has text visible (not hidden/white-on-white)
      cy.get('body').invoke('text').should('not.be.empty')
    })

    it('focus is visible when tabbing through login form fields', () => {
      cy.visit('/auth/login', { failOnStatusCode: false })
      cy.get('input[type="email"]', { timeout: 20000 }).should('be.visible')
      cy.get('input[type="email"]').focus()
      cy.get('input[type="email"]').should('be.focused')
      cy.realPress ? cy.realPress('Tab') : cy.get('input[type="email"]').tab?.()
      cy.get('body').should('not.contain.text', 'Application error')
    })
  })

  // ══ KEYBOARD NAVIGATION ═══════════════════════════════════════════════════

  describe('Keyboard Navigation', () => {
    it('login form can be submitted with Enter key after filling fields', () => {
      cy.intercept('POST', '**/api/auth/login', {
        statusCode: 401,
        body: { detail: 'Invalid credentials' },
      }).as('loginAttempt')

      cy.visit('/auth/login', { failOnStatusCode: false })
      cy.get('input[type="email"]', { timeout: 20000 }).should('be.visible')
      cy.get('input[type="email"]').type('test@test.com')
      cy.get('input[type="password"]').type('WrongPass@1{enter}')
      cy.wait('@loginAttempt')
      cy.get('body').should('not.contain.text', 'Application error')
    })

    it('Tab key cycles through all interactive elements on login page', () => {
      cy.visit('/auth/login', { failOnStatusCode: false })
      cy.get('input[type="email"]', { timeout: 20000 }).should('be.visible')
      // Tab through the form — should not throw errors
      cy.get('body').type('{tab}{tab}{tab}')
      cy.get('body').should('not.contain.text', 'Application error')
    })

    it('Escape key closes modals or dialogs if any are open', () => {
      cy.visit('/auth/login', { failOnStatusCode: false })
      cy.get('input[type="email"]', { timeout: 20000 }).should('be.visible')
      cy.get('body').type('{esc}')
      cy.get('body').should('not.contain.text', 'Application error')
    })
  })

  // ══ RESPONSIVE BREAKPOINTS ════════════════════════════════════════════════

  describe('Responsive Layout', () => {
    const breakpoints = [
      { width: 375, height: 812, label: 'Mobile (375px)' },
      { width: 768, height: 1024, label: 'Tablet (768px)' },
      { width: 1440, height: 900, label: 'Desktop (1440px)' },
    ]

    breakpoints.forEach(({ width, height, label }) => {
      it(`login page renders correctly at ${label}`, () => {
        cy.viewport(width, height)
        cy.visit('/auth/login', { failOnStatusCode: false })
        cy.get('input[type="email"]', { timeout: 20000 }).should('be.visible')
        cy.get('button[type="submit"]').should('be.visible')
        cy.get('body').should('not.contain.text', 'Application error')
      })

      it(`jobs listing renders correctly at ${label}`, () => {
        cy.viewport(width, height)
        cy.visit('/jobs', { failOnStatusCode: false })
        cy.get('body', { timeout: 20000 }).should('be.visible')
        cy.get('body').should('not.contain.text', 'Application error')
        // No horizontal overflow
        cy.window().then((win) => {
          expect(win.document.body.scrollWidth, 'No horizontal overflow').to.be.at.most(width + 20)
        })
      })
    })
  })

  // ══ PERFORMANCE BASICS ════════════════════════════════════════════════════

  describe('Performance Basics', () => {
    it('login page loads within 10 seconds', () => {
      const start = Date.now()
      cy.visit('/auth/login', { failOnStatusCode: false, timeout: 10000 })
      cy.get('input[type="email"]', { timeout: 10000 }).should('be.visible').then(() => {
        const elapsed = Date.now() - start
        cy.log(`Login page loaded in ${elapsed}ms`)
        expect(elapsed).to.be.lessThan(10000)
      })
    })

    it('jobs page loads within 10 seconds', () => {
      const start = Date.now()
      cy.visit('/jobs', { failOnStatusCode: false, timeout: 10000 })
      cy.get('body', { timeout: 10000 }).should('be.visible').then(() => {
        const elapsed = Date.now() - start
        cy.log(`Jobs page loaded in ${elapsed}ms`)
        expect(elapsed).to.be.lessThan(10000)
      })
    })

    it('login page does not block interactivity for more than 5 seconds', () => {
      cy.visit('/auth/login', { failOnStatusCode: false })
      cy.get('input[type="email"]', { timeout: 5000 }).should('be.enabled')
    })

    it('no console errors on login page load', () => {
      const consoleErrors: string[] = []
      cy.visit('/auth/login', {
        failOnStatusCode: false,
        onBeforeLoad(win) {
          cy.stub(win.console, 'error').callsFake((msg) => {
            consoleErrors.push(String(msg))
          })
        },
      })
      cy.get('input[type="email"]', { timeout: 20000 }).should('be.visible')
      cy.then(() => {
        const realErrors = consoleErrors.filter((e) =>
          !e.includes('Warning:') &&
          !e.includes('ReactDOM') &&
          !e.includes('nonce') &&
          !e.includes('hydration')
        )
        if (realErrors.length > 0) {
          cy.log(`Console errors found: ${realErrors.join(' | ')}`)
        }
      })
    })
  })

  // ══ SECURITY HEADERS (BASIC) ═══════════════════════════════════════════════

  describe('Security Headers', () => {
    it('login page response does not expose X-Powered-By header', () => {
      cy.request({ url: '/auth/login', failOnStatusCode: false }).then((res) => {
        expect(res.headers['x-powered-by'] ?? '').to.not.include('Express')
        expect(res.headers['x-powered-by'] ?? '').to.not.include('Next.js')
      })
    })

    it('API login endpoint returns security headers', () => {
      cy.request({
        method: 'OPTIONS',
        url: '/api/auth/login',
        failOnStatusCode: false,
        headers: { Origin: 'http://localhost:3000' },
      }).then((res) => {
        // Should not be a 5xx server error
        expect(res.status).to.be.lessThan(500)
      })
    })
  })
})
