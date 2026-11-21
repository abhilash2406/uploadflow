
import { describe, expect, it, afterEach } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { LocalStorageAdapter } from "../../src/storage/local-storage.js";
import { UploadError } from "../../src/errors/index.js";
import { UploadErrorCode } from "../../src/errors/error-codes.js";

describe("LocalStorageAdapter", () => {
    let directory: string;

    afterEach(async () => {
        if (directory) {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it("should upload a file successfully", async () => {
        directory = await mkdtemp(join(tmpdir(), "uploadflow-"));

        const storage = new LocalStorageAdapter({ directory });

        const result = await storage.upload({
            key: "test.txt",
            stream: Readable.from(["Hello UploadFlow"]),
            contentType: "text/plain",
        });

        expect(result.key).toBe("test.txt");
        expect(result.size).toBe(16);

        const content = await readFile(join(directory, "test.txt"), "utf8");

        expect(content).toBe("Hello UploadFlow");
    });

    it("should create nested directories", async () => {
        directory = await mkdtemp(join(tmpdir(), "uploadflow-"));

        const storage = new LocalStorageAdapter({ directory });

        await storage.upload({
            key: "2026/11/test.txt",
            stream: Readable.from(["Nested file"]),
            contentType: "text/plain",
        });

        const fileStat = await stat(
            join(directory, "2026", "11", "test.txt"),
        );

        expect(fileStat.isFile()).toBe(true);
    });

    it("should delete an uploaded file", async () => {
        directory = await mkdtemp(join(tmpdir(), "uploadflow-"));

        const storage = new LocalStorageAdapter({ directory });

        await storage.upload({
            key: "delete-me.txt",
            stream: Readable.from(["Temporary"]),
            contentType: "text/plain",
        });

        await storage.delete("delete-me.txt");

        await expect(
            stat(join(directory, "delete-me.txt")),
        ).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("should reject path traversal attempts", async () => {
        directory = await mkdtemp(join(tmpdir(), "uploadflow-"));

        const storage = new LocalStorageAdapter({ directory });

        await expect(
            storage.upload({
                key: "../../outside.txt",
                stream: Readable.from(["Malicious"]),
                contentType: "text/plain",
            }),
        ).rejects.toBeInstanceOf(UploadError);
    });

    it("should not overwrite an existing file", async () => {
        directory = await mkdtemp(join(tmpdir(), "uploadflow-"));

        const storage = new LocalStorageAdapter({ directory });

        await storage.upload({
            key: "existing.txt",
            stream: Readable.from(["Original"]),
            contentType: "text/plain",
        });

        await expect(
            storage.upload({
                key: "existing.txt",
                stream: Readable.from(["Replacement"]),
                contentType: "text/plain",
            }),
        ).rejects.toBeInstanceOf(UploadError);

        const content = await readFile(
            join(directory, "existing.txt"),
            "utf8",
        );

        expect(content).toBe("Original");
    });


    it("removes a partially written file when the source stream fails", async () => {
        directory = await mkdtemp(join(tmpdir(), "uploadflow-"));
        const storage = new LocalStorageAdapter({ directory });

        const key = "failed-upload.txt";

        const failingStream = new Readable({
            read() {
                this.push("partial data");
                this.destroy(new Error("Stream failed"));
            },
        });

        await expect(
            storage.upload({
                key,
                stream: failingStream,
                contentType: "text/plain",
            }),
        ).rejects.toMatchObject({
            code: UploadErrorCode.STORAGE_ERROR,
        });

        await expect(readFile(join(directory, key))).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    it("cleans up and reports an aborted upload", async () => {
        directory = await mkdtemp(join(tmpdir(), "uploadflow-"));
        const storage = new LocalStorageAdapter({ directory });

        const key = "aborted-upload.txt";
        const controller = new AbortController();

        const slowStream = new Readable({
            read() {
                this.push("partial data");
            },
        });

        const uploadPromise = storage.upload({
            key,
            stream: slowStream,
            contentType: "text/plain",
            signal: controller.signal,
        });

        controller.abort();

        await expect(uploadPromise).rejects.toMatchObject({
            code: UploadErrorCode.UPLOAD_ABORTED,
        });

        await expect(readFile(join(directory, key))).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

});


