# ADR 0001. 비교 결과 모델(`CompareResult`)과 좌표 규칙

- 상태: 채택 (2026-10, Step 16 / 계획서 P2-1, §11 D16). Step 17이 맡긴 추출 규칙을 §8에, Step 18이 맡긴 정규화·토큰화 규칙을 §9에, Step 19-a가 맡은 OCR 연결 규칙을 §11에, Step 20이 맡은 페이지 짝짓기 규칙을 §12에, Step 21이 맡긴 비교 옵션 규칙을 §13에, Step 23이 맡은 리포트 내보내기 규칙을 §14에(Step 28이 연결선을 더했다), Step 22가 맡은 작업 실행기(진행률·취소·추출 캐시) 규칙을 §15에, Step 26이 맡은 비교 커맨드(계약 미러·에러 코드·OCR 엔진 상태) 규칙을 §16에, Step 29가 맡은 리포트 커맨드를 §17에 더했다. Step 28-b가 변경의 두 쪽을 `Placement`(상자 | 앵커)로 바꾸고 앵커 규칙을 §4에 더했다(계획서 §7.1 사용자 명세, 2026-10-13). Step 28-c가 연결선을 변경마다 하나(앵커 포함)로 다시 만들고 비교 PDF 연결선·삭제 메모를 §14에서 바꿨다.
- 코드: `crates/pdf-core/src/compare/model.rs` (이 문서와 같은 타입만 둔다), 추출은 `crates/pdf-core/src/compare/extract.rs`, 정규화·토큰화는 `crates/pdf-core/src/compare/tokenize.rs`, 앵커는 `crates/pdf-core/src/compare/anchors.rs`, 연결선 끝·모양은 `crates/pdf-core/src/compare/connectors.rs`(계획서 §7.1)
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

pub enum Placement {                             // 변경의 한쪽이 그 문서에 놓이는 곳(§4)
    Boxes { text: String, boxes: Vec<TextBox>, min_confidence: Option<f32> },  // 그 쪽에 글자가 있다
    Anchor { page: u32, x: f32, y: f32, h: f32 },                              // 글자가 없다: 들어갈 자리
}

pub type PagePair = (Option<u32>, Option<u32>);  // (A 쪽, B 쪽)

pub struct Change {
    pub id: String,
    pub kind: ChangeKind,
    pub before: Placement,
    pub after: Placement,
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

Step 28-b 전에는 두 쪽이 `Option<ChangeSide>`(`ChangeSide { text, boxes, min_confidence }`, 없는 쪽은 `None`)였다. `Boxes`가 그 필드를 그대로 갖고, 없던 쪽은 앵커가 됐다.

번호·개수는 처음부터 `u32`다. 이 모델은 경계 계약의 원형이라 계약 규칙(`usize`·`u64` 금지)을 따르고, 쪽 번호는 pdfium의 `c_int` 범위라 `u32`로 넘치지 않는다. 병합(`MergePage.index: usize` + 계약의 `count()`)과 다르지만 변환 지점을 하나 줄인다.

### 2. 좌표 규칙

| 항목 | 규칙 |
|---|---|
| 단위 | PDF 사용자 공간 단위. `UserUnit`이 1이면 pt(1/72인치)다. `UserUnit`은 곱하지 않는다. |
| 원점·축 | 사용자 공간 원점 그대로. 왼쪽 아래, y는 위로 커진다. |
| 회전 | `/Rotate` 적용 전(사용자 공간 자체). |
| CropBox 원점 | **박스에 이미 들어 있다(절대 사용자 공간 좌표).** 보정은 Rust 한 곳에서 하고, 프론트는 원점을 더하거나 빼지 않는다. |
| 상자 | `x`·`y`는 왼쪽 아래 모서리, `w`·`h`는 0 이상. 축에 나란한 상자다. |
| 앵커 | 같은 좌표의 세로 막대: (`x`, `y`)부터 (`x`, `y + h`)까지, `h`는 0 이상. 너비 0인 상자와 같은 뜻이다(§4). |

- **텍스트 레이어:** pdfium 글자 상자는 이미 사용자 공간 좌표다. 그대로 쓴다.
- **OCR:** §6.4의 순서(기울기 보정 역변환 → `× 72 / OCR_RENDER_DPI`와 y 뒤집기 → 렌더에 적용된 `/Rotate` 되돌리기 → `view_box.left`·`view_box.bottom` 더하기)로 같은 좌표로 바꾼다. 렌더는 `view_box` 영역이므로 마지막에 더하는 원점이 `view_box`의 왼쪽 아래다.
- **화면 변환:** `page.getViewport({ scale })`(회전 기본값 = 문서의 `/Rotate`)로 만든 viewport의 `convertToViewportRectangle([x, y, x + w, y + h])`를 쓰고, 돌려받은 `[x1, y1, x2, y2]`를 min/max로 정규화한다.
  - pdf.js의 viewBox는 MediaBox가 아니라 `page.view` = CropBox ∩ MediaBox(교집합이 비면 MediaBox)이고, 변환이 이 viewBox의 원점을 뺀다. 그래서 절대 사용자 공간 좌표를 그대로 넣으면 맞는다(pdfjs-dist 5.5 `get view()` 확인).
  - pdfjs-dist 5.x의 viewport는 `scale *= userUnit`을 한다. 박스를 사용자 공간 단위로 두면 `UserUnit ≠ 1`도 viewport 변환이 맞춘다. pdfium도 `UserUnit`을 곱하지 않은 사용자 공간 단위로 상자를 준다(Step 17 E2E가 5.5.207에서 `UserUnit 2` 쪽으로 확인).
  - 화면 좌표를 손으로 쓴 공식(`pageHeight − y` 등)으로 구하지 않는다. CropBox 원점·회전·`UserUnit`을 놓친다. 연결선 끝점(§7.1)도 pt 점을 같은 viewport로 바꾼다.
- **`page_sizes`의 쓰임:** pdf.js가 쪽을 열기 전의 행 크기·가로 판정(회전 90·270이면 너비와 높이를 바꾼다), 비교 PDF 내보내기(P2-8), 좌표 일치 검증(Step 17 E2E에서 pdf.js `page.view`·`page.rotate`와 같은지 확인). 화면 하이라이트 변환에는 필요하지 않다.
- 박스는 `view_box` 밖에 있을 수 있다(모델은 잘라 내지 않는다). 추출은 `view_box`와 겹치지 않는 글자를 뺀다(§8).

### 3. 쪽 번호와 페이지 쌍

- **쪽 번호는 문서 전체에서 0부터 센다**(`TextBox.page`, `PagePair`, `Notice`의 `pages`, `page_sizes`·`page_sources` 색인). 병합 계약의 `MergePage.index`와 같다. 화면에 보일 때만 1을 더한다. 사용자가 입력하는 페이지 범위 문자열(`"1,3-5"`, P2-6)은 1부터인 별도 입력이고 §13이 0부터 센 목록으로 바꾼다.
- **`PagePair = (A 쪽, B 쪽)`.** `None`은 "그 문서에 짝이 되는 쪽이 없다"는 뜻이다.
- **`CompareResult.page_pairs`:** 화면 행 순서다.
  - 비교 범위의 모든 쪽이 자기 쪽 성분에 정확히 한 번 나온다. `(None, None)`은 없다.
  - 각 쪽의 `Some` 값은 행 순서대로 오름차순이다(짝짓기가 단조 증가 경로라서).
  - 같은 두 짝 사이에 짝 없는 A 쪽과 B 쪽이 함께 있으면 A만 있는 행을 먼저 둔다.
  - 짝짓기(매칭 행렬, 단조 최대 가중 경로, 동률, 빈 쪽·짝 없는 쪽)는 §12다.
- **`Change.page_pair`:** `(before의 첫 상자 쪽, after의 첫 상자 쪽)`이다. 그 쪽이 앵커면 `None`이다(앵커의 쪽은 `Anchor.page`). `Boxes.boxes`는 비지 않으므로 `page_pair.0.is_some() == (before가 Boxes)`가 늘 성립한다. Step 28-b에서 앵커를 더할 때 이 뜻을 바꾸지 않았다(행 찾기·쪽별 묶기·Step 28 연결선이 그대로 쓴다). 변경이 속하는 행은 A 쪽이면 A 쪽 번호로, B 쪽이면 B 쪽 번호로 `page_pairs`에서 찾는다(각 쪽 번호는 한 행에만 있다). Step 28 연결선은 두 쪽이 같은 행일 때만 그렸다. Step 28-c부터는 앵커를 포함해 모든 변경을 잇고, 끝의 쪽은 `page_pair`가 아니라 각 쪽 끝(글자 쪽 첫 상자의 쪽, 앵커는 `Anchor.page`)에서 읽는다(계획서 §7.1).
- **`page_sizes`:** 범위와 상관없이 문서의 모든 쪽, 색인 = 쪽 번호.
- **`page_sources`:** 문서의 모든 쪽, 색인 = 쪽 번호. 비교 범위 밖이라 읽지 않은 쪽만 `None`이다. OCR을 시도했지만 실패한 쪽은 그 쪽의 텍스트 레이어 글자(`OCR_MIN_TEXT_CHARS` 미만, 0개일 수 있다)로 비교하므로 `TextLayer`이고, 실패는 `NoTextLayer` 안내로 알린다. 즉 `TextSource`는 "diff에 실제로 들어간 글자의 출처"다.

### 4. 변경(`Change`)

- **종류와 쪽:** `Insert` = `before: Anchor, after: Boxes`, `Delete` = `before: Boxes, after: Anchor`, `Replace` = 둘 다 `Boxes`.
- **`Boxes.text`:** 변경에 걸린 토큰을 공백 하나로 이은 원문 글자다(NFC만 적용, 대소문자·NFKC 옵션은 반영하지 않는다). 화면 목록과 주석 PDF 내용에 쓴다.
- **`Boxes.boxes`:** 텍스트 순서이고 비어 있지 않다. 같은 줄에서 이어진 글자 상자는 줄 단위 사각형 하나로 합친다(같은 줄 판정·2단 나누기·중복 없애기는 §10). 쪽 경계를 넘는 변경은 상자마다 `page`가 다르다.
  - `Insert`·`Delete`: 걸린 토큰 전체의 글자.
  - `Replace`: 글자 단위 2차 diff에서 실제로 다른 글자만 덮는다. 한쪽에 다른 글자가 없으면(예: `1,000` → `1,0000`의 A 쪽) 그 쪽은 걸린 토큰 전체를 덮는다. 그래야 상자가 비지 않고 연결선이 닿을 곳이 있다. 시간 제한 때문에 통째로 낸 `Replace`는 양쪽 모두 토큰 전체를 덮는다(§6).
- **정렬:** `changes`는 diff 순서다. A 토큰열 위치 오름차순이고, A 쪽이 없는 `Insert`는 삽입 지점(앞 공통 토큰 바로 뒤)의 A 위치로 본다. 같은 지점이면 B 토큰열 위치 오름차순이다. 정렬이 행 순서와 같은 방향이므로 화면의 쪽별 묶기는 이 순서를 그대로 쓰고, 번호 태그는 `색인 + 1`이다.
- **`Change.id`(안정 키):** 같은 두 파일·같은 옵션이면 다시 실행해도 같다. 화면 선택 유지, React key, 연결선 `data-change-ids`에 쓴다.
  1. 입력 필드 다섯 개(모두 비교에 실제로 쓴 정규화 토큰 기준. 토큰은 공백으로 나눈 것이라 공백을 품지 않으므로 공백 하나로 잇는다):
     종류 이름(`insert`/`delete`/`replace`), A 쪽 토큰, B 쪽 토큰, 앞 문맥, 뒤 문맥.
     문맥은 변경 바로 앞·뒤의 공통(Equal) 토큰을 `CHANGE_ID_CONTEXT_TOKENS`(3)개까지 문서 순서로 이은 것이다. 사이에 다른 변경이 끼면 건너뛰고 공통 토큰만 센다. 띄어쓰기만 달라 변경으로 내지 않은 묶음(§10)도 양쪽 토큰이 달라 공통 토큰이 아니므로 건너뛴다. 문서 처음·끝이면 있는 만큼만 쓴다. 공통 토큰은 양쪽에 같으므로 문맥이 A·B 어느 쪽에서 왔는지 따지지 않는다.
  2. 바이트열: ASCII `pdfstudio.change.v1` 뒤에 각 필드를 `u32` 리틀엔디언 바이트 길이 + UTF-8 바이트로 이어 붙인다(구분자 충돌이 없다).
  3. 해시: SHA-256. 앞 8바이트를 소문자 16진수 16자로 쓴다.
  4. 같은 결과 안에서 키가 겹치면(같은 조항 문구가 반복된 문서) 정렬 순서로 두 번째부터 `-2`, `-3`…을 붙인다. 첫째는 붙이지 않는다.
  - 쪽 번호·좌표·신뢰도는 넣지 않는다. OCR을 다시 하거나 쪽 짝이 바뀌어도 키가 같다. 대소문자 무시 같은 옵션을 바꾸면 정규화 토큰이 바뀌므로 키도 바뀔 수 있다(허용).
  - SHA-256은 `sha2` 크레이트(MIT OR Apache-2.0)로, 쓰는 Step(19)에서 `cargo add -p pdf-core sha2`로 넣는다. OCR 캐시 키(§6.4 파일 SHA-256)와 같은 크레이트다.
- **앵커(`Placement::Anchor`, Step 28-b):** 한쪽에만 있는 변경(삽입의 `before`, 삭제의 `after`)이 반대쪽 문서에서 들어갈 자리다. 연결선(계획서 §7.1)이 상자와 이 점을 잇는다. 코드는 `anchors.rs`다.

  | 경우 | 앵커 |
  |---|---|
  | 반대쪽 토큰열에서 변경 바로 앞 토큰이 있음 | 그 토큰 마지막 줄 상자의 오른쪽 끝: `x` = 오른쪽 변, `y` = 아래 변, `h` = 높이 |
  | 앞 토큰이 없음(문서 맨 앞) | 바로 뒤 토큰 첫 줄 상자의 왼쪽 끝: `x` = 왼쪽 변, `y`·`h`는 위와 같다 |
  | 반대쪽 토큰이 하나도 없음 | 쪽 짝으로 고른 반대쪽 쪽의 여백(아래 "빈 쪽") |
  | 앞 토큰이 줄(쪽) 끝이고 뒤 토큰이 다음 줄(쪽) 시작 | 앞 토큰이 늘 이긴다: 앞 줄 끝, 앞 쪽 끝 |

  - **위치:** 변경이 반대쪽 토큰열에 들어갈 자리는 diff 구간의 빈 범위다(`Insert`면 A 범위 `p..p`, 앞 토큰 = A `p − 1`, 뒤 토큰 = A `p`). 앞·뒤 토큰은 늘 공통 토큰이다: 공통 토큰 사이의 가장 긴 묶음 하나가 구간 하나라(§10 "변경") 사이에 공통 토큰이 없는 두 구간은 하나로 합쳐지고, 구간 사이에는 양쪽 모두 공통 토큰이 하나 이상 있다. 띄어쓰기만 다른 묶음도 구간이라 같다.
  - **토큰열:** diff에 넣은 것 그대로다(쪽 범위 선택·줄 제외 뒤, §13). 그래서 뺀 머리말·쪽번호 줄이나 범위 밖 쪽에는 앵커가 놓이지 않는다. 짝 쪽이 빈 쪽이어도 반대쪽 다른 쪽에 토큰이 있으면 위 표의 이웃 토큰을 쓴다(앞 쪽 끝).
  - **줄 상자:** 이웃 토큰의 글자 상자를 같은 줄 병합(§10 `continues_line`)으로 합친 상자다. 토큰이 하이픈으로 줄·쪽을 넘으면 앞 토큰은 마지막 줄, 뒤 토큰은 첫 줄 상자를 쓴다.
  - **기준선 근사:** 명세의 `y`는 기준선, `h`는 글자 높이다. 추출(§8)은 tight 상자와 글꼴 크기만 내고 기준선(pdfium `FPDFText_GetCharOrigin`)은 내지 않는다. 기준선을 더하려면 추출 golden·토큰 모양·OCR 경로(OCR에는 기준선이 없다)를 함께 바꿔야 하므로 더하지 않고, 줄 상자 아래 변을 기준선으로, 줄 상자 높이를 글자 높이로 쓴다. 이웃 토큰에 아래로 내려가는 글자(`,`·`g` 등)가 있으면 `y`는 기준선보다 1~2pt 아래다. 연결선 끝점(막대 가운데, 계획서 §7.1)은 그래서 기준선 + 글자 높이의 반이 아니라 줄 상자의 세로 가운데이고, 화면에서 그 줄 글자의 가운데에 붙는다.
  - **회전 쪽은 사용자 공간 기준:** "오른쪽 끝·왼쪽 끝"과 막대 방향은 사용자 공간(`/Rotate` 적용 전)으로 본다. 근거: ① 앵커는 결과 모델의 다른 좌표처럼 사용자 공간 값이고 화면은 viewport 변환 하나로 바꾼다(§2). 화면 방향으로 정하면 `{x, y, h}` 하나로 화면 세로 막대를 나타낼 수 없다(90·270 쪽은 화면 세로가 사용자 공간 가로다). ② 앵커가 기대는 줄 상자가 사용자 공간 같은 줄 병합(§10)에서 나온다. ③ 쪽을 `/Rotate`로만 돌린 쪽(글자를 사용자 공간에서 가로로 그린 쪽, 병합 회전으로 눕힌 쪽)은 사용자 공간 오른쪽이 곧 글 흐름의 끝이다. Step 28 연결선의 읽는 순서는 "어느 변경이 화면에서 위인가"라 화면 방향으로 봤고, 앵커는 "낱말이 글 흐름에서 어디서 끝나는가"라 묻는 것이 다르다. 한계: 글자를 돌려 그리고 `/Rotate`로 세운 쪽(돌린 스캔의 OCR 글자 포함)은 글 흐름이 사용자 공간 세로라 앵커가 마지막 글자의 화면 아래(90) 또는 위(270) 변 가운데에 놓인다. 이상적인 자리(화면 오른쪽 변)에서 글자 하나 크기 안이고, §10 같은 줄 병합 한계와 원인(글 흐름 방향을 모른다)이 같다.
  - **빈 쪽:** 반대쪽 비교 범위에 토큰이 하나도 없으면(빈 쪽·글자 없는 스캔 쪽만 비교) 공통 토큰이 없어 구간과 변경이 하나뿐이다. 그 변경 첫 상자의 쪽으로 `page_pairs`(§3·§12. 공통 토큰 짝이 없으니 diff 안에서 다시 센 행이 결과의 행과 같다)에서 행을 찾아 ① 그 행에 반대쪽 쪽이 있으면 그 쪽의 위 여백, ② 없으면 앞 행 중 가장 가까운 반대쪽 쪽의 아래 여백, ③ 앞 행에도 없으면 뒤 행 중 가장 가까운 반대쪽 쪽의 위 여백에 둔다. 글자가 없어 글 흐름이 없으므로 여백은 화면 방향(`/Rotate` 적용, §13 밴드와 같다)으로 정한다: 막대 가운데가 `view_box` 화면 왼쪽 가장자리에서 `EMPTY_PAGE_ANCHOR_INSET_PT`(72pt, 워드 기본 여백 = 본문 첫 줄 자리) 안쪽이고, 위 여백이면 막대 위 끝이 화면 위에서 72pt 아래, 아래 여백이면 막대 아래 끝이 화면 아래에서 72pt 위다(쪽이 144pt보다 작으면 그 방향 가운데). `h`는 변경 첫 상자 높이다. 사용자 공간 막대는 세로라 90·270 쪽에서는 화면에서 가로로 놓이지만 가운데는 같다.
  - **놓을 쪽이 없음:** 반대쪽 비교 범위에 쪽이 하나도 없으면(쪽이 0개인 PDF. pdfium은 `/Count 0` 문서도 연다) 앵커는 쪽 0, 원점, `h = 0`이다. 그 쪽은 `page_sizes`에 없으므로 화면·내보내기는 그리지 않는다.
  - **테스트:** `tests/compare_placement.rs`(픽스처 `placement-a.pdf`·`placement-b.pdf`·`placement-blank.pdf`, golden `placement.changes.json`)가 문서 맨 앞·줄 가운데·줄 경계·쪽 경계·문서 맨 끝 삽입과 줄 가운데 삭제의 앵커를 추출 글자로 따로 세운 이웃 낱말 상자와 맞대고, 빈 쪽 ①②③을 실행기 결과로 본다. 회전 쪽 여백과 "가장 가까운"·앞 행 우선은 `anchors.rs` 단위 테스트다.
  - **버린 대안:** 없는 쪽을 `None`으로 두고 화면이 근사(Step 28-c 전 주석 PDF 삭제 메모처럼 쪽 비율로 옮기기) — 줄 배치가 다른 두 판에서 엉뚱한 줄을 가리킨다. 화면 방향으로 정하기 — 위 ①·③. 짝 쪽 안의 이웃 토큰만 보기(짝 쪽에 공통 토큰이 없으면 여백) — 명세는 토큰열의 이웃이고, 쪽 경계에 들어간 변경은 앞 쪽 끝이 들어갈 자리에 가깝다. 기준선을 추출에 더하기 — 위 "기준선 근사".

### 5. 신뢰도와 "확인 필요"

- **토큰 신뢰도:** OCR 토큰은 구성 글자 신뢰도의 최솟값(0~1). 텍스트 레이어 토큰은 신뢰도가 없다. OCR 글자가 하나라도 든 토큰(쪽 경계 하이픈 결합으로 섞인 토큰 포함)이 OCR 토큰이다.
- **`Boxes.min_confidence`:** 그 쪽에 걸린 토큰 중 OCR 토큰 신뢰도의 최솟값. OCR 토큰이 하나도 없으면(텍스트 레이어만) `None`. 한 변경이 텍스트 레이어 쪽과 OCR 쪽에 걸쳐도 OCR 토큰만 본다. 값은 `[0, 1]`로 자르고 NaN을 넣지 않는다.
- **숫자 토큰:** 정규화 뒤 ASCII 숫자(`0`~`9`)가 하나라도 든 토큰. 전각 숫자는 NFKC 정규화로 ASCII가 된 뒤 판정한다. 한글 수사(일, 이…)는 숫자 토큰이 아니다.
- **숫자 토큰 OCR 판정(Step 17-a 합격 기준):** 숫자 토큰을 맞게 읽었는지는 토큰 끝의 `.`·`,`를 뺀 부분이 같은지로 본다(2026-10-13 사용자 결정). 끝 문장부호만 다른 차이는 아래 규칙 3으로 확인 필요가 되어 차이로 세지지 않기 때문이다. 근거는 계획서 §6.4 「P2-2a 스파이크 결과」.
- **기준:** 일반 토큰 `OCR_MIN_CONFIDENCE` = 0.80, 숫자 토큰 `OCR_MIN_CONFIDENCE_NUMERIC` = 0.95. Step 17-a에서 측정해 시작값 그대로 확정했고 `pdf-core` 상수로 둔다. "기준 미만"은 `confidence < 기준`이다(같으면 통과).
- **`needs_review = true`** 인 경우(아래 중 하나라도):
  1. 변경의 어느 쪽에든 걸린 OCR 토큰 중 기준 미만이 있다. 문맥 토큰은 보지 않는다.
  2. `Replace`이고, 어느 한쪽에 OCR 토큰이 있고, 두 쪽의 정규화 토큰을 공백 없이 이은 문자열이 같다(띄어쓰기만 다른 치환. 예: `계약 기간` ↔ `계약기간`).
  3. `Replace`이고, 어느 한쪽에 OCR 토큰이 있고, 두 쪽의 정규화 토큰을 공백 없이 잇고 문장부호(유니코드 일반 범주 P\*: Pc·Pd·Ps·Pe·Pi·Pf·Po)를 뺀 문자열이 같다(문장부호만, 또는 문장부호와 띄어쓰기만 다른 치환. 예: `8,900원이다.` ↔ `8,900원이다`, `“계약”` ↔ `"계약"`). 2026-10-13 사용자 결정이다. OCR은 끝 마침표·쉼표를 높은 신뢰도로 빠뜨리고 따옴표·괄호 모양을 바꿔 읽는데, 빠진 글자에는 신뢰도가 없어 규칙 1로 잡히지 않는다(계획서 §6.4 측정). 일반 범주는 `unicode-properties` 크레이트(MIT OR Apache-2.0, `general-category` 기능, Step 19-a에서 정식 의존성)로 판정한다. 기호(S\*: `%`, `₩` 등)는 문장부호가 아니므로 빼지 않는다.
  4. `Insert`·`Delete`이고, 걸린 토큰이 모두 OCR 토큰이며 모두 문장부호(P\*)다(OCR이 `.`·`,`를 따로 떨어진 토큰으로 높은 신뢰도로 읽은 경우). 규칙 3의 취지(2026-10-13 사용자 결정)를 삽입·삭제로 넓힌 것이다(Step 22). 텍스트 레이어 토큰의 문장부호 삽입·삭제는 그대로 차이다.
- **OCR 쪽이 있는 비교의 정규화:** 어느 쪽이든 출처가 OCR인 쪽이 하나라도 있으면 두 문서 모두 `NormalizeOptions.form = Nfkc`(§9)로 토큰화한다. 사용자 옵션이 NFC여도 강제한다(2026-10-13 사용자 결정). OCR은 원문자 번호(`②`)·전각 문자를 일반 문자(`2`)로 읽으므로, NFC로 두면 텍스트 레이어 쪽과 거짓 차이가 난다(계획서 §6.4 로컬 측정: NFKC 없이 숫자 토큰 조용한 오인식 43건 → NFKC로 0건). 위 규칙 2·3의 "정규화 토큰"도 이 NFKC 키다. 강제는 두 문서를 토큰화하는 곳(`compare_texts`, §11) 한 곳에서 한다.
- **세는 방법:** `changes`를 `needs_review`로 둘로 나눈다. 차이 개수 = `needs_review == false`, 확인 필요 개수 = `needs_review == true`. 한 변경이 두 곳에 함께 세어지지 않는다. 결과에 개수 필드를 따로 두지 않고 `changes`에서 센다. 종류 필터는 두 개수에 똑같이 적용한다.

### 6. 안내(`Notice`)

| 종류 | 언제 생기나 | 데이터 |
|---|---|---|
| `LowTextConfidence` | 텍스트 레이어 쪽에서 대체 문자(U+FFFD)·PUA 글자 비율이 기준(`LOW_TEXT_CONFIDENCE_RATIO` = 0.1, §9) 이상. ToUnicode가 깨진 PDF, 스캐너가 넣은 품질 낮은 숨은 글자층. OCR 쪽에는 생기지 않는다(OCR은 `needs_review`로 다룬다). | `side`, `pages` |
| `NoTextLayer` | OCR 대상 쪽(텍스트 레이어 글자 수 `OCR_MIN_TEXT_CHARS` 미만)인데 OCR로 글자를 얻지 못했다. 그 쪽은 텍스트 레이어 글자로 비교했다. | `side`, `reason`(`OcrUnavailable`: 런타임·모델이 없거나 OCR을 넣지 않은 빌드 / `OcrFailed`: 그 쪽의 렌더·추론 실패), `pages` |
| `Truncated` | diff 시간 제한(`DIFF_TIME_LIMIT`)이 지나 정밀 diff 대신 통째로 낸 변경이 있다: 앵커 구간을 통째 `Replace`로 냈거나, `Replace`의 글자 diff를 하지 않고 토큰 전체를 덮었다(§10). | `before_pages`, `after_pages`: 그 변경들의 토큰 글자 상자가 걸친 쪽 |

- 쪽마다 하나가 아니라 (종류, `side`, `reason`) 조합마다 하나다. 스캔 500쪽에 OCR이 없을 때 안내가 500개가 되지 않는다.
- `pages`·`before_pages`·`after_pages`는 0부터 센 오름차순, 중복 없음. `LowTextConfidence`·`NoTextLayer`의 `pages`는 비지 않는다. `Truncated`의 두 목록도 비지 않는다(통째로 내는 것은 양쪽에 토큰이 있는 `Replace`뿐이다. 한쪽에만 토큰이 있는 구간은 정밀 diff 결과와 같으므로 안내하지 않는다). 비교 범위 밖 쪽에는 안내가 생기지 않는다.
- 정렬: 종류(위 표 순서) → `side`(`Before` 먼저) → `reason`(정의 순서).
- 변경 개수 상한으로 결과를 자르는 일은 하지 않는다(필요해지면 새 변형을 더한다).

### 7. 경계를 넘는 직렬화

- **`pdf-core` 모델에는 지금 serde를 넣지 않는다.** 아직 직렬화하는 곳이 없고, 기존 `info`·`merge` 타입도 serde 없이 둔다.
- **계약 타입은 `src-tauri/src/contract.rs`에 같은 모양으로 따로 둔다(미러 + `From`).** `specta::Type` derive는 어댑터(`src-tauri`) 쪽에만 둔다. `pdf-core`는 Tauri·specta를 모르고, 고아 규칙 때문에 `src-tauri`가 `pdf-core` 타입에 `specta::Type`을 붙일 수도 없다. 비교 커맨드를 여는 Step이 미러를 만든다.
- **계약 JSON 모양**(기존 `contract.rs` 관례):
  - 필드 이름 camelCase(`pageSizes`, `minConfidence`, `needsReview`, `viewBox`, `beforePages`).
  - 단위 enum 값은 camelCase 문자열(`"before"`, `"insert"`, `"textLayer"`, `"ocrUnavailable"`).
  - `Notice`는 `#[serde(tag = "kind", rename_all = "camelCase")]`로 `{ "kind": "noTextLayer", "side": "after", "reason": "ocrUnavailable", "pages": [2, 3] }`.
  - `Placement`(Step 28-b)도 `kind` 태그다: `{ "kind": "boxes", "text": "…", "boxes": [{ "page": 0, "x": …, "y": …, "w": …, "h": … }], "minConfidence": null }` / `{ "kind": "anchor", "page": 0, "x": 176.24, "y": 690.33, "h": 11.04 }`. 태그 이름은 `Notice`와 같고 변경의 `kind`(`"insert"`)와는 다른 객체에 있다. pdf-core는 `rename_all_fields = "camelCase"`, 계약 미러는 `Boxes` 변형의 `rename_all`로 같은 모양을 낸다. TS는 `kind`로 가르는 유니온(`Extract<Placement, { kind: "boxes" }>`)이다.
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
| 정규화 | 비교 키 `key` = 옵션 형식(NFC 기본, NFKC. OCR 쪽이 있는 비교는 NFKC 강제, §5) → `ignore_case`면 `char::to_lowercase`. 원문 `text` = NFC만(대소문자 그대로, `Placement::Boxes.text` 재료). 방법: 원본 글자마다 분해(NFC는 정준, NFKC는 호환 분해)해 분해 글자에 원본 상자를 붙이고, 클러스터(결합 순서 0인 글자 + 뒤따르는 결합 글자·한글 중성/종성 자모 U+1160–11FF, U+D7B0–D7FF)마다 정준 합성한다. |
| 키 글자 ↔ 상자 | `key_boxes[i]`는 `key`의 i번째 글자 상자이고 개수가 늘 같다. 한 클러스터가 낸 키 글자는 모두 그 클러스터 원본 글자 상자들을 합친 상자를 쓴다. 글자가 늘면(NFKC `㈜` → `(주)`, `™` → `TM`) 같은 상자가 여러 번 나오고, 줄면(자모 `ᄀ`+`ᅡ` → `가`, `e`+U+0301 → `é`) 합친 상자 하나가 된다. 겹친 상자는 같은 줄 상자 병합(Step 19)이 하나로 만든다. 글자 단위 2차 diff는 키 글자 색인으로 상자를 찾는다. |
| 토큰 신뢰도 | `ExtractedChar.confidence`(OCR 글자 신뢰도, 텍스트 레이어는 `None`)의 토큰 안 최솟값이 `Token.confidence`다(§5, Step 19-a). 하이픈 결합·정규화는 원본 글자를 버리지 않으므로(모든 원본 글자가 한 토큰의 한 클러스터에 들어간다) 원본 글자로 센다. 두 필드는 `None`이면 직렬화하지 않아 텍스트 레이어 golden 모양이 그대로다. |
| `LowTextConfidence` 판정 | 쪽에서 `glyph`가 있고 공백이 아닌 글자 중 U+FFFD·PUA(U+E000–F8FF, 15·16 평면) 비율이 `LOW_TEXT_CONFIDENCE_RATIO`(0.1) 이상이면 대상이다. 그런 글자가 없는 쪽은 아니다. 안내를 붙일 쪽(출처가 텍스트 레이어이고 비교 범위 안인 쪽)은 결과를 만드는 Step이 고른다. |

- `LOW_TEXT_CONFIDENCE_RATIO` 근거: ToUnicode가 깨진 글꼴은 그 글꼴로 쓴 글자를 거의 모두 PUA·U+FFFD로 내므로 본문 글꼴이 깨지면 비율이 1에 가깝다. 정상 문서의 기호 글꼴(체크박스·글머리표) PUA는 줄마다 한두 글자라 보통 몇 % 안이다(실제 문서로 잰 값이 아니라 추정이다. 오탐이 보이면 다시 정한다). 10%면 한글 단어(3~4자) 서너 개 중 하나에 깨진 글자가 끼어 비교 결과를 믿기 어렵다.
- 한계: ToUnicode가 아예 없는 CID 글꼴은 pdfium이 글자 코드를 그대로 유니코드로 내 엉뚱한 ASCII가 되므로 이 비율로 잡히지 않는다(Step 18 작업 중 임시 픽스처로 확인했다). pdfium `FPDFText_HasUnicodeMapError`가 신호가 될 수 있지만 pdfium-render 0.9.4는 이 함수를 글자 API로 내주지 않는다.
- 한계: 줄 끝 하이픈을 남기므로 조판 프로그램이 자동으로 넣은 하이픈(`inter-` + `national`)은 한 줄 판 `international`과 다른 토큰이 된다. 계약서 원본(워드·한글)은 자동 하이픈이 기본으로 꺼져 있어 줄 끝 하이픈은 대개 진짜 하이픈(복합어, 사업자등록번호·전화번호·날짜)이다.
- 한계: 한글을 글자 단위로 줄바꿈해 단어 중간에서 하이픈 없이 줄이 바뀐 경우는 잇지 않는다. 줄 끝이 단어 끝인지 알 수 없다.
- golden: `crates/pdf-core/tests/golden/tokenize-korean.tokens.json`(기본 옵션)·`tokenize-korean.nfkc-ignore-case.tokens.json`, 픽스처 `tokenize-korean.pdf`.

### 10. 정렬과 diff (Step 19에서 정함)

공개 API는 `diff_tokens(before, after, time_limit) -> TokenDiff { changes, truncated: Option<Notice>, matches }`와 `DIFF_TIME_LIMIT`(10초)이다. 코드는 `crates/pdf-core/src/compare/diff.rs`다. 페이지 짝짓기(Step 20)·옵션(Step 21)·실행기(Step 22)는 이 결과를 받아 `CompareResult`를 채운다.

| 항목 | 규칙 |
|---|---|
| 비교 단위 | 두 문서 전체 토큰열의 비교 키(`Token.key`). 쪽 경계는 보지 않으므로 쪽을 넘는 이동·밀림도 한 번에 맞춘다. |
| 앵커 | 양쪽에 한 번씩만 나오는 키의 위치 쌍 중 두 위치가 함께 늘어나는 가장 긴 사슬(Patience, LIS `O(n log n)`). |
| 구간 diff | 앵커 사이 구간마다 앞뒤 공통 토큰을 먼저 떼고, 양쪽에 토큰이 남으면 `similar` Myers(`capture_diff_deadline`: 바뀐 곳을 미끄러뜨려 이어 붙이는 Compact, 이웃한 삭제·삽입 묶기 포함)로 비교한다. |
| 변경 | 공통 토큰 사이에서 바뀐 토큰의 가장 긴 묶음 하나가 변경 하나다(인접한 삭제·삽입은 `Replace`). A에만 있으면 `Delete`, B에만 있으면 `Insert`. 따로 이동 종류는 없다(옮긴 문단은 `Delete` + `Insert`). |
| 띄어쓰기만 다른 묶음 | 양쪽 토큰 키를 공백 없이 이은 문자열이 같고, **한쪽에만 있는 토큰 경계**(이은 글자열에서 한쪽 문서에만 경계가 있는 위치) 중 앞뒤 글자가 둘 다 숫자(`char::is_numeric`: 전각 숫자 포함, 한글 수사 제외)인 것이 없으면 변경으로 내지 않는다. pdfium이 간격으로 만든 공백·줄바꿈, 한글 단어 중간의 하이픈 없는 줄바꿈(`계약기` + `간은`, §9 한계), 숫자가 든 단어의 경계 이동(`제3조의` ↔ `제3조` + `의`)처럼 줄 배치만 달라 토큰 경계가 달라진 곳이 거짓 차이가 되지 않게 한다. 숫자 사이 경계가 옮겨지면(`1 000` ↔ `10 00`, `제 1 2 조` ↔ `제 12 조`, `010 1234 5678` ↔ `0101 234 5678`) 읽히는 숫자가 달라지므로 `Replace`로 낸다. **OCR 토큰이 걸린 묶음은 버리지 않고 `Replace`로 내며 §5 2번으로 확인 필요가 된다**(Step 19-a). |
| `Replace` 글자 diff | 걸린 토큰 키를 공백 없이 이은 글자열끼리 Myers로 비교해 삭제·삽입된 글자의 상자만 덮는다. 띄어쓰기 차이는 하이라이트하지 않는다. 묶음에 토큰 경계만 다른 단어가 끼면 `text`에는 들어가지만 상자는 실제로 다른 글자만 덮는다. 숫자 사이 경계만 옮겨진 `Replace`는 다른 글자가 없으므로 §4대로 양쪽 모두 걸린 토큰 전체를 덮는다. |
| 상자 합치기 | ① 한 원본 글자(클러스터)에서 나온 키 글자는 상자가 같다(`㈜` → `(주)`). 이어진 같은 상자는 먼저 하나로 묶고, 하나라도 표시됐으면 묶음 전체를 표시한다. 그래서 같은 상자가 두 번 나오지 않는다. ② 글자열에서 이어서 표시된 글자가 같은 줄이면 상자 하나로 합친다. 같은 줄 = 같은 쪽 + 세로 겹침이 낮은 쪽 높이의 `SAME_LINE_MIN_OVERLAP`(0.5) 이상 + 다음 상자가 지금 상자 왼쪽 끝보다 왼쪽으로 가지 않음 + 가로 간격이 높은 쪽 높이의 `SAME_LINE_MAX_GAP`(1.0)배 이하. 단어 사이 공백은 덮고, 다음 줄·표의 먼 칸은 따로 둔다. 2단: 같은 높이라도 다음 글자가 지금 상자 오른쪽으로 높은 쪽 높이(≈ 글꼴 크기)보다 멀면 따로 둔다. 흔한 단 간격(0.25인치 = 18pt)은 10~12pt 본문의 이 한도를 넘는다(Step 28-b `placement-*.pdf` 2쪽: 단 사이 약 18pt, 글자 높이 약 11pt). 한계: 단 간격이 글자 높이보다 좁으면(큰 글자 + 좁은 단 간격) 두 단에 걸친 변경이 한 상자가 된다. 앵커의 줄 상자(§4)도 같은 규칙이다. |
| 시간 제한 | `time_limit`을 diff 시작부터 잰다. 구간 Myers와 `Replace` 글자 diff 각각의 전·후에 확인한다(`similar`는 제한을 넘으면 알리지 않고 근사 결과를 내므로 끝난 뒤에도 본다). 지났으면 구간은 통째 `Replace`(양쪽 상자 = 토큰 전체)로, 글자 diff는 하지 않고 토큰 전체 상자로 낸 뒤 `Truncated`(§6)에 그 쪽을 넣는다. 앞뒤 공통 토큰 떼기와 한쪽에만 토큰이 있는 구간은 시간과 상관없이 정확하므로 그대로 낸다. 띄어쓰기만 다른 규칙은 통째 구간에도 적용한다. |
| 신뢰도 | `min_confidence`는 쪽마다 걸린 토큰의 OCR 신뢰도 최솟값, `needs_review`는 §5의 세 규칙이다(`review.rs`, Step 19-a). 텍스트 레이어끼리의 비교에서는 늘 `None`·`false`다. |
| 직렬화 | golden이 쓰는 `Change`·`ChangeKind`·`ChangeSide`(Step 28-b부터 `Placement`)에 `Serialize`를 붙였다(§7 모양). `Notice`는 처음 직렬화하는 Step이 붙이고, 구조체 변형 필드를 camelCase(`beforePages`)로 쓰려면 `rename_all_fields = "camelCase"`도 함께 둔다. |

- `DIFF_TIME_LIMIT` 근거(release, Apple M 계열, 합성 토큰열): 500쪽 × 400토큰(한 문서 20만 토큰)에 200곳을 고친 짝 약 15 ms, 앞 10%를 뒤로 옮긴 짝 약 15 ms, 유일 토큰이 거의 없는 서로 다른 500쪽 문서 2~7초(토큰 Myers가 대부분). 글자 30만 개짜리 `Replace` 하나의 글자 diff는 최악(두 글자만 쓰는 무작위 글자열) 약 5초라 글자 diff에도 시간 제한을 둔다. 정상 계약서 비교에서는 닿지 않고, 더 느린 PC에서 전혀 다른 문서를 비교할 때 화면이 오래 멈추지 않게 하는 상한이다.
- 한계: 띄어쓰기로 뜻이 바뀌는 단어(`now here` ↔ `nowhere`)도 차이로 내지 않는다. 계약서에서 줄 배치 때문에 생기는 거짓 차이를 막는 쪽을 택했다. 숫자만 예외로 둔 것은 금액·번호·날짜는 경계 위치가 곧 값이기 때문이다.
- 한계: 숫자 중간에서 하이픈 없이 줄이 바뀐 판(`1,000,0` + `00원` ↔ `1,000,000원`)은 차이로 나온다. 워드·한글의 기본 줄바꿈은 숫자를 단어 단위로 옮겨 드물고, 숫자 변경을 숨기는 것보다 낫다고 보았다.
- 한계: 사용자 공간에서 세로로 흐르는 글자(돌려 그린 글자를 `/Rotate`로 세운 쪽)는 같은 줄 글자가 세로로 겹치지 않아 글자마다 상자가 따로 남는다. 덮는 위치는 맞다.
- golden: `crates/pdf-core/tests/golden/diff-edit.changes.json`(단어 삽입·삭제·치환, 날짜·금액·비율 숫자 치환)·`diff-move.changes.json`(쪽을 넘는 문단 이동), 픽스처 `diff-base.pdf`·`diff-edit.pdf`·`diff-move.pdf`·`diff-rewrap.pdf`(줄바꿈 위치만 다른 판, 차이 0). Step 28-b에서 두 golden은 쪽 모양만 바뀌었다(`"kind": "boxes"`가 붙고 `null`이 앵커가 됐다. 상자 값은 그대로). 같은 줄 병합(한 줄 두 낱말·줄바꿈·2단)은 `placement.changes.json`(§4 테스트)이 따로 고정한다.
- diff 공개 API는 Step 28-b부터 `diff_tokens(before, after, pages: &ComparedPages, time_limit)`다. `ComparedPages { before, after, sizes }`는 두 토큰열을 만든 비교 범위 쪽 번호와 문서 전체 쪽 크기이고, 반대쪽 토큰이 없을 때 앵커를 놓을 쪽을 고르는 데만 쓴다(§4 빈 쪽).
- 버린 대안:
  - 줄·단락 해시로 앵커 잡기(계획서 §6.2 3번의 처음 안): 단어 하나만 들어가도 뒤 줄바꿈이 밀려 그 문단의 줄이 모두 달라지고, 두 문서의 줄 배치가 다르면 앵커가 거의 없다. 토큰은 줄 배치와 상관없다.
  - `similar`의 `Algorithm::Patience`를 그대로 쓰기: 제한을 넘은 구간을 알려 주지 않아 `Truncated`를 낼 수 없다. 앵커는 직접 잡고 구간 diff만 `similar`에 맡긴다.
  - 띄어쓰기만 다른 묶음도 `Replace`로 내기: 줄 배치만 다른 두 판을 비교하면 거짓 차이가 줄마다 생긴다.
  - 띄어쓰기만 다른 묶음을 숫자와 상관없이 모두 빼기(Step 19 처음 안): `1 000` ↔ `10 00`처럼 경계 이동만으로 바뀐 숫자가 차이 0이 된다.
  - 숫자가 든 토큰이 걸리면 빼지 않기: `제3조의` ↔ `제3조 의`처럼 조항 번호가 든 단어의 줄 배치 차이가 다시 거짓 차이가 된다. 판정은 경계 앞뒤 글자만 본다.
  - 글자 diff를 공백을 넣은 글자열로: 띄어쓰기 차이가 하이라이트되고, 토큰 경계만 다른 단어가 다른 글자로 보인다.
  - 시간 제한이 지나면 `similar`의 근사 결과를 그대로 쓰기: 근사인지 알 수 없어 안내 없이 거짓 차이가 섞인다.

### 11. OCR 연결 (Step 19-a에서 정함)

공개 API는 `read_document_text(engine, path, ocr: Option<&mut OcrEngine>, cache: Option<&OcrCache>, cancel: &AtomicBool) -> DocumentText { pages, sources, ocr_failures }`와 `compare_texts(before, after, options, time_limit) -> TextComparison { changes, page_sizes, page_sources, notices }`다. 코드는 `crates/pdf-core/src/compare/{pipeline,ocr_text,review}.rs`, `crates/pdf-core/src/ocr/{mod,recognize,cache}.rs`다. 페이지 짝짓기(§12)·옵션(§13)·진행률(Step 22)은 이 결과를 받아 `CompareResult`를 채운다.

| 항목 | 규칙 |
|---|---|
| OCR 대상·출처 | `needs_ocr` 쪽(§8)만 OCR한다. 성공하면 그 쪽 `chars`를 OCR 글자로 **바꾸고**(디지털로 찍힌 쪽 번호도 렌더에 보이므로 OCR이 함께 읽는다) 출처는 `Ocr`다. 글자가 하나도 없는 쪽(빈 스캔 쪽)도 OCR이 끝났으면 `Ocr`이고 안내는 없다. 실패하면 텍스트 레이어 글자를 두고 출처는 `TextLayer`, `ocr_failures`에 이유를 남긴다(§3·§6). |
| 실패 이유 | 캐시에 없고 `ocr`가 `None`(런타임·모델 없음, 호출자가 `OcrEngine::load` 실패를 넘긴다)이면 `OcrUnavailable`, 그 쪽 렌더·추론이 실패하면 `OcrFailed`. 캐시에 있으면 `ocr` 없이도 OCR 결과를 쓴다. |
| 렌더 영역 | pdfium 렌더는 쪽 상자(`FPDF_GetPageBoundingBox` = `view_box`)를 `/Rotate`를 적용한 화면 방향으로 그린다. 이미지 크기 = 화면 크기(pt) × `OCR_RENDER_DPI / 72`를 내림한 값이다(CropBox 오프셋·MediaBox 원점 이동·/Rotate 90·180·270 쪽으로 확인, §2가 남긴 확인 사항). |
| 좌표 되돌리기 | 기울기 보정은 하지 않는다(스파이크 결정)라 §2의 첫 단계는 없다. 픽셀 → 화면 pt(실제 이미지 크기 ÷ 화면 크기 배율, 축마다) → `/Rotate` 되돌리기와 y 뒤집기(화면 `(sx, sy)` → `view_box` 기준 사용자 공간: 0도 `(sx, h−sy)`, 90도 `(sy, sx)`, 180도 `(w−sx, sy)`, 270도 `(w−sy, h−sx)`, `w`·`h`는 `view_box` 너비·높이) → `view_box.left`·`view_box.bottom` 더하기. 글자 사각형(기울 수 있다)은 네 꼭짓점을 바꾼 뒤 덮는 축 나란한 상자로 둔다. |
| OCR 글자 → `ExtractedChar` | 인식 글자마다 `glyph = { bounds: 위 상자, font_size: 줄 상자 높이(pt) }`, `confidence = 글자 신뢰도`. OCR이 읽은 공백은 만든 공백(`glyph: None`), 줄마다 끝에 만든 줄바꿈(`\n`, `glyph: None`)을 둔다. 그래서 토큰화(§9)의 단어 경계·하이픈 결합이 텍스트 레이어와 같게 동작한다. |
| 줄 순서 | 줄 윗변 각도의 가운데값만큼 기울기를 되돌린 좌표에서 위→아래로 놓고, 세로 위치 차이가 낮은 줄 높이의 `SAME_ROW_MAX_OFFSET_RATIO`(0.5) 이하인 줄은 같은 행으로 묶어 왼쪽→오른쪽으로 놓는다. 기운 스캔에서 표·서명란 칸이 따로 검출되면 중심 y만으로는 칸 순서가 뒤집혀 거짓 삭제·삽입이 생긴다. |
| 단어 사이 공백 | PP-OCRv5 한국어 인식 모델은 단어 사이 공백을 거의 내지 않는다(가상 계약서 300dpi 스캔 1쪽에서 정답 공백 169개 중 22개). 공백 없이는 줄 전체가 토큰 하나가 되어 띄어쓰기 규칙(§5 2번)이 문서 대부분을 확인 필요로 만들고, 실제 변경도 같은 토큰의 낮은 신뢰도 글자 때문에 확인 필요로 숨는다. 그래서 인식 뒤 이웃한 두 글자(CTC 중심) 사이 줄 이미지에서 잉크 없는 세로줄이 그 줄 잉크 높이의 `WORD_GAP_MIN_RATIO`(0.30) 이상 이어지면 공백을 넣는다(잉크 = 빨강 채널 128 미만). 측정(스캔 4종): 비율 0.22·0.26·0.30·0.34·0.38에서 텍스트본 ↔ 같은 계약서 스캔본 3종의 확인 필요 변경 합이 119·60·29·81·136개로 0.30이 가장 적고, 모든 비율에서 차이는 0이다. 남는 오류는 `1` 뒤처럼 글리프가 좁은 글자 뒤 거짓 공백(`제1 1조`)과 드문 누락이고 §5 2번으로 확인 필요가 된다. 같은 이미지에서 다른 결과를 내므로 `OCR_MODEL_VERSION`에 들어간다. |
| 정규화 | 어느 쪽이든 출처가 `Ocr`인 쪽이 있으면 `compare_texts`가 두 문서 모두 NFKC로 토큰화한다(§5). |
| 안내 | `compare_texts`가 만든다. `LowTextConfidence`는 출처가 `TextLayer`인 쪽 중 §9 판정 대상, `NoTextLayer`는 `ocr_failures`를 (쪽, 이유)마다 모은 것, `Truncated`는 diff 결과. 순서는 §6. |
| 취소 | `cancel: &AtomicBool`(병합·TIFF와 같은 방식)을 OCR 쪽마다 시작 전, 렌더 뒤, 추론 뒤에 확인해 `CompareError::Cancelled`를 낸다. 렌더 이미지는 메모리에만 있어 지울 파일이 없다. |
| 캐시 키 | SHA-256(`pdfstudio.ocr-cache.v1` ‖ 파일 내용 SHA-256 ‖ 쪽 번호 u32 LE ‖ `OCR_MODEL_VERSION` 길이 u32 LE + UTF-8 ‖ `OCR_RENDER_DPI` u32 LE)의 앞 16바이트 16진수 + `.json`. 파일 경로가 아니라 내용이라 같은 파일을 옮겨도 맞고, 모델·인식 규칙(`OCR_MODEL_VERSION`)이나 DPI가 바뀌면 다시 읽는다. 파일 해시는 OCR 대상 쪽이 있을 때만 센다. |
| 캐시 값 | 렌더 이미지 크기와 줄(픽셀 좌표·글자·신뢰도)을 serde_json으로 쓴 것. 좌표 되돌리기는 읽을 때마다 쪽 상자로 다시 한다. `f32`는 serde_json이 왕복해도 같은 값이라 캐시를 쓴 결과와 처음 결과가 같다. 읽은 값의 이미지 크기가 0이거나 좌표·신뢰도가 유한하지 않으면 깨진 파일로 보고 다시 OCR한다(좌표 되돌리기가 이미지 크기로 나눈다, Step 22). |
| 캐시 쓰기·상한 | 호출자(`src-tauri`가 앱 캐시 폴더)가 `OcrCache::new(dir)`로 넘긴다. 같은 폴더의 임시 파일에 쓴 뒤 rename한다(`output.rs` 관례). 문서 하나를 읽은 뒤 `.json` 파일 합이 `MAX_OCR_CACHE_BYTES`(256 MiB)를 넘으면 시각(마지막으로 쓰거나 읽은 때, 읽으면 갱신)이 오래된 것부터 지운다. 캐시는 최선 노력이라 읽기·쓰기·지우기 실패나 깨진 파일은 OCR을 다시 하거나 그대로 계속한다. |

- 좌표 되돌리기 측정(`ocr-geometry-scan.pdf`, 300dpi 스캔·흐림만, 400dpi 렌더): 같은 글자의 텍스트 레이어 tight 상자 중심과 OCR 상자 중심의 거리는 쪽마다 평균 가로 0.65~1.24pt·세로 0.63~1.05pt, 최대 가로 4.82pt·세로 4.75pt(끝 마침표·쉼표처럼 tight 상자가 작은 글자). tight 상자 중심이 OCR 상자 밖으로 벗어난 거리는 최대 0.85pt다. 테스트는 OCR 상자를 `OCR_BOX_TOLERANCE_PT`(1.0pt) 넓히면 모든 짝 글자의 tight 중심을 품는지 본다.
- 스캔 픽스처 결과(golden `ocr-edit.changes.json`): 텍스트본 A ↔ 같은 계약서 스캔본 3종은 차이 0(확인 필요 4·14·11). A ↔ 금액·날짜·비율·조항을 바꾼 B의 스캔본은 차이 6개가 모두 바꾼 곳이고(4월 → 5월, `서면으로` 이동, `규격 미달로` 삽입, `모든` 삭제, 0.15% → 0.20%), 금액 `48,750,000` → `48,950,000`은 그 OCR 토큰(`48,950,000원(부가가치세`)의 신뢰도가 0.912로 숫자 기준 0.95 미만이라 확인 필요로 나온다(§5 1번 그대로). 나머지 확인 필요 8개는 끝 마침표 누락·띄어쓰기 차이다.
- OCR 대상 판정(`OCR_MIN_TEXT_CHARS` 32): 스캔 픽스처 쪽은 텍스트 레이어 글자 0개, 가상 계약서 텍스트 쪽은 수백 자라 값을 그대로 둔다.
- 한계: 단어 사이 공백 판정 비율은 픽스처 서체(나눔명조 10.5pt) 하나로 정했다. 자간이 넓은 서체나 고딕체에서는 거짓 공백·누락이 늘 수 있고, 그 차이는 확인 필요로만 나온다(차이로 세지 않는다).
- 한계: 텍스트 레이어 추출(§8)은 글자를 시계 방향으로 돌려 그리고 `/Rotate 270`으로 세운 쪽에서 줄 순서를 거꾸로 낸다(`ocr-geometry.pdf` 4쪽에서 확인, OCR 쪽 순서는 맞다). §8의 `rotation-order.pdf`가 다루지 않은 경우라 그런 텍스트 쪽 ↔ 스캔 쪽 비교는 줄마다 삭제·삽입이 생긴다. 추출 쪽 수정 과제로 남긴다.
- 버린 대안:
  - 공백 없는 OCR 글자를 그대로 토큰화: 위 표의 이유로 결과를 쓸 수 없다(측정: 텍스트본 ↔ 같은 계약서 스캔본의 확인 필요 19~23개가 문단 전체를 덮고, 금액·날짜·비율 변경이 모두 확인 필요로 숨었다).
  - 글자 중심 사이 거리로 공백 판정: 숫자·문장부호처럼 폭이 좁은 글자 때문에 공백 있는 쌍과 없는 쌍의 분포가 크게 겹친다(줄 높이 대비 0.3~0.75에서 섞임).
  - 검출 상자 높이 대비 잉크 간격: 검출 상자를 넓히는 비율이 줄 내용마다 달라 기준이 흔들린다(가장 나은 값에서도 확인 필요 합이 잉크 높이 대비보다 많았다).
  - OCR이 있는 비교만 글자 단위 diff로 공백을 무시: §10 단어 단위 diff·`Change.id`·변경 글자를 바꾸고, §5 2번(사용자 결정)을 사실상 없앤다.
  - OCR 결과를 PDF pt로 바꿔 캐시: 같은 파일이면 쪽 상자가 같아 결과는 같지만, 렌더 픽셀 결과를 두어야 좌표 되돌리기 규칙을 바꿔도 캐시를 버리지 않는다.

### 12. 페이지 짝짓기 (Step 20에서 정함)

공개 API는 `pair_pages(before_pages, after_pages, before, after, matches) -> Vec<PagePair>`다. 코드는 `crates/pdf-core/src/compare/pages.rs`다. 입력은 비교 범위의 쪽 번호(0부터, 오름차순, 토큰이 없는 쪽 포함)와 그 쪽들의 토큰열, `diff_tokens`가 함께 내는 공통 토큰 짝 `TokenDiff.matches`(`(A 토큰 색인, B 토큰 색인)`, 두 색인이 함께 늘어난다)다. 결과가 `CompareResult.page_pairs`이고 §3 불변식을 지킨다.

| 항목 | 규칙 |
|---|---|
| 공통 토큰 짝 | diff 구간 밖 토큰을 양쪽에서 차례로 짝지은 것. 변경에 걸린 토큰과 띄어쓰기만 다른 묶음(§10)의 토큰은 들지 않는다. |
| 토큰의 쪽 | 첫 키 글자 상자의 쪽. 하이픈으로 쪽을 넘겨 이은 토큰(`갑-` + `을`)은 앞 쪽이다. |
| 매칭 행렬 | 칸 (A 쪽, B 쪽)의 무게 = 그 두 쪽 사이 공통 토큰 짝 수. 0인 칸은 두지 않는다. |
| 짝 | 두 쪽 번호가 함께(엄격히) 늘어나는 칸들 중 무게 합이 가장 큰 경로의 칸. 한 쪽은 한 짝에만 든다. 쪽 내용이 다음 쪽으로 밀리면 내용이 더 많이 옮겨 간 쪽과 짝이 된다(`pages-push`: A 0쪽 공통 토큰 41개 중 29개가 B 1쪽으로 가서 A 0쪽 ↔ B 1쪽). |
| 동률 | 합이 같은 경로가 여럿이면 행 순서로 앞에서부터 비교해 A 쪽 번호가, 같으면 B 쪽 번호가 작은 짝을 가진 경로다. 쪽 내용이 정확히 반씩 옮겨 가면 앞쪽끼리 짝이 된다. |
| 짝 없는 쪽 | 경로의 두 짝 사이(문서 처음·끝 포함)에 남은 쪽들은 서로 공통 토큰이 없다(있으면 그 칸을 경로에 더해 합이 커진다). ① 빈 쪽(토큰이 하나도 없는 쪽: 빈 쪽, 글자를 얻지 못한 스캔 쪽)끼리 앞에서부터 차례로 짝짓는다. ② 그 사이사이 남은 쪽은 양쪽 개수가 같으면 차례로 짝짓는다(통째로 바뀐 쪽, 공통 토큰이 없는 서명 쪽). ③ 개수가 다르면 짝짓지 않고 A만 있는 행을 먼저, B만 있는 행을 뒤에 둔다(§3). |
| 시간 제한 | `Truncated`(§10)여도 앵커(양쪽 유일 토큰)와 구간 앞뒤에서 뗀 공통 토큰은 공통 토큰 짝에 그대로 든다. 통째로 낸 구간 안 토큰만 짝이 없고, 그 구간에만 걸친 쪽은 짝 없는 쪽 규칙을 따른다. |

- ①을 ②보다 먼저 하는 이유: 빈 쪽 옆에서 쪽을 넣거나 빼면(`[빈 쪽]` ↔ `[새 쪽, 빈 쪽]`) 개수가 달라 ②로는 빈 쪽끼리도 짝짓지 못하고, 개수와 상관없이 차례로 짝지으면 새 쪽을 빈 쪽과 짝짓는다(`pages-insert`·`pages-delete`). 계약서에는 빈 쪽·서명 쪽이 흔하다.
- 성능(release, Apple M 계열, 합성 토큰열): 500쪽 × 400토큰(공통 토큰 짝 20만 개)에서 `pair_pages` 약 8~9 ms다(같은 문서, 모든 쪽이 반쪽씩 밀린 문서, 쪽 삽입·삭제 + 200곳 치환). 같은 입력의 diff는 30~40 ms다. 경로는 칸 수 C에 O(C²)인 DP지만, 공통 토큰 짝이 두 위치가 함께 늘어나므로 0이 아닌 칸이 계단 하나를 이뤄 C가 두 범위 쪽 수의 합보다 작다.
- 한계: 한 쪽은 한 짝에만 들므로, 다시 조판해 쪽 수가 달라진 판(10쪽 → 12쪽)에서는 공통 내용이 든 쪽도 짝 없는 행이 된다. 그 쪽 글자는 공통 토큰이라 하이라이트는 없고, 짝이 다른 행에 놓인 `Replace`는 연결선이 없다(계획서 §7.1 한계).
- 한계: 빈 쪽은 토큰 수 0으로만 판정한다. 디지털 쪽 번호만 찍힌 스캔 쪽은 빈 쪽이 아니어서 ②·③을 따른다(쪽 번호 토큰이 diff에서 맞으면 경로로 짝지어진다).
- golden: `crates/pdf-core/tests/golden/pages-{insert,delete,edit,push}.page-pairs.json`, 픽스처 `pages-base.pdf`(2쪽이 빈 쪽인 5쪽)와 변형 `pages-insert.pdf`(1쪽 뒤에 새 쪽 + 3쪽 숫자 하나 수정)·`pages-delete.pdf`(1쪽 삭제)·`pages-edit.pdf`(쪽 순서를 둔 채 낱말·숫자 수정)·`pages-push.pdf`(앞에 넣은 전문 때문에 쪽 내용이 반 넘게 다음 쪽으로 밀림).
- 버린 대안:
  - 같은 쪽 번호끼리 짝짓기: 쪽 하나만 들어가거나 빠져도 뒤 쪽이 모두 어긋난다.
  - A 쪽마다 공통 토큰이 가장 많은 B 쪽과 짝짓기: 짝이 엇갈리거나 한 B 쪽에 여러 A 쪽이 몰려 행 순서를 만들 수 없다.
  - 경로의 짝 수를 최대로: 내용이 반 넘게 밀린 쪽을 같은 위치 쪽과 짝짓는다.
  - 짝 없는 쪽을 짝짓지 않기: 양쪽 같은 자리의 빈 쪽·서명 쪽이 두 행으로 갈린다.
  - 짝 없는 쪽을 개수와 상관없이 차례로 짝짓기: 개수가 다르면 어느 쪽이 대응하는지 알 수 없고, 빈 쪽 옆 삽입·삭제에서 틀린 짝을 만든다.

### 13. 비교 옵션 (Step 21에서 정함)

코드는 `crates/pdf-core/src/compare/options.rs`다. `CompareOptions { range_a, range_b, exclude_header, exclude_footer, exclude_page_numbers, ignore_case }`(기본값은 전체 쪽·제외 없음·대소문자 구분)와 공개 함수 `parse_page_range`·`select_pages`·`exclude_lines`가 있다. 옵션을 적용해 결과를 만드는 조립은 실행기(Step 22)가 맡고, 순서는 쪽 범위 선택 → 줄 제외 → 토큰화 → diff → `pair_pages`다.

| 항목 | 규칙 |
|---|---|
| 쪽 범위 문자열 | 쉼표로 나눈 `N` 또는 `N-M`. 1부터 센 사용자 표기이고 `parse_page_range`가 0부터 센 쪽 번호 목록(오름차순, 중복 없음)으로 바꾼다. 비었거나 공백뿐이면 전체다. 항목과 `-` 둘레의 공백은 무시한다. |
| 오류 | 0, 쪽 수 초과, 역방향 구간(`5-3`), 빈 항목(`1,,2`, 끝 쉼표), 숫자 외 글자(부호 포함), `u32` 초과는 `CompareOptionsError::InvalidRange { side, range, page_count }`(코드 `INVALID_RANGE`)다. A·B를 따로 검사하므로 `side`가 어느 쪽인지 알린다. 쪽 수 확인은 비교 시작 때 한 번이고 오류면 비교하지 않는다. |
| 화면 검사 | 옵션 카드(Step 26)는 입력하는 동안 같은 규칙을 `src/renderer/shared/lib/page-range-parse.ts`로 검사해 이유(형식·역방향·쪽 수 초과)를 보이고 실행을 막는다. 받는지·거부하는지는 이 표와 같아야 하고, 이유는 화면 문구를 고르는 용도다. 실행 때 Rust가 다시 검사하는 것이 마지막 방어선이다(어긋나면 `INVALID_RANGE` 토스트). |
| 중복·역순 | 사용자 입력이라 관대하게 받는다: `"5,1"` → `[0, 4]`, `"1-3,2"` → `[0, 1, 2]`. `pair_pages`의 오름차순·중복 없음 전제는 이 정렬·중복 제거로 지킨다. |
| 쪽 번호 ↔ 색인 | `select_pages`가 고른 쪽의 글자 상자 `page`는 문서 전체 기준 쪽 번호 그대로고, `pair_pages`는 쪽 번호 목록 안의 위치로 변환해 다시 쪽 번호를 돌려준다. 그래서 범위가 `"3-5"`처럼 0부터 이어지지 않아도 결과 `PagePair`는 문서 전체 쪽 번호다. |
| 줄 | 글자열에서 이어진 글자가 §10의 같은 줄 판정(상자 병합과 같은 `continues_line`)인 동안 한 줄이다. 판정은 화면 방향 좌표에서 한다. 공백 글리프와 pdfium이 만든 공백·줄바꿈은 직전 줄에 붙고, 첫 줄 앞의 것은 어느 줄에도 속하지 않아 남는다. 줄이 제외되면 붙은 글자도 함께 빠진다. |
| 화면 방향 | 밴드의 위·아래는 화면에서 위·아래다. 사용자 공간 좌표(§2, `/Rotate` 적용 전)를 `/Rotate`(시계 방향)로 옮긴다: 0은 그대로, 90은 사용자 공간 왼쪽 가장자리가 화면 위, 180은 아래쪽 가장자리가 화면 위, 270은 오른쪽 가장자리가 화면 위다. 기준 사각형은 `view_box`다. |
| 밴드 | 줄의 세로 중심이 화면 위(머리말)·아래(꼬리말) 끝에서 `HEADER_FOOTER_BAND_PT`(50pt) 안이면 밴드 안이다. 근거: 워드 기본 여백 72pt, 머리말·꼬리말 줄 중심이 끝에서 약 41pt. 실제 계약서로 잰 값이 아닌 추정이다. |
| 쪽번호 | 하단 밴드 안의 줄이면서, `Page`(대소문자 무시)·`p.`·`쪽`을 지운 나머지가 ASCII 숫자·`-`·`–`·`—`·`/`·공백뿐이고 숫자가 하나 이상인 줄(`- 3 -`, `3 / 10`, `Page 3`, `3쪽`). 꼬리말 제외와 독립이다. 머리말 밴드의 숫자와 본문의 숫자 줄은 남긴다. |
| 대소문자 무시 | `NormalizeOptions.ignore_case`로 넘긴다. 유니코드 형식은 옵션으로 노출하지 않고 기본(NFC)을 쓴다. OCR 쪽이 있을 때 NFKC 강제(§5)는 `compare_texts`(§11)가 이 값의 형식만 올려 한 곳에서 한다. |
| 빈 쪽 | 제외로 토큰이 0개가 된 쪽은 범위에 남고 §12의 빈 쪽 규칙을 탄다. |
| `needs_ocr` | 줄 제외는 이 값을 다시 계산하지 않는다. OCR 대상 판정은 제외 전 텍스트 레이어 글자로 한다. |

- 한계: 글자를 화면과 다른 방향으로 쓴 쪽(가로쓰기 화면에서 글자를 90도 돌려 그린 쪽)은 글자마다 줄이 갈려 밴드 판정이 글자 단위가 되고 쪽번호 줄은 알아보지 못한다.
- 한계: `Page 3 of 10`처럼 낱말이 더 있는 표기, 전각 숫자는 쪽번호로 보지 않는다. 필요하면 표기를 더한다.
- 한계: 밴드는 쪽 크기와 상관없는 고정 pt라 아주 작은 쪽에서는 본문이 밴드에 든다. 자동 머리글 감지(쪽마다 반복되는 줄 찾기)는 Phase 5다.
- 버린 대안: 밴드 안 글자를 글자 단위로 빼기(줄 한가운데가 잘려 낱말이 깨진다), 밴드 높이를 쪽 높이의 비율로 두기(여백은 쪽 크기가 아니라 문서 서식이 정한다), 중복·역순 범위를 오류로 보기(사용자 입력을 불필요하게 막는다).

### 14. 리포트 내보내기 (Step 23에서 정함)

코드는 `crates/pdf-core/src/compare/report.rs`(공개 API·옵션·에러·색)와 `report/{sheet,compose,annotate}.rs`다. 공개 함수는 `export_compare_pdf(engine, result, sources, options, output_path, cancel)`, `export_annotated_pdf(engine, result, after_path, hidden_kinds, output_path, cancel)`, `preview_compare_report(engine, result, sources, options, max_sheets, width_px)`이고 옵션은 `CompareReportOptions { layout: ReportLayout(SideBySide | AOnly | BOnly), changed_pages_only, draw_boxes, hidden_kinds: Vec<ChangeKind> }`(기본: 나란히, 모든 행, 상자 넣기, 숨긴 종류 없음)다. 계획서의 `side_by_side | a_only | b_only`가 이 세 변형이다.

| 항목 | 규칙 |
|---|---|
| 장 | `page_pairs` 행 하나가 A4 가로(841.89 × 595.28pt) 한 장이다. 행 순서 그대로다. `AOnly`·`BOnly`는 그쪽 쪽이 없는 행(짝 없는 B만·A만 행)을 넣지 않는다. |
| 칸 | 여백 24pt 안을 나란히면 좌우 두 칸(사이 16pt), 한쪽만이면 한 칸으로 쓴다. 쪽은 화면 방향(`/Rotate` 적용 후) 크기로 비율을 지켜 칸에 맞추고, 가로는 가운데, 세로는 위에 붙인다(나란한 두 쪽의 첫 줄이 같은 높이). `UserUnit`은 곱하지 않는다(§2, 칸에 맞추므로 비율만 같으면 된다). |
| 쪽 놓기 | 원본 쪽을 pdfium `FPDF_NewXObjectFromPage`(pdfium-render `copy_into_x_object_form_object`)로 Form XObject로 가져온다. 이 XObject의 `/Matrix`가 사용자 공간 → 화면 방향(`view_box` 왼쪽 아래 원점) 변환이고 `/BBox`가 `view_box`라, 배율·위치만 더하면 회전·CropBox 오프셋이 맞는다. 글자는 벡터로 남고 원본 파일은 읽기만 한다. 놓인 쪽에는 토큰 `border` 색(≈ `#dfdfe5`) 0.75pt 테두리를 두른다(흰 쪽과 흰 장 구분). |
| 빈 칸 | 나란히에서 짝 없는 행의 빈 칸에는 있는 쪽과 같은 크기의 `border` 색 **점선 테두리만** 둔다. 문구("없음")는 넣지 않는다: 글자를 넣으면 한글 글꼴을 임베드해야 하고, 빈 점선 자리로 뜻이 충분하다(YAGNI). |
| 상자 | 변경 상자(§2 좌표)를 화면 방향 → 배율 → 칸 위치로 옮기고(§13과 같은 `to_display`), 장 좌표에서 사방 1pt 넓힌 뒤 놓인 쪽 사각형으로 자른다. A 칸에는 `before` 상자, B 칸에는 `after` 상자를 그린다(앵커는 상자가 없어 그리지 않고, 연결선의 끝으로만 쓴다). 색은 디자인 토큰 `diff-insert`·`diff-delete`·`diff-change`(선)와 각 `-fill`(채움, 알파 그대로)이다. |
| 차이 / 확인 필요 | 차이는 `-fill`로 채우고 같은 종류 색 0.75pt 선을 두른다. 확인 필요(`needs_review`)는 **채우지 않고** 1.5pt 선만 둔다. 색을 늘리지 않고(토큰에 있는 색만) 모양으로 구별한다. `Replace`는 선을 점선(3pt·2pt)으로 그린다: 토큰 문서가 변경을 점선으로 구분해 색각 이상에서 삭제 주황과 변경 노랑을 가르게 한 것과 같다. |
| 숨긴 종류 | `hidden_kinds`의 변경은 그리지 않고, 차이 있는 쪽 판정·주석·연결선에서도 뺀다. 확인 필요는 종류가 아니므로 따로 숨기지 않는다(§5 "종류 필터는 두 개수에 똑같이"). |
| 연결선(Step 28-c) | 나란히 배치에 색 상자를 넣을 때만 그린다. 화면과 같은 `connectors`(계획서 §7.1, `compare/connectors.rs`)로 변경마다 하나이고, 장에는 두 끝이 모두 그 장의 두 쪽(A 칸 쪽, B 칸 쪽)에 있는 변경만 그린다. 끝마다 줄 표시(Step 28-d, `ConnectorEnd::row`: 화면 방향 pt로 쪽 너비 전체 × 끝 사각형(글자 쪽 = 첫 쪽 상자 합집합, 앵커 쪽 = 막대)의 세로 범위)를 배율·칸 위치만 더해 장 좌표로 옮겨 그린다: 종류 선 색 0.5pt 테두리 + 종류 `-fill`의 반 알파 채움, 쪽을 놓고 테두리를 두른 직후 그 쪽의 변경 상자보다 먼저(상자가 위에 보인다). 선은 줄 표시의 거터 쪽 변 세로 가운데(A 쪽 오른쪽 끝) → A 칸 오른쪽 끝(수평) → 두 칸 사이 3차 베지어(제어점은 각 끝에서 간격 반만큼 수평) → B 칸 왼쪽 끝 → B 쪽 왼쪽 끝(수평)이고 종류 선 색 1pt·둥근 끝이다. 끝 쪽 상자가 2줄을 넘는 변경은 두 줄 표시의 위·아래 변을 같은 모양으로 이은 닫힌 띠를 종류 `-fill`(알파 그대로)로 채우고 0.5pt 종류 선 색 테두리를 두른다. 장의 연결선이 40개(`MAX_SHEET_CONNECTORS`, 단위 = 변경)를 넘으면 그 장에는 연결선도 줄 표시도 그리지 않는다. Step 28-c는 상자의 거터 쪽 변(앵커는 막대 가운데)에서 쪽 끝까지 수평으로 나갔다(대체됨). 번호 태그는 넣지 않는다(장 위 글자는 한글 글꼴 임베드가 필요하다, "빈 칸"과 같은 이유). Step 28은 가까운 `Replace`를 묶어 `connector` 45% 중립색으로 그렸다(대체됨). |
| 차이 있는 쪽만 | 장에 보이는 쪽(배치가 보이는 쪽) 중 하나에 숨기지 않은 변경 상자가 하나라도 있는 장만 남긴다. `draw_boxes`와 상관없다. 글자가 없는 쪽을 통째로 넣거나 뺀 행은 변경 상자가 없어 빠진다. 남는 장이 없으면 `EmptyReport`(파일을 만들지 않는다). |
| 주석 PDF | B 파일을 열어 메모리에서 주석만 더하고 다른 경로로 저장한다. 쪽 내용 스트림은 다시 만들지 않는다(pdfium-render 기본 재생성 전략을 `Manual`로 바꾼다). 추가·변경은 B 상자가 있는 쪽마다 주석 하나: 차이는 `Highlight`(상자마다 QuadPoints, `/C` = 종류 `-fill` 색, `/CA` = 그 알파), 확인 필요는 상자 합집합 `Square`(`/C` = 종류 선 색). `/Rect`는 그 쪽 상자 합집합이다. |
| 주석 순서 | QuadPoints는 왼쪽 위 → 오른쪽 위 → 왼쪽 아래 → 오른쪽 아래로 쓴다. 뷰어(Acrobat·pdf.js)와 pdfium의 모양 생성이 이 순서를 가정한다. pdfium-render `PdfQuadPoints::from_rect`(반시계)는 꼬인 사각형이 되어 강조가 거의 칠해지지 않는다(작업 중 렌더로 확인). |
| 삭제 주석 | B에 글자가 없으므로 B 앵커(§4, 지운 글자가 들어갈 자리) 자리에 `Text` 메모(아이콘 20pt, `/C` = `diff-delete`)를 단다(Step 28-c). 쪽은 `Anchor.page`이고, 아이콘 왼쪽 끝이 앵커 막대 x, 세로 가운데가 막대 가운데이며, 보이는 영역 안에 들도록 민다. 앵커의 쪽이 B에 없으면(쪽이 0개인 B) 달지 않는다. Step 23은 A 첫 상자의 왼쪽 위를 `view_box` 비율로 B에 옮겨 근사했다(대체됨: 줄 배치가 다른 두 판에서 엉뚱한 줄을 가리켰다). |
| 주석 내용 | `Placement::Boxes.text`로 `추가: …` / `삭제: …` / `변경 전: …\n변경 후: …`, 확인 필요는 앞에 `[확인 필요] `. 앱 화면 언어(한국어)로 고정한 `pdf-core` 상수다. |
| 저장 | 둘 다 `save_atomically`(임시 파일 + rename, 실패하면 임시 파일 삭제). 출력 경로가 이미 있고 입력 파일(비교 PDF는 A·B, 주석 PDF는 B)과 `canonicalize`한 경로가 같으면 `OutputIsSource`로 거부한다. 경로 허용 목록·앱이 연 파일 검사는 커맨드(`src-tauri`)의 몫이고 이것은 그 아래의 마지막 방어선이다. |
| 취소 | `cancel`(merge와 같은 `&AtomicBool`)을 비교 PDF는 장마다, 주석 PDF는 쪽마다, 둘 다 저장 직전에 확인하고 `Cancelled`를 돌려준다. 파일이 남지 않는다. 진행률 콜백은 두지 않았다(필요하면 실행기 Step이 더한다). |
| 미리보기 | 같은 장 고르기로 첫 `max_sheets`장만 메모리에 만들어 너비 `width_px`(1 ~ `MAX_PREVIEW_WIDTH_PX` 2400으로 자른다)로 렌더하고 PNG 바이트(`image` 크레이트 `png` 기능)로 돌려준다. `sheet_count`는 그린 장 수가 아니라 내보낼 때의 전체 장 수다(화면의 쪽수 표시). 파일은 쓰지 않는다. |
| 에러 코드 | `OUTPUT_IS_SOURCE`, `INVALID_PAGE`(결과의 쪽 번호가 파일 쪽 수나 `page_sizes` 밖: 다른 파일을 넘겼다), `EMPTY_REPORT`, `CANCELLED`, `PDFIUM_FAILURE`(새 문서 조립 실패), `IMAGE_ENCODE_FAILED`, 그리고 문서 열기·저장 코드. |

- 측정(픽스처): 5쪽·6쪽 원본(28KB·31KB)을 나란히 6장으로 내보내면 264KB다. `FPDF_NewXObjectFromPage`가 호출마다 쪽 리소스(임베드 글꼴 등)를 새로 복사해 장마다 글꼴이 한 벌씩 들어간다. 100쪽 계약서에서 수 MB~수십 MB가 될 수 있다. 줄이려면 같은 원본 쪽 리소스를 공유하는 XObject 생성(pdfium-render가 내주지 않는 저수준 경로)이 필요하므로 실제 문서로 재 본 뒤 정한다.
- 한계: CropBox가 MediaBox와 겹치지 않는 쪽(잘못 만든 PDF, §8)은 pdfium XObject의 보이는 영역이 비어 내용이 보이지 않고 테두리만 남는다.
- 한계: 주석 모양(AP 스트림)은 넣지 않는다. Highlight·Square·Text는 pdfium·pdf.js·Acrobat이 없으면 만들어 그린다.
- 버린 대안: pdfium `FPDF_ImportNPagesToOne`(`tile_into_new_document`) — 한 문서의 쪽만 고정 격자로 깔아 두 문서·짝 없는 행·칸별 배율을 할 수 없다. 쪽을 이미지로 렌더해 붙이기 — 글자가 벡터가 아니게 되고 파일이 커진다. 삭제 주석 생략 — 계약서에서 지운 조항은 놓치면 안 되는 차이다. 확인 필요를 다른 색으로 — 토큰에 없는 색을 늘리게 된다.
- 테스트(`report/tests.rs`): 출력 PDF를 pdfium으로 다시 열어야 해서 crate 안 테스트 모듈에 둔다. 연결선은 끝점 픽스처(`connector-geometry-a.pdf`·`-b.pdf`, 회전 0·90·180·270·CropBox 오프셋·MediaBox 원점)를 나란히 내보내 장마다 두 끝이 그 장에 있는 변경마다 줄 표시 A·B 하나씩(놓인 쪽 너비 전체 × 끝 사각형을 장 좌표로 옮긴 세로 범위, 종류 색, 채움, 칸마다 변경 상자보다 먼저)과 선 하나(베지어를 가진 경로)이고, 시작점·끝점이 줄 표시의 쪽 끝 세로 가운데이며 칸 끝까지 수평으로 가는지, 색이 종류 선 색인지, 띠는 채운 닫힌 경로이고 위·아래 변 모서리가 맞는지, 색 상자를 빼거나 한쪽 배치면 없고 변경을 숨기면 그 종류만 빠지는지, 한 장 40개는 그리고(줄 표시 80개) 41개면 연결선·줄 표시를 하나도 그리지 않는지 본다. 삭제 메모는 B 앵커 자리(왼쪽 끝·세로 가운데)인지 본다. 회전 90·180·270·CropBox 오프셋·MediaBox 원점·`UserUnit 2` 쪽(`text-geometry.pdf`)에서 그린 상자가 출력 장에서 pdfium이 다시 뽑은 같은 낱말 글자들을 덮는지, 배치 3종·차이 쪽만·숨긴 종류가 고른 행(출력 장 글자로 알아본다), 주석 종류·사각형·내용·개수와 강조가 실제로 칠해지는지(렌더), 원본 바이트 불변, 출력=입력 거부(`..` 경로 포함), 취소, 미리보기 장 수·PNG 너비·색 상자 유무를 확인한다.

### 15. 작업 실행기 (Step 22에서 정함)

공개 API는 `compare_pdfs(engine, request, ocr, ocr_cache, extraction_cache, cancel, on_progress) -> Result<CompareResult, CompareError>`이고 요청은 `CompareRequest { job_id, before, after, options: CompareOptions }`다. 코드는 `crates/pdf-core/src/compare/runner.rs`와 `runner/{progress,cache}.rs`다. 호출자(`src-tauri`)는 OCR 엔진을 한 번 로드해 `Option<&mut OcrEngine>`로(로드 실패면 `None`), OCR 디스크 캐시(`OcrCache::new(앱 캐시 폴더)`)와 추출 메모리 캐시(`ExtractionCache`, 앱에 하나)를 넘긴다. 에러는 `Document`(파일 열기·읽기, 경로 포함), `Options`(`INVALID_RANGE`), `Cancelled`다.

| 단계 `stage` | 하는 일 | `done / total` 단위 | 가중치 | 측정(100쪽 텍스트 짝) |
|---|---|---|---|---|
| `ExtractA` | A 텍스트 레이어 추출(§8) | A 쪽(문서 전체) | 20 | 68 ms |
| `ExtractB` | B 텍스트 레이어 추출 | B 쪽(문서 전체) | 20 | 68 ms |
| `Ocr` | 비교 범위 안 OCR 대상 쪽 읽기(§11) | 대상 쪽(A·B 합) | 30 | 0 ms(대상 없음) |
| `Normalize` | 쪽 범위 선택 → 줄 제외(§13) → 토큰화(§9) | 범위 쪽(A·B 합) | 5 | 25 ms |
| `Diff` | 토큰 diff(§10) | 앵커 사이 구간(앵커 수 + 1) | 15 | 2 ms |
| `AlignPages` | 쪽 짝짓기(§12)와 결과 조립 | 범위 쪽(A·B 합) | 10 | 1 ms |

| 항목 | 규칙 |
|---|---|
| 순서 | 두 파일을 열어(추출 캐시에 있으면 열지 않는다) 쪽 수를 얻고 쪽 범위를 검사한 뒤 위 표 순서로 간다. 범위가 잘못되면(`InvalidRange`) 진행 이벤트를 하나도 보내지 않고 끝난다. 각 단계는 앞 단계가 끝나야 시작한다. |
| 진행 이벤트 | `CompareProgress { job_id, stage, done, total, stage_percent, overall_percent, detail }`, `job_id`는 요청 그대로다. `stage_percent = ⌊done × 100 / total⌋`(`total`이 0이면 100). `overall_percent = ⌊(끝난 단계 가중치 합 × 100 + stage_percent × 지금 단계 가중치) / 100⌋`로 계획서의 `Σ(stage_percent × 가중치) / 100`이다. 단계 %를 거쳐 내리므로 병합식 `⌊done × 가중치 / total⌋`보다 1 작을 수 있다. 가중치는 `runner/progress.rs` 상수다. |
| 1% 단위·100 | 직전 이벤트와 단계·단계 %·전체 %가 모두 같으면 보내지 않는다(병합과 같다). 단계 안 이벤트는 많아야 101개다. 단계 100은 그 단계 일이 끝난 뒤(diff는 변경과 글자 diff까지 만든 뒤, 토큰화는 마지막 쪽의 토큰을 만든 뒤), 전체 100은 결과를 다 만든 뒤 마지막 이벤트로만 나온다. |
| `detail` | `done`·`total`로 알 수 없는 것만 담는다. `Some(Cached)` = 이 단계를 앞선 실행의 캐시로 바로 끝냈다(추출 캐시 적중, 또는 OCR 대상 쪽이 모두 추출 캐시·OCR 디스크 캐시에 있다). 그 밖에는 `None`이다. 화면 세부 문구(`12 / 19쪽`)는 단계 단위와 `done`·`total`로 만든다. |
| 바로 100% | 렌더·인식할 일이 없는 단계는 100% 이벤트 하나만 보낸다: 캐시로 끝난 추출(`Cached`), OCR 대상 쪽이 없는 OCR(`0 / 0`), 대상 쪽이 모두 캐시에 있는 OCR(`Cached`), OCR 엔진이 없는 OCR(대상 쪽은 §11대로 텍스트 레이어로 비교하고 `NoTextLayer(OcrUnavailable)`). |
| 취소 | 시작할 때와 단계를 시작할 때마다, 추출은 쪽을 읽을 때마다, OCR은 쪽마다(시작 전·렌더 뒤·추론 뒤, §11) 확인해 `Cancelled`로 끝난다. 쓰는 파일은 OCR 디스크 캐시(끝난 쪽만, 임시 파일 + rename)뿐이라 지울 것이 없다. 추출 캐시에는 끝까지 읽은 문서만 넣는다. diff 단계 안에서는 보지 않는다(시간 제한 §10이 상한). |
| 추출 캐시 | 메모리 LRU, 문서 `EXTRACTION_CACHE_DOCUMENTS`(4, 비교 두 번 분량)개. 키는 (경로, 크기, 수정 시각)이다. 값은 문서 전체 쪽의 텍스트 레이어 추출 결과와 OCR에 성공한 쪽의 OCR 글자로, 옵션과 상관없다. 그래서 옵션(쪽 범위·줄 제외·대소문자)만 바꾼 재실행은 추출·OCR을 하지 않는다. OCR 실패는 담지 않아 다음 실행에서 다시 시도하고, 범위를 넓혀 새 대상 쪽이 생기면 그 쪽만 OCR한다. |
| OCR 단계 | 두 문서 **비교 범위 안**의 OCR 대상 쪽(§8 `needs_ocr`)만 읽는다. 범위 밖 스캔 쪽은 OCR하지 않고 출처가 `None`이며 안내도 없다(§3·§6). 쪽마다 추출 캐시 → OCR 디스크 캐시(파일 해시는 이때만 센다) → OCR 엔진 순서로 채우고, 캐시로 채운 쪽은 첫 이벤트부터 끝난 것으로 센다. 순서는 A 쪽들 다음 B 쪽들이다. |
| 글자 정리 | 범위 쪽마다 OCR한 쪽은 OCR 글자로 바꾸고 줄을 뺀 뒤 토큰화한다. 범위 안에 출처가 OCR인 쪽이 어느 문서에든 있으면 두 문서 모두 NFKC다(§5). NFKC 판단과 토큰화는 `compare_texts`와 같은 함수(`tokenize_pair`)다. `LowTextConfidence`는 줄 제외 전 텍스트 레이어 글자로 판정한다. |
| 쪽 짝짓기 단위 | 행 수는 짝짓기가 끝나야 알 수 있어 0% 이벤트에 `total`을 줄 수 없다. 그래서 두 범위 쪽 수 합(쪽마다 한 행에 한 번 놓인다)을 단위로 0%와 100%만 보낸다(500쪽 약 9 ms, §12). |
| 문서 열기 | pdfium의 마지막 오류(`FPDF_GetLastError`)는 스레드마다 따로 있지 않다. pdfium-render는 열기와 오류 읽기에서 잠금을 따로 잡아, 병렬로 열면 다른 스레드의 열기 실패가 실패 이유를 덮었다(암호 문서가 `InvalidPdf`. 8스레드 × 500회에서 10번 중 10번 재현, `pdf_info.rs`). Step 22는 열기만 감싸는 잠금(`document.rs` `load_exclusively`)으로 막았고, Step 29부터는 아래 "pdfium 잠금"이 열기와 오류 읽기를 한 구간으로 감싸므로 그 잠금을 지웠다. |
| pdfium 잠금(Step 29) | pdfium을 쓰는 pdf-core 공개 함수(정보 읽기·병합·TIFF 변환·추출·비교 실행기·OCR 렌더·리포트 내보내기·미리보기)는 시작할 때 프로세스 잠금 하나(`engine.rs` `PDFIUM_LOCK`)를 잡고 끝날 때 놓는다(`PdfEngine::session` → `PdfiumSession`). `&Pdfium`은 이 세션의 `Deref`로만 얻으므로 그 핸들로 연 문서·쪽·비트맵은 세션보다 오래 살 수 없다(컴파일러가 확인한다). 그래서 pdfium 호출과 객체 해제가 모두 잠금 안에서 일어난다. 비교 실행기는 비교 하나 동안 세션을 쥐고, pdfium을 부르지 않는 OCR 추론(ONNX Runtime)과 OCR 디스크 캐시용 파일 해시만 `PdfiumSession::unlocked`로 잠금 밖에서 돌린다(열어 둔 문서는 그대로 두되 그동안 pdfium을 부르지 않는다). 세션을 쥔 채 다른 공개 함수를 부르면 같은 스레드가 잠금을 다시 잡아 멈추므로, 공개 함수끼리 부를 때는 `&Pdfium`을 받는 crate 안 함수(`read_text_layer` 등)를 쓴다. 잠금 순서는 OCR 엔진 슬롯(`src-tauri`, 비교만 잡는다) → 이 잠금 → 추출 캐시·pdfium-render 함수별 잠금 하나뿐이다. 이 잠금을 쥔 채 기다리는 잠금은 뒤의 둘(안에서 pdfium도 이 잠금도 부르지 않는 짧은 구간)뿐이라 그 둘을 쥔 채 이 잠금을 기다리는 곳이 없고, OCR 엔진 슬롯을 쥔 채 이 잠금을 기다리는 비교는 있어도 이 잠금을 쥔 다른 작업은 OCR 엔진 슬롯을 기다리지 않으므로(두 비교는 슬롯에서 먼저 줄 선다) 교착이 없다. |

- 측정(release, Apple M3 Pro, 다른 빌드가 돌던 부하 load average 약 5): 가상 계약서 텍스트 A·B(2쪽)를 50번 이어 만든 100쪽 짝(변경 350개)은 전체 167 ms(위 표), 옵션만 바꾼 재실행 28 ms(추출·OCR 0, 정리 25 ms)다. 같은 방식의 500쪽 짝은 841 ms(추출 339·346, 정리 121, diff 9, 짝짓기 5), 재실행 146 ms다. Phase 3 목표(100쪽 5초) 안이다.
- 측정(스캔 쪽, `contract-b-scan-300dpi.pdf`, 400dpi 렌더): 쪽당 렌더 71~75 ms, 인식 524~963 ms(줄 20·45개). 스캔 2쪽 짝 전체 1.59초이고 거의 모두 OCR 단계다.
- 가중치: 텍스트 짝에서는 추출이 시간의 약 80%이고 diff·짝짓기는 2% 미만이라 계획서 가중치(diff 15, 짝짓기 10)일 때 그 구간을 순식간에 지난다. 스캔 쪽이 있으면 OCR이 거의 전부다. Step 22는 계획서 시작값을 그대로 두고 측정만 기록한다. 조정은 실제 문서로 진행 화면(Phase 3)을 본 뒤 한다.
- 메모리: 추출 글자 하나(`ExtractedChar`)가 40 B다. 위 100쪽 문서(70,900자)는 2.8 MB, 500쪽은 14.2 MB이고, 캐시 4문서면 500쪽 문서로 약 57 MB다.
- 렌더·추론 스레드(계획서 §6.4 2번): 지금은 나누지 않는다. pdfium 호출은 위 "pdfium 잠금"이 구간마다 줄 세우고(`src-tauri`는 작업마다 `spawn_blocking`), OCR 추론은 그 잠금 밖에서 돈다. 그래서 OCR 중인 비교가 병합·내보내기를 막는 시간은 쪽당 렌더와 추출뿐이고, 렌더를 다른 스레드에서 미리 해 두는 파이프라인은 쪽당 시간을 렌더 몫(약 10%)만큼만 줄인다. 측정한 병목이 아니므로 그대로 둔다.
- Step 22~28의 이 항목은 "pdfium-render `thread_safe`가 함수마다 프로세스 잠금으로 줄 세운다"고 적었으나 사실이 아니었다. pdfium-render 0.9.4 `thread_safe`는 pdfium 함수 467개 중 182개(`FPDFPageObj_SetStrokeColor`·`GetStrokeColor`·`FPDFPath_BezierTo`·`FPDF_NewXObjectFromPage`·`FPDFText_GetCharBox`·`FPDFText_GetText`·`FPDF_RenderPageBitmapWithMatrix` 등, 함수 정의를 세어 확인)를 잠금 없이 부른다. 그래서 내보내기(장마다 상자·연결선 색 칠하기)와 미리보기 렌더·추출이 동시에 돌면 pdfium 공유 색공간의 참조 수가 깨져 `CPDF_Color::GetColorRef`에서 죽는다(Step 28에서 리포트 테스트 병렬 실행 20번 중 7번 재현). 함수마다가 아니라 구간마다 잡는 잠금은 pdfium이 스레드 안전하지 않다는 전제와 맞고, pdfium-render가 빠뜨린 함수를 하나씩 따라갈 필요가 없다.
- 측정(Step 29, Apple M3 Pro): 재현 테스트(`tests/pdfium_concurrency.rs`, 12스레드 × 20회로 비교 PDF·주석 PDF 내보내기·미리보기·추출·정보 읽기를 섞는다)는 잠금을 빼면 30번 중 29번 SIGSEGV로 죽고, 잠금이 있으면 20번 중 20번 통과하며 debug 빌드 약 3초 걸린다(모두 줄 서므로 한 스레드로 돌린 시간과 같다). OCR 비교(텍스트 2쪽 ↔ 300dpi 스캔 2쪽, release, 1.64초) 동안 다른 스레드가 5 ms 간격으로 정보 읽기를 부르면, 추론을 잠금 밖에 둔 지금은 약 190번 중 중앙값 0 ms·최대 85~90 ms(쪽 하나 렌더) 기다리고, 추론까지 잠금 안에 두면 첫 호출이 비교가 끝날 때까지 1.64초 기다린다.
- 버린 대안(pdfium 잠금): pdfium-render `thread_safe`가 빠뜨린 함수만 감싸는 래퍼 — 182개를 따라가야 하고 버전마다 바뀐다. 테스트만 잠그기(Step 28 `pdfium_serialized`) — 앱의 여러 작업 스레드는 그대로 겹친다. pdfium 전용 작업 스레드 하나에 모든 일을 보내기 — 커맨드마다 결과·진행률을 스레드 사이로 옮기는 코드가 늘고, 구간 잠금과 줄 서는 결과가 같다.
- 한계: 추출 캐시는 (경로, 크기, 수정 시각)이 같으면 같은 파일로 본다. 내용을 바꾸고 크기와 수정 시각을 되돌린 파일은 알아보지 못한다.
- 테스트(`compare_runner.rs`): 텍스트 짝의 진행 규칙(순서·단조·1% 단위·100은 끝에만)과 결과(diff·쪽 짝 golden), 쪽 범위의 쪽 번호·출처·OCR 대상, `InvalidRange` 때 이벤트 없음, 추출 중·OCR 중 취소, 옵션만 바꾼 재실행(추출 `Cached`, 결과가 캐시 없는 실행과 같음), 파일을 고치면 다시 추출, 스캔 짝의 쪽별 OCR 진행과 재실행(메모리 캐시만·디스크 캐시만으로 OCR 엔진 없이 `Cached`), OCR 엔진이 없을 때 바로 100%. 공식·1% 단위는 `runner/progress.rs` 단위 테스트다.
- 버린 대안:
  - 추출 캐시 키를 파일 해시로: 맞는지 보려고 매번 파일 전체를 읽어야 한다(큰 스캔 파일 수백 ms). OCR 디스크 캐시는 대상 쪽이 있을 때만 해시를 센다.
  - 메모리 캐시에 OCR 글자를 두지 않고 OCR 디스크 캐시만 쓰기: 재실행마다 파일 해시와 쪽 JSON 읽기가 들고, 디스크 캐시 없이 부른 실행은 다시 OCR한다.
  - 문서 전체 쪽을 OCR: 범위를 좁힌 비교에서도 스캔 문서 전체(쪽당 약 1초)를 읽는다.
  - 쪽 짝짓기 단위를 행으로: 0% 이벤트에 `total`이 없다.
  - diff 구간마다 변경까지 만들기: `Change.id`의 뒤 문맥(§4)이 다음 구간의 공통 토큰을 봐야 해 구간을 미리 나눌 수 없다. 구간은 Myers 전에 세고 변경 만들기는 마지막 구간에 든다.

### 16. 비교 커맨드 (Step 26에서 정함)

커맨드는 `compare_pdfs(request: CompareRequest, on_progress: Channel<CompareProgress>) -> CompareResult`, 취소는 병합과 같은 `cancel_job(request.jobId)`다. 코드는 `src-tauri/src/compare.rs`(검증과 실행기 위임, 앱 상태), 계약 미러는 `src-tauri/src/contract.rs`, 에러 코드는 `src-tauri/src/error.rs`다.

| 항목 | 규칙 |
|---|---|
| 요청 | `CompareRequest { jobId, before, after, options: CompareOptions { rangeA, rangeB, excludeHeader, excludeFooter, excludePageNumbers, ignoreCase } }`. 옵션은 §13과 같은 필드를 camelCase로 받아 `From`으로 pdf-core `CompareOptions`에 옮긴다. |
| 경로 | A·B는 허용 경로 목록(사용자가 고르거나 놓은 파일, 앱 폴더) 안의 PDF만 받는다(`PathAccess::readable`). 밖이면 진행 이벤트 없이 `PATH_NOT_ALLOWED`. 실행기에는 canonical 경로를 넘겨 추출 캐시 키(§15)가 같은 파일에서 같다. |
| 진행 이벤트 | `CompareProgress { jobId, stage, done, total, stagePercent, overallPercent, detail }`. 단계 값은 camelCase(`extractA`·`extractB`·`ocr`·`normalize`·`diff`·`alignPages`)로 병합(`readFiles`)과 §7 단위 enum 규칙을 따른다. `detail`은 `"cached"` 또는 `null`. 받는 창이 닫혀 보내지 못해도 비교는 계속한다. |
| 결과 | §7 계약 JSON 그대로다. `Notice`·`PageSizes`·`PageSources`·`Side`·`TextSource`·`NoTextReason`은 pdf-core에 `Serialize`가 없어 미러만 직렬화한다. 확인: `compare.rs`의 `contract_json_mirrors_the_pdf_core_result`가 같은 비교의 계약 JSON과 pdf-core 직렬화(변경·쪽 짝·쪽 크기)를 맞대고, `Notice`·출처는 §7의 모양 리터럴과 맞댄다. |
| 에러 코드 | `CompareError::Document` → 문서 열기 코드(`NOT_FOUND`·`INVALID_PDF`·`PASSWORD_PROTECTED`…), `path` = 그 문서. `CompareError::Options(InvalidRange)` → 새 코드 `INVALID_RANGE`, `path` = `null`(입력 파일이 아니라 사용자가 쓴 범위 문자열 탓이다. 화면은 실행 전에 같은 규칙으로 막는다, §13). `CompareError::Cancelled` → `CANCELLED`. 짝짓기는 `error.rs` 한 곳의 `match`라 pdf-core에 변형이 늘면 컴파일이 멈춘다. |
| 앱 상태 | `CompareState` 하나를 `app.manage`한다: 추출 메모리 캐시(`ExtractionCache`, 앱에 하나), OCR 디스크 캐시(`OcrCache::new(앱 캐시 폴더/ocr)`), OCR 엔진 슬롯(`Mutex<OcrSlot>`: 로드 전·로드됨·없음). `compare_pdfs`가 엔진을 `&mut`로 쓰므로 비교 하나가 끝날 때까지 잠금을 잡는다(동시에 두 비교가 오면 뒤의 것이 기다린다. 화면은 한 번에 하나만 실행한다). |
| OCR 엔진 | 첫 비교에서 로드한다(`OcrEngine::load(번들 라이브러리 폴더, 리소스/ocr-models)`, 개발·테스트는 `ONNXRUNTIME_LIB_PATH`·`OCR_MODEL_DIR`이 먼저). 실패하면(런타임·모델이 없음, 번들 경로를 모름) 경고 로그를 남기고 슬롯을 "없음"으로 두어 OCR 없이 비교한다(스캔 쪽은 `NoTextLayer(OcrUnavailable)`, §15). 앱을 다시 시작할 때까지 다시 로드하지 않는다. |
| 번들 위치 | macOS는 ONNX Runtime dylib를 pdfium과 같은 `Contents/Frameworks`(`bundle.macOS.frameworks`), 모델 세 파일은 `Contents/Resources/ocr-models`(`bundle.resources`). Windows·Linux의 라이브러리는 리소스 폴더(`pdf_engine::bundled_library_dir`)에서 찾고, 그 번들 설정은 CI(P4-1)가 `--config`로 더한다(계획서 §6.4 배포). |

- 측정(release, Apple M3 Pro): OCR 엔진 첫 로드 711 ms(dylib 로드 + 검출·인식 세션 생성), 상주 메모리 +68 MB(로드 안 한 프로세스 10 MB → 79 MB). 병합만 쓰는 사용자가 이 메모리를 내지 않도록 앱 시작이 아니라 첫 비교에서 로드한다. 그래서 앱을 켠 뒤 첫 비교는 진행률 0%에서 약 0.7초 머문다(진행 이벤트는 실행기가 시작해야 나온다).
- 버린 대안: 앱 시작 때(또는 별도 스레드에서) 미리 로드 — 비교를 안 쓰는 실행에도 68 MB를 쓴다. OCR 대상 쪽이 생길 때만 로드 — 실행기 API(`Option<&mut OcrEngine>`)를 바꿔야 하고, 측정한 병목이 아니다. 실행기마다 엔진을 새로 만들기 — 비교마다 0.7초.
- 테스트(`src-tauri/src/compare.rs`, OCR 없이): 고르지 않은 파일 거부(이벤트 없음), 쪽 범위 오류가 `INVALID_RANGE`·경로 없음, `cancel_job` 토큰이 추출 중 비교를 멈춤, 계약 JSON 미러.

### 17. 리포트 커맨드 (Step 29에서 정함)

커맨드는 `preview_compare_report(request) -> ReportPreview`, `export_compare_pdf(request) -> ExportedFile`, `export_annotated_pdf(request) -> ExportedFile`, `pick_save_directory(options) -> 폴더 | null`이고 취소는 `cancel_job(request.jobId)`다. 코드는 `src-tauri/src/report.rs`(검증과 pdf-core 위임), 내보내기 폴더와 새 이름은 `src-tauri/src/access.rs`, 계약은 `src-tauri/src/contract.rs`다.

| 항목 | 규칙 |
|---|---|
| 결과 | 프론트가 비교 커맨드에서 받은 `CompareResult` 계약 JSON을 그대로 다시 보낸다. 앱(Rust)은 끝난 결과를 따로 두지 않는다(결과를 어느 실행의 것으로 찾을지, 몇 개를 둘지 정할 상태가 생기지 않는다). 계약 미러는 이제 양쪽(`Serialize` + `Deserialize`, pdf-core로 옮기는 `From`)이다. 결과의 쪽 번호가 문서 밖이면 pdf-core가 `INVALID_PAGE`(그 문서 경로)로 거부한다. 확인: `report.rs`의 `compare_result_sent_back_by_the_front_equals_the_pdf_core_result`(회전·CropBox 오프셋·짝 없는 행·안내가 든 결과의 왕복이 pdf-core 결과와 같다). |
| 옵션 | `CompareReportOptions { layout: "sideBySide" \| "aOnly" \| "bOnly", changedPagesOnly, drawBoxes, hiddenKinds }`가 §14 옵션 그대로다. `hiddenKinds`는 결과 화면 필터에서 끈 종류다. 주석 PDF 요청도 같은 `hiddenKinds`를 싣는다. 확인 필요 칩은 종류가 아니라 싣지 않는다(§14 "숨긴 종류"). 연결선은 따로 고르지 않는다(나란히 + 색 상자일 때 그린다, 화면의 "연결선" 체크박스와 잇지 않는다). |
| 입력 경로 | A·B는 허용 경로 목록(또는 앱 폴더) 안의 PDF만 받는다(`PathAccess::readable`, §16과 같다). |
| 출력 | 저장 위치는 파일이 아니라 폴더다. 폴더 다이얼로그(`pick_save_directory`)에서 고른 폴더를 허용 목록의 "내보내기 폴더"로 기록하고, 요청은 `output: { directory, fileName }`이다. 그 폴더 바로 안의 이름 하나(경로 구분자·`..` 없음, 확장자 `pdf`)만 받는다. 같은 이름의 파일(또는 링크)이 있으면 덮지 않고 `이름 (2).pdf` ~ `이름 (999).pdf` 중 비어 있는 첫 이름에 만들고, 실제 이름을 `ExportedFile.fileName`으로 돌려준다(다 차면 `WRITE_FAILED`). 고르지 않은 폴더·이름 형식이 틀리면 `PATH_NOT_ALLOWED`, 확장자가 다르면 `UNSUPPORTED_FILE_TYPE`, 폴더가 사라졌으면 `OUTPUT_DIRECTORY_NOT_FOUND`다. 출력이 비교한 파일이면 pdf-core가 `OUTPUT_IS_SOURCE`로 거부한다(새 이름이라 일어나지 않지만 마지막 방어선이다). |
| 미리보기 | 앞 `PREVIEW_SHEETS`(8)장을 요청 너비(1 ~ 2400px)로 그려 PNG를 표준 base64 문자열로 보낸다(`ReportPreview { sheetCount, images }`). 프론트는 `data:image/png;base64,`에 붙여 그린다(CSP `img-src data:`). 바이너리 응답(`tauri::ipc::Response`)은 여러 그림과 장 수를 함께 싣지 못해 쓰지 않았다(base64는 1.33배지만 장 하나가 수십 KB다). 넣을 장이 없으면 `EMPTY_REPORT`(경로 없음)이고 화면은 그것으로 "넣을 쪽이 없어요"를 보인다. |
| 에러 코드 | 새 코드 `EMPTY_REPORT`·`IMAGE_ENCODE_FAILED`. `ReportError` → `ErrorCode`는 `error.rs` 한 곳의 `match`다(`Compose` → `PDFIUM_FAILURE`). `path`는 `InvalidPage`와 문서 열기 실패일 때만 그 입력 문서이고, 출력·조립·그림·저장 실패와 `OUTPUT_IS_SOURCE`는 `null`이다. |
| 취소 | 내보내기 두 커맨드는 병합·비교처럼 작업 ID를 등록하고 `cancel_job`이 켜는 토큰을 pdf-core에 넘긴다(§14 취소). 미리보기는 취소하지 않는다(앞 8장이라 짧고, 화면은 늦게 온 응답을 버린다). |

- 버린 대안: 결과를 Rust에 두고 작업 ID로 찾기 — 어느 결과까지 둘지(마지막 하나·여러 개)와 취소·실패 뒤 상태를 정해야 하고, 결과 JSON은 수백 KB라 IPC로 다시 보내는 비용이 작다. 저장 다이얼로그(파일 하나 고르기)로 저장 위치 정하기 — 비교 PDF와 주석 PDF 두 파일 중 하나의 경로만 허용 목록에 들어가 두 번째 파일을 쓸 수 없다. 같은 이름이면 덮어쓰기 — 사용자가 고른 폴더의 다른 파일을 물어보지 않고 지울 수 있다(원본은 아니어도 사용자 데이터다).
- 테스트(`src-tauri/src/report.rs`): 결과 왕복, 고르지 않은 폴더·경로가 섞인 이름·고르지 않은 원본 거부와 같은 이름의 사용자 파일·앞서 내보낸 파일을 덮지 않고 번호를 붙이기, 미리보기 그림이 표준 base64 PNG(요청 너비)이고 넣을 장이 없으면 `EMPTY_REPORT`.

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
