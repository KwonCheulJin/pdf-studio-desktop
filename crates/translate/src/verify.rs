//! API 키 확인(ADR 0002 §10 `verify_api_key`, 계획서 Q15). 형식 검사([`ApiKey::parse`])를 통과한 키로 모델
//! 목록(`GET /v1/models`)을 한 번 받아 앱 모델 ID가 모두 있는지 본다. 문서를 보내지 않고 요금이 들지
//! 않는다. 오류는 Messages API와 같은 재시도·짝(§7)이다.

use serde::Deserialize;

use crate::error::{ApiError, ApiErrorCode};
use crate::http::Transport;
use crate::key::ApiKey;
use crate::models::TranslateModel;
use crate::retry::{SendFailure, send_with_retry};

/// 모델 목록 응답에서 읽는 것(`data[].id`)
#[derive(Deserialize)]
struct ModelList {
    data: Vec<ListedModel>,
}

#[derive(Deserialize)]
struct ListedModel {
    id: String,
}

/// 키로 모델 목록을 받는다. 앱 모델 ID가 하나라도 없으면(또는 목록을 읽을 수 없으면) `MODEL_UNAVAILABLE`이다.
pub async fn verify_api_key<T: Transport>(transport: &T, key: &ApiKey) -> Result<(), ApiError> {
    let body = send_with_retry(|| transport.get_models(key))
        .await
        .map_err(|failure| match failure {
            SendFailure::TooLarge(error) | SendFailure::Api(error) => error,
        })?;
    let listed: Vec<String> = serde_json::from_slice::<ModelList>(&body)
        .map(|list| list.data.into_iter().map(|model| model.id).collect())
        .unwrap_or_default();
    let all_listed = TranslateModel::ALL
        .iter()
        .all(|model| listed.iter().any(|id| id == model.spec().api_id));
    if all_listed {
        Ok(())
    } else {
        log::warn!(
            "키 확인: 모델 목록에 앱 모델이 없다(목록 {}개)",
            listed.len()
        );
        Err(ApiError::without_response(ApiErrorCode::ModelUnavailable))
    }
}
