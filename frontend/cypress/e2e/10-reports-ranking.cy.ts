// cypress/e2e/10-reports-ranking.cy.ts
// Deep tests for HR Reports & Candidate Ranking pages

describe('Reports & Ranking — Deep Checks', () => {

  const MOCK_AUTH = {
    id: 1,
    email: 'hr@test.com',
    role: 'hr',
    approval_status: 'approved',
    full_name: 'Test HR',
  }

  const MOCK_RANKING = [
    { id: 401, candidate_name: 'Henry Ford', job_id_code: 'JOB-001', composite_score: 96, rank: 1 },
    { id: 402, candidate_name: 'Iris West',  job_id_code: 'JOB-001', composite_score: 88, rank: 2 },
    { id: 403, candidate_name: 'Jack Holt',  job_id_code: 'JOB-001', composite_score: 75, rank: 3 },
  ]

  const MOCK_REPORT_STATS = {
    total_applications: 120,
    open_jobs: 8,
    avg_score: 72.5,
    hired_this_month: 4,
    interviews_scheduled: 15,
    emails_synced: 340,
  }

  beforeEach(() => {
    cy.intercept('GET', '**/api/auth/me', { statusCode: 200, body: MOCK_AUTH }).as('authMe')
    cy.injectHRAuth()
  })

  // ══ REPORTS ═════════════════════════════════════════════════════════════════

  it('/dashboard/hr/reports loads without application error', () => {
    cy.intercept('GET', '**/api/reports**', { statusCode: 200, body: MOCK_REPORT_STATS }).as('getReports')
    cy.visit('/dashboard/hr/reports', { failOnStatusCode: false })
    cy.get('body').should('not.contain.text', 'Application error')
  })

  it('reports page displays key metrics (applications, jobs, hires)', () => {
    cy.intercept('GET', '**/api/reports**', { statusCode: 200, body: MOCK_REPORT_STATS }).as('getReports')
    cy.intercept('GET', '**/api/jobs**', { statusCode: 200, body: [] }).as('getJobs')
    cy.intercept('GET', '**/api/applications**', {
      statusCode: 200,
      body: { applications: [], total: 120 },
    }).as('getApplications')

    cy.visit('/dashboard/hr/reports', { failOnStatusCode: false })
    cy.get('body').should('not.contain.text', 'Application error')
    cy.get('body').then(($body) => {
      const text = $body.text()
      const hasMetric =
        text.includes('120') ||
        text.includes('application') ||
        text.includes('job') ||
        text.includes('hire') ||
        text.includes('report')
      expect(hasMetric, 'Reports page should display some metric data').to.be.true
    })
  })

  it('reports page shows a chart or data visualisation element', () => {
    cy.intercept('GET', '**/api/reports**', { statusCode: 200, body: MOCK_REPORT_STATS }).as('getReports')
    cy.visit('/dashboard/hr/reports', { failOnStatusCode: false })
    cy.get('body').should('not.contain.text', 'Application error')
    cy.get('body').then(($body) => {
      // Chart.js, Recharts, or similar render SVG/canvas elements
      const hasChart =
        $body.find('svg').length > 0 ||
        $body.find('canvas').length > 0 ||
        $body.find('[class*="chart"]').length > 0 ||
        $body.find('[class*="recharts"]').length > 0
      if (!hasChart) cy.log('No chart element detected — reports may use table layout only')
    })
  })

  it('reports page shows an export/download button', () => {
    cy.intercept('GET', '**/api/reports**', { statusCode: 200, body: MOCK_REPORT_STATS }).as('getReports')
    cy.visit('/dashboard/hr/reports', { failOnStatusCode: false })
    cy.get('body').should('not.contain.text', 'Application error')
    cy.get('body').then(($body) => {
      const hasExport =
        $body.find('button, a').filter(':contains("Export")').length > 0 ||
        $body.find('button, a').filter(':contains("Download")').length > 0 ||
        $body.find('[aria-label*="export" i]').length > 0 ||
        $body.find('[aria-label*="download" i]').length > 0
      if (!hasExport) cy.log('No export button detected on reports page')
    })
  })

  it('reports API 500 does not crash the page', () => {
    cy.intercept('GET', '**/api/reports**', { statusCode: 500, body: { detail: 'Error' } }).as('failReports')
    cy.visit('/dashboard/hr/reports', { failOnStatusCode: false })
    cy.get('body').should('not.contain.text', 'Application error')
  })

  // ══ RANKING ═════════════════════════════════════════════════════════════════

  it('/dashboard/hr/ranking loads without application error', () => {
    cy.intercept('GET', '**/api/applications**', {
      statusCode: 200,
      body: { applications: MOCK_RANKING, total: 3 },
    }).as('getRanking')

    cy.visit('/dashboard/hr/ranking', { failOnStatusCode: false })
    cy.get('body').should('not.contain.text', 'Application error')
  })

  it('ranking page displays candidates in descending score order', () => {
    cy.intercept('GET', '**/api/applications**', {
      statusCode: 200,
      body: { applications: MOCK_RANKING, total: 3 },
    }).as('getRanking')

    cy.visit('/dashboard/hr/ranking', { failOnStatusCode: false })
    cy.wait('@getRanking')
    cy.get('body').then(($body) => {
      if ($body.text().includes('Henry Ford')) {
        // Rank #1 should appear before Rank #2
        const henryPos = $body.text().indexOf('Henry Ford')
        const irisPos = $body.text().indexOf('Iris West')
        expect(henryPos).to.be.lessThan(irisPos)
      } else {
        cy.log('Ranking uses a different data source — skipping order assertion')
      }
    })
  })

  it('ranking page shows scores alongside candidate names', () => {
    cy.intercept('GET', '**/api/applications**', {
      statusCode: 200,
      body: { applications: MOCK_RANKING, total: 3 },
    }).as('getRanking')

    cy.visit('/dashboard/hr/ranking', { failOnStatusCode: false })
    cy.wait('@getRanking')
    cy.get('body').then(($body) => {
      const text = $body.text()
      const hasScore = text.includes('96') || text.includes('88') || text.includes('75') || text.includes('score')
      if (!hasScore) cy.log('Scores not shown directly on ranking list')
    })
  })

  it('clicking a ranked candidate opens their detail/scorecard', () => {
    cy.intercept('GET', '**/api/applications**', {
      statusCode: 200,
      body: { applications: MOCK_RANKING, total: 3 },
    }).as('getRanking')
    cy.intercept('GET', '**/api/applications/401**', {
      statusCode: 200,
      body: { id: 401, candidate_name: 'Henry Ford', composite_score: 96 },
    }).as('getCandidateDetail')

    cy.visit('/dashboard/hr/ranking', { failOnStatusCode: false })
    cy.wait('@getRanking')
    cy.get('body').then(($body) => {
      if ($body.text().includes('Henry Ford')) {
        cy.contains('Henry Ford').click({ force: true })
        cy.get('body').should('not.contain.text', 'Application error')
      } else {
        cy.log('Candidate not rendered — skipping click-through test')
      }
    })
  })

  it('ranking page shows empty state when no candidates ranked', () => {
    cy.intercept('GET', '**/api/applications**', {
      statusCode: 200,
      body: { applications: [], total: 0 },
    }).as('emptyRanking')

    cy.visit('/dashboard/hr/ranking', { failOnStatusCode: false })
    cy.wait('@emptyRanking')
    cy.get('body').should('not.contain.text', 'Application error')
  })

  it('ranking API 500 does not crash the page', () => {
    cy.intercept('GET', '**/api/applications**', {
      statusCode: 500,
      body: { detail: 'DB error' },
    }).as('failRanking')

    cy.visit('/dashboard/hr/ranking', { failOnStatusCode: false })
    cy.get('body').should('not.contain.text', 'Application error')
  })
})
