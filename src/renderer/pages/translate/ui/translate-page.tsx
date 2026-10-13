import { useEffect, useState } from "react";
import {
  ApiKeyDialog,
  ApiKeyStatusRow,
  loadApiKeyStatus,
  useApiKeyStatus
} from "@/renderer/features/api-key";
import {
  TranslateFileCard,
  TranslateOptionsCard,
  TranslateRunSummaryCard,
  useTranslateRequestOptions,
  useTranslationPlan
} from "@/renderer/features/pdf-translate";
import { useTranslateSettingsStore } from "@/renderer/features/translate-settings";

interface TranslatePageProps {
  /** 설정 모달을 번역 탭으로 연다("외부 전송 확인을 껐어요 · 설정"). */
  onOpenTranslateSettings: () => void;
}

/**
 * 번역 화면(시안 10): 왼쪽 문서 카드·번역 옵션 카드, 오른쪽 실행 전 확인 카드(`1fr | 340px`).
 * 설정의 기본 모델·공용 용어집·외부 전송 확인과 키 상태를 읽어 번역 기능에 넘긴다(FSD: 같은 레이어끼리 import 금지).
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

  // 키 상태(설정 저장소의 힌트, 키체인은 읽지 않는다)를 화면에 들어올 때 읽는다.
  useEffect(() => {
    void loadApiKeyStatus();
  }, []);

  const openApiKeyDialog = () => setIsApiKeyDialogOpen(true);

  return (
    <div className="bg-canvas flex-1 overflow-auto px-6 py-5 text-sm/5.25">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(280px,340px)] items-start gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          <TranslateFileCard />
          <TranslateOptionsCard
            defaultModel={defaultModel}
            sharedGlossaryRows={sharedGlossaryRows}
          />
        </div>
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
      <ApiKeyDialog
        isOpen={isApiKeyDialogOpen}
        onOpenChange={setIsApiKeyDialogOpen}
      />
    </div>
  );
}
