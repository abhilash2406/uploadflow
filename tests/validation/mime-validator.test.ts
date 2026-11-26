
import { describe, expect, it } from "vitest";

import { validateMimeType } from "../../src/validation/mime-validator.js";
import { UploadErrorCode } from "../../src/errors/error-codes.js";

describe("MIME Type Validator", () => {
    const allowedTypes = [
        "image/jpeg",
        "image/png",
        "application/pdf",
    ];

    it("should accept an allowed MIME type", () => {
        expect(() =>
            validateMimeType("image/jpeg", allowedTypes),
        ).not.toThrow();
    });

    it("should accept each supported MIME type", () => {
        for (const mimeType of allowedTypes) {
            expect(() =>
                validateMimeType(mimeType, allowedTypes),
            ).not.toThrow();
        }
    });

    it("should reject a disallowed MIME type", () => {
        expect(() =>
            validateMimeType("application/x-executable", allowedTypes),
        ).toThrow(
            expect.objectContaining({
                code: UploadErrorCode.UNSUPPORTED_FILE_TYPE,
            }),
        );
    });

    it("should reject MIME types when the allowed list is empty", () => {
        expect(() =>
            validateMimeType("image/jpeg", []),
        ).toThrow(
            expect.objectContaining({
                code: UploadErrorCode.UNSUPPORTED_FILE_TYPE,
            }),
        );
    });

    it("should treat MIME types as case-sensitive", () => {
        expect(() =>
            validateMimeType("IMAGE/JPEG", allowedTypes),
        ).toThrow(
            expect.objectContaining({
                code: UploadErrorCode.UNSUPPORTED_FILE_TYPE,
            }),
        );
    });

    it.each([
        "",
        " ",
        "   ",
        "\t",
        "\n",
        "image/jpeg\n",
        "image/jpeg\r",
        "image/\0jpeg",
    ])("should reject invalid MIME type values: %s", (mimeType) => {
        expect(() =>
            validateMimeType(mimeType, allowedTypes),
        ).toThrow(
            expect.objectContaining({
                code: UploadErrorCode.UNSUPPORTED_FILE_TYPE,
            }),
        );
    });

    it.each([
        null,
        undefined,
        123,
        {},
        [],
    ])("should reject non-string MIME type values: %s", (mimeType) => {
        expect(() =>
            validateMimeType(mimeType as string, allowedTypes),
        ).toThrow(
            expect.objectContaining({
                code: UploadErrorCode.UNSUPPORTED_FILE_TYPE,
            }),
        );
    });
});
