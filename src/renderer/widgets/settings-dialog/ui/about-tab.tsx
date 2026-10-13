import { ThirdPartyNoticesButton } from "@/renderer/features/third-party-notices";
import { SETTING_BUTTON_CLASS } from "@/renderer/shared/ui";
import { SETTINGS_TEXT } from "../config/settings-dialog";

/** 정보 탭(Q9): 앱 이름·버전, 오픈소스 라이선스(상태바와 같은 대화상자), 저장소 주소(고를 수 있는 글자) */
export function AboutTab() {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-6 gap-y-3.5">
      <dt className="text-muted-foreground text-[13px]">
        {SETTINGS_TEXT.VERSION}
      </dt>
      <dd>
        <span className="font-semibold">{SETTINGS_TEXT.APP_NAME}</span>{" "}
        <span className="font-mono">v{__APP_VERSION__}</span>
      </dd>
      <dt className="text-muted-foreground text-[13px]">
        {SETTINGS_TEXT.LICENSES}
      </dt>
      <dd className="flex">
        <ThirdPartyNoticesButton className={SETTING_BUTTON_CLASS.OUTLINE} />
      </dd>
      <dt className="text-muted-foreground text-[13px]">
        {SETTINGS_TEXT.REPOSITORY}
      </dt>
      <dd className="font-mono text-[13px] select-all">
        {SETTINGS_TEXT.REPOSITORY_ADDRESS}
      </dd>
    </dl>
  );
}
