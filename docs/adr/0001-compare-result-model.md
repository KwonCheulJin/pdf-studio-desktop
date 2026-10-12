# ADR 0001. 비교 결과 모델(`CompareResult`)과 좌표 규칙

- 상태: 채택 (2026-10, Step 16 / 계획서 P2-1, §11 D16)
- 코드: `crates/pdf-core/src/compare/model.rs` (이 문서와 같은 타입만 둔다)
- 관련: 계획서 §6.1(결과 모델), §6.2(파이프라인), §6.4(OCR 신뢰도·확인 필요·좌표 되돌리기), §7.1(연결선)

## 맥락

비교 엔진(Step 17~23)과 비교 화면(Step 24~29)은 따로, 일부는 병렬로 만든다. 둘이 만나는 곳은 결과 모델 하나다.
모델이 흔들리면 golden 픽스처·E2E 시드·화면 코드를 함께 고쳐야 하므로 엔진을 쓰기 전에 고정한다.

계획서 §6.1에는 타입 골격만 있었고 다음이 정해지지 않았다.

- `PageSizes`·`PageSources`·`Notice`의 정의
- CropBox 원점을 누가 보정하는지(박스에 이미 더하는지, 프론트가 `page_sizes`로 보정하는지), `UserUnit` 처리
- 쪽 번호 기준, `page_pair`의 의미, `Change.id` 계산, 변경 정렬 순서
- `min_confidence`·`needs_review`의 정확한 판정, 차이 개수와 따로 세는 방법
- `pdf-core` 타입과 경계 계약 타입의 관계, golden JSON을 위한 serde 도입 여부

비교 범위는 계약서의 ① 텍스트 레이어 비교 ② 스캔본 OCR 비교다. 스타일·레이아웃·이미지는 Phase 5이므로 모델에 그 필드를 두지 않는다.

## 결정

### 1. 타입

`pdf-core`가 공개하는 타입이다. `PageBox`·`PageRotation`은 `info.rs`의 기존 타입을 그대로 쓴다.

```rust
pub enum Side { Before, After }                 // Before = A(왼쪽), After = B(오른쪽)

pub struct TextBox { pub page: u32, pub x: f32, pub y: f32, pub w: f32, pub h: f32 }

pub enum ChangeKind { Insert, Delete, Replace }

pub enum TextSource { TextLayer, Ocr }

pub struct ChangeSide {
    pub text: String,
    pub boxes: Vec<TextBox>,
    pub min_confidence: Option<f32>,
}

pub type PagePair = (Option<u32>, Option<u32>);  // (A 쪽, B 쪽)

pub struct Change {
    pub id: String,
    pub kind: ChangeKind,
    pub before: Option<ChangeSide>,
    pub after: Option<ChangeSide>,
    pub page_pair: PagePair,
    pub needs_review: bool,
}

pub struct PageSize { pub view_box: PageBox, pub rotation: PageRotation }
pub struct PageSizes { pub before: Vec<PageSize>, pub after: Vec<PageSize> }
pub struct PageSources { pub before: Vec<Option<TextSource>>, pub after: Vec<Option<TextSource>> }

pub enum NoTextReason { OcrUnavailable, OcrFailed }

pub enum Notice {
    LowTextConfidence { side: Side, pages: Vec<u32> },
    NoTextLayer { side: Side, reason: NoTextReason, pages: Vec<u32> },
    Truncated { before_pages: Vec<u32>, after_pages: Vec<u32> },
}

pub struct CompareResult {
    pub changes: Vec<Change>,
    pub page_pairs: Vec<PagePair>,
    pub page_sizes: PageSizes,
    pub page_sources: PageSources,
    pub notices: Vec<Notice>,
}
```

번호·개수는 처음부터 `u32`다. 이 모델은 경계 계약의 원형이라 계약 규칙(`usize`·`u64` 금지)을 따르고, 쪽 번호는 pdfium의 `c_int` 범위라 `u32`로 넘치지 않는다. 병합(`MergePage.index: usize` + 계약의 `count()`)과 다르지만 변환 지점을 하나 줄인다.

### 2. 좌표 규칙

| 항목 | 규칙 |
|---|---|
| 단위 | PDF 사용자 공간 단위. `UserUnit`이 1이면 pt(1/72인치)다. `UserUnit`은 곱하지 않는다. |
| 원점·축 | 사용자 공간 원점 그대로. 왼쪽 아래, y는 위로 커진다. |
| 회전 | `/Rotate` 적용 전(사용자 공간 자체). |
| CropBox 원점 | **박스에 이미 들어 있다(절대 사용자 공간 좌표).** 보정은 Rust 한 곳에서 하고, 프론트는 원점을 더하거나 빼지 않는다. |
| 상자 | `x`·`y`는 왼쪽 아래 모서리, `w`·`h`는 0 이상. 축에 나란한 상자다. |

- **텍스트 레이어:** pdfium 글자 상자는 이미 사용자 공간 좌표다. 그대로 쓴다.
- **OCR:** §6.4의 순서(기울기 보정 역변환 → `× 72 / OCR_RENDER_DPI`와 y 뒤집기 → 렌더에 적용된 `/Rotate` 되돌리기 → `view_box.left`·`view_box.bottom` 더하기)로 같은 좌표로 바꾼다. 렌더는 `view_box` 영역이므로 마지막에 더하는 원점이 `view_box`의 왼쪽 아래다.
- **화면 변환:** `page.getViewport({ scale })`(회전 기본값 = 문서의 `/Rotate`)로 만든 viewport의 `convertToViewportRectangle([x, y, x + w, y + h])`를 쓰고, 돌려받은 `[x1, y1, x2, y2]`를 min/max로 정규화한다.
  - pdf.js의 viewBox는 MediaBox가 아니라 `page.view` = CropBox ∩ MediaBox(교집합이 비면 MediaBox)이고, 변환이 이 viewBox의 원점을 뺀다. 그래서 절대 사용자 공간 좌표를 그대로 넣으면 맞는다(pdfjs-dist 5.5 `get view()` 확인).
  - pdfjs-dist 5.x의 viewport는 `scale *= userUnit`을 한다. 박스를 사용자 공간 단위로 두면 `UserUnit ≠ 1`도 viewport 변환이 맞춘다.
  - 화면 좌표를 손으로 쓴 공식(`pageHeight − y` 등)으로 구하지 않는다. CropBox 원점·회전·`UserUnit`을 놓친다. 연결선 끝점(§7.1)도 pt 점을 같은 viewport로 바꾼다.
- **`page_sizes`의 쓰임:** pdf.js가 쪽을 열기 전의 행 크기·가로 판정(회전 90·270이면 너비와 높이를 바꾼다), 비교 PDF 내보내기(P2-8), 좌표 일치 검증(Step 17 E2E에서 pdf.js `page.view`·`page.rotate`와 같은지 확인). 화면 하이라이트 변환에는 필요하지 않다.
- 박스는 `view_box` 밖에 있을 수 있다(모델은 잘라 내지 않는다). 보이지 않는 글자를 추출에서 뺄지는 Step 17이 정한다.

### 3. 쪽 번호와 페이지 쌍

- **쪽 번호는 문서 전체에서 0부터 센다**(`TextBox.page`, `PagePair`, `Notice`의 `pages`, `page_sizes`·`page_sources` 색인). 병합 계약의 `MergePage.index`와 같다. 화면에 보일 때만 1을 더한다. 사용자가 입력하는 페이지 범위 문자열(`"1,3-5"`, P2-6)은 1부터인 별도 입력이다.
- **`PagePair = (A 쪽, B 쪽)`.** `None`은 "그 문서에 짝이 되는 쪽이 없다"는 뜻이다.
- **`CompareResult.page_pairs`:** 화면 행 순서다.
  - 비교 범위의 모든 쪽이 자기 쪽 성분에 정확히 한 번 나온다. `(None, None)`은 없다.
  - 각 쪽의 `Some` 값은 행 순서대로 오름차순이다(짝짓기가 단조 증가 경로라서).
  - 같은 두 짝 사이에 짝 없는 A 쪽과 B 쪽이 함께 있으면 A만 있는 행을 먼저 둔다.
- **`Change.page_pair`:** `(before의 첫 상자 쪽, after의 첫 상자 쪽)`이다. 그 쪽(`before`/`after`)이 없으면 `None`이다. `ChangeSide.boxes`는 비지 않으므로 `page_pair.0.is_some() == before.is_some()`이 늘 성립한다. 변경이 속하는 행은 A 쪽이면 A 쪽 번호로, B 쪽이면 B 쪽 번호로 `page_pairs`에서 찾는다(각 쪽 번호는 한 행에만 있다). 연결선은 두 쪽이 같은 행일 때만 그린다(§7.1).
- **`page_sizes`:** 범위와 상관없이 문서의 모든 쪽, 색인 = 쪽 번호.
- **`page_sources`:** 문서의 모든 쪽, 색인 = 쪽 번호. 비교 범위 밖이라 읽지 않은 쪽만 `None`이다. OCR을 시도했지만 실패한 쪽은 그 쪽의 텍스트 레이어 글자(`OCR_MIN_TEXT_CHARS` 미만, 0개일 수 있다)로 비교하므로 `TextLayer`이고, 실패는 `NoTextLayer` 안내로 알린다. 즉 `TextSource`는 "diff에 실제로 들어간 글자의 출처"다.

### 4. 변경(`Change`)

- **종류와 쪽:** `Insert` = `before: None, after: Some`, `Delete` = `before: Some, after: None`, `Replace` = 둘 다 `Some`.
- **`ChangeSide.text`:** 변경에 걸린 토큰을 공백 하나로 이은 원문 글자다(NFC만 적용, 대소문자·NFKC 옵션은 반영하지 않는다). 화면 목록과 주석 PDF 내용에 쓴다.
- **`ChangeSide.boxes`:** 텍스트 순서이고 비어 있지 않다. 같은 줄에서 이어진 글자 상자는 하나로 합친다. 쪽 경계를 넘는 변경은 상자마다 `page`가 다르다.
  - `Insert`·`Delete`: 걸린 토큰 전체의 글자.
  - `Replace`: 글자 단위 2차 diff에서 실제로 다른 글자만 덮는다. 한쪽에 다른 글자가 없으면(예: `1,000` → `1,0000`의 A 쪽) 그 쪽은 걸린 토큰 전체를 덮는다. 그래야 상자가 비지 않고 연결선이 닿을 곳이 있다.
- **정렬:** `changes`는 diff 순서다. A 토큰열 위치 오름차순이고, A 쪽이 없는 `Insert`는 삽입 지점(앞 공통 토큰 바로 뒤)의 A 위치로 본다. 같은 지점이면 B 토큰열 위치 오름차순이다. 정렬이 행 순서와 같은 방향이므로 화면의 쪽별 묶기는 이 순서를 그대로 쓰고, 번호 태그는 `색인 + 1`이다.
- **`Change.id`(안정 키):** 같은 두 파일·같은 옵션이면 다시 실행해도 같다. 화면 선택 유지, React key, 연결선 `data-change-ids`에 쓴다.
  1. 입력 필드 다섯 개(모두 비교에 실제로 쓴 정규화 토큰 기준. 토큰은 공백으로 나눈 것이라 공백을 품지 않으므로 공백 하나로 잇는다):
     종류 이름(`insert`/`delete`/`replace`), A 쪽 토큰, B 쪽 토큰, 앞 문맥, 뒤 문맥.
     문맥은 변경 바로 앞·뒤의 공통(Equal) 토큰을 `CHANGE_ID_CONTEXT_TOKENS`(3)개까지다. 사이에 다른 변경이 끼면 건너뛰고 공통 토큰만 센다. 문서 처음·끝이면 있는 만큼만 쓴다. 공통 토큰은 양쪽에 같으므로 문맥이 A·B 어느 쪽에서 왔는지 따지지 않는다.
  2. 바이트열: ASCII `pdfstudio.change.v1` 뒤에 각 필드를 `u32` 리틀엔디언 바이트 길이 + UTF-8 바이트로 이어 붙인다(구분자 충돌이 없다).
  3. 해시: SHA-256. 앞 8바이트를 소문자 16진수 16자로 쓴다.
  4. 같은 결과 안에서 키가 겹치면(같은 조항 문구가 반복된 문서) 정렬 순서로 두 번째부터 `-2`, `-3`…을 붙인다. 첫째는 붙이지 않는다.
  - 쪽 번호·좌표·신뢰도는 넣지 않는다. OCR을 다시 하거나 쪽 짝이 바뀌어도 키가 같다. 대소문자 무시 같은 옵션을 바꾸면 정규화 토큰이 바뀌므로 키도 바뀔 수 있다(허용).
  - SHA-256은 `sha2` 크레이트(MIT OR Apache-2.0)로, 쓰는 Step(19)에서 `cargo add -p pdf-core sha2`로 넣는다. OCR 캐시 키(§6.4 파일 SHA-256)와 같은 크레이트다.

### 5. 신뢰도와 "확인 필요"

- **토큰 신뢰도:** OCR 토큰은 구성 글자 신뢰도의 최솟값(0~1). 텍스트 레이어 토큰은 신뢰도가 없다.
- **`ChangeSide.min_confidence`:** 그 쪽에 걸린 토큰 중 OCR 토큰 신뢰도의 최솟값. OCR 토큰이 하나도 없으면(텍스트 레이어만) `None`. 한 변경이 텍스트 레이어 쪽과 OCR 쪽에 걸쳐도 OCR 토큰만 본다. 값은 `[0, 1]`로 자르고 NaN을 넣지 않는다.
- **숫자 토큰:** 정규화 뒤 ASCII 숫자(`0`~`9`)가 하나라도 든 토큰. 전각 숫자는 NFKC 정규화로 ASCII가 된 뒤 판정한다. 한글 수사(일, 이…)는 숫자 토큰이 아니다.
- **기준:** 일반 토큰 `OCR_MIN_CONFIDENCE`(시작값 0.80), 숫자 토큰 `OCR_MIN_CONFIDENCE_NUMERIC`(시작값 0.95). 두 값은 Step 17-a에서 측정 후 확정하고 `pdf-core` 상수로 둔다. "기준 미만"은 `confidence < 기준`이다(같으면 통과).
- **`needs_review = true`** 인 경우(둘 중 하나라도):
  1. 변경의 어느 쪽에든 걸린 OCR 토큰 중 기준 미만이 있다. 문맥 토큰은 보지 않는다.
  2. `Replace`이고, 어느 한쪽에 OCR 토큰이 있고, 두 쪽의 정규화 토큰을 공백 없이 이은 문자열이 같다(띄어쓰기만 다른 치환. 예: `계약 기간` ↔ `계약기간`).
- **세는 방법:** `changes`를 `needs_review`로 둘로 나눈다. 차이 개수 = `needs_review == false`, 확인 필요 개수 = `needs_review == true`. 한 변경이 두 곳에 함께 세어지지 않는다. 결과에 개수 필드를 따로 두지 않고 `changes`에서 센다. 종류 필터는 두 개수에 똑같이 적용한다.

### 6. 안내(`Notice`)

| 종류 | 언제 생기나 | 데이터 |
|---|---|---|
| `LowTextConfidence` | 텍스트 레이어 쪽에서 대체 문자(U+FFFD)·PUA 글자 비율이 기준(`LOW_TEXT_CONFIDENCE_RATIO`, Step 18에서 정한다) 이상. ToUnicode가 깨진 PDF, 스캐너가 넣은 품질 낮은 숨은 글자층. OCR 쪽에는 생기지 않는다(OCR은 `needs_review`로 다룬다). | `side`, `pages` |
| `NoTextLayer` | OCR 대상 쪽(텍스트 레이어 글자 수 `OCR_MIN_TEXT_CHARS` 미만)인데 OCR로 글자를 얻지 못했다. 그 쪽은 텍스트 레이어 글자로 비교했다. | `side`, `reason`(`OcrUnavailable`: 런타임·모델이 없거나 OCR을 넣지 않은 빌드 / `OcrFailed`: 그 쪽의 렌더·추론 실패), `pages` |
| `Truncated` | diff 시간 제한(deadline)을 넘은 앵커 구간을 정밀 diff 대신 구간 통째 `Replace`로 냈다. | `before_pages`, `after_pages`: 그 구간이 걸친 쪽 |

- 쪽마다 하나가 아니라 (종류, `side`, `reason`) 조합마다 하나다. 스캔 500쪽에 OCR이 없을 때 안내가 500개가 되지 않는다.
- `pages`·`before_pages`·`after_pages`는 0부터 센 오름차순, 중복 없음. `LowTextConfidence`·`NoTextLayer`의 `pages`는 비지 않는다. `Truncated`는 한쪽 목록이 빌 수 있다(구간이 한쪽에만 토큰이 있을 때). 비교 범위 밖 쪽에는 안내가 생기지 않는다.
- 정렬: 종류(위 표 순서) → `side`(`Before` 먼저) → `reason`(정의 순서).
- 변경 개수 상한으로 결과를 자르는 일은 하지 않는다(필요해지면 새 변형을 더한다).

### 7. 경계를 넘는 직렬화

- **`pdf-core` 모델에는 지금 serde를 넣지 않는다.** 아직 직렬화하는 곳이 없고, 기존 `info`·`merge` 타입도 serde 없이 둔다.
- **계약 타입은 `src-tauri/src/contract.rs`에 같은 모양으로 따로 둔다(미러 + `From`).** `specta::Type` derive는 어댑터(`src-tauri`) 쪽에만 둔다. `pdf-core`는 Tauri·specta를 모르고, 고아 규칙 때문에 `src-tauri`가 `pdf-core` 타입에 `specta::Type`을 붙일 수도 없다. 비교 커맨드를 여는 Step이 미러를 만든다.
- **계약 JSON 모양**(기존 `contract.rs` 관례):
  - 필드 이름 camelCase(`pageSizes`, `minConfidence`, `needsReview`, `viewBox`, `beforePages`).
  - 단위 enum 값은 camelCase 문자열(`"before"`, `"insert"`, `"textLayer"`, `"ocrUnavailable"`).
  - `Notice`는 `#[serde(tag = "kind", rename_all = "camelCase")]`로 `{ "kind": "noTextLayer", "side": "after", "reason": "ocrUnavailable", "pages": [2, 3] }`.
  - `PagePair`는 두 칸 배열 `[0, null]`(TS `[number | null, number | null]`).
  - `rotation`은 기존 계약 `Rotation`(숫자 0/90/180/270), `viewBox`는 기존 계약 `PageBox`를 재사용한다.
  - `f32` 필드는 `#[specta(type = Number)]`. 좌표는 pdfium·변환이 만든 유한한 값이고 `minConfidence`는 NaN을 넣지 않으므로 JSON `null`이 되지 않는다(`Option`의 `None`만 `null`).
  - 번호·개수는 `u32`.
- **golden JSON:** pdf-core에 serde를 넣는다. 시점은 첫 golden 테스트를 쓰는 Step(17)이다.
  - `cargo add -p pdf-core serde --features derive`, `cargo add -p pdf-core --dev serde_json`(둘 다 MIT OR Apache-2.0).
  - 모델 타입(필요하면 `PageBox`·`PageRotation`까지)에 `Serialize`만 붙인다. `Deserialize`는 두지 않는다. golden 비교는 실제 결과를 `serde_json::Value`로 직렬화해 기대 파일과 비교하고, 실수는 허용 오차로 비교한다.
  - 직렬화 모양은 위 계약 JSON 모양과 **같게** 한다(`rotation`은 숫자). 그래야 Rust golden 파일을 E2E mock 시드로 그대로 쓸 수 있다. 두 모양이 어긋나지 않게 하는 확인은 계약 미러를 만드는 Step이 둔다.

## 결과

- 엔진 Step(17~23)은 이 모델을 출력으로 삼아 따로 진행할 수 있다. 화면 Step은 E2E 시드에 같은 모양 JSON을 쓴다.
- 하이라이트 위치는 pdf.js viewport 변환 하나에만 의존한다. CropBox 오프셋·회전·`UserUnit` 보정 코드가 프론트에 생기지 않는다.
- `changes`를 `needs_review`로 나누는 것만으로 "차이 N · 확인 필요 M"이 나온다.
- 비용: `contract.rs`에 미러 타입과 `From` 변환이 생긴다(병합·정보 타입과 같은 비용). `pdf-core` 직렬화와 계약 직렬화가 같은 모양을 두 번 정의한다.
- 계획서 §6.1은 이 문서를 정본으로 가리킨다. 모델을 바꾸려면 이 ADR을 먼저 고친다(새 ADR로 대체하거나 이 문서의 상태를 바꾼다).

## 대안

| 대안 | 버린 이유 |
|---|---|
| 박스를 CropBox 원점 기준 상대 좌표로 두고 프론트가 `page_sizes`로 보정 | pdf.js `convertToViewportRectangle`은 절대 사용자 공간 좌표를 받는다. 프론트가 원점을 다시 더해야 해 보정 지점이 Rust·TS 두 곳이 된다. |
| 박스를 `/Rotate` 적용 후(화면 방향) 좌표로 | 회전·확대가 바뀌면 다시 계산해야 하고, pdf.js viewport 변환과 이중으로 회전한다. |
| `UserUnit`을 곱한 pt로 저장 | pdf.js viewport가 이미 `userUnit`을 곱하므로 두 번 곱해진다. |
| `page_pair`를 `{ before, after }` 구조체로 | 계획서·§7.1과 이름이 달라지고, TS에서는 `[a, b]` 구조 분해로 충분하다. |
| `Change.id` = 결과 안 순번 | 앞쪽에 변경이 하나 생기면 뒤의 키가 모두 밀려 화면 선택이 풀린다. |
| 해시 = `std::hash::DefaultHasher` | Rust 버전 사이 결과가 같다는 보장이 없다. |
| 해시 = xxHash(`xxhash-rust`) | 라이선스(BSL-1.0)가 화이트리스트 밖이다. |
| `Notice`를 쪽마다 하나씩 | OCR이 없는 스캔본이면 안내가 쪽 수만큼 쌓인다. |
| `TextSource`에 "글자 없음" 변형 추가 | OCR 실패 쪽도 텍스트 레이어 글자로 비교하므로 출처는 늘 둘 중 하나이고, 실패 사실은 `NoTextLayer`가 전한다. 범위 밖만 `None`이라 `None`의 뜻이 하나다. |
| 결과에 차이·확인 필요 개수 필드 | `changes`에서 바로 셀 수 있는 값이라 두 곳이 어긋날 위험만 생긴다. |
| `pdf-core`에 specta derive(기능 플래그) | specta는 경계 어댑터의 관심사다. 기존 계약도 `src-tauri` 미러로 만든다. |
| 스타일·글꼴 차이 필드를 미리 두기 | Phase 5 범위다(YAGNI). 필요해지면 `ChangeKind`·필드를 더하는 새 ADR로 정한다. |
