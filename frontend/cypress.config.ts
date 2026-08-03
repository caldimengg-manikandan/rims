import { defineConfig } from 'cypress'

export default defineConfig({
  e2e: {
    baseUrl: 'http://127.0.0.1:3000/calrims',
    viewportWidth: 1440,
    viewportHeight: 900,
    defaultCommandTimeout: 15000,
    requestTimeout: 20000,
    responseTimeout: 20000,
    pageLoadTimeout: 45000,
    video: true,
    screenshotOnRunFailure: true,
    // Wait for server to be ready before starting
    experimentalRunAllSpecs: false,
    retries: {
      runMode: 2,
      openMode: 0,
    },
    env: {
      // Suppress allowCypressEnv warning by not using Cypress.env() in tests
    },
    setupNodeEvents(on, config) {
      on('before:browser:launch', (browser, launchOptions) => {
        launchOptions.args.push('--use-fake-ui-for-media-stream')
        launchOptions.args.push('--use-fake-device-for-media-stream')
        return launchOptions
      })
    },
    specPattern: 'cypress/e2e/**/*.cy.{ts,tsx}',
    supportFile: 'cypress/support/e2e.ts',
  },
})
