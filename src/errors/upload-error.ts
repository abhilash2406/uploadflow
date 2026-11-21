
import type { UploadErrorCode } from "./error-codes.js";

export interface UploadErrorOptions {
  code: UploadErrorCode;
  message: string;
  cause?: unknown;
  retryable?: boolean;
}

export class UploadError extends Error {
  readonly code: UploadErrorCode;
  readonly retryable: boolean;

  constructor(options: UploadErrorOptions) {
    super(options.message, { cause: options.cause });

    this.name = "UploadError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;

    Object.setPrototypeOf(this, new.target.prototype);
  }
}
