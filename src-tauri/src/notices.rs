//! 앱과 함께 번들한 제3자 고지(`THIRD_PARTY_NOTICES.md`, `pnpm licenses:generate`가 만든다)를 읽는다.
//! 프론트에서 경로를 받지 않고 앱 리소스 폴더의 고정 이름 파일 하나만 읽는다(읽기 전용).

use std::fs;
use std::path::Path;

use crate::error::CommandError;

/// `tauri.conf.json > bundle.resources`가 리소스 폴더에 두는 이름
pub(crate) const THIRD_PARTY_NOTICES_FILE: &str = "THIRD_PARTY_NOTICES.md";

pub(crate) fn read_third_party_notices(resource_dir: &Path) -> Result<String, CommandError> {
    fs::read_to_string(resource_dir.join(THIRD_PARTY_NOTICES_FILE)).map_err(|error| {
        CommandError::ResourceUnavailable {
            name: THIRD_PARTY_NOTICES_FILE,
            detail: error.to_string(),
        }
    })
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use serde_json::Value;

    use super::THIRD_PARTY_NOTICES_FILE;

    const TAURI_CONFIG: &str = include_str!("../tauri.conf.json");

    /// 커맨드는 리소스 폴더의 `THIRD_PARTY_NOTICES_FILE`을 읽는다. 번들 설정이 그 이름으로
    /// 실제 있는 파일을 넣지 않으면 앱에서 고지를 열 수 없다(E2E의 가짜 플랫폼으로는 잡히지 않는다).
    #[test]
    fn bundle_resources_place_notices_where_command_reads() {
        let config: Value = serde_json::from_str(TAURI_CONFIG).expect("parse tauri.conf.json");
        let resources = config["bundle"]["resources"]
            .as_object()
            .expect("bundle.resources is a source → target map");
        let source = resources
            .iter()
            .find(|(_, target)| target.as_str() == Some(THIRD_PARTY_NOTICES_FILE))
            .map(|(source, _)| source)
            .expect("bundle.resources maps a file to THIRD_PARTY_NOTICES_FILE");

        let source_path = Path::new(env!("CARGO_MANIFEST_DIR")).join(source);
        assert!(
            source_path.is_file(),
            "bundled notices source is missing: {}",
            source_path.display()
        );
    }
}
