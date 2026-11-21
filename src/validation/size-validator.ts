import { UploadError } from "../errors/upload-error.js";
import { UploadErrorCode } from "../errors/error-codes.js";

export function validateFileSize(
    size: number,
    maxFileSize: number,
): void {
    if (size > maxFileSize) {
        throw new UploadError({
            code: UploadErrorCode.FILE_TOO_LARGE,
            message: `File size exceeds the maximum allowed size of ${maxFileSize} bytes`,
        });
    }
}
