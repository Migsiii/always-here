import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.js/,
  timeout: 90_000,
  workers: 2,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8080',
    permissions: ['camera', 'microphone'],
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    { command: 'node tests/serve.mjs', url: 'http://localhost:8080/tests/blank.html', reuseExistingServer: false },
    { command: 'npx peerjs --port 9000 --key peerjs --path /', url: 'http://localhost:9000/peerjs/id', reuseExistingServer: false },
  ],
});
