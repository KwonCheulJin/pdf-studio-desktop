# 아키텍처 규칙

언제 읽는가: 새 모듈·슬라이스를 만들거나 파일을 옮길 때, 계층·의존 방향이 헷갈릴 때, 설계 원칙으로 판단이 갈릴 때.

## Clean Architecture

**의존 방향은 바깥 → 안쪽 한 방향이다.**

| 계층 | 위치 | 역할 | 의존해도 되는 것 |
|---|---|---|---|
| 도메인·유스케이스 | `crates/pdf-core`, 프론트의 `**/model`·`shared/lib` 순수 함수 | 병합·회전·TIFF·비교 규칙 | 표준 라이브러리, 순수 crate/패키지만 |
| 어댑터 | `src-tauri`(커맨드·경로 검증·작업 큐), `shared/platform/*-platform.ts` | 바깥 세계 ↔ 도메인 변환 | 도메인 + 프레임워크 API |
| 프레임워크·UI | Tauri 런타임, React 컴포넌트 | 입출력, 화면 | 어댑터 인터페이스 |

- `pdf-core`는 Tauri·웹뷰를 모른다. `cargo test`만으로 검증할 수 있어야 한다.
- 프론트는 `DesktopPlatform` 인터페이스에만 의존한다. `@tauri-apps/api` import는 `shared/platform/tauri-platform.ts`에서만 한다. `window.api`(Electron)는 Step 2에서 없앤다.
- 경계를 넘는 데이터는 계약 타입(`tauri-specta` 생성물)만 쓴다. TS 쪽에 같은 타입을 손으로 복제하지 않는다.
- 프론트는 **파일 경로를 넘기고 결과(JSON)를 받는다.** PDF 바이트는 표시용 읽기(`read_pdf`) 말고는 IPC를 오가지 않는다.

## FSD (renderer)

`app → pages → widgets → features → entities → shared`

- 위 레이어만 아래 레이어를 import한다. 같은 레이어의 다른 슬라이스끼리 import하지 않는다(조합은 상위 레이어에서).
- 슬라이스 밖에서는 슬라이스의 공개 API(`index.ts`)로만 가져온다.
- `entities` = 읽기·표시, `features` = 사용자 행동(생성·수정·삭제), `widgets` = 조합, `pages` = 화면 조립, `app` = 부팅·프로바이더·전역 스타일·모드 스토어.
- `shared`는 도메인을 모른다. 업무 훅·스토어를 `shared`에 두지 않는다(`features/*/model`, `entities/*/model`).
- 세그먼트: `ui/`, `model/`, `lib/`, `api/`, `config/`. 세부 배치는 `docs/06-design-system.md §3`.

## YAGNI + KISS

- 현재 필요한 것만 구현한다. 미래용 코드, 쓰지 않는 옵션·추상화 금지
- Rule of 3: 3번 이상 반복될 때만 추상화
- 단일 컴포넌트 상태는 `useState`, 전역 확대 금지 / 라우터 없이 모드 스토어로 화면 전환
- 조기 최적화 금지. 측정한 병목만 고친다.

## SOLID (이 프로젝트에서의 의미)

- **S** 모듈 하나는 바뀌는 이유 하나. Tauri 커맨드는 입력 검증 + `pdf-core` 위임만, 컴포넌트는 표시만, 로직은 `model`/`lib`
- **O** 새 플랫폼·새 내보내기 형식은 구현을 **추가**해서 늘린다(`DesktopPlatform` 구현체 추가). 기존 분기를 늘리지 않는다.
- **L** `tauri`·`mock` 플랫폼 구현은 같은 계약과 같은 에러 의미(`{ code, message }`)를 지킨다. 테스트에서 바꿔 끼워도 동작이 같아야 한다.
- **I** 인터페이스와 props는 쓰는 쪽이 필요한 만큼만. 거대한 props 객체·만능 훅 금지
- **D** 상위 정책은 추상에 의존한다. UI → `DesktopPlatform`(부팅 시 `app/providers`에서 주입), 커맨드 → `pdf-core` 공개 API
