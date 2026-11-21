
import { describe, expect, it } from "vitest";
import { validateFileSize } from "../../src/validation/size-validator.js";
import { UploadError } from "../../src/errors/upload-error.js";
import { UploadErrorCode } from "../../src/errors/error-codes.js";


describe("File Size Validator", () => {
    const maxSize = 5 * 1024 * 1024;

    it("should accept files within the size limit", () => {
        expect(() => validateFileSize(2 * 1024 * 1024, maxSize))
            .not.toThrow();
    });

    it("should accept files exactly at the size limit", () => {
        expect(() => validateFileSize(maxSize, maxSize))
            .not.toThrow();
    });

    it("should reject files exceeding the size limit", () => {
    expect(() => validateFileSize(8 * 1024 * 1024, maxSize))
        .toThrow(
            expect.objectContaining({
                code: UploadErrorCode.FILE_TOO_LARGE,
            }),
        );
});
});

