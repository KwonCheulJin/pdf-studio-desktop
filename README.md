# PDF Studio Desktop

Tauri v2로 만든 PDF 조작 데스크톱 앱입니다. PDF 병합·편집·TIFF 변환을 지원하며
처리는 Rust(pdfium), 화면은 React 19 + Tailwind CSS 4가 맡습니다.

## 주요 기능

- PDF 병합/순서 편집, 페이지 회전·삭제, TIFF → PDF 변환
- 페이지/파일 단위 드래그 앤 드롭 정렬, 그룹 접기/펼치기
- 병합 진행률·취소, 결과 미리보기 및 저장, 완료 후 임시 파일 정리

## 기술 스택

- Tauri v2, Rust(`crates/pdf-core`, pdfium-render)
- React 19, TypeScript, Vite, Tailwind CSS 4
- Zustand 상태 관리, pdf.js 표시

## 개발 시작

사전 요구: Node 24 LTS(`.tool-versions`), pnpm(`packageManager` 필드,
`corepack enable`), Rust stable,
[Tauri 사전 요구 사항](https://v2.tauri.app/start/prerequisites/).

```bash
pnpm install
pnpm fetch:pdfium   # 버전 고정 pdfium 라이브러리를 src-tauri/pdfium/ 에 받는다
pnpm tauri dev      # 개발 실행(HMR)
```

## 빌드

```bash
pnpm tauri build    # 현재 OS용 앱 번들 생성 (macOS: .app/.dmg)
```

## 프로젝트 구조 (요약)

- `crates/pdf-core/` : PDF 처리(병합·회전·TIFF 변환). Tauri에 의존하지 않는다
- `src-tauri/` : Tauri 셸, 커맨드, 경로 검증, 작업 큐
- `src/renderer/` : React FSD 레이아웃 (app/pages/widgets/features/entities/shared)

자세한 배치는 [docs/01-folder-structure.md](docs/01-folder-structure.md).

## 주요 워크플로우

- 파일 추가: 다이얼로그 → `pick_files` → `open_files`(TIFF 변환·정보 조회)
- 병합 실행: UI → `merge_pdfs`(진행률 채널, 취소 가능) → 완료 시 미리보기 전환
- 미리보기: 저장(`copy_file`) 후 또는 돌아가기 시 임시 병합 파일 삭제

## 스크립트

- `pnpm tauri dev` / `pnpm tauri build` : 개발 실행 / 앱 빌드
- `pnpm dev:web` / `pnpm build:web` : 렌더러만 실행 / 빌드
- `pnpm validate` : lint + typecheck + test
- `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test` :
  Rust 검증 (`PDFIUM_LIB_PATH`에 pdfium 라이브러리 파일 경로)

## 라이선스

MIT
