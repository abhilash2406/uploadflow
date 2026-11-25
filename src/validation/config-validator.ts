
import type { UploadConfig } from "../types/upload.js";
import { UploadError } from "../errors/upload-error.js";
import { UploadErrorCode } from "../errors/error-codes.js";

export function validateUploadConfig(config: UploadConfig): void {
    if (!config || typeof config !== "object") {
        throw new UploadError({
            code: UploadErrorCode.VALIDATION_ERROR,
            message: "Upload configuration must be an object",
        });
    }

    if (
        !Number.isSafeInteger(config.maxFileSize) ||
        config.maxFileSize <= 0
    ) {
        throw new UploadError({
            code: UploadErrorCode.VALIDATION_ERROR,
            message: "maxFileSize must be a positive safe integer",
        });
    }

    if (
        !Array.isArray(config.allowedMimeTypes) ||
        config.allowedMimeTypes.length === 0 ||
        config.allowedMimeTypes.some(
            (mimeType) =>
                typeof mimeType !== "string" ||
                mimeType.trim().length === 0,
        )
    ) {
        throw new UploadError({
            code: UploadErrorCode.VALIDATION_ERROR,
            message: "allowedMimeTypes must be a non-empty array of valid MIME type strings",
        });
    }

    if (
        !config.storage ||
        typeof config.storage.upload !== "function" ||
        typeof config.storage.delete !== "function"
    ) {
        throw new UploadError({
            code: UploadErrorCode.VALIDATION_ERROR,
            message: "storage must implement upload() and delete() methods",
        });
    }
}
