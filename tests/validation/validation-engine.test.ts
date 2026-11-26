
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

    const jpeg = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0,
        0x00, 0x10, 0x4a, 0x46,
        0x49, 0x46, 0x00, 0x01,
    ]);

    const png = Buffer.from([
        0x89, 0x50, 0x4e, 0x47,
        0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52,
    ]);

    const pdf = Buffer.from("%PDF-1.7\n");

    it("should accept a valid JPEG file", async () => {
        const result = await validateFile(jpeg, options);

        expect(result).toEqual({
            mimeType: "image/jpeg",
            extension: "jpg",
        });
    });

    it("should accept a valid PNG file", async () => {
        const result = await validateFile(png, options);

        expect(result).toEqual({
            mimeType: "image/png",
            extension: "png",
        });
    });

    it("should accept a valid PDF file", async () => {
        const result = await validateFile(pdf, options);

        expect(result).toEqual({
            mimeType: "application/pdf",
            extension: "pdf",
        });
    });

    it("should reject unsupported file types", async () => {
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

    it("should reject empty buffers", async () => {
        await expect(
            validateFile(Buffer.alloc(0), options),
        ).rejects.toMatchObject({
            code: UploadErrorCode.INVALID_FILE,
        });
    });

    it("should reject very short invalid signatures", async () => {
        await expect(
            validateFile(Buffer.from([0xff, 0xd8]), options),
        ).rejects.toMatchObject({
            code: UploadErrorCode.INVALID_FILE,
        });
    });

    it("should reject files when the MIME allowlist is empty", async () => {
        await expect(
            validateFile(jpeg, {
                allowedMimeTypes: [],
            }),
        ).rejects.toMatchObject({
            code: UploadErrorCode.UNSUPPORTED_FILE_TYPE,
        });
    });
});
