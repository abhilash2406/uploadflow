
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from "vitest";

import {
    mkdtemp,
    readFile,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";

import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { LocalStorageAdapter } from "../../src/storage/local-storage.js";
import { UploadError } from "../../src/errors/index.js";
import { UploadErrorCode } from "../../src/errors/error-codes.js";

describe("LocalStorageAdapter", () => {
    let directory: string;
    let storage: LocalStorageAdapter;

    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), "uploadflow-"));

        storage = new LocalStorageAdapter({ directory });
    });

    afterEach(async () => {
        if (directory) {
            await rm(directory, {
                recursive: true,
                force: true,
            });
        }
    });

    it("should upload a file successfully", async () => {
        const result = await storage.upload({
            key: "test.txt",
            stream: Readable.from(["Hello UploadFlow"]),
            contentType: "text/plain",
        });

        expect(result.key).toBe("test.txt");
        expect(result.size).toBe(16);

        const content = await readFile(
            join(directory, "test.txt"),
            "utf8",
        );

        expect(content).toBe("Hello UploadFlow");
    });

    it("should create nested directories", async () => {
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
        await storage.upload({
            key: "delete-me.txt",
            stream: Readable.from(["Temporary"]),
            contentType: "text/plain",
        });

        await storage.delete("delete-me.txt");

        await expect(
            stat(join(directory, "delete-me.txt")),
        ).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    it("should reject path traversal attempts", async () => {
        await expect(
            storage.upload({
                key: "../../outside.txt",
                stream: Readable.from(["Malicious"]),
                contentType: "text/plain",
            }),
        ).rejects.toBeInstanceOf(UploadError);
    });

    it("should not overwrite an existing file", async () => {
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

    it("should remove a partially written file when the source stream fails", async () => {
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
            code: UploadErrorCode.STREAM_ERROR,
        });

        await expect(
            readFile(join(directory, key)),
        ).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    it("should remove a partially written file when the stream fails after writing data", async () => {
        const key = "partial-failure.txt";

        const failingStream = new Readable({
            read() {
                this.push(Buffer.alloc(1024 * 1024, "a"));
                this.destroy(new Error("Simulated failure after data"));
            },
        });

        await expect(
            storage.upload({
                key,
                stream: failingStream,
                contentType: "text/plain",
            }),
        ).rejects.toMatchObject({
            code: UploadErrorCode.STREAM_ERROR,
        });

        await expect(
            stat(join(directory, key)),
        ).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    it("should clean up and report an aborted upload", async () => {
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

        await expect(
            readFile(join(directory, key)),
        ).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    it("should classify filesystem errors as STORAGE_ERROR", async () => {
        const key = "existing.jpg";

        await writeFile(
            join(directory, key),
            "existing content",
        );

        await expect(
            storage.upload({
                key,
                stream: Readable.from([
                    Buffer.from("new content"),
                ]),
                contentType: "image/jpeg",
            }),
        ).rejects.toMatchObject({
            code: UploadErrorCode.STORAGE_ERROR,
        });

        const content = await readFile(
            join(directory, key),
            "utf8",
        );

        expect(content).toBe("existing content");
    });
});
