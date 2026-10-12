import { readFileSync } from "node:fs";
import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

interface PackageJson {
  version: string;
}

// tauri.conf.json의 devUrl과 같은 포트여야 한다.
const DEV_SERVER_PORT = 1420;

// pdf.js 5는 Promise.withResolvers를 폴리필 없이 쓴다
// (Safari 17.4, Chromium 119부터 지원).
const BUILD_TARGET = ["es2022", "safari17.4", "chrome119"];

const { version } = JSON.parse(
  readFileSync("./package.json", "utf-8")
) as PackageJson;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  define: {
    __APP_VERSION__: JSON.stringify(version)
  },
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_ENV_"],
  server: {
    port: DEV_SERVER_PORT,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**", "**/target/**"]
    }
  },
  build: {
    outDir: "dist",
    target: BUILD_TARGET
  }
});
