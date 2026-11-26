
import { UploadError } from "../errors/upload-error.js";
import { UploadErrorCode } from "../errors/error-codes.js";

export function validateFileSize(
    size: number,
    maxFileSize: number,
): void {
    if (
        !Number.isSafeInteger(size) ||
        size < 0
    ) {
        throw new UploadError({
            code: UploadErrorCode.VALIDATION_ERROR,
            message: "File size must be a non-negative safe integer",
        });
    }

    if (
        !Number.isSafeInteger(maxFileSize) ||
        maxFileSize <= 0
    ) {
        throw new UploadError({
            code: UploadErrorCode.VALIDATION_ERROR,
            message: "Maximum file size must be a positive safe integer",
        });
    }

    if (size > maxFileSize) {
        throw new UploadError({
            code: UploadErrorCode.FILE_TOO_LARGE,
            message: `File size exceeds the maximum allowed size of ${maxFileSize} bytes`,
        });
    }
}
