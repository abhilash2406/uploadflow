
import { describe, expect, it } from "vitest";

import {
    UploadEngine,
    LocalStorageAdapter,
    UploadError,
    UploadErrorCode,
} from "../src/index.js";

import type {
    UploadConfig,
    UploadInput,
    UploadResult,
    UploadStatus,
    StorageAdapter,
    StoredFile,
    DetectedFile,
    LocalStorageOptions,
} from "../src/index.js";

describe("Public API", () => {
    it("should export UploadEngine", () => {
        expect(UploadEngine).toBeDefined();
    });

    it("should export LocalStorageAdapter", () => {
        expect(LocalStorageAdapter).toBeDefined();
    });

    it("should export UploadError and UploadErrorCode", () => {
        expect(UploadError).toBeDefined();
        expect(UploadErrorCode.INVALID_FILE).toBe("INVALID_FILE");
    });

    it("should allow creating a LocalStorageAdapter", () => {
        const storage = new LocalStorageAdapter({
            directory: "./test-uploads",
        });

        expect(storage).toBeInstanceOf(LocalStorageAdapter);
    });

    it("should allow creating an UploadEngine", () => {
        const config: UploadConfig = {
            maxFileSize: 5 * 1024 * 1024,
            allowedMimeTypes: ["image/jpeg", "application/pdf"],
            storage: new LocalStorageAdapter({
                directory: "./test-uploads",
            }),
        };

        const engine = new UploadEngine(config);

        expect(engine).toBeInstanceOf(UploadEngine);
    });

    it("should expose public types", () => {
        const status: UploadStatus = "completed";

        const options: LocalStorageOptions = {
            directory: "./uploads",
        };

        const storedFile: StoredFile = {
            key: "test.pdf",
            size: 1024,
        };

        const detectedFile: DetectedFile = {
            mimeType: "application/pdf",
            extension: "pdf",
        };

        const storage: StorageAdapter = new LocalStorageAdapter(options);

        const input: UploadInput = {
            stream: null as never,
            filename: "test.pdf",
        };

        const result: UploadResult = {
            id: "test-id",
            key: "test.pdf",
            originalName: "test.pdf",
            mimeType: "application/pdf",
            size: 1024,
            status,
        };

        expect(storage).toBeDefined();
        expect(input.filename).toBe("test.pdf");
        expect(storedFile.size).toBe(1024);
        expect(detectedFile.extension).toBe("pdf");
        expect(result.status).toBe("completed");
    });
});
