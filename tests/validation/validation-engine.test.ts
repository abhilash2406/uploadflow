
import { describe, expect, it } from "vitest";

import { validateFile } from "../../src/validation/validation-engine.js";
import { UploadErrorCode } from "../../src/errors/error-codes.js";

describe("Validation Engine", () => {
    const options = {
        allowedMimeTypes: [
            "image/jpeg",
            "image/png",
            "application/pdf",
        ],
    };

    it("should accept a valid JPEG file", async () => {
        const jpeg = Buffer.from([
            0xff, 0xd8, 0xff, 0xe0,
            0x00, 0x10, 0x4a, 0x46,
            0x49, 0x46, 0x00, 0x01,
        ]);

        const result = await validateFile(jpeg, options);

        expect(result).toEqual({
            mimeType: "image/jpeg",
            extension: "jpg",
        });
    });

    it("should reject unsupported file types", async () => {
        const jpeg = Buffer.from([
            0xff, 0xd8, 0xff, 0xe0,
            0x00, 0x10, 0x4a, 0x46,
            0x49, 0x46, 0x00, 0x01,
        ]);

        await expect(
            validateFile(jpeg, {
                allowedMimeTypes: ["application/pdf"],
            }),
        ).rejects.toMatchObject({
            code: UploadErrorCode.UNSUPPORTED_FILE_TYPE,
        });
    });

    it("should reject unknown file formats", async () => {
        const unknown = Buffer.from("This is an unknown file format");

        await expect(
            validateFile(unknown, options),
        ).rejects.toMatchObject({
            code: UploadErrorCode.INVALID_FILE,
        });
    });
});
