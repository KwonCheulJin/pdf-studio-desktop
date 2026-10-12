import { readFileSync } from "node:fs";
import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

import { PDFJS_ASSET_DIRECTORY } from "./src/renderer/shared/lib/pdfjs/asset-paths";

interface PackageJson {
  version: string;
}

// tauri.conf.json의 devUrl과 같은 포트여야 한다.
const DEV_SERVER_PORT = 1420;

// pdf.js 5는 Promise.withResolvers를 폴리필 없이 쓴다
// (Safari 17.4, Chromium 119부터 지원).
const BUILD_TARGET = ["es2022", "safari17.4", "chrome119"];

// pdf.js 런타임 자산: `pdfjs-dist`의 폴더 → 앱의 `PDFJS_ASSET_DIRECTORY`.
// 빌드하면 dist에 복사되고 개발 서버는 node_modules에서 바로 내준다(레포에 사본을 두지 않는다).
const PDFJS_PACKAGE_DIRECTORY = "node_modules/pdfjs-dist";
const PDFJS_ASSET_SOURCES = [
  { source: "cmaps", destination: PDFJS_ASSET_DIRECTORY.CMAPS },
  {
    source: "standard_fonts",
    destination: PDFJS_ASSET_DIRECTORY.STANDARD_FONTS
  },
  { source: "wasm", destination: PDFJS_ASSET_DIRECTORY.WASM },
  { source: "iccs", destination: PDFJS_ASSET_DIRECTORY.ICCS }
];

const { version } = JSON.parse(
  readFileSync("./package.json", "utf-8")
) as PackageJson;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: PDFJS_ASSET_SOURCES.map(({ source, destination }) => ({
        src: `${PDFJS_PACKAGE_DIRECTORY}/${source}/*`,
        dest: destination,
        rename: { stripBase: true }
      }))
    })
  ],
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
