use std::env;
use std::path::Path;

/// tauri-build 기본값과 같은 Common Controls v6 의존성 매니페스트
const WINDOWS_APP_MANIFEST_FILE: &str = "windows-app-manifest.xml";

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut attributes = tauri_build::Attributes::new();
    if is_windows_msvc_target() {
        // tauri-build는 매니페스트를 앱 exe에만 넣어 라이브러리 테스트 exe가 comctl32 v5를 불러
        // TaskDialogIndirect 진입점을 못 찾는다(STATUS_ENTRYPOINT_NOT_FOUND).
        // 링커로 모든 링크 대상에 직접 넣고, 중복(CVT1100)을 막으려 tauri-build 쪽은 끈다.
        // https://github.com/tauri-apps/tauri/issues/13419
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        embed_app_manifest_for_all_targets();
    }
    tauri_build::try_build(attributes)?;
    Ok(())
}

fn is_windows_msvc_target() -> bool {
    env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
}

fn embed_app_manifest_for_all_targets() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR")).join(WINDOWS_APP_MANIFEST_FILE);
    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    // 매니페스트가 빠지면 링커 경고로 끝나지 않고 빌드가 실패하게 한다.
    println!("cargo:rustc-link-arg=/WX");
}
