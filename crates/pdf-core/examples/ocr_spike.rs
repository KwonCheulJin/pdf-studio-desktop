//! OCR 스파이크(계획서 §6.4 P2-2a) 측정 하네스. 테스트가 아니라 손으로 돌리는 측정 도구다.
//!
//! ```sh
//! PDFIUM_LIB_PATH=$PWD/src-tauri/pdfium/aarch64-apple-darwin/libpdfium.dylib \
//! ONNXRUNTIME_LIB_PATH=$PWD/src-tauri/onnxruntime/aarch64-apple-darwin/libonnxruntime.dylib \
//! OCR_MODEL_DIR=$PWD/src-tauri/ocr-models \
//!   cargo run --release -p pdf-core --example ocr_spike -- [--verbose] [--fixtures <dir>] [--local <test-files/ocr>]
//! ```
//!
//! - 픽스처(`tests/fixtures/ocr/`): 줄 단위로 정답과 맞춰 CER(공백 제외), 도장 겹친 줄 CER,
//!   숫자 토큰 완전 일치율, 숫자 토큰 조용한 오인식, 쪽당 시간, 글자 상자 위치를 잰다.
//! - `--local`: 레포 밖 로컬 스캔본을 쪽 단위로 맞춰 CER·숫자 토큰만 잰다. 실제 계약서 내용이
//!   새지 않게 집계 수치만 출력한다.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use unicode_normalization::UnicodeNormalization;

use pdf_core::{
    OCR_DET_MAX_SIDE, OCR_RENDER_DPI, OcrEngine, OcrLine, PdfEngine, read_pdf_info,
    render_page_for_ocr,
};

const POINTS_PER_INCH: f32 = 72.0;
/// 숫자 토큰 신뢰도 기준 `OCR_MIN_CONFIDENCE_NUMERIC` 시작값(§6.4)
const OCR_MIN_CONFIDENCE_NUMERIC: f32 = 0.95;
/// 일반 토큰 신뢰도 기준 `OCR_MIN_CONFIDENCE` 시작값(§6.4)
const OCR_MIN_CONFIDENCE: f32 = 0.80;
/// OCR 줄 중심을 정답 줄에 붙일 때 줄 상자 위아래로 더 보는 여유(pt)
const ROW_MATCH_SLACK_PT: f32 = 3.0;
/// 같은 줄로 묶는 정답 칸 윗변 차이(pt)
const SAME_ROW_TOLERANCE_PT: f32 = 0.5;
/// 글자 상자 판정: OCR 글자 중심이 정답 글자 상자 좌우로 이만큼 안에 있으면 맞다(pt)
const CHAR_BOX_TOLERANCE_PT: f32 = 1.0;
/// 토큰 끝의 문장부호. 숫자 토큰의 "핵심" 일치(참고값)에서 뺀다
const TRAILING_PUNCTUATION: [char; 2] = ['.', ','];
/// 픽스처 스캔 해상도(scans.tsv의 dpi). 렌더 해상도(`OCR_RENDER_DPI`)와 따로 묶는다
const FIXTURE_HIGH_DPI: u32 = 300;
const SYNTHETIC_CELL_SEPARATOR: &str = " | ";
const PAGE_HEADER_PREFIX: &str = "=== ";

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let verbose = args.iter().any(|arg| arg == "--verbose");
    let option = |name: &str| {
        args.iter()
            .position(|arg| arg == name)
            .and_then(|index| args.get(index + 1))
            .map(PathBuf::from)
    };
    let local_root = option("--local");
    let fixtures = option("--fixtures").unwrap_or_else(fixture_dir);

    let missing = Path::new("/nonexistent");
    let pdf = PdfEngine::bind(missing).expect("bind pdfium (PDFIUM_LIB_PATH)");
    let started = Instant::now();
    let mut ocr = OcrEngine::load(missing, missing).expect("load ONNX Runtime and OCR models");
    println!(
        "ONNX Runtime: {}\nmodels: {}\nload: {} ms, OCR_RENDER_DPI={OCR_RENDER_DPI}, OCR_DET_MAX_SIDE={OCR_DET_MAX_SIDE}",
        ocr.library_path().display(),
        ocr.model_dir().display(),
        started.elapsed().as_millis()
    );

    measure_fixtures(&pdf, &mut ocr, &fixtures, verbose);
    if let Some(root) = local_root {
        measure_local(&pdf, &mut ocr, &root, verbose);
    }
}

// ---------------------------------------------------------------------------
// 공통: 정렬과 집계
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
struct OcrGlyph {
    character: char,
    confidence: f32,
    /// 기울기를 되돌린 글자 중심(pt, 위·왼쪽 원점)
    center: (f32, f32),
}

#[derive(Clone, Copy, PartialEq)]
enum Op {
    Match(usize, usize),
    Substitute(usize, usize),
    Delete(usize),
    Insert(usize),
}

/// 레벤슈타인 정렬(정답 → OCR). 같은 비용이면 일치를 먼저 고른다.
fn align(truth: &[char], ocr: &[char]) -> Vec<Op> {
    let (rows, columns) = (truth.len() + 1, ocr.len() + 1);
    let mut cost = vec![0u32; rows * columns];
    for i in 0..rows {
        cost[i * columns] = i as u32;
    }
    for (j, cell) in cost.iter_mut().take(columns).enumerate() {
        *cell = j as u32;
    }
    for i in 1..rows {
        for j in 1..columns {
            let substitute =
                cost[(i - 1) * columns + j - 1] + u32::from(truth[i - 1] != ocr[j - 1]);
            let delete = cost[(i - 1) * columns + j] + 1;
            let insert = cost[i * columns + j - 1] + 1;
            cost[i * columns + j] = substitute.min(delete).min(insert);
        }
    }
    let mut ops = Vec::new();
    let (mut i, mut j) = (truth.len(), ocr.len());
    while i > 0 || j > 0 {
        let here = cost[i * columns + j];
        if i > 0 && j > 0 {
            let same = truth[i - 1] == ocr[j - 1];
            if here == cost[(i - 1) * columns + j - 1] + u32::from(!same) {
                ops.push(if same {
                    Op::Match(i - 1, j - 1)
                } else {
                    Op::Substitute(i - 1, j - 1)
                });
                i -= 1;
                j -= 1;
                continue;
            }
        }
        if i > 0 && here == cost[(i - 1) * columns + j] + 1 {
            ops.push(Op::Delete(i - 1));
            i -= 1;
        } else {
            ops.push(Op::Insert(j - 1));
            j -= 1;
        }
    }
    ops.reverse();
    ops
}

fn edit_distance(ops: &[Op]) -> usize {
    ops.iter().filter(|op| !matches!(op, Op::Match(..))).count()
}

#[derive(Default)]
struct Totals {
    distance: usize,
    length: usize,
    numeric_total: usize,
    numeric_exact: usize,
    /// 틀렸는데 관련 OCR 글자 신뢰도가 모두 `OCR_MIN_CONFIDENCE_NUMERIC` 이상
    numeric_silent: usize,
    /// 관련 OCR 글자가 하나도 없음(통째로 빠짐)
    numeric_missing: usize,
    /// 틀린 숫자 토큰 중 신뢰도가 `OCR_MIN_CONFIDENCE` 미만(확인 필요로 걸러짐)
    numeric_wrong_low_confidence: usize,
    /// 맞은 숫자 토큰 중 `OCR_MIN_CONFIDENCE_NUMERIC` 미만(불필요한 확인 필요)
    numeric_right_flagged: usize,
    /// 토큰 끝 문장부호(`TRAILING_PUNCTUATION`)를 뺀 숫자 토큰 기준(제안 정의용 참고값)
    numeric_core_exact: usize,
    numeric_core_silent: usize,
    box_checked: usize,
    box_inside: usize,
    box_error_sum: f32,
    box_rows_skipped: usize,
    pages: usize,
    page_times: Vec<Duration>,
    /// 틀린 숫자 토큰 (정답, OCR, 최소 신뢰도). `--verbose`에서만 출력한다
    numeric_failures: Vec<(String, String, f32)>,
}

impl Totals {
    fn add(&mut self, other: &Totals) {
        self.distance += other.distance;
        self.length += other.length;
        self.numeric_total += other.numeric_total;
        self.numeric_exact += other.numeric_exact;
        self.numeric_silent += other.numeric_silent;
        self.numeric_missing += other.numeric_missing;
        self.numeric_wrong_low_confidence += other.numeric_wrong_low_confidence;
        self.numeric_right_flagged += other.numeric_right_flagged;
        self.numeric_core_exact += other.numeric_core_exact;
        self.numeric_core_silent += other.numeric_core_silent;
        self.box_checked += other.box_checked;
        self.box_inside += other.box_inside;
        self.box_error_sum += other.box_error_sum;
        self.box_rows_skipped += other.box_rows_skipped;
        self.pages += other.pages;
        self.page_times.extend(other.page_times.iter().copied());
        self.numeric_failures
            .extend(other.numeric_failures.iter().cloned());
    }

    fn cer(&self) -> f32 {
        percent(self.distance, self.length)
    }

    fn summary(&self) -> String {
        let millis: Vec<u128> = self.page_times.iter().map(Duration::as_millis).collect();
        let mean = millis.iter().sum::<u128>() / millis.len().max(1) as u128;
        let max = millis.iter().max().copied().unwrap_or_default();
        format!(
            "pages {:>2} | CER {:>5.2}% ({}/{}) | numeric exact {:>6.2}% ({}/{}) silent {} missing {} wrong<0.80 {} right<0.95 {} | core exact {:>6.2}% silent {} | page ms mean {} max {}",
            self.pages,
            self.cer(),
            self.distance,
            self.length,
            percent(self.numeric_exact, self.numeric_total),
            self.numeric_exact,
            self.numeric_total,
            self.numeric_silent,
            self.numeric_missing,
            self.numeric_wrong_low_confidence,
            self.numeric_right_flagged,
            percent(self.numeric_core_exact, self.numeric_total),
            self.numeric_core_silent,
            mean,
            max
        )
    }

    fn box_summary(&self) -> String {
        format!(
            "char boxes: {}/{} centers inside truth box ±{CHAR_BOX_TOLERANCE_PT}pt ({:.2}%), mean |dx| {:.2}pt, rows skipped {}",
            self.box_inside,
            self.box_checked,
            percent(self.box_inside, self.box_checked),
            self.box_error_sum / self.box_checked.max(1) as f32,
            self.box_rows_skipped
        )
    }
}

fn percent(part: usize, whole: usize) -> f32 {
    if whole == 0 {
        0.0
    } else {
        part as f32 * 100.0 / whole as f32
    }
}

/// 정답 글자열의 공백 없는 위치 기준 숫자 토큰 구간들
fn numeric_spans(text: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut offset = 0;
    for token in text.split_whitespace() {
        let length = token.chars().count();
        if token.chars().any(|character| character.is_ascii_digit()) {
            spans.push((offset, offset + length));
        }
        offset += length;
    }
    spans
}

/// 한 정렬 단위(줄 또는 쪽)의 CER·숫자 토큰을 센다.
fn score_sequence(truth_text: &str, glyphs: &[OcrGlyph], totals: &mut Totals) -> Vec<Op> {
    let truth: Vec<char> = truth_text.chars().filter(|c| !c.is_whitespace()).collect();
    let ocr: Vec<char> = glyphs.iter().map(|glyph| glyph.character).collect();
    let ops = align(&truth, &ocr);
    totals.distance += edit_distance(&ops);
    totals.length += truth.len();

    // 정답 위치 i → (맞춘 OCR 위치, 일치 여부), i 뒤에 끼어든 OCR 위치들
    let mut aligned: Vec<Option<(usize, bool)>> = vec![None; truth.len()];
    let mut inserted_after: BTreeMap<isize, Vec<usize>> = BTreeMap::new();
    let mut last_truth: isize = -1;
    for op in &ops {
        match *op {
            Op::Match(i, j) => {
                aligned[i] = Some((j, true));
                last_truth = i as isize;
            }
            Op::Substitute(i, j) => {
                aligned[i] = Some((j, false));
                last_truth = i as isize;
            }
            Op::Delete(i) => last_truth = i as isize,
            Op::Insert(j) => inserted_after.entry(last_truth).or_default().push(j),
        }
    }
    // 구간 [start, end)의 (완전 일치 여부, 관련 OCR 글자 위치들)
    let evaluate = |start: usize, end: usize| {
        let mut involved: Vec<usize> = Vec::new();
        let mut exact = true;
        for (i, slot) in aligned.iter().enumerate().take(end).skip(start) {
            match *slot {
                Some((j, same)) => {
                    involved.push(j);
                    exact &= same;
                }
                None => exact = false,
            }
            if i + 1 < end
                && let Some(inside) = inserted_after.get(&(i as isize))
            {
                involved.extend(inside);
                exact = false;
            }
        }
        let minimum = involved
            .iter()
            .map(|j| glyphs[*j].confidence)
            .fold(f32::MAX, f32::min);
        (exact, involved, minimum)
    };
    for (start, end) in numeric_spans(truth_text) {
        totals.numeric_total += 1;
        let (exact, involved, minimum) = evaluate(start, end);
        if !exact {
            let read: String = involved.iter().map(|j| glyphs[*j].character).collect();
            let expected: String = truth[start..end].iter().collect();
            totals.numeric_failures.push((expected, read, minimum));
        }
        if exact {
            totals.numeric_exact += 1;
            if minimum < OCR_MIN_CONFIDENCE_NUMERIC {
                totals.numeric_right_flagged += 1;
            }
        } else if involved.is_empty() {
            totals.numeric_missing += 1;
        } else if minimum >= OCR_MIN_CONFIDENCE_NUMERIC {
            totals.numeric_silent += 1;
        } else if minimum < OCR_MIN_CONFIDENCE {
            totals.numeric_wrong_low_confidence += 1;
        }

        let mut core_end = end;
        while core_end > start + 1 && TRAILING_PUNCTUATION.contains(&truth[core_end - 1]) {
            core_end -= 1;
        }
        let (core_exact, core_involved, core_minimum) = evaluate(start, core_end);
        if core_exact {
            totals.numeric_core_exact += 1;
        } else if !core_involved.is_empty() && core_minimum >= OCR_MIN_CONFIDENCE_NUMERIC {
            totals.numeric_core_silent += 1;
        }
    }
    ops
}

/// 스캔 기울기(양수 = 반시계)를 되돌려 렌더 픽셀 좌표를 pt로 바꾼다.
fn unskew_to_points(point: (f32, f32), size: (u32, u32), skew_degrees: f32) -> (f32, f32) {
    let (center_x, center_y) = (size.0 as f32 / 2.0, size.1 as f32 / 2.0);
    let (dx, dy) = (point.0 - center_x, point.1 - center_y);
    let (sin, cos) = skew_degrees.to_radians().sin_cos();
    let scale = POINTS_PER_INCH / OCR_RENDER_DPI as f32;
    (
        (center_x + cos * dx - sin * dy) * scale,
        (center_y + sin * dx + cos * dy) * scale,
    )
}

fn glyphs_of(line: &OcrLine, size: (u32, u32), skew: f32) -> Vec<OcrGlyph> {
    line.chars
        .iter()
        .flat_map(|character| {
            let center = unskew_to_points(character.quad.center(), size, skew);
            character
                .text
                .chars()
                .filter(|c| !c.is_whitespace())
                .map(move |c| OcrGlyph {
                    character: c,
                    confidence: character.confidence,
                    center,
                })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// 픽스처 측정
// ---------------------------------------------------------------------------

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("ocr")
}

struct TruthRow {
    page: u16,
    top: f32,
    bottom: f32,
    /// (x0, x1, 글자) 칸들. 왼쪽부터
    cells: Vec<(f32, f32, String)>,
    /// 공백이 아닌 글자마다 그려진 가로 칸(x0, x1). 칸 순서대로 이어 붙인다
    glyph_cells: Vec<(f32, f32)>,
}

impl TruthRow {
    fn text(&self) -> String {
        self.cells
            .iter()
            .map(|cell| cell.2.as_str())
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn left(&self) -> f32 {
        self.cells.first().map_or(0.0, |cell| cell.0)
    }

    fn right(&self) -> f32 {
        self.cells.last().map_or(0.0, |cell| cell.1)
    }
}

fn read_truth_rows(path: &Path) -> Vec<TruthRow> {
    let text = fs::read_to_string(path).expect("read answer tsv");
    let mut rows: Vec<TruthRow> = Vec::new();
    for line in text.lines().skip(1) {
        let fields: Vec<&str> = line.splitn(7, '\t').collect();
        let number = |index: usize| fields[index].parse::<f32>().expect("number");
        let page: u16 = fields[0].parse().expect("page");
        let (x0, top, x1, bottom) = (number(1), number(2), number(3), number(4));
        let cell = (x0, x1, fields[6].to_owned());
        let glyphs: Vec<(f32, f32)> = fields[5]
            .split(',')
            .filter(|cell| !cell.is_empty())
            .map(|cell| {
                let (left, right) = cell.split_once(':').expect("x0:x1");
                (left.parse().expect("x0"), right.parse().expect("x1"))
            })
            .collect();
        match rows
            .iter_mut()
            .find(|row| row.page == page && (row.top - top).abs() < SAME_ROW_TOLERANCE_PT)
        {
            Some(row) => {
                row.cells.push(cell);
                row.glyph_cells.extend(glyphs);
                row.cells.sort_by(|left, right| left.0.total_cmp(&right.0));
                row.glyph_cells
                    .sort_by(|left, right| left.0.total_cmp(&right.0));
            }
            None => rows.push(TruthRow {
                page,
                top,
                bottom,
                cells: vec![cell],
                glyph_cells: glyphs,
            }),
        }
    }
    rows
}

struct ScanEntry {
    file: String,
    page: u16,
    dpi: u32,
    skew: f32,
    /// (cx, cy, r) pt, 위·왼쪽 원점
    stamps: Vec<(f32, f32, f32)>,
}

fn read_scans(path: &Path) -> Vec<ScanEntry> {
    let text = fs::read_to_string(path).expect("read scans.tsv");
    text.lines()
        .skip(1)
        .map(|line| {
            let fields: Vec<&str> = line.split('\t').collect();
            let stamps = if fields[4] == "-" {
                Vec::new()
            } else {
                fields[4]
                    .split(';')
                    .map(|stamp| {
                        let values: Vec<f32> = stamp
                            .split(',')
                            .map(|v| v.parse().expect("stamp"))
                            .collect();
                        (values[0], values[1], values[2])
                    })
                    .collect()
            };
            ScanEntry {
                file: fields[0].to_owned(),
                page: fields[1].parse().expect("page"),
                dpi: fields[2].parse().expect("dpi"),
                skew: fields[3].parse().expect("skew"),
                stamps,
            }
        })
        .collect()
}

fn circle_hits_row(circle: (f32, f32, f32), row: &TruthRow) -> bool {
    let (cx, cy, radius) = circle;
    let nearest_x = cx.clamp(row.left(), row.right());
    let nearest_y = cy.clamp(row.top, row.bottom);
    (cx - nearest_x).hypot(cy - nearest_y) <= radius
}

fn measure_fixtures(pdf: &PdfEngine, ocr: &mut OcrEngine, directory: &Path, verbose: bool) {
    let scans = read_scans(&directory.join("scans.tsv"));
    let mut by_file: BTreeMap<String, Totals> = BTreeMap::new();
    let mut stamp_rows = Totals::default();
    let mut boxes = Totals::default();
    let mut answers: BTreeMap<String, Vec<TruthRow>> = BTreeMap::new();

    println!("\n== fixtures ({}) ==", directory.display());
    for scan in &scans {
        let source = scan
            .file
            .split("-scan")
            .next()
            .expect("scan name has source prefix")
            .to_owned();
        let rows = answers
            .entry(source.clone())
            .or_insert_with(|| read_truth_rows(&directory.join(format!("{source}.tsv"))));
        let path = directory.join(&scan.file);
        let started = Instant::now();
        let image = render_page_for_ocr(pdf, &path, scan.page - 1).expect("render scan page");
        let rendered = started.elapsed();
        let lines = ocr.recognize(&image).expect("recognize page");
        let elapsed = started.elapsed();
        let size = image.dimensions();

        // OCR 줄을 정답 줄에 붙인다
        let page_rows: Vec<&TruthRow> = rows.iter().filter(|row| row.page == scan.page).collect();
        let mut assigned: Vec<Vec<(f32, Vec<OcrGlyph>, String)>> =
            vec![Vec::new(); page_rows.len()];
        let mut unmatched = 0usize;
        for line in &lines {
            let (x, y) = unskew_to_points(line.quad.center(), size, scan.skew);
            let best = page_rows
                .iter()
                .enumerate()
                .filter(|(_, row)| {
                    y >= row.top - ROW_MATCH_SLACK_PT && y <= row.bottom + ROW_MATCH_SLACK_PT
                })
                .min_by(|(_, left), (_, right)| {
                    let distance = |row: &TruthRow| (y - (row.top + row.bottom) / 2.0).abs();
                    distance(left).total_cmp(&distance(right))
                });
            let glyphs = glyphs_of(line, size, scan.skew);
            match best {
                Some((index, _)) => assigned[index].push((x, glyphs, line.text.clone())),
                None => {
                    unmatched += glyphs.len();
                    if verbose {
                        println!("   [unmatched] {}", line.text);
                    }
                }
            }
        }

        let mut page_totals = Totals {
            pages: 1,
            page_times: vec![elapsed],
            distance: unmatched,
            ..Totals::default()
        };
        for (row, mut parts) in page_rows.iter().zip(assigned) {
            parts.sort_by(|left, right| left.0.total_cmp(&right.0));
            let glyphs: Vec<OcrGlyph> = parts.iter().flat_map(|part| part.1.clone()).collect();
            let truth = row.text();
            let mut row_totals = Totals::default();
            let ops = score_sequence(&truth, &glyphs, &mut row_totals);
            if verbose {
                for (expected, read, minimum) in &row_totals.numeric_failures {
                    println!("   [numeric] {expected} → {read} ({minimum:.3})");
                }
            }
            if verbose && row_totals.distance > 0 {
                let read: Vec<&str> = parts.iter().map(|part| part.2.as_str()).collect();
                println!(
                    "   [{}] {}\n        → {}",
                    row_totals.distance,
                    truth,
                    read.join(" ‖ ")
                );
            }
            if scan.stamps.iter().any(|stamp| circle_hits_row(*stamp, row)) {
                stamp_rows.distance += row_totals.distance;
                stamp_rows.length += row_totals.length;
            }
            page_totals.add(&row_totals);

            // 글자 상자: 일치한 글자의 OCR 중심이 정답 글자 칸 안에 드는가
            let truth_length = truth.chars().filter(|c| !c.is_whitespace()).count();
            if row.glyph_cells.len() != truth_length {
                boxes.box_rows_skipped += 1;
                continue;
            }
            for op in ops {
                if let Op::Match(i, j) = op {
                    let (left, right) = row.glyph_cells[i];
                    let x = glyphs[j].center.0;
                    boxes.box_checked += 1;
                    if x >= left - CHAR_BOX_TOLERANCE_PT && x <= right + CHAR_BOX_TOLERANCE_PT {
                        boxes.box_inside += 1;
                    }
                    boxes.box_error_sum += (x - (left + right) / 2.0).abs();
                }
            }
        }
        println!(
            "{} p{} ({}dpi, skew {:+}°): lines {} | render {} ms, total {} ms | {}",
            scan.file,
            scan.page,
            scan.dpi,
            scan.skew,
            lines.len(),
            rendered.as_millis(),
            elapsed.as_millis(),
            page_totals.summary()
        );
        by_file
            .entry(scan.file.clone())
            .or_default()
            .add(&page_totals);
    }

    let mut dpi300 = Totals::default();
    let mut dpi300_without_stamp = Totals::default();
    let mut dpi200 = Totals::default();
    println!("\n-- per file --");
    for (file, totals) in &by_file {
        println!("{file:<28} {}", totals.summary());
        let dpi = scans
            .iter()
            .find(|scan| &scan.file == file)
            .map_or(0, |scan| scan.dpi);
        if dpi == FIXTURE_HIGH_DPI {
            dpi300.add(totals);
            if !file.contains("stamp") {
                dpi300_without_stamp.add(totals);
            }
        } else {
            dpi200.add(totals);
        }
    }
    println!("\n-- summary --");
    println!("300dpi (all)          {}", dpi300.summary());
    println!("300dpi (no stamp)     {}", dpi300_without_stamp.summary());
    println!("200dpi                {}", dpi200.summary());
    println!(
        "stamp-overlap rows    CER {:.2}% ({}/{})",
        stamp_rows.cer(),
        stamp_rows.distance,
        stamp_rows.length
    );
    println!("{}", boxes.box_summary());
}

// ---------------------------------------------------------------------------
// 로컬 스캔본(레포 밖): 쪽 단위, 집계만 출력
// ---------------------------------------------------------------------------

const LOCAL_SETS: [(&str, &[&str]); 2] = [
    (
        "synthetic",
        &[
            "contract-a-scan-300dpi",
            "contract-b-scan-300dpi",
            "contract-a-scan-200dpi",
            "contract-b-scan-200dpi",
            "contract-a-scan-skew-noise",
            "contract-b-scan-skew-noise",
            "contract-a-scan-stamp",
            "contract-b-scan-stamp",
            "contract-a-scan-bw",
            "contract-b-scan-bw",
        ],
    ),
    (
        "scanned-from-local",
        &[
            "local-1-fy25-scan-300dpi",
            "local-1-fy26-scan-300dpi",
            "local-2-fy25-scan-300dpi",
            "local-2-fy26-scan-300dpi",
            "local-1-fy25-scan-skew-noise",
            "local-1-fy26-scan-skew-noise",
            "local-2-fy25-scan-skew-noise",
            "local-2-fy26-scan-skew-noise",
        ],
    ),
];

/// `=== N쪽 ===` 머리글로 나눈 쪽별 정답 글자열
fn read_local_answer(path: &Path, synthetic: bool) -> Vec<String> {
    let text = fs::read_to_string(path).expect("read local answer");
    let mut pages: Vec<String> = Vec::new();
    for line in text.lines() {
        if line.starts_with(PAGE_HEADER_PREFIX) {
            pages.push(String::new());
            continue;
        }
        if let Some(page) = pages.last_mut() {
            let line = if synthetic {
                line.replace(SYNTHETIC_CELL_SEPARATOR, " ")
            } else {
                line.to_owned()
            };
            page.push_str(&line);
            page.push('\n');
        }
    }
    pages
}

/// 줄 중심 y가 가까운 OCR 줄을 한 줄로 묶어 왼쪽부터 읽는다(표 칸 순서 맞추기).
fn reading_order(lines: &[OcrLine]) -> Vec<&OcrLine> {
    let mut sorted: Vec<&OcrLine> = lines.iter().collect();
    sorted.sort_by(|left, right| left.quad.center().1.total_cmp(&right.quad.center().1));
    let mut rows: Vec<Vec<&OcrLine>> = Vec::new();
    for line in sorted {
        let (_, y) = line.quad.center();
        let same_row = rows.last().is_some_and(|row| {
            let anchor = row[0];
            (y - anchor.quad.center().1).abs() < anchor.quad.height().min(line.quad.height()) / 2.0
        });
        if same_row {
            if let Some(row) = rows.last_mut() {
                row.push(line);
            }
        } else {
            rows.push(vec![line]);
        }
    }
    rows.into_iter()
        .flat_map(|mut row| {
            row.sort_by(|left, right| left.quad.center().0.total_cmp(&right.quad.center().0));
            row
        })
        .collect()
}

fn nfkc_glyphs(glyphs: &[OcrGlyph]) -> Vec<OcrGlyph> {
    glyphs
        .iter()
        .flat_map(|glyph| {
            std::iter::once(glyph.character)
                .nfkc()
                .filter(|c| !c.is_whitespace())
                .map(|character| OcrGlyph {
                    character,
                    ..*glyph
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

/// 글자 종류만 남긴다(숫자 → 9, 한글 → 가, 로마자 → a). 실제 계약서 내용 없이 오류 모양만 보려고 쓴다.
fn mask(text: &str) -> String {
    text.chars()
        .map(|character| match character {
            '0'..='9' => '9',
            'a'..='z' | 'A'..='Z' => 'a',
            '\u{AC00}'..='\u{D7A3}' => '가',
            other => other,
        })
        .collect()
}

fn measure_local(pdf: &PdfEngine, ocr: &mut OcrEngine, root: &Path, verbose: bool) {
    println!("\n== local scans ({}) — aggregate only ==", root.display());
    for (set, names) in LOCAL_SETS {
        let synthetic = set == "synthetic";
        let mut set_totals = Totals::default();
        let mut set_nfkc = Totals::default();
        for name in names {
            let path = root.join(set).join(format!("{name}.pdf"));
            if !path.exists() {
                println!("{set}/{name}: missing, skipped");
                continue;
            }
            let source = name.split("-scan").next().expect("scan name has source");
            let answer = read_local_answer(
                &root.join(set).join("answer").join(format!("{source}.txt")),
                synthetic,
            );
            let page_count = read_pdf_info(pdf, &path)
                .expect("read local pdf")
                .page_count;
            let mut file_totals = Totals::default();
            let mut file_nfkc = Totals::default();
            for page in 0..page_count {
                let started = Instant::now();
                let image = render_page_for_ocr(pdf, &path, page as u16).expect("render");
                let lines = ocr.recognize(&image).expect("recognize");
                let elapsed = started.elapsed();
                let glyphs: Vec<OcrGlyph> = reading_order(&lines)
                    .into_iter()
                    .flat_map(|line| glyphs_of(line, image.dimensions(), 0.0))
                    .collect();
                let truth = answer.get(page).map_or("", String::as_str);
                let mut page_totals = Totals {
                    pages: 1,
                    page_times: vec![elapsed],
                    ..Totals::default()
                };
                score_sequence(truth, &glyphs, &mut page_totals);
                file_totals.add(&page_totals);
                // 비교 단계의 NFKC 정규화(P2-3 옵션)를 양쪽에 건 값: ② → 2 같은 호환 문자 차이를 뺀다
                let mut page_nfkc = Totals {
                    pages: 1,
                    page_times: vec![elapsed],
                    ..Totals::default()
                };
                let truth_nfkc: String = truth.nfkc().collect();
                score_sequence(&truth_nfkc, &nfkc_glyphs(&glyphs), &mut page_nfkc);
                file_nfkc.add(&page_nfkc);
            }
            // 파일 이름과 집계 수치만 출력한다(내용은 출력하지 않는다)
            println!("{set}/{name:<30} {}", file_totals.summary());
            println!("{set}/{name:<30} {} (NFKC)", file_nfkc.summary());
            if verbose {
                for (expected, read, minimum) in &file_totals.numeric_failures {
                    println!(
                        "   [numeric, masked] {} → {} ({minimum:.3})",
                        mask(expected),
                        mask(read)
                    );
                }
            }
            set_totals.add(&file_totals);
            set_nfkc.add(&file_nfkc);
        }
        println!("{set} total                       {}", set_totals.summary());
        println!(
            "{set} total                       {} (NFKC)",
            set_nfkc.summary()
        );
    }
}
