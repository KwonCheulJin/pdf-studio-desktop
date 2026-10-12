//! 비교 엔진 통합 테스트가 함께 쓰는 pdfium 바인딩·픽스처 경로·golden 비교. 통합 테스트는 파일마다
//! 별도 프로세스라 pdfium 바인딩(프로세스당 한 번)이 다른 테스트 파일과 겹치지 않는다.
//!
//! golden은 픽스처(`generate_compare_fixtures.py`)나 규칙을 바꾸면 `UPDATE_GOLDEN=1`로 다시 쓰고,
//! 바뀐 값을 눈으로 확인한다.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use pdf_core::PdfEngine;
use serde::Serialize;
use serde_json::Value;
use serde_json::ser::Formatter;

const LIBRARY_PATH_ENV: &str = "PDFIUM_LIB_PATH";
/// 있으면 비교하지 않고 golden 파일을 지금 결과로 다시 쓴다.
const UPDATE_GOLDEN_ENV: &str = "UPDATE_GOLDEN";
/// 좌표·크기 허용 오차(pt). 플랫폼별 pdfium 빌드의 부동소수점 차이만 흡수한다.
const GOLDEN_TOLERANCE: f64 = 0.01;

pub fn engine() -> &'static PdfEngine {
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

pub fn fixture_path(name: &str) -> PathBuf {
    test_path("fixtures", name)
}

fn test_path(folder: &str, name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join(folder)
        .join(name)
}

/// `value`를 `tests/golden/<golden_name>`과 비교한다(실수는 허용 오차 안이면 같다).
/// `expanded_depth`까지의 배열·객체는 줄을 나눠 쓴다.
pub fn assert_matches_golden<T: Serialize>(value: &T, golden_name: &str, expanded_depth: usize) {
    let actual = golden_json(value, expanded_depth);
    let golden_path = test_path("golden", golden_name);

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

/// golden 파일 모양: `expanded_depth`까지의 배열·객체는 줄을 나누고 그보다 깊은 것은 한 줄로
/// 쓴다. 필드 순서는 구조체 정의 순서 그대로다.
fn golden_json<T: Serialize>(value: &T, expanded_depth: usize) -> String {
    let mut bytes = Vec::new();
    let formatter = GoldenFormatter {
        expanded_depth,
        depth: 0,
        has_value: false,
    };
    let mut serializer = serde_json::Serializer::with_formatter(&mut bytes, formatter);
    value.serialize(&mut serializer).expect("serialize golden");
    bytes.push(b'\n');
    String::from_utf8(bytes).expect("serde_json writes UTF-8")
}

const GOLDEN_INDENT: &[u8] = b"  ";

struct GoldenFormatter {
    expanded_depth: usize,
    depth: usize,
    has_value: bool,
}

impl GoldenFormatter {
    fn is_expanded(&self) -> bool {
        self.depth <= self.expanded_depth
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
