
import { describe, expect, it } from "vitest";

import { validateFileSize } from "../../src/validation/size-validator.js";
import { UploadErrorCode } from "../../src/errors/error-codes.js";

describe("File Size Validator", () => {
    const maxSize = 5 * 1024 * 1024;

    it("should accept zero-byte files", () => {
        expect(() => validateFileSize(0, maxSize)).not.toThrow();
    });

    it("should accept files within the size limit", () => {
        expect(() => validateFileSize(2 * 1024 * 1024, maxSize))
            .not.toThrow();
    });

    it("should accept files one byte below the size limit", () => {
        expect(() => validateFileSize(maxSize - 1, maxSize))
            .not.toThrow();
    });

    it("should accept files exactly at the size limit", () => {
        expect(() => validateFileSize(maxSize, maxSize))
            .not.toThrow();
    });

    it("should reject files exceeding the size limit", () => {
        expect(() => validateFileSize(maxSize + 1, maxSize))
            .toThrow(
                expect.objectContaining({
                    code: UploadErrorCode.FILE_TOO_LARGE,
                }),
            );
    });

    it("should reject negative file sizes", () => {
        expect(() => validateFileSize(-1, maxSize))
            .toThrow(
                expect.objectContaining({
                    code: UploadErrorCode.VALIDATION_ERROR,
                }),
            );
    });

    it.each([
        1.5,
        Number.MAX_SAFE_INTEGER + 1,
        Infinity,
        -Infinity,
        NaN,
    ])("should reject invalid file size: %s", (size) => {
        expect(() => validateFileSize(size, maxSize))
            .toThrow(
                expect.objectContaining({
                    code: UploadErrorCode.VALIDATION_ERROR,
                }),
            );
    });

    it.each([
        0,
        -1,
        1.5,
        Number.MAX_SAFE_INTEGER + 1,
        Infinity,
        NaN,
    ])("should reject invalid maximum file size: %s", (limit) => {
        expect(() => validateFileSize(100, limit))
            .toThrow(
                expect.objectContaining({
                    code: UploadErrorCode.VALIDATION_ERROR,
                }),
            );
    });
});
