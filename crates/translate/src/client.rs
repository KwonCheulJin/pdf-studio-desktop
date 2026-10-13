//! 묶음 하나를 보내 문단 상태까지 정한다(ADR 0002 §6 "나눠 다시", §7 413). 진행·취소·기록은 실행기
//! (Step 40)가 한다.
//!
//! 텍스트 묶음:
//! - 잘림(`max_tokens`)·413: 항목이 둘 이상이면 앞 ⌈n/2⌉개와 나머지로 나눠 보낸다(나눈 쪽이 또 잘리면
//!   또 나눈다). 하나면 잘림은 그 문단 `Failed(Truncated)`, 413은 `API_REQUEST_REJECTED`로 멈춘다.
//! - 검증 실패: 항목이 둘 이상이면 반으로 나눠 각각 **한 번** 보내고, 하나면 같은 요청을 한 번 더 보낸다.
//!   다시 보낸 요청이 또 검증에 실패하면 그 요청의 문단은 모두 `Failed(Mismatch)`다.
//! - 거절: 그 요청 항목 모두 `Refused`. 다른 모델로 넘기지 않는다.
//! - 나눈 요청은 항목 ID를 `"1"`부터 다시 매기고, 용어집은 그 항목에 나오는 용어만 싣는다.
//!   `max_tokens`는 묶음 값을 그대로 쓴다(항목이 줄어 여유만 는다).
//!
//! 스캔 묶음은 나눌 수 없다: 검증 실패면 같은 요청을 한 번 더, 잘림이면 `Failed(Truncated)`, 413이면
//! `API_REQUEST_REJECTED`다.
//!
//! 사용량은 받은 모든 200 응답(거절·검증 실패·잘림 포함)을 더하고, 작업을 멈추는 오류로 끝나도 그때까지의
//! 사용량을 돌려준다. 반환한 future를 버리면(취소) 진행 중인 요청·기다림이 멈추고 그 사용량은 잃는다.

use std::ops::Range;

use crate::chunk::{ScanChunk, TextChunk};
use crate::error::ApiError;
use crate::glossary::{GlossaryTerm, term_appears_in};
use crate::http::Transport;
use crate::key::ApiKey;
use crate::language::Language;
use crate::models::TranslateModel;
use crate::request::{RequestContext, scan_request, text_request};
use crate::response::{ReplyKind, ScanParagraph, read_reply, validate_scan, validate_text};
use crate::retry::{SendFailure, send_with_retry};
use crate::usage::TokenUsage;

/// 텍스트 묶음 항목 하나의 결과
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ItemOutcome {
    /// 번역(앞뒤 공백을 지운, 비지 않은)
    Translated(String),
    Failed(FailReason),
    Refused,
}

/// 문단(또는 스캔 쪽) 실패 사유(계약 `fail_code`)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailReason {
    /// `TRANSLATION_MISMATCH`
    Mismatch,
    /// `TRANSLATION_TRUNCATED`
    Truncated,
}

/// 스캔 묶음의 결과
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScanOutcome {
    /// 받아 적은 문단(0개면 글이 없는 쪽)
    Paragraphs(Vec<ScanParagraph>),
    Failed(FailReason),
    Refused,
}

/// 묶음 하나를 보낸 결과. 오류로 멈춰도 `usage`는 그때까지 받은 200 응답의 합이다.
#[derive(Debug)]
pub struct Attempt<T> {
    pub usage: TokenUsage,
    pub result: Result<T, ApiError>,
}

/// 한 작업(같은 키·모델·원문 언어)의 Messages API 클라이언트. 키는 작업 동안만 들고 있다.
pub struct MessagesClient<T> {
    transport: T,
    key: ApiKey,
    model: TranslateModel,
    language: Language,
}

/// 보낼 항목 범위와, 검증 실패로 다시 보내는 요청인지
struct Pending {
    range: Range<usize>,
    is_retry: bool,
}

/// 요청 하나를 본 결정
enum Settle {
    /// 범위의 항목 결과가 정해졌다
    Done(Vec<ItemOutcome>),
    /// 다시 보낼 요청을 쌓았다
    Requeued,
}

impl<T: Transport> MessagesClient<T> {
    pub fn new(transport: T, key: ApiKey, model: TranslateModel, language: Language) -> Self {
        Self {
            transport,
            key,
            model,
            language,
        }
    }

    /// 텍스트 묶음을 보내 항목마다(`chunk.items` 순서) 결과를 낸다.
    pub async fn translate_text(&self, chunk: &TextChunk) -> Attempt<Vec<ItemOutcome>> {
        self.send_text(chunk, None).await
    }

    /// 다시 번역: 문단 하나를 담은 묶음을 앞·뒤 문단 문맥과 함께 보낸다(ADR 0002 §5 "다시 번역").
    pub(crate) async fn retranslate_text(
        &self,
        chunk: &TextChunk,
        context: &RequestContext,
    ) -> Attempt<Vec<ItemOutcome>> {
        self.send_text(chunk, Some(context)).await
    }

    async fn send_text(
        &self,
        chunk: &TextChunk,
        context: Option<&RequestContext>,
    ) -> Attempt<Vec<ItemOutcome>> {
        let mut usage = TokenUsage::default();
        // 쌓인 요청이 모두 끝나면 모든 항목이 정해지므로 초기값은 남지 않는다.
        let mut outcomes = vec![ItemOutcome::Failed(FailReason::Mismatch); chunk.items.len()];
        let max_tokens = chunk.estimate.max_tokens(self.model);
        let mut stack = vec![Pending {
            range: 0..chunk.items.len(),
            is_retry: false,
        }];
        while let Some(pending) = stack.pop() {
            let items = &chunk.items[pending.range.clone()];
            let glossary: Vec<GlossaryTerm> = chunk
                .glossary
                .iter()
                .filter(|term| items.iter().any(|item| term_appears_in(term, &item.text)))
                .cloned()
                .collect();
            let body = text_request(
                self.model,
                self.language,
                items,
                &glossary,
                max_tokens,
                context,
            );
            let reply =
                match send_with_retry(|| self.transport.post_messages(&self.key, &body)).await {
                    Ok(body) => read_reply(&body),
                    Err(SendFailure::TooLarge(_)) if items.len() > 1 => {
                        split(&mut stack, &pending);
                        continue;
                    }
                    Err(SendFailure::TooLarge(error) | SendFailure::Api(error)) => {
                        return Attempt {
                            usage,
                            result: Err(error),
                        };
                    }
                };
            usage.add(reply.usage);
            let checked = match reply.kind {
                ReplyKind::Complete(output) => validate_text(&output, items.len()).map(|texts| {
                    Settle::Done(texts.into_iter().map(ItemOutcome::Translated).collect())
                }),
                ReplyKind::Invalid(reason) => Err(reason),
                ReplyKind::Truncated if items.len() > 1 => {
                    log::warn!("번역 응답 잘림: 항목 {}개를 나눠 다시 보낸다", items.len());
                    split(&mut stack, &pending);
                    Ok(Settle::Requeued)
                }
                ReplyKind::Truncated => {
                    log::warn!("번역 응답 잘림: 항목 1개");
                    Ok(Settle::Done(vec![ItemOutcome::Failed(
                        FailReason::Truncated,
                    )]))
                }
                ReplyKind::Refused(category) => {
                    log_refusal(category.as_deref(), items.len());
                    Ok(Settle::Done(vec![ItemOutcome::Refused; items.len()]))
                }
            };
            let settle = checked.unwrap_or_else(|reason| {
                log_invalid(reason, items.len());
                retry_mismatch(&mut stack, &pending)
            });
            if let Settle::Done(settled) = settle {
                for (slot, outcome) in outcomes[pending.range].iter_mut().zip(settled) {
                    *slot = outcome;
                }
            }
        }
        Attempt {
            usage,
            result: Ok(outcomes),
        }
    }

    /// 스캔 묶음(그림 `png`)을 보내 받아 적은 문단을 낸다.
    pub async fn translate_scan(&self, chunk: &ScanChunk, png: &[u8]) -> Attempt<ScanOutcome> {
        let mut usage = TokenUsage::default();
        let max_tokens = chunk.estimate.max_tokens(self.model);
        let body = scan_request(self.model, self.language, &chunk.glossary, max_tokens, png);
        let mut is_retry = false;
        loop {
            let reply =
                match send_with_retry(|| self.transport.post_messages(&self.key, &body)).await {
                    Ok(body) => read_reply(&body),
                    Err(SendFailure::TooLarge(error) | SendFailure::Api(error)) => {
                        return Attempt {
                            usage,
                            result: Err(error),
                        };
                    }
                };
            usage.add(reply.usage);
            let checked = match reply.kind {
                ReplyKind::Complete(output) => validate_scan(&output).map(ScanOutcome::Paragraphs),
                ReplyKind::Invalid(reason) => Err(reason),
                ReplyKind::Truncated => {
                    log::warn!("번역 응답 잘림: 스캔 쪽");
                    Ok(ScanOutcome::Failed(FailReason::Truncated))
                }
                ReplyKind::Refused(category) => {
                    log_refusal(category.as_deref(), 1);
                    Ok(ScanOutcome::Refused)
                }
            };
            let outcome = match checked {
                Ok(outcome) => outcome,
                Err(reason) => {
                    log_invalid(reason, 1);
                    if !is_retry {
                        is_retry = true;
                        continue;
                    }
                    ScanOutcome::Failed(FailReason::Mismatch)
                }
            };
            return Attempt {
                usage,
                result: Ok(outcome),
            };
        }
    }
}

/// 앞 ⌈n/2⌉개와 나머지로 나눠 쌓는다(검증 실패로 다시 보내는 요청인지는 물려받는다). 뒤에 쌓은 것을
/// 먼저 꺼내므로 뒤쪽을 먼저 쌓는다(문서 순서로 보낸다).
fn split(stack: &mut Vec<Pending>, pending: &Pending) {
    let Range { start, end } = pending.range;
    let middle = start + (end - start).div_ceil(2);
    stack.push(Pending {
        range: middle..end,
        is_retry: pending.is_retry,
    });
    stack.push(Pending {
        range: start..middle,
        is_retry: pending.is_retry,
    });
}

/// 검증 실패: 처음이면 나눠서(하나면 그대로) 한 번 더, 다시 보낸 요청이면 모두 `Failed(Mismatch)`.
fn retry_mismatch(stack: &mut Vec<Pending>, pending: &Pending) -> Settle {
    if pending.is_retry {
        return Settle::Done(vec![
            ItemOutcome::Failed(FailReason::Mismatch);
            pending.range.len()
        ]);
    }
    let retry = Pending {
        range: pending.range.clone(),
        is_retry: true,
    };
    if retry.range.len() > 1 {
        split(stack, &retry);
    } else {
        stack.push(retry);
    }
    Settle::Requeued
}

fn log_invalid(reason: &str, item_count: usize) {
    log::warn!("번역 응답 검증 실패: {reason}, 항목 {item_count}개");
}

fn log_refusal(category: Option<&str>, item_count: usize) {
    log::warn!(
        "번역 거절: 범주 {}, 항목 {item_count}개",
        category.unwrap_or("-")
    );
}
