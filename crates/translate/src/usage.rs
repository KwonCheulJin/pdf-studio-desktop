//! 사용 토큰(계약 `TokenUsage`, ADR 0002 §6·§9). 받은 200 응답의 `usage`를 더한다. `u32`로 넘치면
//! `u32::MAX`에서 멈춘다.

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

impl TokenUsage {
    pub(crate) fn new(input_tokens: u64, output_tokens: u64) -> Self {
        Self {
            input_tokens: u32::try_from(input_tokens).unwrap_or(u32::MAX),
            output_tokens: u32::try_from(output_tokens).unwrap_or(u32::MAX),
        }
    }

    pub(crate) fn add(&mut self, other: TokenUsage) {
        self.input_tokens = self.input_tokens.saturating_add(other.input_tokens);
        self.output_tokens = self.output_tokens.saturating_add(other.output_tokens);
    }
}
