# 테스트 규칙

언제 읽는가: 테스트를 쓰거나 고칠 때, 리팩터링 전에 동작을 고정할 때, 어떤 테스트를 둘지 판단할 때.

- **Rust는 핵심 동작만 테스트한다.** 결과가 바뀌면 깨지는 규칙이 대상이다: 병합(페이지 순서·회전 절대값·북마크), 정보 읽기, TIFF 변환, 비교 엔진(추출·토큰화·diff·연결선 묶기), 경로 검증, 진행률 계산. `crates/pdf-core`와 `src-tauri`의 순수 로직에 적용한다.
- **Rust에서 쓰지 않는 테스트:** 상수 값 확인, 단순 getter, 자명한 enum↔문자열 매핑, 라이브러리(pdfium 등) 자체 동작, 다른 테스트와 같은 것을 다시 확인하는 중복. 「이 테스트를 실패시킬 production 변경」을 한 줄로 말할 수 없으면 쓰지 않는다.
- Rust 핵심 코어는 **Red → Green → Refactor.** 실패하는 테스트를 먼저 쓰고, 통과시키는 최소 코드를 쓰고, 그다음 정리한다. 버그는 재현 테스트부터 쓴다.
- 비교 엔진·연결선 묶기는 golden JSON 픽스처로 Rust에서 검증한다.
- **프론트는 새 단위 테스트(Vitest)를 쓰지 않는다.** 검증은 Playwright E2E로 한다: Vite dev 서버 + `mock-platform` + WebKit 엔진 헤드리스(창이 뜨지 않는다). 어댑터(`tauri-platform.ts`)에도 단위 테스트를 따로 두지 않고 계약 타입과 typecheck로 형태를 맞추고 동작은 E2E로 확인한다.
- 기존 프론트 Vitest(특성 테스트 포함)는 리팩터링 중 동작 고정용으로 유지한다. 대상 코드를 다시 쓰거나 지우는 Step에서 같은 동작을 E2E가 확인하게 되면 그 테스트도 함께 지운다.
- 공개 인터페이스로 테스트한다. 구현 세부(private 함수, 내부 상태)를 테스트하지 않는다.
- 위치: Rust 단위 테스트는 같은 파일 `#[cfg(test)] mod tests`, 통합 테스트는 `crates/*/tests/`, 픽스처는 `crates/pdf-core/tests/fixtures/`, E2E는 `e2e/`. 기존 Vitest는 대상과 같은 폴더의 `__tests__/`에 있다.
- **E2E 실행:** `pnpm test:e2e`. `playwright.config.ts`가 E2E 전용 포트(1430)로 Vite 개발 서버(`pnpm dev:web`)를 띄우고 WebKit 헤드리스 프로젝트 하나로 `e2e/*.spec.ts`를 돈다. 처음 한 번 `pnpm exec playwright install webkit`. 실패하면 `test-results/`에 trace가 남는다(`pnpm exec playwright show-trace <trace.zip>`).
- **E2E 시드·기록:** 브라우저에는 실제 파일이 없으므로 테스트가 `page.addInitScript`로 `window.__E2E_MOCK_SEED__ = { files }`를 넣는다. 파일마다 경로·표시 이름·쪽별 `PageInfo`(크기·원본 회전)·썸네일용 PDF 바이트(base64)를 준다. PDF는 `e2e/fixtures/`의 작은 합성 파일(`crates/pdf-core/tests/fixtures/` 사본)만 쓰고 실제 문서는 쓰지 않는다. 앱은 쓰기 계열 호출(`mergePdfs`·`copyFile`·`discardTemp`)을 위임 전에 `window.__E2E_MOCK_WRITES__`에 기록하고, 테스트는 `page.evaluate`로 읽는다. 구현은 `app/providers/e2e-platform.ts`이고 개발 서버에서만(`import.meta.env.DEV`) 쓰여 프로덕션 번들에는 들어가지 않는다.
- E2E 셀렉터는 역할·접근 가능한 이름(`getByRole`) 우선이고, 없을 때만 `data-testid`를 최소로 둔다(지금은 `document-card`, `page-card`).
