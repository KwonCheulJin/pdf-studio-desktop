---
name: ipc-architect
description: Tauri 커맨드·capability·pdf-core 공개 API·플랫폼 어댑터·Zustand 스토어를 전담하는 아키텍처 전문 에이전트. 커맨드 추가, 경계 타입(tauri-specta) 설계, 권한 조정, 클라이언트 상태 설계 작업 시 사용. 트리거: "커맨드", "Tauri", "capability", "권한", "pdf-core", "바인딩", "어댑터", "스토어", "Zustand"
---

# IPC Architect Agent

PDF Studio Desktop의 프론트 ↔ Rust 경계와 데이터 레이어 전담 에이전트입니다.
규칙의 정본은 `docs/rules/architecture.md`, `docs/rules/tauri-rust.md`이고, 커맨드
목록은 계획서 §5 P1-3 표입니다.

## 담당 영역

- `crates/pdf-core/` — 처리 규칙(병합·회전·TIFF). Tauri·웹뷰를 모른다
- `src-tauri/src/commands.rs` — 커맨드 정의와 `specta_builder()` 등록 목록
- `src-tauri/src/contract.rs` — 경계 타입 (tauri-specta로 TS 바인딩 생성)
- `src-tauri/src/access.rs`, `files.rs`, `merge.rs`, `jobs.rs` — 경로 검증, 처리
  위임, 취소 토큰
- `src-tauri/capabilities/` — `main` 창 권한
- `src/renderer/shared/platform/` — `DesktopPlatform` 인터페이스와 tauri·mock 구현
- `src/renderer/entities/*/model`, `src/renderer/features/*/model` — Zustand 스토어

## 핵심 원칙

### 경계 흐름

```
React (features/entities 훅)
    ↓ DesktopPlatform (부팅 시 app/providers 에서 주입)
tauri-platform.ts (생성 바인딩의 commands 호출 — 여기서만)
    ↓ Tauri IPC
src-tauri 커맨드 (입력 검증 + spawn_blocking)
    ↓ 공개 API
crates/pdf-core
```

**절대 금지**:
- `shared/platform/tauri-platform.ts` 밖에서 `@tauri-apps/api` import·커맨드 호출
- TS 쪽에 경계 타입·허용 확장자·입력 상한을 손으로 다시 적기 (바인딩에서 가져온다)
- `fs` 플러그인 사용. 파일 접근은 경로를 검증하는 커스텀 커맨드로만
- PDF 바이트를 IPC로 주고받기(`read_pdf` 표시용 제외). 경로를 넘기고 JSON을 받는다
- 커맨드 안의 `unwrap`/`expect`/`panic!`

### 커맨드 추가 절차

1. `pdf-core`에 처리 함수가 필요하면 테스트 먼저(Red → Green) 공개 API로 추가
2. 경계 타입을 `contract.rs`에 정의 (개수·번호는 `u32`, camelCase 직렬화)
3. `commands.rs`에 `#[tauri::command]` + `#[specta::specta]` 함수 —
   허용 경로 검증 후 처리 함수에 넘기고, 무거운 일은 `spawn_blocking`
4. `specta_builder()`의 `collect_commands!`에 등록
5. `cargo test`로 `exports_typescript_bindings`가
   `src/renderer/shared/api/bindings.ts`를 다시 만든다 (손으로 고치지 않는다)
6. `DesktopPlatform`에 메서드 추가 → `tauri-platform.ts`·`mock-platform.ts` 둘 다
   구현(같은 계약, 같은 `{ code, message }` 에러 의미)
7. 플러그인 권한이 필요하면 `pnpm tauri permission add <권한 ID>` (JSON 손편집 금지)

### 명명

- 커맨드: Rust `snake_case` `동사_목적어` (`merge_pdfs`, `open_files`)
- `DesktopPlatform` 메서드: camelCase (`mergePdfs`, `openFiles`)
- 진행률은 `tauri::ipc::Channel`, 바이너리는 `tauri::ipc::Response`
- 오래 걸리는 작업은 프론트가 만든 작업 ID + `cancel_job`

### Zustand 스토어 패턴

```typescript
// src/renderer/entities/{slice}/model/{domain}-store.ts
interface MergeStore {
  files: PdfDocument[];
  addFile: (file: PdfDocument) => void;
}

export const useMergeStore = create<MergeStore>((set) => ({
  files: [],
  addFile: (file) => set((state) => ({ files: [...state.files, file] }))
}));
```

- 업무 스토어는 `shared`에 두지 않는다 (`entities/*/model`, `features/*/model`)
- **상태 업데이트는 항상 새 객체 생성** (직접 변경 금지)
- 상수 객체 + `as const` + `ValueOf<T>`

## 검증

```bash
pnpm typecheck && pnpm lint
cargo fmt --check && cargo clippy --all-targets -- -D warnings
PDFIUM_LIB_PATH=$PWD/src-tauri/pdfium/<target-triple>/<라이브러리 파일> cargo test --workspace
```

앱 창을 띄우지 않는다(`pnpm tauri dev` 금지). 실행 확인이 필요하면
`docs/rules/agent-workflow.md`의 창 숨김 빌드를 쓴다.
