import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 기존 설정에 tailwindcss 플러그인 추가
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  // ... 나머지 기존 옵션들 유지
});