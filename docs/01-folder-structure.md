# 폴더 구조

언제 읽는가: 새 파일·슬라이스를 어디에 둘지 정할 때. 계층과 의존 방향 규칙은
`docs/rules/architecture.md`, 토큰·스타일 배치는 `docs/06-design-system.md §3`이
정본이다.

## 설계 기준

- **처리(도메인):** Rust `crates/pdf-core`. Tauri·웹뷰를 모르고 `cargo test`만으로
  검증한다.
- **어댑터:** `src-tauri`(Tauri 커맨드·경로 검증·작업 큐)와 렌더러의
  `shared/platform`(`DesktopPlatform` 구현).
- **화면:** `src/renderer`, FSD(`app → pages → widgets → features → entities →
  shared`). `entities` = 읽기·표시, `features` = 사용자 행동.
- 경계를 넘는 타입은 `tauri-specta` 생성물(`src/renderer/shared/api/bindings.ts`)만
  쓴다.

## 전체 구조

```
project-root/
├─ package.json                # 버전 단일 소스 (tauri.conf.json 이 가리킨다)
├─ Cargo.toml                  # [workspace] members = src-tauri, crates/pdf-core
├─ vite.config.ts              # 렌더러 빌드 (dev 서버 1420, dist/ 출력)
├─ vitest.config.mts
├─ index.html
├─ docs/                       # 계획서(plans/), 규칙(rules/), 결정 기록(adr/)
├─ scripts/
│  ├─ fetch-pdfium.mjs         # 버전 고정 pdfium 받기 (src-tauri/pdfium/<target>/, gitignore)
│  └─ release.mjs
│
├─ crates/pdf-core/            # 도메인: Tauri 의존 없음
│  ├─ src/
│  │  ├─ engine.rs             # pdfium 라이브러리 경로 결정(PDFIUM_LIB_PATH 우선)과 바인딩
│  │  ├─ document.rs           # 문서 열기, 에러 타입
│  │  ├─ info.rs               # 페이지 수·크기·회전 정규화
│  │  ├─ compare.rs, compare/  # PDF 비교(결과 모델·추출 규칙은 ADR 0001)
│  │  ├─ merge.rs, merge/      # 병합(회전 절대값), 진행률
│  │  ├─ tiff.rs, tiff/        # TIFF → PDF (CCITT 포함)
│  │  └─ output.rs             # 원자적 쓰기(임시 파일 + rename)
│  └─ tests/                   # 통합 테스트, fixtures/(생성 스크립트 포함), golden/(비교 엔진 기대 JSON)
│
├─ src-tauri/                  # 어댑터: Tauri 셸
│  ├─ src/
│  │  ├─ lib.rs, main.rs       # 앱 부팅, 플러그인·커맨드 등록
│  │  ├─ commands.rs           # 커맨드: 입력을 처리 함수에 넘기고 무거운 일은 spawn_blocking
│  │  ├─ contract.rs           # 경계 타입 (tauri-specta 로 TS 바인딩 생성)
│  │  ├─ access.rs             # 허용 경로 목록, 경로 검증
│  │  ├─ files.rs, merge.rs    # 파일 열기, 병합 처리(경로 검증 후 pdf-core 위임)
│  │  ├─ jobs.rs               # 작업 ID·취소 토큰
│  │  ├─ pdf_engine.rs         # 번들 pdfium 바인딩, 엔진을 앱 상태로
│  │  └─ error.rs              # 커맨드 에러 → { code, message, path }
│  ├─ capabilities/            # main 창 권한
│  ├─ icons/
│  ├─ Entitlements.plist
│  └─ tauri.conf.json
│
└─ src/renderer/               # 화면: React 19 + FSD
   ├─ app/                     # 부팅, 프로바이더(플랫폼 주입), 레이아웃, 전역 스타일
   │  ├─ index.tsx
   │  ├─ layout/               # app-shell, 툴바, 상태바
   │  ├─ providers/            # 플랫폼·오류 보고 주입, 테마 적용(theme-provider), 오류 경계
   │  └─ styles/               # index.css, tokens.css, theme.css, base.css
   ├─ pages/
   │  └─ merged-preview/       # 병합 결과 미리보기 화면
   ├─ widgets/
   │  └─ merge-workspace/      # 병합 작업 영역 조합
   ├─ features/                # 사용자 행동
   │  ├─ pdf-merge/            # 파일 추가·선택·회전·병합·다운로드
   │  ├─ pdf-preview/          # 미리보기 모달
   │  ├─ theme-toggle/         # 테마 system|light|dark 선택·저장
   │  └─ error-reporting/      # 오류 보고 켜기·끄기, 첫 실행 안내
   ├─ entities/                # 읽기·표시
   │  └─ merge-plan/           # 병합 대상 문서·페이지 상태(merge-store), 진행 오버레이
   └─ shared/                  # 도메인을 모른다
      ├─ api/bindings.ts       # tauri-specta 생성물 (손으로 고치지 않는다)
      ├─ platform/             # DesktopPlatform 인터페이스, tauri·mock 구현
      ├─ lib/                  # 순수 함수, pdf.js 썸네일, 오류 보고(error-report: 경로 마스킹·전송)
      ├─ ui/                   # 공용 UI (토큰 클래스만)
      ├─ constants/
      └─ types/
```

슬라이스 안 세그먼트는 `ui/`, `model/`, `lib/`, `api/`, `config/`이고, 슬라이스 밖에서는
`index.ts`로만 가져온다. 기존 Vitest는 대상과 같은 폴더의 `__tests__/`에 있다.

## 앞으로 바뀌는 곳

- `docs/06-design-system.md §3`: `app/styles/fonts.css`, 토큰 이름 상수
  `shared/config/theme.ts`(`shared/constants/group-colors.ts`를 옮긴다)
- 계획서 §7 FSD 배치(Phase 3): 비교 화면 슬라이스(`entities/comparison` 등)
- `e2e/`: 첫 Playwright E2E를 넣는 Step에서 만든다

## 레이어별 역할 요약

| 위치                | 역할                         | 예시                              |
| ------------------- | ---------------------------- | --------------------------------- |
| `crates/pdf-core`   | 처리 규칙 (도메인)           | 병합, 회전 정규화, TIFF 변환      |
| `src-tauri`         | 커맨드·경로 검증·작업 큐     | `merge_pdfs`, `open_files`        |
| `renderer/shared`   | 공통 유틸·UI·플랫폼 어댑터   | `DesktopPlatform`, 바인딩         |
| `renderer/entities` | 읽기·표시                    | 병합 계획 스토어, 진행 오버레이   |
| `renderer/features` | 사용자 행동                  | 파일 추가, 선택, 병합 실행        |
| `renderer/widgets`  | features 조합                | 병합 작업 영역                    |
| `renderer/pages`    | 화면 조립                    | 병합 결과 미리보기                |
| `renderer/app`      | 부팅·프로바이더·전역 스타일  | 플랫폼 주입, 앱 셸                |
