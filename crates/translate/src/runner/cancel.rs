//! 취소 토큰(`src-tauri` 작업 등록의 `AtomicBool`)과 일을 함께 기다린다(ADR 0002 §9 "취소").

use std::future::{Future, poll_fn};
use std::pin::pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::task::Poll;
use std::time::Duration;

/// 일을 기다리는 동안 취소 토큰을 보는 간격. 요청 하나가 수 초~수십 초라 사용자가 느끼지 못하는 지연이다.
const CANCEL_POLL_INTERVAL: Duration = Duration::from_millis(50);

/// `work`가 끝나면 그 결과, 먼저 취소되면 `None`이다. 취소면 `work`를 버린다: 보내던 요청(연결)과 재시도
/// 대기가 함께 멈추고, 그 요청의 사용량은 알 수 없다. 둘이 함께 준비되면 끝난 일을 받는다(돈을 낸 결과다).
pub(super) async fn until_cancelled<F: Future>(cancel: &AtomicBool, work: F) -> Option<F::Output> {
    let mut work = pin!(work);
    let mut cancelled = pin!(wait_cancelled(cancel));
    poll_fn(|cx| {
        if let Poll::Ready(output) = work.as_mut().poll(cx) {
            return Poll::Ready(Some(output));
        }
        cancelled.as_mut().poll(cx).map(|()| None)
    })
    .await
}

async fn wait_cancelled(cancel: &AtomicBool) {
    while !cancel.load(Ordering::Relaxed) {
        tokio::time::sleep(CANCEL_POLL_INTERVAL).await;
    }
}
