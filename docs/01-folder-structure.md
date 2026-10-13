# 폴더 구조

언제 읽는가: 새 파일·슬라이스를 어디에 둘지 정할 때. 계층과 의존 방향 규칙은
`docs/rules/architecture.md`, 토큰·스타일 배치는 `docs/06-design-system.md §3`이
정본이다.

## 설계 기준

- **처리(도메인):** Rust `crates/pdf-core`(PDF 처리)와 `crates/translate`(번역 규칙,
  pdf-core를 모른다). Tauri·웹뷰를 모르고 `cargo test`만으로 검증한다.
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
├─ Cargo.toml                  # [workspace] members = src-tauri, crates/pdf-core, crates/translate
├─ vite.config.ts              # 렌더러 빌드 (dev 서버 1420, dist/ 출력)
├─ vitest.config.mts
├─ index.html
├─ docs/                       # 계획서(plans/), 규칙(rules/), 결정 기록(adr/)
├─ LICENSE                     # MIT (앱 번들에도 넣는다)
├─ THIRD_PARTY_NOTICES.md      # 제3자 고지 (pnpm licenses:generate 생성물, 앱 번들에 넣는다)
├─ scripts/
│  ├─ fetch-pdfium.mjs         # 버전 고정 pdfium 받기 (src-tauri/pdfium/<target>/, gitignore)
│  ├─ fetch-ocr.mjs            # 버전 고정 ONNX Runtime·OCR 모델 받기 (src-tauri/onnxruntime/<target>/, ocr-models/, gitignore)
│  ├─ generate-notices.mjs     # THIRD_PARTY_NOTICES.md 생성 (pnpm licenses:generate)
│  ├─ check-licenses.mjs       # 허용 목록 밖 라이선스·낡은 고지면 실패 (pnpm licenses:check)
│  ├─ third-party/             # 의존성 수집, 허용 목록·예외(policy.mjs), 번들 자산 고정 목록
│  ├─ verify-macos-signature.mjs # .app과 Frameworks dylib의 서명 identity 검사 (release.yml, 계획서 P4-3)
│  └─ release.mjs              # 버전 범프 → 릴리스 커밋 → v 태그 (pnpm release:*, 푸시는 사용자)
│
├─ crates/pdf-core/            # 도메인: Tauri 의존 없음
│  ├─ src/
│  │  ├─ engine.rs             # pdfium 라이브러리 경로 결정(PDFIUM_LIB_PATH 우선)과 바인딩, pdfium 프로세스 잠금(PdfiumSession, ADR 0001 §15)
│  │  ├─ document.rs           # 문서 열기, 에러 타입
│  │  ├─ info.rs               # 페이지 수·크기·회전 정규화
│  │  ├─ compare.rs, compare/  # PDF 비교(결과 모델·추출·토큰화·diff·앵커 anchors.rs·리포트 내보내기 규칙은 ADR 0001, 연결선 끝·모양 connectors.rs는 계획서 §7.1)
│  │  ├─ ocr/                  # 스캔 쪽 OCR(렌더·검출·인식, 런타임 경로, 디스크 캐시). 비교 연결은 compare/pipeline.rs(ADR 0001 §11)
│  │  ├─ merge.rs, merge/      # 병합(회전 절대값), 진행률
│  │  ├─ tiff.rs, tiff/        # TIFF → PDF (CCITT 포함)
│  │  └─ output.rs             # 원자적 쓰기(임시 파일 + rename)
│  └─ tests/                   # 통합 테스트, fixtures/(생성 스크립트 포함), golden/(비교 엔진 기대 JSON), pdfium_concurrency.rs(동시 호출 재현)
│
├─ crates/translate/           # 번역 도메인(ADR 0002): Tauri·pdfium·키체인·pdf-core 의존 없음
│  ├─ src/
│  │  ├─ source.rs             # 입력(SourcePage: 글자층 문단 | 스캔 쪽 그림 크기). src-tauri가 pdf-core 문단에서 옮긴다
│  │  ├─ chunk.rs              # 묶음(문단 자르지 않음·긴 문단 조각·스캔 쪽 한 묶음)과 예상 토큰·max_tokens·예상 요금
│  │  ├─ models.rs             # 모델 표(API ID·출력 상한·요금·기준일)
│  │  ├─ language.rs           # 원문 언어 감지(한자·라틴 비율, 간체·번체 글자 짝)
│  │  ├─ glossary.rs           # 용어집 정규화(공백·NFC·같은 원어)와 원문에 나오는 용어 찾기
│  │  └─ script.rs, per_mille.rs # 글자 갈래(한자·라틴) 판정, 천분율 비율 상수
│  └─ tests/                   # 묶음·예상치·언어 감지·용어집(cargo test -p translate, pdfium 없이)
│
├─ src-tauri/                  # 어댑터: Tauri 셸
│  ├─ src/
│  │  ├─ lib.rs, main.rs       # 앱 부팅, 플러그인·커맨드 등록
│  │  ├─ commands.rs           # 커맨드: 입력을 처리 함수에 넘기고 무거운 일은 spawn_blocking
│  │  ├─ contract.rs           # 경계 타입 (tauri-specta 로 TS 바인딩 생성)
│  │  ├─ access.rs             # 허용 경로 목록, 경로 검증
│  │  ├─ files.rs, merge.rs    # 파일 열기, 병합 처리(경로 검증 후 pdf-core 위임)
│  │  ├─ compare.rs            # 비교 처리(경로 검증 후 실행기 위임), 추출·OCR 캐시와 OCR 엔진 상태(ADR 0001 §16)
│  │  ├─ report.rs             # 리포트 내보내기·미리보기(경로 검증·내보내기 폴더 새 이름 후 pdf-core 위임, ADR 0001 §17)
│  │  ├─ jobs.rs               # 작업 ID·취소 토큰
│  │  ├─ pdf_engine.rs         # 번들 pdfium 바인딩, 엔진을 앱 상태로
│  │  ├─ notices.rs            # 번들한 제3자 고지 읽기(리소스 폴더 고정 파일)
│  │  └─ error.rs              # 커맨드 에러 → { code, message, path }
│  ├─ capabilities/            # main 창 권한(default.json, 데스크톱 전용 updater·process는 desktop.json)
│  ├─ icons/
│  ├─ Entitlements.plist
│  ├─ windows-app-manifest.xml # Windows 앱·테스트 exe 매니페스트 (build.rs가 링커로 넣는다)
│  └─ tauri.conf.json
│
└─ src/renderer/               # 화면: React 19 + FSD
   ├─ app/                     # 부팅, 프로바이더(플랫폼 주입), 레이아웃, 전역 스타일, 모드 스토어
   │  ├─ index.tsx
   │  ├─ layout/               # app-shell(모드별 화면), 툴바·모드 탭(mode-tabs), 상태바
   │  ├─ model/                # 앱 모드 home|merge|compare (라우터 없음)
   │  ├─ providers/            # 플랫폼·오류 보고 주입, 테마 적용(theme-provider), 오류 경계
   │  └─ styles/               # index.css, tokens.css, theme.css, base.css
   ├─ pages/
   │  ├─ home/                 # 첫 화면: 작업 고르기 카드(병합·비교), 카드 위 드롭
   │  ├─ compare/              # 비교 화면: 옵션(A·B 슬롯 + 실행 전 옵션) / 진행 카드 / 결과 화면(툴바·안내 띠·목록 | 페이지 영역)
   │  └─ merged-preview/       # 병합 결과 미리보기 화면
   ├─ widgets/
   │  ├─ merge-workspace/      # 병합 작업 영역 조합
   │  └─ compare-viewer/       # 비교 결과 페이지 영역: A·B 두 패널(같은 쌍 행 배치, 패널마다 virtuoso 가상화, 동기 스크롤), pdf.js 쪽 + SVG 하이라이트, 영역 전체를 덮는 연결선 오버레이(좌표 변환·경로·컬링 lib/connector-geometry, rAF 갱신), 미니맵, 배율
   ├─ features/                # 사용자 행동
   │  ├─ pdf-merge/            # 파일 추가·선택·회전·병합·다운로드
   │  ├─ pdf-compare/          # 비교 세션(A·B 문서·옵션·결과·고른 변경·필터·보기 방식·연결선 표시)·실행(진행률·취소), 파일 받기, 그릴 연결선·호버, ui/file-slots·options-card·progress-card·결과 머리·종류 칩·연결선 체크박스·이전/다음·차이 목록·안내 띠
   │  ├─ compare-export/       # 결과 내보내기 모달(시안 5): 받을 파일·비교 PDF 옵션, 저장 폴더(이 실행 동안 기억)·만들 이름, 미리보기(오래된 응답 버림), 내보내기 실행·취소·토스트
   │  ├─ pdf-preview/          # 미리보기 모달
   │  ├─ theme-toggle/         # 테마 system|light|dark 선택·저장
   │  ├─ error-reporting/      # 오류 보고 켜기·끄기, 첫 실행 안내
   │  ├─ app-update/           # 시작 후 업데이트 확인, 토스트(업데이트 → 받기 % → 진행 중인 작업이 없을 때 설치·재시작)
   │  └─ third-party-notices/  # 앱 정보: 상태 바에서 제3자 고지 대화상자 열기
   ├─ entities/                # 읽기·표시
   │  ├─ merge-plan/           # 병합 대상 문서·페이지 상태(merge-store), 진행 오버레이
   │  └─ comparison/           # 비교 결과 타입(바인딩 재수출)·선택자(필터·개수·쪽별 묶기·이동·안내 문구), 연결선 끝·모양(connector-ends, Rust connectors.rs의 거울), 하이라이트 상자·견본·배지
   └─ shared/                  # 도메인을 모른다
      ├─ api/bindings.ts       # tauri-specta 생성물 (손으로 고치지 않는다)
      ├─ platform/             # DesktopPlatform 인터페이스, tauri·mock 구현, 진행 중인 작업 세기(running-work)
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
- `e2e/`: 첫 Playwright E2E를 넣는 Step에서 만든다

## 레이어별 역할 요약

| 위치                | 역할                         | 예시                              |
| ------------------- | ---------------------------- | --------------------------------- |
| `crates/pdf-core`   | 처리 규칙 (도메인)           | 병합, 회전 정규화, TIFF 변환      |
| `crates/translate`  | 번역 규칙 (도메인)           | 묶음·예상치, 언어 감지, 용어집    |
| `src-tauri`         | 커맨드·경로 검증·작업 큐     | `merge_pdfs`, `open_files`        |
| `renderer/shared`   | 공통 유틸·UI·플랫폼 어댑터   | `DesktopPlatform`, 바인딩         |
| `renderer/entities` | 읽기·표시                    | 병합 계획 스토어, 진행 오버레이   |
| `renderer/features` | 사용자 행동                  | 파일 추가, 선택, 병합 실행        |
| `renderer/widgets`  | features 조합                | 병합 작업 영역                    |
| `renderer/pages`    | 화면 조립                    | 병합 결과 미리보기                |
| `renderer/app`      | 부팅·프로바이더·전역 스타일  | 플랫폼 주입, 앱 셸                |
