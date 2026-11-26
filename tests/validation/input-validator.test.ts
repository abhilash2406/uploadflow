
import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";

import { validateUploadInput } from "../../src/validation/input-validator.js";
import { UploadErrorCode } from "../../src/errors/error-codes.js";

import type { UploadInput } from "../../src/types/upload.js";

describe("Upload Input Validator", () => {
    const createValidInput = (): UploadInput => ({
        stream: Readable.from(["test file content"]),
        filename: "document.pdf",
    });

    it("should accept valid upload input", () => {
        expect(() => validateUploadInput(createValidInput()))
            .not.toThrow();
    });

    it("should accept a valid AbortSignal", () => {
        const controller = new AbortController();

        const input: UploadInput = {
            ...createValidInput(),
            signal: controller.signal,
        };

        expect(() => validateUploadInput(input)).not.toThrow();
    });

    it.each([
        null,
        undefined,
        "invalid",
        123,
        [],
    ])("should reject invalid input values: %s", (input) => {
        expect(() => validateUploadInput(input as unknown as UploadInput))
            .toThrow(
                expect.objectContaining({
                    code: UploadErrorCode.VALIDATION_ERROR,
                }),
            );
    });

    it.each([
        "",
        " ",
        "   ",
        "\t",
        "\n",
        "\0document.pdf",
        "document\n.pdf",
        "document\r.pdf",
    ])("should reject invalid filenames: %s", (filename) => {
        const input = {
            ...createValidInput(),
            filename,
        };

        expect(() => validateUploadInput(input))
            .toThrow(
                expect.objectContaining({
                    code: UploadErrorCode.VALIDATION_ERROR,
                }),
            );
    });

    it.each([
        null,
        undefined,
        123,
        {},
        "not-a-stream",
        {
            destroy: () => {},
        },
    ])("should reject invalid streams: %s", (stream) => {
        const input = {
            ...createValidInput(),
            stream,
        };

        expect(() => validateUploadInput(input as unknown as UploadInput))
            .toThrow(
                expect.objectContaining({
                    code: UploadErrorCode.VALIDATION_ERROR,
                }),
            );
    });

    it.each([
        null,
        {},
        { aborted: false },
        { aborted: false, addEventListener: () => {} },
        {
            aborted: "false",
            addEventListener: () => {},
            removeEventListener: () => {},
        },
    ])("should reject invalid AbortSignals: %s", (signal) => {
        const input = {
            ...createValidInput(),
            signal,
        };

        expect(() => validateUploadInput(input as unknown as UploadInput))
            .toThrow(
                expect.objectContaining({
                    code: UploadErrorCode.VALIDATION_ERROR,
                }),
            );
    });
});
