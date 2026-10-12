import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const remote = process.env.SHELL_BROWSER_URL;
const proxy = process.env.SHELL_BROWSER_PROXY;
export default defineConfig({ testDir: './tests/browser', timeout: 60000, workers: 1, use: { baseURL: remote || 'http://127.0.0.1:3000', browserName: 'chromium', headless: true, ...(proxy ? { proxy: { server: proxy, bypass: 'localhost,127.0.0.1,[::1]' } } : {}), launchOptions: existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {} }, webServer: remote ? undefined : { command: 'npm run dev -- --hostname 127.0.0.1', url: 'http://127.0.0.1:3000', reuseExistingServer: true, timeout: 120000 } });
