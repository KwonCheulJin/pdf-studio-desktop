import { defineConfig } from 'vite';

// 프리로드 번들 파일명을 main 프로세스 기대치(preload.js)와 맞춥니다.
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'preload.js',
      },
    },
  },
});
