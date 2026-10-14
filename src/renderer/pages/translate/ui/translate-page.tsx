import { useEffect, useState, type ReactNode } from "react";
import { TranslationViewer } from "@/renderer/widgets/translation-viewer";
import {
  ApiKeyDialog,
  ApiKeyStatusRow,
  loadApiKeyStatus,
  useApiKeyStatus
} from "@/renderer/features/api-key";
import {
  TRANSLATE_SCREEN,
  TranslateFailureCard,
  TranslateFileCard,
  TranslateOptionsCard,
  TranslateProgressCard,
  TranslateRunSummaryCard,
  useTranslateRequestOptions,
  useTranslateScreen,
  useTranslationPlan
} from "@/renderer/features/pdf-translate";
import { useTranslateSettingsStore } from "@/renderer/features/translate-settings";

/** 진행·실패 카드를 가운데 위에 두는 바탕(시안 12: 위아래 40px, 좌우 24px) */
const CENTERED_SCREEN_CLASS =
  "bg-canvas flex flex-1 justify-center overflow-auto px-6 py-10 text-sm/5.25";

interface TranslatePageProps {
  /** 설정 모달을 번역 탭으로 연다("외부 전송 확인을 껐어요 · 설정"). */
  onOpenTranslateSettings: () => void;
}

/**
 * 번역 화면. 옵션 화면(시안 10: 왼쪽 문서 카드·번역 옵션 카드, 오른쪽 실행 전 확인 카드 `1fr | 340px`),
 * 실행하면 그 자리에 진행 카드(시안 12), 실패하면 같은 자리에 실패, 끝나면 결과 대역 보기(시안 13)를 보인다.
 * 설정의 기본 모델·공용 용어집·외부 전송 확인과 키 상태를 읽어 번역 기능에 넘긴다(FSD: 같은 레이어끼리 import 금지).
 * 계획은 화면이 바뀌어도 받는다(취소·실패 뒤 옵션 화면의 이어하기 표시).
 */
export function TranslatePage({ onOpenTranslateSettings }: TranslatePageProps) {
  const defaultModel = useTranslateSettingsStore((state) => state.defaultModel);
  const sharedGlossaryRows = useTranslateSettingsStore(
    (state) => state.glossaryRows
  );
  const confirmExternalTransfer = useTranslateSettingsStore(
    (state) => state.confirmExternalTransfer
  );
  const apiKeyStatus = useApiKeyStatus();
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);
  const options = useTranslateRequestOptions({
    defaultModel,
    sharedGlossaryRows
  });
  const planState = useTranslationPlan(options);
  const screen = useTranslateScreen();

  // 키 상태(설정 저장소의 힌트, 키체인은 읽지 않는다)를 화면에 들어올 때 읽는다.
  useEffect(() => {
    void loadApiKeyStatus();
  }, []);

  const openApiKeyDialog = () => setIsApiKeyDialogOpen(true);

  const renderScreen = (): ReactNode => {
    switch (screen) {
      case TRANSLATE_SCREEN.PROGRESS:
        return (
          <div className={CENTERED_SCREEN_CLASS}>
            <TranslateProgressCard />
          </div>
        );
      case TRANSLATE_SCREEN.FAILURE:
        return (
          <div className={CENTERED_SCREEN_CLASS}>
            <TranslateFailureCard onChangeApiKey={openApiKeyDialog} />
          </div>
        );
      case TRANSLATE_SCREEN.RESULT:
        return <TranslationViewer />;
      default:
        return (
          <div className="bg-canvas flex flex-1 flex-col overflow-auto px-6 py-5 text-sm/5.25">
            <div className="grid flex-1 grid-cols-[minmax(0,1fr)_minmax(280px,340px)] gap-4">
              <div className="flex min-w-0 flex-col gap-4">
                <TranslateFileCard />
                <TranslateOptionsCard
                  defaultModel={defaultModel}
                  sharedGlossaryRows={sharedGlossaryRows}
                />
              </div>
              <div className="self-start">
                <TranslateRunSummaryCard
                  options={options}
                  planState={planState}
                  apiKeyStatus={apiKeyStatus}
                  apiKeyRow={
                    <ApiKeyStatusRow
                      status={apiKeyStatus}
                      onOpenDialog={openApiKeyDialog}
                    />
                  }
                  confirmExternalTransfer={confirmExternalTransfer}
                  onRequestApiKey={openApiKeyDialog}
                  onOpenTranslateSettings={onOpenTranslateSettings}
                />
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <>
      {renderScreen()}
      <ApiKeyDialog
        isOpen={isApiKeyDialogOpen}
        onOpenChange={setIsApiKeyDialogOpen}
      />
    </>
  );
}
