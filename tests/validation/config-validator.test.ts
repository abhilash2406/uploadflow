
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
        delete: async () => { },
    },
};

describe("Upload Config Validator", () => {
    it("should accept valid configuration", () => {
        expect(() => validateUploadConfig(validConfig)).not.toThrow();
    });

    it.each([
        null,
        undefined,
        "invalid",
        123,
        [],
    ])("should reject invalid configuration values: %s", (config) => {
        expect(() =>
            validateUploadConfig(config as never),
        ).toThrow(
            expect.objectContaining({
                code: UploadErrorCode.VALIDATION_ERROR,
            }),
        );
    });

    it.each([
        0,
        -1,
        -100,
        1.5,
        Number.MAX_SAFE_INTEGER + 1,
        Infinity,
        -Infinity,
        NaN,
    ])("should reject an invalid maxFileSize: %s", (maxFileSize) => {
        expect(() =>
            validateUploadConfig({
                ...validConfig,
                maxFileSize,
            }),
        ).toThrow(
            expect.objectContaining({
                code: UploadErrorCode.VALIDATION_ERROR,
            }),
        );
    });

    it.each([
        null,
        undefined,
        "image/jpeg",
        {},
    ])("should reject an invalid MIME allowlist: %s", (allowedMimeTypes) => {
        expect(() =>
            validateUploadConfig({
                ...validConfig,
                allowedMimeTypes: allowedMimeTypes as never,
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

    it.each([
        "",
        " ",
        "   ",
        null,
        undefined,
        123,
        {},
    ])("should reject invalid MIME entries: %s", (mimeType) => {
        expect(() =>
            validateUploadConfig({
                ...validConfig,
                allowedMimeTypes: [
                    "image/jpeg",
                    mimeType,
                ] as never,
            }),
        ).toThrow(
            expect.objectContaining({
                code: UploadErrorCode.VALIDATION_ERROR,
            }),
        );
    });

    it("should reject a storage adapter without upload()", () => {
        expect(() =>
            validateUploadConfig({
                ...validConfig,
                storage: {
                    delete: async () => { },
                } as unknown as UploadConfig["storage"],
            }),
        ).toThrow(
            expect.objectContaining({
                code: UploadErrorCode.VALIDATION_ERROR,
            }),
        );
    });

    it("should reject a storage adapter without delete()", () => {
        expect(() =>
            validateUploadConfig({
                ...validConfig,
                storage: {
                    upload: async () => ({
                        key: "test.jpg",
                        size: 100,
                    }),
                } as unknown as UploadConfig["storage"],
            }),
        ).toThrow(
            expect.objectContaining({
                code: UploadErrorCode.VALIDATION_ERROR,
            }),
        );
    });

    it("should reject a storage adapter with non-function methods", () => {
        expect(() =>
            validateUploadConfig({
                ...validConfig,
                storage: {
                    upload: "invalid",
                    delete: null,
                } as never,
            }),
        ).toThrow(
            expect.objectContaining({
                code: UploadErrorCode.VALIDATION_ERROR,
            }),
        );
    });
});
