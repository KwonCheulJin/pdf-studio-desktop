# ADR 0001. 비교 결과 모델(`CompareResult`)과 좌표 규칙

- 상태: 채택 (2026-10, Step 16 / 계획서 P2-1, §11 D16). Step 17이 맡긴 추출 규칙을 §8에, Step 18이 맡긴 정규화·토큰화 규칙을 §9에 더했다.
- 코드: `crates/pdf-core/src/compare/model.rs` (이 문서와 같은 타입만 둔다), 추출은 `crates/pdf-core/src/compare/extract.rs`, 정규화·토큰화는 `crates/pdf-core/src/compare/tokenize.rs`
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
  - pdfjs-dist 5.x의 viewport는 `scale *= userUnit`을 한다. 박스를 사용자 공간 단위로 두면 `UserUnit ≠ 1`도 viewport 변환이 맞춘다. pdfium도 `UserUnit`을 곱하지 않은 사용자 공간 단위로 상자를 준다(Step 17 E2E가 5.5.207에서 `UserUnit 2` 쪽으로 확인).
  - 화면 좌표를 손으로 쓴 공식(`pageHeight − y` 등)으로 구하지 않는다. CropBox 원점·회전·`UserUnit`을 놓친다. 연결선 끝점(§7.1)도 pt 점을 같은 viewport로 바꾼다.
- **`page_sizes`의 쓰임:** pdf.js가 쪽을 열기 전의 행 크기·가로 판정(회전 90·270이면 너비와 높이를 바꾼다), 비교 PDF 내보내기(P2-8), 좌표 일치 검증(Step 17 E2E에서 pdf.js `page.view`·`page.rotate`와 같은지 확인). 화면 하이라이트 변환에는 필요하지 않다.
- 박스는 `view_box` 밖에 있을 수 있다(모델은 잘라 내지 않는다). 추출은 `view_box`와 겹치지 않는 글자를 뺀다(§8).

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
| `LowTextConfidence` | 텍스트 레이어 쪽에서 대체 문자(U+FFFD)·PUA 글자 비율이 기준(`LOW_TEXT_CONFIDENCE_RATIO` = 0.1, §9) 이상. ToUnicode가 깨진 PDF, 스캐너가 넣은 품질 낮은 숨은 글자층. OCR 쪽에는 생기지 않는다(OCR은 `needs_review`로 다룬다). | `side`, `pages` |
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
  - Step 17은 추출 golden이 쓰는 `TextBox`·`PageSize`·`PageBox`·`PageRotation`(`#[serde(into = "u16")]`)과 추출 타입에만 붙였다. 나머지 모델 타입은 처음 직렬화하는 Step(19)이 붙인다.
  - 직렬화 모양은 위 계약 JSON 모양과 **같게** 한다(`rotation`은 숫자). 그래야 Rust golden 파일을 E2E mock 시드로 그대로 쓸 수 있다. 두 모양이 어긋나지 않게 하는 확인은 계약 미러를 만드는 Step이 둔다.

### 8. 텍스트 레이어 추출 (Step 17에서 정함)

공개 API는 `extract_text_layer(engine, path) -> Vec<ExtractedPage>`다(색인 = 쪽 번호). 쪽마다 `size: PageSize`, `chars: Vec<ExtractedChar>`, `needs_ocr`를 낸다. 글자는 `{ ch, glyph: Option<Glyph> }`, `Glyph = { bounds: TextBox, font_size }`다.

| 항목 | 규칙 |
|---|---|
| 상자 | pdfium tight bounds(`FPDFText_GetCharBox`, 글리프 모양에 맞춘 상자)를 그대로 쓴다. CropBox 원점이 들어간 절대 사용자 공간 좌표이고 `/Rotate`·`UserUnit`을 적용하지 않은 값이다. CropBox 오프셋·MediaBox 원점·회전 90/180/270·`UserUnit 2` 쪽 golden(`crates/pdf-core/tests/golden/`)으로 고정했다. |
| `view_box` | pdfium `FPDF_GetPageBoundingBox`(쪽을 열 때 Pages 노드에서 물려받은 값까지 반영해 정규화한 CropBox ∩ MediaBox)다. 넓이가 0이면 pdf.js처럼 MediaBox로 돌아간다. `FPDFPage_GetMediaBox`·`GetCropBox`는 물려받은 상자를 읽지 못하므로 쓰지 않는다. MediaBox를 물려받은 쪽에서 교집합까지 비면 pdfium이 MediaBox를 알려 주지 않아 빈 상자가 남는다(잘못 만든 PDF에서만 생긴다). |
| 보이지 않는 글자 | tight 상자가 `view_box`와 닫힌 구간으로도 겹치지 않으면 뺀다. 겹치면 상자를 자르지 않고 둔다. 화면에 없는 차이는 하이라이트할 곳이 없고, OCR(§6.4)도 `view_box`만 렌더하므로 텍스트 쪽과 스캔 쪽이 같은 글자 집합을 본다. pdf.js `getTextContent()`도 화면 밖 글리프를 빼지만 기준이 다르다(기준선 시작점·전진 폭 기준). 경계에 걸친 글자에서만 다를 수 있다. 렌더 모드 3(숨은 글자층)·흰 글자처럼 겹치지만 안 보이는 글자는 빼지 않는다. |
| 순서 | pdfium 텍스트 페이지 순서. 단 pdfium은 화면 방향(`/Rotate` 적용 후)으로 줄 순서를 정해 `/Rotate 90` 쪽에서 내용상 줄 순서를 뒤집는다. 그래서 메모리 안 문서의 `/Rotate`만 0으로 두고 분석한다(저장하지 않으므로 원본은 그대로, 상자는 사용자 공간이라 그대로). 같은 내용이면 회전과 상관없이, 글자를 돌려 그리고 `/Rotate`로 바로 세운 쪽까지 같은 순서다(`rotation-order.pdf`). |
| 공백·줄바꿈 | 내용 스트림의 공백 글리프는 다른 글자처럼 `glyph`와 함께 낸다(높이가 거의 0인 상자). pdfium이 간격·줄 끝을 보고 만든 글자(줄 끝 `\r` `\n`, 공백 글리프 없이 띄운 단어 사이 공백)는 `glyph: None`이다. 만든 글자도 뺀 글자 사이에 남을 수 있다. 정리(연속 공백·`\r\n` 합치기)는 토큰화(§9)가 하고, 토큰화는 `glyph`가 없는 글자를 경계로만 쓴다. |
| 글자 값 | pdfium 유니코드(`FPDFText_GetUnicode`) 그대로. 유효한 스칼라 값이 아니면 U+FFFD다. pdfium이 다음 줄과 이은 줄 끝 하이픈은 U+0002로 나오고 그 뒤에 줄바꿈 글자가 없다(§9에서 되돌린다). ToUnicode가 깨져 PUA·U+FFFD가 나오는 글꼴은 `LowTextConfidence`(§9)가 다루고, ToUnicode가 아예 없는 글꼴의 엉뚱한 값은 잡지 못한다(§9 한계). |
| `font_size` | 사용자 공간 글꼴 크기 = `Tf` × 글자 행렬(텍스트 행렬 × CTM)의 세로 단위 벡터 길이. pdfium `FPDFText_GetFontSize`는 `Tf` 값만 준다(`Tf 1` + `Tm` 배율 PDF에서 1이 된다). `font_name`은 쓰는 곳(Phase 5 스타일 비교)이 생길 때 더한다. |
| OCR 대상 | 남은 글자 중 `glyph`가 있고 공백이 아닌 글자가 `OCR_MIN_TEXT_CHARS`(32)보다 적으면 `needs_ocr`다. 스캔본에 디지털로 찍힌 쪽 번호·날짜·도장 문구(보통 30자 아래)만으로 텍스트 쪽이 되지 않게 하고, 글자가 적은 텍스트 쪽(서명란)은 OCR로 읽어도 같은 글자가 나와 손해가 작으므로 높은 쪽으로 둔다. Step 19-a가 스캔 픽스처로 다시 본다. |

- golden JSON 모양은 §7 계약 모양(camelCase, `rotation` 숫자, `viewBox`는 계약 `PageBox`)과 같다. E2E(`e2e/text-box-geometry.spec.ts`)가 같은 golden과 픽스처를 읽어, 상자를 `convertToViewportRectangle`로 바꾼 사각형이 pdf.js 텍스트 항목의 화면 사각형 안에 들고 항목 길이를 덮는지, `viewBox`·`rotation`이 `page.view`·`page.rotate`와 같은지 확인한다.
- 한글 픽스처는 IBM Plex Sans KR(OFL-1.1) 서브셋을 임베드한 Identity-H CID 글꼴이다. 임베드하지 않은 CID 글꼴은 pdfium이 시스템 글꼴로 대신 그려 tight 상자가 플랫폼마다 달라지므로 golden에 쓰지 않는다.

### 9. 정규화와 토큰화 (Step 18에서 정함)

공개 API는 `tokenize(pages, options) -> Vec<Token>`과 `has_low_text_confidence(page) -> bool`이다. 옵션은 `NormalizeOptions { form: UnicodeForm(Nfc 기본 | Nfkc), ignore_case }`이고 Step 21의 비교 옵션이 이 구조체를 담는다. 토큰은 `Token { key, text, key_boxes }`다.

| 항목 | 규칙 |
|---|---|
| 토큰 | 단어. `glyph: None`인 글자와 공백 글자(`char::is_whitespace`: 공백 글리프, NBSP, U+3000 포함)가 경계다. 경계가 몇 개 이어져도(연속 공백, 공백 + 만든 `\r\n`) 토큰을 한 번 가를 뿐이라 공백·줄바꿈 정리가 따로 없다. 문장부호는 단어에 붙은 채 둔다(`제3조(대금`). 쪽은 받은 순서로 잇고 쪽 사이는 줄바꿈이다. 공백 글리프(높이 ≈ 0인 상자)는 토큰에 들어가지 않으므로 하이라이트에 쓰이지 않는다. |
| 줄바꿈 | `\r`·`\n`과 쪽 경계. 하이픈 결합에만 쓴다. |
| 하이픈 줄바꿈 | 줄 끝 단어가 하이픈(`-` U+002D, U+2010)으로 끝나고, 하이픈 바로 앞 글자와 다음 줄 첫 단어의 첫 글자가 둘 다 글자·숫자(`char::is_alphanumeric`, 한글 포함)면 두 단어를 한 토큰으로 잇고 **하이픈은 남긴다**: `co-` + `operation` → `co-operation`, `123-45-` + `67890` → `123-45-67890`, 쪽 끝 `갑-` + 다음 쪽 `을` → `갑-을`. 홀로 선 `-`(`별첨 -`)나 다음 줄이 `(`처럼 글자·숫자가 아닌 것으로 시작하면 잇지 않는다. |
| pdfium 줄 끝 하이픈 | pdfium은 문자 뒤 줄 끝 `-`·U+00AD를 U+0002(`FPDFText_IsHyphen`인 글자, 상자는 하이픈 글리프)로 바꾸고 그 뒤 `\r\n`을 내지 않는다. 다음 줄 첫 글자가 대문자·숫자여도 그렇다. 토큰화는 U+0002를 `-` + 줄바꿈으로 되돌린 뒤 위 규칙을 쓴다. 그래서 텍스트 레이어와 OCR(하이픈 + 줄바꿈으로 들어온다) 결과가 같다. U+00AD였는지는 알 수 없어 `-`로 둔다. |
| 정규화 | 비교 키 `key` = 옵션 형식(NFC 기본, NFKC) → `ignore_case`면 `char::to_lowercase`. 원문 `text` = NFC만(대소문자 그대로, `ChangeSide.text` 재료). 방법: 원본 글자마다 분해(NFC는 정준, NFKC는 호환 분해)해 분해 글자에 원본 상자를 붙이고, 클러스터(결합 순서 0인 글자 + 뒤따르는 결합 글자·한글 중성/종성 자모 U+1160–11FF, U+D7B0–D7FF)마다 정준 합성한다. |
| 키 글자 ↔ 상자 | `key_boxes[i]`는 `key`의 i번째 글자 상자이고 개수가 늘 같다. 한 클러스터가 낸 키 글자는 모두 그 클러스터 원본 글자 상자들을 합친 상자를 쓴다. 글자가 늘면(NFKC `㈜` → `(주)`, `™` → `TM`) 같은 상자가 여러 번 나오고, 줄면(자모 `ᄀ`+`ᅡ` → `가`, `e`+U+0301 → `é`) 합친 상자 하나가 된다. 겹친 상자는 같은 줄 상자 병합(Step 19)이 하나로 만든다. 글자 단위 2차 diff는 키 글자 색인으로 상자를 찾는다. |
| 토큰 신뢰도 | 아직 두지 않는다. OCR 연결(Step 19-a)이 `ExtractedChar`에 글자 신뢰도를, `Token`에 구성 글자 신뢰도 최솟값(§5)을 더한다. 하이픈 결합·정규화는 원본 글자를 버리지 않으므로(모든 원본 글자가 한 토큰의 한 클러스터에 들어간다) 최솟값을 그대로 셀 수 있다. |
| `LowTextConfidence` 판정 | 쪽에서 `glyph`가 있고 공백이 아닌 글자 중 U+FFFD·PUA(U+E000–F8FF, 15·16 평면) 비율이 `LOW_TEXT_CONFIDENCE_RATIO`(0.1) 이상이면 대상이다. 그런 글자가 없는 쪽은 아니다. 안내를 붙일 쪽(출처가 텍스트 레이어이고 비교 범위 안인 쪽)은 결과를 만드는 Step이 고른다. |

- `LOW_TEXT_CONFIDENCE_RATIO` 근거: ToUnicode가 깨진 글꼴은 그 글꼴로 쓴 글자를 거의 모두 PUA·U+FFFD로 내므로 본문 글꼴이 깨지면 비율이 1에 가깝다. 정상 문서의 기호 글꼴(체크박스·글머리표) PUA는 줄마다 한두 글자라 보통 몇 % 안이다(실제 문서로 잰 값이 아니라 추정이다. 오탐이 보이면 다시 정한다). 10%면 한글 단어(3~4자) 서너 개 중 하나에 깨진 글자가 끼어 비교 결과를 믿기 어렵다.
- 한계: ToUnicode가 아예 없는 CID 글꼴은 pdfium이 글자 코드를 그대로 유니코드로 내 엉뚱한 ASCII가 되므로 이 비율로 잡히지 않는다(Step 18 작업 중 임시 픽스처로 확인했다). pdfium `FPDFText_HasUnicodeMapError`가 신호가 될 수 있지만 pdfium-render 0.9.4는 이 함수를 글자 API로 내주지 않는다.
- 한계: 줄 끝 하이픈을 남기므로 조판 프로그램이 자동으로 넣은 하이픈(`inter-` + `national`)은 한 줄 판 `international`과 다른 토큰이 된다. 계약서 원본(워드·한글)은 자동 하이픈이 기본으로 꺼져 있어 줄 끝 하이픈은 대개 진짜 하이픈(복합어, 사업자등록번호·전화번호·날짜)이다.
- 한계: 한글을 글자 단위로 줄바꿈해 단어 중간에서 하이픈 없이 줄이 바뀐 경우는 잇지 않는다. 줄 끝이 단어 끝인지 알 수 없다.
- golden: `crates/pdf-core/tests/golden/tokenize-korean.tokens.json`(기본 옵션)·`tokenize-korean.nfkc-ignore-case.tokens.json`, 픽스처 `tokenize-korean.pdf`.

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
| (§8) `view_box` 밖 글자도 추출 | 화면에 없는 글자의 차이는 하이라이트·연결선을 둘 곳이 없고, OCR 쪽은 `view_box`만 읽어 텍스트 쪽과 글자 집합이 달라진다. |
| (§8) pdfium 기본 순서(화면 방향) 그대로 | `/Rotate`만 바꾼 쪽(이 앱의 병합 회전 포함)과 원본을 비교하면 줄 순서가 뒤집혀 차이가 생긴다. |
| (§8) 만든 공백·줄바꿈을 버리기 | 공백 글리프 없이 단어를 띄워 놓은 PDF(한글 문서에 흔하다)에서 단어가 붙고, 줄 끝 단어와 다음 줄 첫 단어가 붙는다. pdfium의 줄·간격 판단을 다시 만들 이유가 없다. |
| (§9) 줄 끝 하이픈을 지우고 잇기(pdfium 방식) | 계약서의 줄 끝 하이픈은 대개 진짜 하이픈이라 `self-employed`·`123-45-67890`이 한 줄 판과 달라진다. 숫자 뒤 하이픈만 잇지 않으면 날짜·번호가 줄 위치에 따라 둘로 갈린다. |
| (§9) pdfium이 이은 결과를 그대로 쓰기 | 하이픈을 지우고, 대문자·숫자 앞에서도 이으며, OCR 글자에는 없는 동작이라 텍스트 쪽과 스캔 쪽 토큰이 달라진다. |
| (§9) 토큰 전체를 한 번에 정규화 | 키 글자와 원본 글자 상자를 짝지을 수 없다. |
| (§9) 원본 글자마다 따로 정규화 | 자모·결합 문자가 합쳐지지 않아 NFC가 되지 않는다. |
| (§9) 늘어난 키 글자에 원본 상자를 나눠 붙이기(`㈜` 상자를 3등분) | 글리프 모양과 상관없는 좌표가 생긴다. 하이라이트는 원본 글자 단위면 충분하다. |
| (§8) loose bounds(글꼴 상자 높이) | 계획서 §6.2가 tight를 기본으로 정했다. 하이라이트가 글자 모양에 붙고 줄 사이가 겹치지 않는다. |
