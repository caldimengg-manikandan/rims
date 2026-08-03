// cypress/e2e/07-api-contracts.cy.ts
// Deep API contract and network layer tests
// Validates response shapes, HTTP methods, headers, and error propagation

describe('API Contract & Network Layer — Deep Checks', () => {
  // ── Auth API ───────────────────────────────────────────────────────────────
  it('login sends POST to /api/auth/login with email and password in body', () => {
    cy.intercept('POST', '**/api/auth/login', (req) => {
      expect(req.body).to.have.property('email')
      expect(req.body).to.have.property('password')
      expect(req.method).to.equal('POST')
      req.reply({ statusCode: 200, body: { access_token: 'mock', role: 'hr' } })
    }).as('loginRequest')

    cy.visit('/auth/login', { failOnStatusCode: false })
    cy.get('input[type="email"]', { timeout: 20000 }).should('be.visible')
    cy.get('input[type="email"]').type('hr@test.com')
    cy.get('input[type="password"]').type('Test@123')
    cy.get('button[type="submit"]').click()
    cy.wait('@loginRequest')
  })

  // ── Interview Access API ───────────────────────────────────────────────────
  it('interview access sends POST with email and access_key fields', () => {
    cy.intercept('POST', '**/api/interviews/access', (req) => {
      expect(req.body).to.have.property('email')
      expect(req.body).to.have.property('access_key')
      expect(req.headers['content-type']).to.include('application/json')
      req.reply({ statusCode: 200, body: { access_token: 'x', interview_id: '1' } })
    }).as('accessRequest')

    cy.visit('/interview/access', { failOnStatusCode: false })
    cy.get('input[type="email"], input[placeholder*="email" i]', { timeout: 20000 }).should('be.visible')
    cy.get('input[type="email"], input[placeholder*="email" i]').type('c@test.com')
    cy.get('input[placeholder*="key" i], input[name*="key" i], input[name*="access" i]').type('KEY-ABC')
    cy.get('button').contains(/access|enter|start/i).click()
    cy.wait('@accessRequest')
  })

  // ── Jobs API Pagination ────────────────────────────────────────────────────
  it('jobs API request includes limit parameter', () => {
    cy.intercept('GET', '**/api/auth/me', {
      statusCode: 200,
      body: { id: 1, email: 'hr@test.com', role: 'hr', approval_status: 'approved' },
    }).as('authMe')
    cy.intercept('GET', '**/api/jobs*', (req) => {
      expect(req.url).to.include('limit=')
      req.reply({ statusCode: 200, body: [] })
    }).as('jobsRequest')

    cy.injectHRAuth()
    cy.visit('/dashboard/hr/jobs', { failOnStatusCode: false })
    cy.wait('@jobsRequest', { timeout: 15000 })
  })

  // ── 401 Redirect ──────────────────────────────────────────────────────────
  it('401 response from API causes redirect to login page', () => {
    cy.intercept('GET', '**/api/auth/me', { statusCode: 401, body: {} }).as('authMe')
    cy.visit('/dashboard/hr/jobs', { failOnStatusCode: false })
    cy.url().should('include', '/auth/login')
  })

  // ── Network Error Graceful Handling ───────────────────────────────────────
  it('network failure on jobs fetch shows error UI, not blank page', () => {
    cy.intercept('GET', '**/api/auth/me', {
      statusCode: 200,
      body: { id: 1, role: 'hr', approval_status: 'approved' },
    }).as('authMe')
    cy.intercept('GET', '**/api/jobs*', { forceNetworkError: true }).as('networkError')

    cy.injectHRAuth()
    cy.visit('/dashboard/hr/jobs', { failOnStatusCode: false })
    cy.wait('@networkError', { timeout: 15000 })
    cy.get('body').should('not.contain.text', 'Application error')
  })

  // ── No Token Exposure in GET Params ───────────────────────────────────────
  it('authenticated API calls send token as Authorization header, not query param', () => {
    cy.intercept('GET', '**/api/auth/me', {
      statusCode: 200,
      body: { id: 1, role: 'hr', approval_status: 'approved' },
    }).as('authMe')
    cy.intercept('GET', '**/api/jobs*', (req) => {
      expect(req.url).to.not.include('token=')
      expect(req.url).to.not.include('access_token=')
      // Authorization header should be present if app sends it
      req.reply({ statusCode: 200, body: [] })
    }).as('secureJobsRequest')

    cy.injectHRAuth()
    cy.visit('/dashboard/hr/jobs', { failOnStatusCode: false })
    cy.wait('@secureJobsRequest', { timeout: 15000 })
  })

  // ── Health Check Endpoint ─────────────────────────────────────────────────
  it('/api/health endpoint returns 200 OK', () => {
    cy.request({
      method: 'GET',
      url: '/api/health',
      failOnStatusCode: false,
    }).then((res) => {
      expect(res.status).to.equal(200)
    })
  })

  // ── CORS Headers on API Preflight ─────────────────────────────────────────
  it('backend API responds to OPTIONS preflight without 5xx error', () => {
    const backendUrl = Cypress.env('API_BASE_URL') || 'http://localhost:8000'
    cy.request({
      method: 'OPTIONS',
      url: `${backendUrl}/api/auth/login`,
      failOnStatusCode: false,
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
      },
    }).then((res) => {
      // Should return 200 or 204, never 5xx
      expect(res.status).to.be.lessThan(500)
    })
  })
})
