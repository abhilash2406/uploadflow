
import { detectFileType } from "./file-detector.js";
import { validateMimeType } from "./mime-validator.js";

import type { DetectedFile } from "../types/validation.js";
import { UploadError } from "../errors/upload-error.js";
import { UploadErrorCode } from "../errors/error-codes.js";

export interface ValidationOptions {
    allowedMimeTypes: readonly string[];
}

export async function validateFile(
    buffer: Buffer,
    options: ValidationOptions,
): Promise<DetectedFile> {
    const detectedFile = await detectFileType(buffer);

    if (!detectedFile) {
        throw new UploadError({
            code: UploadErrorCode.INVALID_FILE,
            message: "Unable to determine file type",
        });
    }

    validateMimeType(
        detectedFile.mimeType,
        options.allowedMimeTypes,
    );

    return detectedFile;
}
