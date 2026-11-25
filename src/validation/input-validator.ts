
import type { UploadInput } from "../types/upload.js";
import { UploadError } from "../errors/upload-error.js";
import { UploadErrorCode } from "../errors/error-codes.js";

export function validateUploadInput(input: UploadInput): void {
    if (!input || typeof input !== "object") {
        throw new UploadError({
            code: UploadErrorCode.VALIDATION_ERROR,
            message: "Upload input must be an object",
        });
    }

    if (
        typeof input.filename !== "string" ||
        input.filename.trim().length === 0 ||
        /[\u0000-\u001f\u007f]/.test(input.filename)
    ) {
        throw new UploadError({
            code: UploadErrorCode.VALIDATION_ERROR,
            message: "A valid filename must be provided",
        });
    }

    const stream = input.stream;

    if (
        !stream ||
        typeof stream[Symbol.asyncIterator] !== "function" ||
        typeof stream.destroy !== "function"
    ) {
        throw new UploadError({
            code: UploadErrorCode.VALIDATION_ERROR,
            message: "stream must be a readable async iterable",
        });
    }

    if (
        input.signal !== undefined &&
        (
            typeof input.signal.aborted !== "boolean" ||
            typeof input.signal.addEventListener !== "function" ||
            typeof input.signal.removeEventListener !== "function"
        )
    ) {
        throw new UploadError({
            code: UploadErrorCode.VALIDATION_ERROR,
            message: "signal must be a valid AbortSignal",
        });
    }
}
