
import { describe, expect, it } from "vitest";

import { validateUploadConfig } from "../../src/validation/config-validator.js";
import { UploadErrorCode } from "../../src/errors/error-codes.js";

import type { UploadConfig } from "../../src/types/upload.js";

const validConfig: UploadConfig = {
    maxFileSize: 5 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "application/pdf"],
    storage: {
        upload: async ({ key }) => ({
            key,
            size: 100,
        }),
        delete: async () => {},
    },
};

describe("Upload Config Validator", () => {
    it("should accept valid configuration", () => {
        expect(() => validateUploadConfig(validConfig)).not.toThrow();
    });

    it("should reject a non-positive maxFileSize", () => {
        expect(() =>
            validateUploadConfig({
                ...validConfig,
                maxFileSize: 0,
            }),
        ).toThrow(
            expect.objectContaining({
                code: UploadErrorCode.VALIDATION_ERROR,
            }),
        );
    });

    it("should reject an unsafe maxFileSize", () => {
        expect(() =>
            validateUploadConfig({
                ...validConfig,
                maxFileSize: Number.MAX_SAFE_INTEGER + 1,
            }),
        ).toThrow(
            expect.objectContaining({
                code: UploadErrorCode.VALIDATION_ERROR,
            }),
        );
    });

    it("should reject an empty MIME allowlist", () => {
        expect(() =>
            validateUploadConfig({
                ...validConfig,
                allowedMimeTypes: [],
            }),
        ).toThrow(
            expect.objectContaining({
                code: UploadErrorCode.VALIDATION_ERROR,
            }),
        );
    });

    it("should reject invalid MIME entries", () => {
        expect(() =>
            validateUploadConfig({
                ...validConfig,
                allowedMimeTypes: ["image/jpeg", "  "],
            }),
        ).toThrow(
            expect.objectContaining({
                code: UploadErrorCode.VALIDATION_ERROR,
            }),
        );
    });

    it("should reject an invalid storage adapter", () => {
        expect(() =>
            validateUploadConfig({
                ...validConfig,
                storage: {} as UploadConfig["storage"],
            }),
        ).toThrow(
            expect.objectContaining({
                code: UploadErrorCode.VALIDATION_ERROR,
            }),
        );
    });
});
