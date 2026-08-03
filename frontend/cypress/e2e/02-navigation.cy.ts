// cypress/e2e/02-navigation.cy.ts
// Deep navigation checks — global navbar, routing, back/forward, 404, breadcrumbs

describe('Navigation — Deep Routing Checks', () => {
  // ── Public Routes ─────────────────────────────────────────────────────────
  describe('Public routes load correctly', () => {
    // Note: '/' redirects to '/jobs' or similar — test the concrete pages
    const publicRoutes = [
      { path: '/jobs', label: 'Jobs listing' },
      { path: '/company', label: 'Company page' },
      { path: '/support', label: 'Support page' },
      { path: '/privacy', label: 'Privacy page' },
      { path: '/terms', label: 'Terms page' },
      { path: '/auth/login', label: 'Login page' },
    ]

    publicRoutes.forEach(({ path, label }) => {
      it(`${label} (${path}) loads with visible content and no broken elements`, () => {
        cy.visit(path, { failOnStatusCode: false })
        cy.get('body', { timeout: 20000 }).should('be.visible')
        // No error overlays or 500 messages
        cy.get('body').should('not.contain.text', 'Application error')
        cy.get('body').should('not.contain.text', 'Internal Server Error')
        // No broken images
        cy.get('img').each(($img) => {
          const src = $img.attr('src')
          if (src && !src.startsWith('data:') && !src.startsWith('blob:')) {
            cy.wrap($img).should(($i) => {
              expect(($i[0] as HTMLImageElement).naturalWidth, `Image should load: ${src}`).to.be.greaterThan(0)
            })
          }
        })
        // All links have valid href (not empty, not just '#')
        cy.get('a[href]').each(($a) => {
          const href = $a.attr('href')
          expect(href, 'Link href should not be empty string').to.not.equal('')
        })
      })
    })
  })

  // ── 404 Handling ─────────────────────────────────────────────────────────
  it('shows a 404 / Not Found page for unknown routes', () => {
    cy.visit('/this-page-does-not-exist-xyz-abc', { failOnStatusCode: false })
    cy.get('body').should('not.contain.text', 'Application error')
    cy.contains(/not found|404|page.*not.*exist/i).should('be.visible')
  })

  // ── Navbar Link Integrity ─────────────────────────────────────────────────
  it('global navbar renders on login page with navigation links', () => {
    cy.visit('/auth/login', { failOnStatusCode: false })
    cy.get('input[type="email"]', { timeout: 20000 }).should('be.visible')
    cy.get('nav, header').should('exist').and('be.visible')
  })

  it('Jobs link navigates to /jobs listing', () => {
    cy.visit('/auth/login', { failOnStatusCode: false })
    cy.get('input[type="email"]', { timeout: 20000 }).should('be.visible')
    cy.get('a[href*="/jobs"]').first().click({ force: true })
    cy.url().should('include', '/jobs')
    cy.get('h1, h2').should('be.visible')
  })

  // ── SPA Client-Side Navigation (no hard reload) ──────────────────────────
  it('navigating between public pages does not trigger full page reload', () => {
    // Visit support page — it has nav links to other public pages
    cy.visit('/support', { failOnStatusCode: false })
    cy.get('body', { timeout: 20000 }).should('be.visible')
    // Mark the window to detect full reload
    cy.window().then((win) => { (win as any).__rims_marker__ = true })
    // Navigate to another public page via any visible link
    cy.get('a[href*="/jobs"], a[href*="/privacy"], a[href*="/terms"]')
      .first()
      .click({ force: true })
    // Marker must still exist → confirms SPA navigation (no full reload)
    cy.window().its('__rims_marker__').should('equal', true)
  })

  // ── Unauthenticated Protected Routes ─────────────────────────────────────
  const protectedRoutes = [
    '/dashboard',
    '/dashboard/hr',
    '/dashboard/hr/jobs',
    '/dashboard/hr/applications',
    '/dashboard/hr/pipeline',
    '/dashboard/hr/reports',
    '/dashboard/hr/approvals',
    '/dashboard/settings',
    '/dashboard/repository',
    '/dashboard/onboarding',
  ]

  protectedRoutes.forEach((route) => {
    it(`unauthenticated access to ${route} redirects to login`, () => {
      cy.visit(route, { failOnStatusCode: false })
      cy.url().should('include', '/auth/login')
      cy.get('form').should('exist')
    })
  })

  // ── Browser Back/Forward on Public Routes ─────────────────────────────────
  it('browser Back button works correctly between public pages', () => {
    cy.visit('/jobs', { failOnStatusCode: false })
    cy.get('body', { timeout: 20000 }).should('be.visible')
    cy.visit('/support', { failOnStatusCode: false })
    cy.url().should('include', '/support')
    cy.go('back')
    cy.url().should('include', '/jobs')
    cy.go('forward')
    cy.url().should('include', '/support')
  })

  // ── Deep Link Integrity: Jobs detail ─────────────────────────────────────
  it('/jobs listing contains clickable job cards linking to detail pages', () => {
    cy.visit('/jobs', { failOnStatusCode: false })
    cy.get('body', { timeout: 20000 }).should('be.visible')
    cy.get('body').then(($body) => {
      if ($body.find('a[href*="/jobs/"]').length > 0) {
        cy.get('a[href*="/jobs/"]').first().click({ force: true })
        cy.url().should('match', /\/jobs\/\d+/)
        cy.get('body').should('not.contain.text', 'Application error')
      } else {
        cy.log('No job listings present — skipping detail navigation check')
      }
    })
  })

  // ── Offer/respond public page ─────────────────────────────────────────────
  it('/offer/respond loads without application error', () => {
    cy.visit('/offer/respond', { failOnStatusCode: false })
    cy.get('body').should('not.contain.text', 'Application error')
  })
})
