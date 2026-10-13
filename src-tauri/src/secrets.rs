//! API 키 보관과 키 커맨드(ADR 0002 §10·§12·§13, 계획서 Q6·Q15·Q17).
//!
//! - 키는 OS 키체인(`keyring`)에만 둔다. 서비스 이름은 앱 식별자(번들 ID), 계정은 [`KEYCHAIN_ACCOUNT`]다.
//!   평문 파일·설정 저장소·환경 변수에 두지 않고, 키체인을 쓸 수 없으면 `KEYCHAIN_UNAVAILABLE`로 멈춘다.
//! - 화면 표시는 설정 저장소의 힌트(끝 4자리)만 쓴다. 키체인은 요청을 보낼 때만 읽는다(번역·다시 번역 시작).
//!   ad-hoc 서명 앱은 업데이트 뒤 첫 키체인 읽기에 허락 창이 뜰 수 있어, 화면을 열 때마다 읽지 않는다.
//! - 키 원문은 웹뷰로 다시 가지 않고 `AppError`·로그에 싣지 않는다. 키체인 오류는 종류만 남긴다.

use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;
use translate::{ApiKey, Transport};

use crate::contract::ApiKeyStatus;
use crate::error::CommandError;

/// 키체인 계정 이름(서비스 이름은 앱 식별자)
const KEYCHAIN_ACCOUNT: &str = "anthropic-api-key";
/// 설정 저장소 파일. 프론트(`plugin-store` `LazyStore`)와 같은 파일·같은 저장소다.
const SETTINGS_FILE: &str = "settings.json";
/// 키 끝 4자리 힌트. Rust만 쓴다.
const API_KEY_HINT_SETTING: &str = "translate.apiKeyHint";
/// 외부 전송 확인을 한 번 받았는가(ADR 0002 §13). 프론트가 `true`로, 키 저장이 `false`로 쓴다.
const TRANSFER_CONFIRMED_ONCE_SETTING: &str = "translate.transferConfirmedOnce";

/// 키체인 실패 종류(오류·로그에는 이것만 싣는다)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct KeychainError(pub(crate) &'static str);

/// 키를 두는 곳(앱은 OS 키체인)
pub(crate) trait KeyStore {
    /// 저장된 키. 없으면 `None`
    fn read(&self) -> Result<Option<String>, KeychainError>;
    fn write(&self, key: &str) -> Result<(), KeychainError>;
    /// 항목이 없어도 성공이다.
    fn delete(&self) -> Result<(), KeychainError>;
}

/// 키 힌트·전송 확인 설정(앱은 `plugin-store` 설정 저장소)
pub(crate) trait KeySettings {
    fn api_key_hint(&self) -> Option<String>;
    /// `None`이면 힌트를 지운다.
    fn set_api_key_hint(&self, hint: Option<&str>) -> Result<(), CommandError>;
    fn set_transfer_confirmed_once(&self, confirmed: bool) -> Result<(), CommandError>;
}

/// OS 키체인(macOS Keychain, Windows 자격 증명 관리자, Linux Secret Service)
pub(crate) struct Keychain {
    service: String,
}

impl Keychain {
    pub(crate) fn new(service: &str) -> Self {
        Self {
            service: service.to_owned(),
        }
    }

    fn entry(&self) -> Result<keyring::Entry, KeychainError> {
        keyring::Entry::new(&self.service, KEYCHAIN_ACCOUNT).map_err(keychain_error)
    }
}

impl KeyStore for Keychain {
    fn read(&self) -> Result<Option<String>, KeychainError> {
        match self.entry()?.get_password() {
            Ok(key) => Ok(Some(key)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(keychain_error(error)),
        }
    }

    fn write(&self, key: &str) -> Result<(), KeychainError> {
        self.entry()?.set_password(key).map_err(keychain_error)
    }

    fn delete(&self) -> Result<(), KeychainError> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(keychain_error(error)),
        }
    }
}

/// 오류 종류만 남긴다. `keyring` 오류의 `Debug`는 읽은 바이트(키)를 담을 수 있다(`BadEncoding`).
fn keychain_error(error: keyring::Error) -> KeychainError {
    KeychainError(match error {
        keyring::Error::PlatformFailure(_) => "platform failure",
        keyring::Error::NoStorageAccess(_) => "no storage access",
        keyring::Error::NoDefaultStore => "no credential store",
        keyring::Error::BadEncoding(_) | keyring::Error::BadDataFormat(..) => "unreadable entry",
        _ => "credential store error",
    })
}

/// 설정 저장소(`settings.json`)
pub(crate) struct AppSettings<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> AppSettings<R> {
    pub(crate) fn new(app: &AppHandle<R>) -> Self {
        Self { app: app.clone() }
    }

    fn store(&self) -> Result<std::sync::Arc<tauri_plugin_store::Store<R>>, CommandError> {
        self.app
            .store(SETTINGS_FILE)
            .map_err(|error| CommandError::SettingsUnavailable {
                detail: error.to_string(),
            })
    }

    fn saved(store: &tauri_plugin_store::Store<R>) -> Result<(), CommandError> {
        store
            .save()
            .map_err(|error| CommandError::SettingsUnavailable {
                detail: error.to_string(),
            })
    }
}

impl<R: Runtime> KeySettings for AppSettings<R> {
    fn api_key_hint(&self) -> Option<String> {
        let store = self
            .store()
            .inspect_err(|error| log::warn!("설정 저장소를 열지 못했다: {error}"))
            .ok()?;
        store.get(API_KEY_HINT_SETTING)?.as_str().map(str::to_owned)
    }

    fn set_api_key_hint(&self, hint: Option<&str>) -> Result<(), CommandError> {
        let store = self.store()?;
        match hint {
            Some(hint) => store.set(API_KEY_HINT_SETTING, hint),
            None => {
                store.delete(API_KEY_HINT_SETTING);
            }
        }
        Self::saved(&store)
    }

    fn set_transfer_confirmed_once(&self, confirmed: bool) -> Result<(), CommandError> {
        let store = self.store()?;
        store.set(TRANSFER_CONFIRMED_ONCE_SETTING, confirmed);
        Self::saved(&store)
    }
}

/// 키 상태. 힌트만 보고 키체인을 읽지 않는다(Q17).
pub(crate) fn api_key_status(settings: &impl KeySettings) -> ApiKeyStatus {
    let hint = settings.api_key_hint();
    ApiKeyStatus {
        registered: hint.is_some(),
        hint,
    }
}

/// 형식 검사 → 키체인 쓰기 → 힌트 저장 → 외부 전송 확인을 다시 받게(`transferConfirmedOnce = false`). 새 키(새
/// 계정)로 처음 보내는 전송은 늘 확인한다(ADR 0002 §13). 네트워크를 쓰지 않는다.
pub(crate) fn save_api_key(
    keys: &impl KeyStore,
    settings: &impl KeySettings,
    raw: &str,
) -> Result<ApiKeyStatus, CommandError> {
    let key = ApiKey::parse(raw).map_err(|_| CommandError::ApiKeyInvalid)?;
    keys.write(raw.trim()).map_err(keychain_unavailable)?;
    let hint = key.hint();
    settings.set_api_key_hint(Some(&hint))?;
    settings.set_transfer_confirmed_once(false)?;
    Ok(ApiKeyStatus {
        registered: true,
        hint: Some(hint),
    })
}

/// 키체인 항목과 힌트를 지운다. 항목이 없어도 성공이다. 전송 확인 설정은 건드리지 않는다(다시 등록할 때 되돌린다).
pub(crate) fn delete_api_key(
    keys: &impl KeyStore,
    settings: &impl KeySettings,
) -> Result<ApiKeyStatus, CommandError> {
    keys.delete().map_err(keychain_unavailable)?;
    settings.set_api_key_hint(None)?;
    Ok(ApiKeyStatus {
        registered: false,
        hint: None,
    })
}

/// 요청을 보낼 때 키체인에서 키를 읽는다. 없으면 남은 힌트를 지우고 `API_KEY_MISSING`이다.
pub(crate) fn read_api_key(
    keys: &impl KeyStore,
    settings: &impl KeySettings,
) -> Result<ApiKey, CommandError> {
    match keys.read().map_err(keychain_unavailable)? {
        Some(stored) => ApiKey::parse(&stored).map_err(|_| CommandError::ApiKeyInvalid),
        None => {
            if settings.api_key_hint().is_some()
                && let Err(error) = settings.set_api_key_hint(None)
            {
                log::warn!("남은 키 힌트를 지우지 못했다: {}", error.code());
            }
            Err(CommandError::ApiKeyMissing)
        }
    }
}

/// 형식 검사 → 모델 목록 한 번(ADR 0002 §10). 저장하지 않는다. 형식이 틀리면 네트워크 없이 `API_KEY_INVALID`다.
pub(crate) async fn verify_api_key<T: Transport>(
    transport: &T,
    raw: &str,
) -> Result<(), CommandError> {
    let key = ApiKey::parse(raw).map_err(|_| CommandError::ApiKeyInvalid)?;
    translate::verify_api_key(transport, &key)
        .await
        .map_err(CommandError::Api)
}

fn keychain_unavailable(KeychainError(kind): KeychainError) -> CommandError {
    log::warn!("키체인을 쓸 수 없다: {kind}");
    CommandError::KeychainUnavailable { kind }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::{AppError, ErrorCode};
    use crate::test_support::{
        FakeCall, FakeKeySettings, FakeKeyStore, FakeTransport, assert_no_secret, captured_logs,
        reply,
    };

    const KEY: &str = "sk-ant-api03-secret-test-key-a1F3";

    /// 저장하면 키는 키체인에만 가고 설정 저장소에는 끝 4자리 힌트만 남는다. 새 키라 외부 전송 확인을 다시 받는다.
    /// 상태는 힌트만 보고 키체인을 읽지 않으며, 지우면 둘 다 사라진다.
    #[test]
    fn a_saved_key_lives_in_the_keychain_and_only_its_hint_is_shown() {
        let keys = FakeKeyStore::default();
        let settings = FakeKeySettings::with_transfer_confirmed();

        let saved = save_api_key(&keys, &settings, &format!("  {KEY}\n")).expect("saved");
        let shown = api_key_status(&settings);

        assert_eq!(keys.stored(), Some(KEY.to_owned()));
        assert_eq!(settings.hint(), Some("a1F3".to_owned()));
        assert_eq!(settings.transfer_confirmed_once(), Some(false));
        let expected = ApiKeyStatus {
            registered: true,
            hint: Some("a1F3".to_owned()),
        };
        assert_eq!(saved, expected);
        assert_eq!(shown, expected);
        assert_eq!(keys.reads(), 0);
        assert_no_secret(&serde_json::to_string(&shown).expect("status JSON"), &[KEY]);

        let deleted = delete_api_key(&keys, &settings).expect("deleted");
        assert_eq!(
            deleted,
            ApiKeyStatus {
                registered: false,
                hint: None
            }
        );
        assert_eq!(keys.stored(), None);
        assert_eq!(settings.hint(), None);
    }

    /// 형식이 틀린 키는 키체인·네트워크 전에 `API_KEY_INVALID`로 거부한다.
    #[test]
    fn a_malformed_key_is_rejected_before_the_keychain_or_the_network() {
        let keys = FakeKeyStore::default();
        let settings = FakeKeySettings::default();
        let transport = FakeTransport::new(|_| reply(200, "{}"));
        let malformed = "sk-proj-not-an-anthropic-key";

        let saved = save_api_key(&keys, &settings, malformed).expect_err("malformed");
        let verified = tauri::async_runtime::block_on(verify_api_key(&transport, malformed))
            .expect_err("malformed");

        assert_eq!(saved.code(), ErrorCode::ApiKeyInvalid);
        assert_eq!(verified.code(), ErrorCode::ApiKeyInvalid);
        assert_eq!(keys.writes(), 0);
        assert!(transport.calls().is_empty());
    }

    /// 키체인에 키가 없으면(힌트만 남았다) 힌트도 지우고 `API_KEY_MISSING`이다.
    #[test]
    fn a_hint_without_a_keychain_entry_is_cleared_when_the_key_is_needed() {
        let keys = FakeKeyStore::default();
        let settings = FakeKeySettings::default();
        settings.set_api_key_hint(Some("a1F3")).expect("left hint");

        let error = read_api_key(&keys, &settings).expect_err("no key");

        assert_eq!(error.code(), ErrorCode::ApiKeyMissing);
        assert_eq!(settings.hint(), None);
    }

    /// 키 확인이 401로 실패하고(서버가 키를 되돌려 보내도) 키체인 쓰기가 실패해도 `AppError`·로그에 키가 없다.
    #[test]
    fn failures_leave_no_key_in_app_errors_or_logs() {
        let logs = captured_logs();
        let echoing = FakeTransport::new(|_| {
            reply(
                401,
                &format!(
                    r#"{{"type":"error","error":{{"type":"authentication_error","message":"invalid key {KEY}"}},"request_id":"req_1"}}"#
                ),
            )
        });
        let failing_keys = FakeKeyStore::failing();

        let verified = tauri::async_runtime::block_on(verify_api_key(&echoing, KEY))
            .expect_err("rejected key");
        let saved = save_api_key(&failing_keys, &FakeKeySettings::default(), KEY)
            .expect_err("keychain unavailable");

        assert_eq!(echoing.calls(), [FakeCall::Models]);
        let verified = AppError::from(verified);
        let saved = AppError::from(saved);
        assert_eq!(verified.code, ErrorCode::ApiKeyInvalid);
        assert_eq!(saved.code, ErrorCode::KeychainUnavailable);
        for error in [&verified, &saved] {
            assert_no_secret(&error.message, &[KEY]);
            assert_no_secret(&format!("{error:?}"), &[KEY]);
        }
        let lines = logs.lines();
        assert!(!lines.is_empty(), "실패는 로그에 남는다");
        lines.iter().for_each(|line| assert_no_secret(line, &[KEY]));
    }
}
