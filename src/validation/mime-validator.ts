import { UploadError } from "../errors/upload-error.js";
import { UploadErrorCode } from "../errors/error-codes.js";

export function validateMimeType(
    mimeType: string,
    allowedMimeTypes: readonly string[],
): void {
    if (!allowedMimeTypes.includes(mimeType)) {
        throw new UploadError({
            code: UploadErrorCode.UNSUPPORTED_FILE_TYPE,
            message: `File type '${mimeType}' is not allowed`,
        });
    }
}
