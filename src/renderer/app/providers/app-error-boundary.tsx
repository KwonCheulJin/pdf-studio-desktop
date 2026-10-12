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
        <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center dark:border-red-900 dark:bg-red-950">
          <p className="text-lg font-medium text-red-700 dark:text-red-400">
            앗, 문제가 생겼어요
          </p>
          {errorCode && (
            <>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                아래 에러 코드를 전달해주세요
              </p>
              <code className="mt-3 inline-block rounded bg-red-100 px-4 py-2 text-base font-bold text-red-600 dark:bg-red-900 dark:text-red-300">
                {errorCode}
              </code>
            </>
          )}
          <div className="mt-6">
            <button
              onClick={this.handleReset}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600"
            >
              다시 시도
            </button>
          </div>
        </div>
      </div>
    );
  }
}
