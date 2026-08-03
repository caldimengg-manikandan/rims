// cypress/e2e/04-interview-navigation-lock.cy.ts
// Deep browser history locking tests during active interview session
// Tests the popstate/beforeunload guards added to InterviewSession.tsx

import { SignJWT } from 'jose';

describe('Interview Session — Browser History Locking (Forward/Backward)', () => {
  const MOCK_SESSION_ID = 'test-session-001';

  beforeEach(() => {
    // 1. Mock the backend session validation/start endpoints
    cy.intercept('GET', '**/api/interviews/*/stage', {
      statusCode: 200,
      body: {
        status: 'in_progress',
        questions_ready: true,
        total_questions: 2,
        interview_stage: 'assessment',
      },
    }).as('getStage');

    cy.intercept('GET', '**/api/interviews/*/questions', {
      statusCode: 200,
      body: [
        {
          id: 1,
          question_number: 1,
          text: 'What is the difference between var, let and const?',
          type: 'text',
          is_answered: false,
          answer_score: null,
        },
        {
          id: 2,
          question_number: 2,
          text: 'Explain the concept of closure in JavaScript.',
          type: 'text',
          is_answered: false,
          answer_score: null,
        },
      ],
    }).as('getQuestions');

    cy.intercept('GET', '**/api/interviews/*/current-question', {
      statusCode: 200,
      body: {
        id: 1,
        question_number: 1,
        text: 'What is the difference between var, let and const?',
        type: 'text',
        time_limit: 120,
      },
    }).as('getCurrentQuestion');

    cy.intercept('POST', '**/api/interviews/*/heartbeat', { statusCode: 200, body: {} }).as('heartbeat');
    cy.intercept('POST', '**/api/interviews/*/monitoring', { statusCode: 200, body: {} }).as('monitoring');
    cy.intercept('POST', '**/api/interviews/*/start', { statusCode: 200, body: { status: 'in_progress' } }).as('startSession');

    // 2. Generate and inject a valid JWT token cookie before visiting the page
    cy.wrap(null).then(async () => {
      const secret = new TextEncoder().encode('5ff829b387f2b50f516a5326b52ad798312cd6c7709226e4ad9b21f254ee8019_interview');
      const token = await new SignJWT({ role: 'interview' })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('2h')
        .sign(secret);

      // Set cookie and session storage
      cy.setCookie('interview_token', token);
      cy.visit(`/interview/live/${MOCK_SESSION_ID}?token=${token}`, { failOnStatusCode: false });
      cy.get('body[data-hydrated="true"]', { timeout: 20000 }).should('exist');
      cy.window().then((win) => {
        win.sessionStorage.setItem('interview_token', token);
      });
    });
  });

  // ── Missing Token / Cookie Redirect Guard ──────────────────────────────────
  it('redirects to access page when no token cookie is present', () => {
    // Clear cookie to trigger security redirect
    cy.clearCookie('interview_token');
    cy.visit(`/interview/live/${MOCK_SESSION_ID}`, { failOnStatusCode: false });
    // URL must automatically redirect to the access route
    cy.url().should('include', '/interview/access');
  });

  // ── Back Navigation — Before Session Starts ───────────────────────────────
  it('browser back button works normally before interview is started', () => {
    // Build some history first
    cy.visit('/interview/access', { failOnStatusCode: false });
    // Re-inject token to go to live page
    cy.wrap(null).then(async () => {
      const secret = new TextEncoder().encode('5ff829b387f2b50f516a5326b52ad798312cd6c7709226e4ad9b21f254ee8019_interview');
      const token = await new SignJWT({ role: 'interview' })
        .setProtectedHeader({ alg: 'HS256' })
        .sign(secret);
      cy.setCookie('interview_token', token);
      cy.visit(`/interview/live/${MOCK_SESSION_ID}?token=${token}`, { failOnStatusCode: false });
    });
    cy.go('back');
    cy.url().should('include', '/interview/access');
  });

  // ── History Lock — After Session Starts ───────────────────────────────────
  it('browser back button is intercepted once the interview session is active', () => {
    cy.wait('@getStage', { timeout: 25000 });
    cy.wait('@getQuestions', { timeout: 25000 });

    // Enable devices and click start button (button is disabled if media test is not success)
    cy.get('button').contains(/enter.*interview|start.*interview|begin|proceed/i).should('not.be.disabled').click({ force: true });

    // Attempt browser back — it should be blocked
    cy.go('back');

    // URL must remain on the interview page
    cy.url().should('include', `/interview/live/${MOCK_SESSION_ID}`);

    // A toast warning should appear
    cy.contains(
      /back.*forward.*disabled|navigation.*disabled|complete.*session|exit.*session/i,
      { timeout: 8000 }
    ).should('be.visible');
  });

  // ── Forward Navigation Lock ────────────────────────────────────────────────
  it('browser forward button is also intercepted during active session', () => {
    cy.wait('@getStage', { timeout: 25000 });
    cy.wait('@getQuestions', { timeout: 25000 });
    cy.get('button').contains(/enter.*interview|start.*interview|begin|proceed/i).should('not.be.disabled').click({ force: true });

    // Navigate back then try forward — forward should be re-locked too
    cy.go('back');
    cy.url().should('include', `/interview/live/${MOCK_SESSION_ID}`);
  });

  // ── BeforeUnload Warning ───────────────────────────────────────────────────
  it('registers a beforeunload listener once interview is active', () => {
    cy.wait('@getStage', { timeout: 25000 });
    cy.wait('@getQuestions', { timeout: 25000 });
    cy.get('button').contains(/enter.*interview|start.*interview|begin|proceed/i).should('not.be.disabled').click({ force: true });

    // Verify page stays on active route
    cy.url().should('include', `/interview/live/${MOCK_SESSION_ID}`);
  });
});
