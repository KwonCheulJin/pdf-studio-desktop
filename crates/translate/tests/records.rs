//! 기록 지우기(ADR 0002 §8 "지우기"): 설정 '일반'의 "저장된 번역 지우기"가 부른다.

use std::fs;

use translate::delete_translation_records;

/// 기록(`.json`)과 쓰다 남은 임시 파일(`.record-*.tmp`)만 지우고 다른 파일은 둔다. 폴더가 없어도 성공이다.
#[test]
fn deleting_records_removes_record_files_and_leftover_temp_files_only() {
    let dir = std::env::temp_dir().join(format!("translate-records-{}", std::process::id()));
    fs::remove_dir_all(&dir).ok();
    fs::create_dir_all(&dir).expect("record dir");
    for name in [
        "0f3c5d1e2a4b6c8d0f3c5d1e2a4b6c8d.json",
        ".record-0f3c5d1e2a4b6c8d0f3c5d1e2a4b6c8d-41-1760313600000000000-0.tmp",
        "notes.txt",
    ] {
        fs::write(dir.join(name), b"{}").expect("write file");
    }

    let deleted = delete_translation_records(&dir);
    let mut left: Vec<String> = fs::read_dir(&dir)
        .expect("read dir")
        .map(|entry| {
            entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    left.sort();
    fs::remove_dir_all(&dir).ok();

    assert!(deleted.is_ok());
    assert_eq!(left, ["notes.txt"]);
    assert!(delete_translation_records(&dir.join("missing")).is_ok());
}
