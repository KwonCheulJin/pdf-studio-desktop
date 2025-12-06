# PDF Studio Desktop

Electron Forge로 부트스트랩된 PDF Studio Desktop의 데스크톱 클라이언트입니다. Vite + React + Tailwind v4 베이스이며, 멀티 플랫폼(Windows/macOS/Linux) 빌드를 지원하도록 설정되어 있습니다.

## 주요 특징

- Electron Forge 7 + Vite로 빠른 HMR 개발 환경
- React + Tailwind v4 테마 변수 사전 정의
- Squirrel(Win), zip(macOS), deb/rpm(Linux) 패키징 설정 포함
- Preload 스크립트 분리로 보안 기본값 유지

## 기술 스택

- Electron 39
- Vite 5
- React 19 (현재 기본 renderer는 빈 화면 로그만 출력)
- Tailwind CSS 4 (테마 토큰 정의)
- TypeScript 5

## 시작하기

사전 요구 사항: Node 18+ 권장, [pnpm](https://pnpm.io/) 설치.

```bash
# 의존성 설치
pnpm install

# 개발 모드 (HMR)
pnpm start
```

## 빌드 & 패키징

```bash
# 플랫폼별 패키지 생성 (dist/)
pnpm make

# 플랫폼 공용 패키징 (다국적 포맷 생성 없이)
pnpm package
```

## 프로젝트 구조

```
src/
  main.ts       # 메인 프로세스
  preload.ts    # 브라우저 <-> Node 브리지
  renderer.ts   # 렌더러 엔트리 (React/Tailwind 사용 가능)
  index.css     # Tailwind v4 테마 토큰 및 기본 스타일
forge.config.mts          # Electron Forge 빌드/패키징 설정
vite.*.config.mts         # Vite 설정 (main/preload/renderer)
```

## 개발 메모

- 현재 renderer는 기본 로그만 출력합니다. `src/renderer.ts`를 React 엔트리로 교체해 UI를 추가하세요.
- Tailwind v4는 가상 테마 토큰을 정의해둔 상태입니다. 필요 시 `src/index.css`에서 컬러/폰트 토큰을 수정하세요.
- 린트 스크립트가 미구성되어 있습니다. 필요 시 ESLint/Prettier를 추가하면 됩니다.

## 라이선스

MIT
