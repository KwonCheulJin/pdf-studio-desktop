const LOGO_SIZE = 20;

/** 홈 상단바(시안 1): 로고와 앱 이름. 오른쪽 설정 버튼 자리는 설정 화면(Phase 6)까지 비워 둔다. */
export function AppHomeHeader() {
  return (
    <header className="border-border flex h-12 shrink-0 items-center gap-3 border-b px-4">
      <svg
        width={LOGO_SIZE}
        height={LOGO_SIZE}
        viewBox="0 0 20 20"
        aria-hidden="true"
      >
        <rect
          x="5"
          y="2"
          width="11"
          height="14"
          rx="2"
          className="fill-accent"
        />
        <rect
          x="3"
          y="4"
          width="11"
          height="14"
          rx="2"
          className="fill-primary"
        />
      </svg>
      <span className="text-[15px]/5.5 font-semibold">PDF Studio</span>
    </header>
  );
}
