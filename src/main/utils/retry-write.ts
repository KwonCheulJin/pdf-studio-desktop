import fse from "fs-extra";

const RETRYABLE_ERROR_CODES = new Set(["EBUSY", "EACCES", "EPERM"]);

interface WriteFileWithRetryOptions {
  filePath: string;
  data: Uint8Array;
  maxRetries?: number;
  baseDelayMs?: number;
}

export async function writeFileWithRetry({
  filePath,
  data,
  maxRetries = 3,
  baseDelayMs = 200
}: WriteFileWithRetryOptions): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await fse.writeFile(filePath, data);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!RETRYABLE_ERROR_CODES.has(code ?? "")) {
        throw error;
      }
      lastError = error;
      if (attempt < maxRetries) {
        await new Promise((resolve) =>
          setTimeout(resolve, baseDelayMs * Math.pow(2, attempt))
        );
      }
    }
  }

  throw lastError;
}
