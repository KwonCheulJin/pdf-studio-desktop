//! 오래 걸리는 작업의 취소 토큰 표. 프론트가 만든 작업 ID로 찾는다.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use crate::error::CommandError;

#[derive(Default)]
pub(crate) struct JobRegistry {
    jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl JobRegistry {
    /// 작업을 등록하고 취소 토큰을 쥔 guard를 돌려준다. guard가 사라지면 등록도 지운다.
    /// 같은 ID의 작업이 아직 돌고 있으면 거부한다.
    pub(crate) fn start(&self, job_id: &str) -> Result<JobGuard<'_>, CommandError> {
        let mut jobs = self.lock();
        if jobs.contains_key(job_id) {
            return Err(CommandError::JobAlreadyRunning {
                job_id: job_id.to_owned(),
            });
        }
        let token = Arc::new(AtomicBool::new(false));
        jobs.insert(job_id.to_owned(), Arc::clone(&token));
        Ok(JobGuard {
            registry: self,
            job_id: job_id.to_owned(),
            token,
        })
    }

    /// 작업의 취소 토큰을 켠다. 이미 끝났거나 없는 작업이면 아무 일도 하지 않는다.
    pub(crate) fn cancel(&self, job_id: &str) {
        if let Some(token) = self.lock().get(job_id) {
            token.store(true, Ordering::Relaxed);
        }
    }

    /// 표는 넣기·빼기만 하므로 다른 스레드가 패닉해도 내용이 깨지지 않는다. 잠금 오염은 무시한다.
    fn lock(&self) -> MutexGuard<'_, HashMap<String, Arc<AtomicBool>>> {
        self.jobs.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

pub(crate) struct JobGuard<'a> {
    registry: &'a JobRegistry,
    job_id: String,
    token: Arc<AtomicBool>,
}

impl JobGuard<'_> {
    /// 작업 스레드로 넘길 취소 토큰
    pub(crate) fn token(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.token)
    }
}

impl Drop for JobGuard<'_> {
    fn drop(&mut self) {
        self.registry.lock().remove(&self.job_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    const JOB_ID: &str = "merge-1";

    #[test]
    fn cancel_flips_the_running_job_token_and_a_finished_job_id_can_be_reused() {
        let registry = JobRegistry::default();
        let job = registry.start(JOB_ID).expect("start job");
        let token = job.token();

        registry.cancel(JOB_ID);
        assert!(token.load(Ordering::Relaxed));
        let duplicate = registry.start(JOB_ID).err().expect("duplicate is rejected");
        assert_eq!(duplicate.code(), ErrorCode::JobAlreadyRunning);

        drop(job);
        let restarted = registry.start(JOB_ID).expect("finished job id is free");
        assert!(!restarted.token().load(Ordering::Relaxed));
    }
}
