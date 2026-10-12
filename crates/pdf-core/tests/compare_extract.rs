//! 텍스트 레이어 글자 추출의 golden 검증(ADR 0001 §2 좌표 규칙). 통합 테스트는 파일마다 별도
//! 프로세스라 pdfium 바인딩(프로세스당 한 번)이 다른 테스트 파일과 겹치지 않는다.
//!
//! golden은 E2E(`e2e/text-box-geometry.spec.ts`)도 그대로 읽어 pdf.js 화면 위치와 맞춰 본다.
//! 픽스처(`generate_compare_fixtures.py`)나 추출 규칙을 바꾸면 `UPDATE_GOLDEN=1`로 다시 쓰고,
//! 바뀐 값을 눈으로 확인한 뒤 E2E까지 통과시킨다.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use pdf_core::{PdfEngine, extract_text_layer};
use serde::Serialize;
use serde_json::Value;
use serde_json::ser::Formatter;

const LIBRARY_PATH_ENV: &str = "PDFIUM_LIB_PATH";
/// 있으면 비교하지 않고 golden 파일을 지금 결과로 다시 쓴다.
const UPDATE_GOLDEN_ENV: &str = "UPDATE_GOLDEN";
/// 좌표·크기 허용 오차(pt). 플랫폼별 pdfium 빌드의 부동소수점 차이만 흡수한다.
const GOLDEN_TOLERANCE: f64 = 0.01;

fn engine() -> &'static PdfEngine {
    static ENGINE: OnceLock<PdfEngine> = OnceLock::new();
    ENGINE.get_or_init(|| {
        assert!(
            std::env::var_os(LIBRARY_PATH_ENV).is_some(),
            "{LIBRARY_PATH_ENV} is required: run `node scripts/fetch-pdfium.mjs` and export it"
        );
        // 번들 폴더는 없는 경로를 준다: 환경변수 경로로 바인딩돼야 통과한다.
        PdfEngine::bind(Path::new("/nonexistent/pdfium")).expect("bind pdfium")
    })
}

fn test_path(folder: &str, name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join(folder)
        .join(name)
}

/// 상자 좌표는 CropBox 원점이 들어간 절대 사용자 공간 좌표이고(/Rotate·UserUnit 미적용),
/// view_box(CropBox ∩ MediaBox, 비면 MediaBox) 밖 글자는 빠지며, 글꼴 크기는 Tf·Tm·CTM을
/// 모두 반영하고, 쪽 번호만 있는 쪽은 OCR 대상이다.
#[test]
fn text_geometry_extraction_matches_golden() {
    assert_extraction_matches_golden("text-geometry");
}

/// Identity-H CID 글꼴(임베드 TrueType + ToUnicode)의 한글·숫자·괄호를 회전·CropBox 오프셋
/// 쪽까지 같은 규칙으로 읽는다.
#[test]
fn korean_cid_extraction_matches_golden() {
    assert_extraction_matches_golden("korean-text");
}

/// 같은 내용이면 /Rotate(0·90·180·270)와 상관없이, 글자를 돌려 그리고 /Rotate로 바로 세운
/// 쪽까지 같은 글자 순서를 낸다. 순서가 다르면 회전만 바꾼 문서끼리 비교해도 차이가 생긴다.
#[test]
fn page_rotation_does_not_change_text_order() {
    let pages = extract_text_layer(engine(), &test_path("fixtures", "rotation-order.pdf"))
        .expect("extract text layer");
    let texts: Vec<String> = pages
        .iter()
        .map(|page| page.chars.iter().map(|extracted| extracted.ch).collect())
        .collect();

    // 줄 끝 `\r\n`은 pdfium이 만든 줄바꿈이다.
    let content_order = [
        "First line of the clause",
        "Second line follows it",
        "Third line ends here",
    ]
    .join("\r\n");
    for (page_number, text) in texts.iter().enumerate() {
        assert_eq!(text, &content_order, "page {page_number}");
    }
}

fn assert_extraction_matches_golden(fixture_stem: &str) {
    let pages = extract_text_layer(
        engine(),
        &test_path("fixtures", &format!("{fixture_stem}.pdf")),
    )
    .expect("extract text layer");
    let actual = golden_json(&pages);
    let golden_path = test_path("golden", &format!("{fixture_stem}.extract.json"));

    if std::env::var_os(UPDATE_GOLDEN_ENV).is_some() {
        std::fs::write(&golden_path, &actual).expect("write golden");
        return;
    }
    let expected = std::fs::read_to_string(&golden_path).expect("read golden");
    let mut mismatches = Vec::new();
    collect_mismatches(&parse(&expected), &parse(&actual), "$", &mut mismatches);
    assert!(
        mismatches.is_empty(),
        "{} differs from golden ({} mismatches, first 20):\n{}",
        golden_path.display(),
        mismatches.len(),
        mismatches[..mismatches.len().min(20)].join("\n")
    );
}

fn parse(json: &str) -> Value {
    serde_json::from_str(json).expect("valid JSON")
}

fn collect_mismatches(expected: &Value, actual: &Value, path: &str, out: &mut Vec<String>) {
    match (expected, actual) {
        (Value::Number(expected_number), Value::Number(actual_number)) => {
            let (expected_value, actual_value) = (
                expected_number.as_f64().expect("finite number"),
                actual_number.as_f64().expect("finite number"),
            );
            if (expected_value - actual_value).abs() > GOLDEN_TOLERANCE {
                out.push(format!(
                    "{path}: expected {expected_value}, got {actual_value}"
                ));
            }
        }
        (Value::Array(expected_items), Value::Array(actual_items)) => {
            if expected_items.len() != actual_items.len() {
                out.push(format!(
                    "{path}: expected {} items, got {}",
                    expected_items.len(),
                    actual_items.len()
                ));
            }
            for (index, (expected_item, actual_item)) in
                expected_items.iter().zip(actual_items).enumerate()
            {
                collect_mismatches(expected_item, actual_item, &format!("{path}[{index}]"), out);
            }
        }
        (Value::Object(expected_fields), Value::Object(actual_fields)) => {
            let mut keys: Vec<&String> =
                expected_fields.keys().chain(actual_fields.keys()).collect();
            keys.sort();
            keys.dedup();
            for key in keys {
                let field_path = format!("{path}.{key}");
                match (expected_fields.get(key), actual_fields.get(key)) {
                    (Some(expected_field), Some(actual_field)) => {
                        collect_mismatches(expected_field, actual_field, &field_path, out);
                    }
                    (expected_field, actual_field) => out.push(format!(
                        "{field_path}: expected {expected_field:?}, got {actual_field:?}"
                    )),
                }
            }
        }
        _ if expected == actual => {}
        _ => out.push(format!("{path}: expected {expected}, got {actual}")),
    }
}

/// golden 파일 모양: `GOLDEN_EXPANDED_DEPTH`까지의 배열·객체는 줄을 나누고 그보다 깊은 것은
/// 한 줄로 쓴다. 추출 결과면 글자 하나가 한 줄이다. 필드 순서는 구조체 정의 순서 그대로다.
fn golden_json<T: Serialize>(value: &T) -> String {
    let mut bytes = Vec::new();
    let mut serializer =
        serde_json::Serializer::with_formatter(&mut bytes, GoldenFormatter::default());
    value.serialize(&mut serializer).expect("serialize golden");
    bytes.push(b'\n');
    String::from_utf8(bytes).expect("serde_json writes UTF-8")
}

const GOLDEN_EXPANDED_DEPTH: usize = 3;
const GOLDEN_INDENT: &[u8] = b"  ";

#[derive(Default)]
struct GoldenFormatter {
    depth: usize,
    has_value: bool,
}

impl GoldenFormatter {
    fn is_expanded(&self) -> bool {
        self.depth <= GOLDEN_EXPANDED_DEPTH
    }

    fn new_line<W: ?Sized + io::Write>(&self, writer: &mut W) -> io::Result<()> {
        writer.write_all(b"\n")?;
        (0..self.depth).try_for_each(|_| writer.write_all(GOLDEN_INDENT))
    }

    fn begin(&mut self, writer: &mut (impl ?Sized + io::Write), open: &[u8]) -> io::Result<()> {
        self.depth += 1;
        self.has_value = false;
        writer.write_all(open)
    }

    fn end(&mut self, writer: &mut (impl ?Sized + io::Write), close: &[u8]) -> io::Result<()> {
        let was_expanded = self.is_expanded();
        self.depth -= 1;
        if was_expanded && self.has_value {
            self.new_line(writer)?;
        }
        writer.write_all(close)
    }

    fn begin_item(
        &mut self,
        writer: &mut (impl ?Sized + io::Write),
        first: bool,
    ) -> io::Result<()> {
        if !first {
            writer.write_all(b",")?;
        }
        if self.is_expanded() {
            self.new_line(writer)?;
        }
        Ok(())
    }
}

impl Formatter for GoldenFormatter {
    fn begin_array<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        self.begin(writer, b"[")
    }

    fn end_array<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        self.end(writer, b"]")
    }

    fn begin_array_value<W: ?Sized + io::Write>(
        &mut self,
        writer: &mut W,
        first: bool,
    ) -> io::Result<()> {
        self.begin_item(writer, first)
    }

    fn end_array_value<W: ?Sized + io::Write>(&mut self, _writer: &mut W) -> io::Result<()> {
        self.has_value = true;
        Ok(())
    }

    fn begin_object<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        self.begin(writer, b"{")
    }

    fn end_object<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        self.end(writer, b"}")
    }

    fn begin_object_key<W: ?Sized + io::Write>(
        &mut self,
        writer: &mut W,
        first: bool,
    ) -> io::Result<()> {
        self.begin_item(writer, first)
    }

    fn begin_object_value<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        writer.write_all(if self.is_expanded() { b": " } else { b":" })
    }

    fn end_object_value<W: ?Sized + io::Write>(&mut self, _writer: &mut W) -> io::Result<()> {
        self.has_value = true;
        Ok(())
    }
}
