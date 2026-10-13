import { defineConfig, devices } from "@playwright/test";

// 앱 개발 서버(1420, tauri.conf.json devUrl)와 겹치지 않는 E2E 전용 포트.
// 다른 작업 폴더의 개발 서버를 잘못 재사용하지 않도록 항상 새로 띄운다.
// 여러 worktree에서 동시에 돌리면 `E2E_PORT` 환경변수로 worktree마다 다른 포트를 준다.
const DEFAULT_E2E_PORT = 1430;
const E2E_PORT_ENV = "E2E_PORT";

function e2ePort(): number {
  const value = process.env[E2E_PORT_ENV];
  if (value === undefined || value === "") return DEFAULT_E2E_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`${E2E_PORT_ENV}는 포트 번호여야 합니다: ${value}`);
  }
  return port;
}

const E2E_PORT = e2ePort();
const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;
const WEB_SERVER_TIMEOUT_MS = 120_000;

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure"
  },
  // WebKit(Tauri macOS 웹뷰와 같은 엔진) 헤드리스 하나만. 창은 뜨지 않는다.
  projects: [
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], headless: true }
    }
  ],
  webServer: {
    command: `pnpm dev:web --port ${E2E_PORT} --strictPort`,
    url: E2E_BASE_URL,
    reuseExistingServer: false,
    timeout: WEB_SERVER_TIMEOUT_MS
  }
});
