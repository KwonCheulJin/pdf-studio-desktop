//! 원문 언어 감지(계획서 §9.1.2 "언어 감지", Q4). 의존성 없이 글자 비율로 정한다.
//!
//! - 분모는 범위 안 글자층 문단의 "글자"(`char::is_alphabetic`: 한자·라틴·가나·한글 등)다. 숫자·
//!   문장부호·공백은 세지 않는다. 스캔 쪽은 글이 없어 세지 않는다.
//! - 한자가 `HAN_RATIO_FOR_CHINESE` 이상이면 중국어, 아니고 라틴 글자가
//!   `LATIN_RATIO_FOR_ENGLISH` 이상이면 영어, 둘 다 아니면(글자가 없을 때 포함) 모름이다.
//! - 중국어는 간체에만·번체에만 쓰는 글자 짝(`SIMPLIFIED_TRADITIONAL_PAIRS`)을 세어 많은 쪽으로
//!   정하고, 같으면(둘 다 0 포함) 그냥 중국어다.

use crate::per_mille::PerMille;
use crate::script::{is_han, is_latin_letter};
use crate::source::{SourcePage, SourcePageContent};

/// 요청에 싣는 원문 언어(간체·번체는 표시용이고 요청은 "중국어"다)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Language {
    Zh,
    En,
}

/// 감지 결과(계약 `DetectedLanguage`)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DetectedLanguage {
    ZhHans,
    ZhHant,
    Zh,
    En,
    Unknown,
}

impl DetectedLanguage {
    /// 요청에 실을 언어. 모름이면 `None`(자동 감지면 실행을 막는다, `SOURCE_LANGUAGE_UNKNOWN`)
    pub fn language(self) -> Option<Language> {
        match self {
            Self::ZhHans | Self::ZhHant | Self::Zh => Some(Language::Zh),
            Self::En => Some(Language::En),
            Self::Unknown => None,
        }
    }
}

/// 글자 가운데 한자가 절반 이상이면 중국어다. 중국어 문서는 영문 모델명·약어가 섞여도 한자가
/// 대부분이다. 일본어는 가나가 분모에 들어 보통 절반 아래라 모름으로 남는다(시작값, Step 48 실측).
const HAN_RATIO_FOR_CHINESE: PerMille = PerMille(500);

/// 글자 가운데 라틴 글자가 70% 이상이면 영어다. 영어 문서는 거의 모든 글자가 라틴이고, 한자가
/// 30~50%인 중·영 혼합 문서는 어느 쪽도 아닌 모름으로 두어 사용자가 고르게 한다. 두 비율의 합이
/// 1을 넘으므로 둘이 함께 성립하는 일은 없다.
const LATIN_RATIO_FOR_ENGLISH: PerMille = PerMille(700);

/// (간체, 번체) 짝. 흔하고, 간체 글자는 번체 문서에, 번체 글자는 간체 문서에 거의 쓰이지 않는
/// 글자만 둔다(`后`·`里`·`干`처럼 번체에서도 쓰는 간체 글자는 넣지 않는다).
const SIMPLIFIED_TRADITIONAL_PAIRS: [(char, char); 40] = [
    ('这', '這'),
    ('为', '為'),
    ('们', '們'),
    ('国', '國'),
    ('个', '個'),
    ('来', '來'),
    ('时', '時'),
    ('说', '說'),
    ('对', '對'),
    ('会', '會'),
    ('学', '學'),
    ('经', '經'),
    ('过', '過'),
    ('动', '動'),
    ('种', '種'),
    ('与', '與'),
    ('关', '關'),
    ('现', '現'),
    ('开', '開'),
    ('进', '進'),
    ('长', '長'),
    ('门', '門'),
    ('问', '問'),
    ('间', '間'),
    ('无', '無'),
    ('应', '應'),
    ('实', '實'),
    ('当', '當'),
    ('业', '業'),
    ('机', '機'),
    ('产', '產'),
    ('务', '務'),
    ('协', '協'),
    ('议', '議'),
    ('条', '條'),
    ('规', '規'),
    ('书', '書'),
    ('认', '認'),
    ('发', '發'),
    ('电', '電'),
];

/// 범위 안 쪽(`pages`)의 글자층 문단으로 원문 언어를 정한다.
pub fn detect_language(pages: &[SourcePage]) -> DetectedLanguage {
    let mut counts = ScriptCounts::default();
    for page in pages {
        if let SourcePageContent::Text(paragraphs) = &page.content {
            for paragraph in paragraphs {
                paragraph.text.chars().for_each(|c| counts.push(c));
            }
        }
    }
    counts.decide()
}

#[derive(Default)]
struct ScriptCounts {
    letters: u64,
    han: u64,
    latin: u64,
    simplified: u64,
    traditional: u64,
}

impl ScriptCounts {
    fn push(&mut self, c: char) {
        if !c.is_alphabetic() {
            return;
        }
        self.letters += 1;
        if is_latin_letter(c) {
            self.latin += 1;
        } else if is_han(c) {
            self.han += 1;
            if SIMPLIFIED_TRADITIONAL_PAIRS.iter().any(|&(s, _)| s == c) {
                self.simplified += 1;
            } else if SIMPLIFIED_TRADITIONAL_PAIRS.iter().any(|&(_, t)| t == c) {
                self.traditional += 1;
            }
        }
    }

    fn decide(&self) -> DetectedLanguage {
        if HAN_RATIO_FOR_CHINESE.reached_by(self.han, self.letters) {
            match self.simplified.cmp(&self.traditional) {
                std::cmp::Ordering::Greater => DetectedLanguage::ZhHans,
                std::cmp::Ordering::Less => DetectedLanguage::ZhHant,
                std::cmp::Ordering::Equal => DetectedLanguage::Zh,
            }
        } else if LATIN_RATIO_FOR_ENGLISH.reached_by(self.latin, self.letters) {
            DetectedLanguage::En
        } else {
            DetectedLanguage::Unknown
        }
    }
}
