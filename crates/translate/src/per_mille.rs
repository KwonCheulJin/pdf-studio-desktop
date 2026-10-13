//! 천분율. 비율 상수를 정수로 두어 올림·경계 비교가 부동소수 오차(`1.3 × 10 = 13.000…02`)에
//! 흔들리지 않게 한다.

/// 천분율 1이 나타내는 분모
pub(crate) const PER_MILLE_SCALE: u64 = 1_000;

/// 천분율 값. `PerMille(1_300)`은 1.3이다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PerMille(pub(crate) u64);

impl PerMille {
    /// `value × 이 비율`을 올림한 정수
    pub(crate) fn of_ceil(self, value: u64) -> u64 {
        (value * self.0).div_ceil(PER_MILLE_SCALE)
    }

    /// `part / whole`이 이 비율 이상인가. `whole`이 0이면 거짓이다.
    pub(crate) fn reached_by(self, part: u64, whole: u64) -> bool {
        whole > 0 && part * PER_MILLE_SCALE >= whole * self.0
    }
}
