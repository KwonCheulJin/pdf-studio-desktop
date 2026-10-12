import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "@/renderer/shared/lib/error-report";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  /** 오류 보고가 보낸 코드. 보내지 않았으면(꺼짐·실패) `null` */
  errorCode: string | null;
}

/** 렌더 중 오류를 잡아 보고하고 다시 시도 화면을 보인다. */
export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { hasError: false, errorCode: null };

  static getDerivedStateFromError(): Partial<AppErrorBoundaryState> {
    return { hasError: true, errorCode: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    void reportError({
      error,
      meta: {
        source: "ErrorBoundary",
        componentStack: info.componentStack ?? null
      }
    }).then((errorCode) => this.setState({ errorCode }));
  }

  handleReset = (): void => {
    this.setState({ hasError: false, errorCode: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    const { errorCode } = this.state;
    return (
      <div className="bg-background text-foreground flex h-screen flex-col items-center justify-center gap-4">
        <div className="border-destructive/30 bg-destructive/10 rounded-lg border p-8 text-center">
          <p className="text-destructive text-lg font-medium">
            앗, 문제가 생겼어요
          </p>
          {errorCode && (
            <>
              <p className="text-muted-foreground mt-2 text-sm">
                아래 에러 코드를 전달해주세요
              </p>
              <code className="bg-destructive/10 text-destructive mt-3 inline-block rounded px-4 py-2 text-base font-bold">
                {errorCode}
              </code>
            </>
          )}
          <div className="mt-6">
            <button
              onClick={this.handleReset}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-md px-4 py-2 text-sm font-medium"
            >
              다시 시도
            </button>
          </div>
        </div>
      </div>
    );
  }
}
