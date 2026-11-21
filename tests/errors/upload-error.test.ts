
import { describe, expect, it } from "vitest";

import { UploadError } from "../../src/errors/upload-error.js";
import { UploadErrorCode } from "../../src/errors/error-codes.js";

describe("UploadError", () => {
  it("should create an error with the correct code", () => {
    const error = new UploadError({
      code: UploadErrorCode.FILE_TOO_LARGE,
      message: "File exceeds maximum size",
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(UploadError);
    expect(error.name).toBe("UploadError");
    expect(error.code).toBe("FILE_TOO_LARGE");
  });

  it("should default retryable to false", () => {
    const error = new UploadError({
      code: UploadErrorCode.INVALID_FILE,
      message: "Invalid file",
    });

    expect(error.retryable).toBe(false);
  });

  it("should support retryable errors", () => {
    const error = new UploadError({
      code: UploadErrorCode.STORAGE_ERROR,
      message: "Storage unavailable",
      retryable: true,
    });

    expect(error.retryable).toBe(true);
  });

  it("should preserve the original error as cause", () => {
    const originalError = new Error("Network timeout");

    const error = new UploadError({
      code: UploadErrorCode.STORAGE_ERROR,
      message: "Upload failed",
      cause: originalError,
    });

    expect(error.cause).toBe(originalError);
  });
});
