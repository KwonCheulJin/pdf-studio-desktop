import type { ReactNode } from "react";

interface SettingSectionProps {
  title: string;
  children: ReactNode;
}

/** 설정 한 묶음: 13px 굵은 제목 아래 내용(시안 14 "Claude API 키"·"기본 모델"·"공용 용어집") */
export function SettingSection({ title, children }: SettingSectionProps) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-[13px] font-semibold">{title}</h4>
      {children}
    </section>
  );
}

interface SettingRowProps {
  children: ReactNode;
}

/** 테두리 상자 한 줄(상태 글 + 오른쪽 버튼). 좁으면 버튼이 다음 줄로 내려간다. */
export function SettingRow({ children }: SettingRowProps) {
  return (
    <div className="border-border flex min-h-14 flex-wrap items-center gap-2.5 rounded-md border px-3.5 py-3">
      {children}
    </div>
  );
}

/** 설정 상자 안 작은 버튼(높이 30px·13px). 강조 없는 테두리 버튼과 빨간 글자 버튼 */
export const SETTING_BUTTON_CLASS = {
  OUTLINE:
    "border-border bg-card hover:bg-accent hover:text-accent-foreground h-7.5 rounded-sm border px-3 text-[13px] font-normal",
  DESTRUCTIVE:
    "text-destructive hover:bg-destructive-subtle h-7.5 rounded-sm px-3 text-[13px] font-normal"
} as const;
