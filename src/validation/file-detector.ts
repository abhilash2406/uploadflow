

import { fileTypeFromBuffer } from "file-type";

export interface DetectedFile {
    mimeType: string;
    extension: string;
}

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
