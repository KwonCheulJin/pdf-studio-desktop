//! OCR 결과(렌더 이미지 픽셀 좌표)를 텍스트 레이어 글자와 같은 모양([`ExtractedChar`])으로 바꾼다.
//! 좌표 규칙은 ADR 0001 §2, 되돌리는 순서와 글자 규칙은 §11이 정본이다.
//!
//! - 픽셀 → 화면 pt(이미지 크기 ÷ 화면 크기 배율, 위·왼쪽 원점) → `/Rotate` 되돌리기와 y 뒤집기
//!   (`view_box` 왼쪽 아래 원점) → `view_box.left`·`view_box.bottom` 더하기. 렌더 영역이 `view_box`라
//!   마지막에 더하는 원점이 `view_box`의 왼쪽 아래다. 기울기 보정은 하지 않으므로 되돌릴 것이 없다.
//! - 기울어진 글자 사각형은 네 꼭짓점을 바꾼 뒤 덮는 축 나란한 상자로 둔다.
//! - 줄마다 끝에 만든 줄바꿈(`glyph: None`)을 둔다. OCR이 읽은 공백도 만든 글자로 둔다(토큰 경계).

use super::extract::{ExtractedChar, Glyph};
use super::model::{PageSize, TextBox};
use crate::info::{PageBox, PageRotation};
use crate::ocr::{OcrPage, Quad};

/// 줄 끝에 두는 만든 줄바꿈(텍스트 레이어에서 pdfium이 만드는 줄 끝과 같은 역할)
const LINE_BREAK: char = '\n';
/// OCR이 읽은 공백 자리에 두는 만든 공백
const SPACE: char = ' ';

/// 쪽(`page_number`, 크기 `size`)의 OCR 결과를 사용자 공간 글자로 바꾼다. 글자의 `font_size`는
/// 그 줄 상자 높이(pt)다(OCR은 글꼴 크기를 모른다).
pub(super) fn ocr_chars(page: &OcrPage, page_number: u32, size: &PageSize) -> Vec<ExtractedChar> {
    let to_user = PixelToUser::new(page.width, page.height, size);
    let mut chars = Vec::new();
    for line in &page.lines {
        let line_height = line.quad.height() / to_user.pixels_per_point.1;
        for ocr_char in &line.chars {
            let bounds = to_user.text_box(page_number, &ocr_char.quad);
            for ch in ocr_char.text.chars() {
                chars.push(if ch.is_whitespace() {
                    generated(SPACE)
                } else {
                    ExtractedChar {
                        ch,
                        glyph: Some(Glyph {
                            bounds,
                            font_size: line_height,
                        }),
                        confidence: Some(ocr_char.confidence),
                    }
                });
            }
        }
        chars.push(generated(LINE_BREAK));
    }
    chars
}

fn generated(ch: char) -> ExtractedChar {
    ExtractedChar {
        ch,
        glyph: None,
        confidence: None,
    }
}

/// 렌더 이미지 픽셀(위·왼쪽 원점, `/Rotate` 적용 후 화면 방향) → 절대 사용자 공간 pt
struct PixelToUser {
    view_box: PageBox,
    rotation: PageRotation,
    /// 화면 pt당 픽셀(가로·세로). 렌더 이미지 크기가 배율을 내림한 값이라 실제 크기로 센다.
    pixels_per_point: (f32, f32),
}

impl PixelToUser {
    fn new(width: u32, height: u32, size: &PageSize) -> Self {
        let view_box = size.view_box;
        let (box_width, box_height) = (
            view_box.right - view_box.left,
            view_box.top - view_box.bottom,
        );
        // 화면 방향 크기: 90·270도면 너비와 높이가 바뀐다.
        let (screen_width, screen_height) = match size.rotation {
            PageRotation::Degrees90 | PageRotation::Degrees270 => (box_height, box_width),
            PageRotation::Degrees0 | PageRotation::Degrees180 => (box_width, box_height),
        };
        Self {
            view_box,
            rotation: size.rotation,
            pixels_per_point: (
                width as f32 / screen_width.max(f32::EPSILON),
                height as f32 / screen_height.max(f32::EPSILON),
            ),
        }
    }

    /// 픽셀 점 하나. `/Rotate`는 화면을 시계 방향으로 돌린 각도다.
    fn point(&self, (x, y): (f32, f32)) -> (f32, f32) {
        let (screen_x, screen_y) = (x / self.pixels_per_point.0, y / self.pixels_per_point.1);
        let width = self.view_box.right - self.view_box.left;
        let height = self.view_box.top - self.view_box.bottom;
        // view_box 왼쪽 아래 원점, y는 위로 커진다.
        let (user_x, user_y) = match self.rotation {
            PageRotation::Degrees0 => (screen_x, height - screen_y),
            // 90도: 사용자 공간 왼쪽 아래가 화면 왼쪽 위, 위쪽(+y)이 화면 오른쪽, 오른쪽(+x)이 화면 아래
            PageRotation::Degrees90 => (screen_y, screen_x),
            PageRotation::Degrees180 => (width - screen_x, screen_y),
            // 270도: 사용자 공간 오른쪽 위가 화면 왼쪽 위
            PageRotation::Degrees270 => (width - screen_y, height - screen_x),
        };
        (self.view_box.left + user_x, self.view_box.bottom + user_y)
    }

    /// 사각형 네 꼭짓점을 덮는 축 나란한 상자
    fn text_box(&self, page: u32, quad: &Quad) -> TextBox {
        let points = quad.corners.map(|corner| self.point(corner));
        let (mut left, mut bottom) = points[0];
        let (mut right, mut top) = points[0];
        for (x, y) in points {
            left = left.min(x);
            right = right.max(x);
            bottom = bottom.min(y);
            top = top.max(y);
        }
        TextBox {
            page,
            x: left,
            y: bottom,
            w: right - left,
            h: top - bottom,
        }
    }
}
