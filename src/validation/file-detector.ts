import { fileTypeFromBuffer } from "file-type";
import type { DetectedFile } from "../types/validation.js";

export async function detectFileType(
    buffer: Buffer,
): Promise<DetectedFile | undefined> {
    const result = await fileTypeFromBuffer(buffer);

    if (!result) {
        return undefined;
    }

    return {
        mimeType: result.mime,
        extension: result.ext,
    };
}