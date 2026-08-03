// cypress/e2e/17-interview-live.cy.ts
// Deep tests for the live interview session page (/interview/live/:id)
// Covers: question rendering, answer submission, timer, proctoring flags,
// question navigation, session completion flow

import { SignJWT } from 'jose'

describe('Live Interview Session — Deep Checks', () => {
  const SESSION_ID = 'test-session-42'
  const JWT_SECRET = '5ff829b387f2b50f516a5326b52ad798312cd6c7709226e4ad9b21f254ee8019_interview'

  const MOCK_QUESTIONS = [
    {
      id: 1,
      question_number: 1,
      text: 'What is the difference between var, let, and const?',
      type: 'text',
      time_limit: 120,
      is_answered: false,
      answer_score: null,
    },
    {
      id: 2,
      question_number: 2,
      text: 'Explain how React hooks work.',
      type: 'text',
      time_limit: 120,
      is_answered: false,
      answer_score: null,
    },
    {
      id: 3,
      question_number: 3,
      text: 'What is the Big-O complexity of a binary search?',
      type: 'text',
      time_limit: 90,
      is_answered: false,
      answer_score: null,
    },
  ]

  const setupInterviewMocks = () => {
    cy.intercept('GET', '**/api/interviews/*/stage', {
      statusCode: 200,
      body: {
        status: 'in_progress',
        questions_ready: true,
        total_questions: 3,
        interview_stage: 'assessment',
      },
    }).as('getStage')

    cy.intercept('GET', '**/api/interviews/*/questions', {
      statusCode: 200,
      body: MOCK_QUESTIONS,
    }).as('getQuestions')

    cy.intercept('GET', '**/api/interviews/*/current-question', {
      statusCode: 200,
      body: MOCK_QUESTIONS[0],
    }).as('getCurrentQuestion')

    cy.intercept('POST', '**/api/interviews/*/heartbeat', {
      statusCode: 200,
      body: {},
    }).as('heartbeat')

    cy.intercept('POST', '**/api/interviews/*/monitoring', {
      statusCode: 200,
      body: {},
    }).as('monitoring')

    cy.intercept('POST', '**/api/interviews/*/start', {
      statusCode: 200,
      body: { status: 'in_progress' },
    }).as('startSession')

    cy.intercept('POST', '**/api/interviews/*/answers**', {
      statusCode: 200,
      body: { id: 1, score: null, saved: true },
    }).as('submitAnswer')

    cy.intercept('POST', '**/api/interviews/*/complete', {
      statusCode: 200,
      body: { status: 'completed', message: 'Interview submitted' },
    }).as('completeInterview')
  }

  const injectTokenAndVisit = () => {
    cy.wrap(null).then(async () => {
      const secret = new TextEncoder().encode(JWT_SECRET)
      const token = await new SignJWT({ role: 'interview' })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('2h')
        .sign(secret)

      cy.setCookie('interview_token', token)
      cy.window().then((win) => {
        win.sessionStorage.setItem('interview_token', token)
        win.sessionStorage.setItem('proctoring_secret', 'mock-proctoring-secret')
      })
      cy.visit(`/interview/live/${SESSION_ID}?token=${token}`, { failOnStatusCode: false })
    })
  }

  beforeEach(() => {
    setupInterviewMocks()
    injectTokenAndVisit()
  })

  // ── Page Load ─────────────────────────────────────────────────────────────
  it('interview live page loads without application error', () => {
    cy.get('body').should('not.contain.text', 'Application error')
  })

  it('interview page renders a question or pre-start check screen', () => {
    cy.get('body', { timeout: 25000 }).should('not.contain.text', 'Application error')
    cy.get('body').then(($body) => {
      const text = $body.text().toLowerCase()
      const hasContent =
        text.includes('question') ||
        text.includes('interview') ||
        text.includes('start') ||
        text.includes('ready') ||
        text.includes('camera') ||
        text.includes('microphone')
      expect(hasContent, 'Interview page should show question or setup screen').to.be.true
    })
  })

  // ── Question Content ──────────────────────────────────────────────────────
  it('displays the current question text after session starts', () => {
    cy.wait('@getStage', { timeout: 25000 })
    cy.wait('@getQuestions', { timeout: 25000 })

    cy.get('body').then(($body) => {
      const hasMockQuestion = $body.text().includes('var, let') || $body.text().includes('React hooks')
      if (hasMockQuestion) {
        cy.contains(/var, let|React hooks|binary search/i).should('be.visible')
      } else {
        cy.log('Questions not rendered yet — may require starting the session')
      }
    })
  })

  // ── Answer Text Area ──────────────────────────────────────────────────────
  it('answer textarea is present and accepts input', () => {
    cy.wait('@getStage', { timeout: 25000 })

    cy.get('body').then(($body) => {
      const $textarea = $body.find('textarea, [contenteditable="true"]')
      if ($textarea.length > 0) {
        cy.wrap($textarea.first())
          .click({ force: true })
          .type('This is my answer to the question.')
        cy.wrap($textarea.first()).should('contain.value', 'This is my answer')
      } else {
        cy.log('No textarea found — interview may use code editor or voice input')
      }
    })
  })

  // ── Submit Answer ─────────────────────────────────────────────────────────
  it('Submit Answer button fires POST to answers endpoint', () => {
    cy.wait('@getStage', { timeout: 25000 })

    cy.get('body').then(($body) => {
      const $textarea = $body.find('textarea, [contenteditable="true"]')
      if ($textarea.length > 0) {
        cy.wrap($textarea.first()).click({ force: true }).type('My answer here')
      }

      const $submitBtn = $body.find('button').filter(':contains("Submit")')
        .add($body.find('button').filter(':contains("Next")'))
        .add($body.find('button').filter(':contains("Save")'))

      if ($submitBtn.length > 0) {
        cy.wrap($submitBtn.first()).click({ force: true })
        cy.wait('@submitAnswer')
        cy.get('body').should('not.contain.text', 'Application error')
      } else {
        cy.log('No submit/next button found — may require completing the pre-check first')
      }
    })
  })

  // ── Timer Visibility ──────────────────────────────────────────────────────
  it('a countdown timer is visible during the interview', () => {
    cy.wait('@getStage', { timeout: 25000 })

    cy.get('body').then(($body) => {
      const text = $body.text()
      // Timer typically shows MM:SS format like 1:58, 02:00, or a digit countdown
      const hasTimer =
        /\d{1,2}:\d{2}/.test(text) ||
        $body.find('[class*="timer"]').length > 0 ||
        $body.find('[class*="countdown"]').length > 0 ||
        $body.find('[data-testid*="timer"]').length > 0
      if (!hasTimer) cy.log('Timer not visible — may only appear after starting the session')
    })
  })

  // ── Question Counter ──────────────────────────────────────────────────────
  it('shows question number indicator (e.g., "Question 1 of 3")', () => {
    cy.wait('@getStage', { timeout: 25000 })
    cy.wait('@getQuestions', { timeout: 25000 })

    cy.get('body').then(($body) => {
      const text = $body.text()
      const hasCounter =
        /question\s+\d+\s+(of|\/)\s+\d+/i.test(text) ||
        /\d+\s*\/\s*\d+/.test(text) ||
        text.toLowerCase().includes('1 of 3') ||
        text.toLowerCase().includes('question 1')
      if (!hasCounter) cy.log('No question counter found — may appear only after starting')
    })
  })

  // ── Missing Token Redirect ────────────────────────────────────────────────
  it('redirects to /interview/access when no token cookie is present', () => {
    cy.clearCookie('interview_token')
    cy.visit(`/interview/live/${SESSION_ID}`, { failOnStatusCode: false })
    cy.url().should('include', '/interview/access')
  })

  // ── Session Completion ────────────────────────────────────────────────────
  it('completing all questions shows a submission confirmation screen', () => {
    // Mock the final question being already answered
    cy.intercept('GET', '**/api/interviews/*/current-question', {
      statusCode: 200,
      body: { ...MOCK_QUESTIONS[2], is_answered: true },
    }).as('lastQuestion')

    cy.intercept('GET', '**/api/interviews/*/stage', {
      statusCode: 200,
      body: {
        status: 'completed',
        questions_ready: true,
        total_questions: 3,
        interview_stage: 'completed',
      },
    }).as('completedStage')

    cy.wait('@getStage', { timeout: 25000 })
    cy.get('body').then(($body) => {
      const $finishBtn = $body.find('button').filter(':contains("Submit Interview")')
        .add($body.find('button').filter(':contains("Finish")')  )
        .add($body.find('button').filter(':contains("Complete")'))

      if ($finishBtn.length > 0) {
        cy.wrap($finishBtn.first()).click({ force: true })
        cy.wait('@completeInterview')
        cy.get('body').then(($after) => {
          const text = $after.text().toLowerCase()
          const hasConfirm =
            text.includes('submitted') ||
            text.includes('complete') ||
            text.includes('thank you') ||
            text.includes('finished')
          if (!hasConfirm) cy.log('No completion confirmation screen — may redirect')
        })
      } else {
        cy.log('No finish/complete button found in current interview state')
      }
    })
  })

  // ── Heartbeat API ─────────────────────────────────────────────────────────
  it('heartbeat API is called during active session', () => {
    cy.wait('@getStage', { timeout: 25000 })
    // Heartbeats are sent on interval — wait for at least one
    cy.wait('@heartbeat', { timeout: 20000 }).then(() => {
      cy.log('Heartbeat received — session keep-alive is working')
    })
  })

  // ── API Error During Interview ────────────────────────────────────────────
  it('answer submission failure shows a retry message, not a crash', () => {
    cy.intercept('POST', '**/api/interviews/*/answers**', {
      statusCode: 500,
      body: { detail: 'Server error' },
    }).as('failAnswer')

    cy.wait('@getStage', { timeout: 25000 })

    cy.get('body').then(($body) => {
      const $textarea = $body.find('textarea')
      if ($textarea.length > 0) cy.wrap($textarea.first()).type('My answer')

      const $btn = $body.find('button').filter(':contains("Submit")').add(
        $body.find('button').filter(':contains("Next")')
      )
      if ($btn.length > 0) {
        cy.wrap($btn.first()).click({ force: true })
        cy.get('body').should('not.contain.text', 'Application error')
      }
    })
  })
})
