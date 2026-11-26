
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import { createWriteStream } from "node:fs";
import {
    mkdtemp,
    readFile,
    rm,
    stat,
    writeFile,
    symlink,
} from "node:fs/promises";

import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";

import { LocalStorageAdapter } from "../../src/storage/local-storage.js";
import { UploadError } from "../../src/errors/index.js";
import { UploadErrorCode } from "../../src/errors/error-codes.js";

class FailingWriteStorageAdapter extends LocalStorageAdapter {
    protected override createOutputStream(filePath: string) {
        const output = createWriteStream(filePath, { flags: "wx" });

        output.once("open", () => {
            setImmediate(() => {
                output.destroy(
                    new Error("Simulated destination write failure"),
                );
            });
        });

        return output;
    }
}

class FailingCleanupStorageAdapter extends LocalStorageAdapter {
    protected override async removeFile(
        _filePath: string,
    ): Promise<void> {
        throw new Error("Simulated cleanup failure");
    }
}

describe("LocalStorageAdapter", () => {
    let directory: string;
    let outsideDirectory: string | undefined;
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

        if (outsideDirectory) {
            await rm(outsideDirectory, {
                recursive: true,
                force: true,
            });

            outsideDirectory = undefined;
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

    it("should reject uploads through a directory symlink", async () => {
        outsideDirectory = await mkdtemp(
            join(tmpdir(), "uploadflow-outside-"),
        );

        const symlinkPath = join(directory, "linked");

        await symlink(
            outsideDirectory,
            symlinkPath,
            process.platform === "win32" ? "junction" : "dir",
        );

        await expect(
            storage.upload({
                key: "linked/escaped.txt",
                stream: Readable.from(["Malicious content"]),
                contentType: "text/plain",
            }),
        ).rejects.toMatchObject({
            code: UploadErrorCode.INVALID_FILE,
        });

        await expect(
            stat(join(outsideDirectory, "escaped.txt")),
        ).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    it("should reject deletion through a directory symlink", async () => {
        outsideDirectory = await mkdtemp(
            join(tmpdir(), "uploadflow-outside-"),
        );

        const outsideFile = join(outsideDirectory, "important.txt");

        await writeFile(outsideFile, "Do not delete");

        const symlinkPath = join(directory, "linked");

        await symlink(
            outsideDirectory,
            symlinkPath,
            process.platform === "win32" ? "junction" : "dir",
        );

        await expect(
            storage.delete("linked/important.txt"),
        ).rejects.toMatchObject({
            code: UploadErrorCode.INVALID_FILE,
        });

        await expect(
            readFile(outsideFile, "utf8"),
        ).resolves.toBe("Do not delete");
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
        const filePath = join(directory, key);

        const source = new PassThrough();

        const uploadPromise = storage.upload({
            key,
            stream: source,
            contentType: "text/plain",
        });

        source.write(Buffer.alloc(1024 * 1024, "a"));

        await vi.waitFor(async () => {
            const fileStat = await stat(filePath);
            expect(fileStat.size).toBeGreaterThan(0);
        });

        source.destroy(new Error("Simulated failure after writing data"));

        await expect(uploadPromise).rejects.toMatchObject({
            code: UploadErrorCode.STREAM_ERROR,
        });

        await expect(stat(filePath)).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    it("should report cleanup failure while preserving the original stream error", async () => {
        const key = "cleanup-failure.txt";
        const filePath = join(directory, key);

        const failingStorage = new FailingCleanupStorageAdapter({
            directory,
        });

        const source = new PassThrough();
        const sourceError = new Error("Simulated source stream failure");

        const uploadPromise = failingStorage.upload({
            key,
            stream: source,
            contentType: "text/plain",
        });

        source.write(Buffer.alloc(1024 * 1024, "a"));

        await vi.waitFor(async () => {
            const fileStat = await stat(filePath);
            expect(fileStat.size).toBeGreaterThan(0);
        });

        source.destroy(sourceError);

        const uploadError: unknown = await uploadPromise.catch(
            (error: unknown) => error,
        );

        expect(uploadError).toBeInstanceOf(UploadError);

        if (!(uploadError instanceof UploadError)) {
            throw uploadError;
        }

        expect(uploadError.code).toBe(UploadErrorCode.STREAM_ERROR);
        expect(uploadError.cause).toBeInstanceOf(AggregateError);

        if (!(uploadError.cause instanceof AggregateError)) {
            throw uploadError.cause;
        }

        const aggregateError = uploadError.cause;

        expect(aggregateError.errors).toHaveLength(2);
        expect(aggregateError.errors[0]).toBe(sourceError);
        expect(aggregateError.errors[1]).toMatchObject({
            message: "Simulated cleanup failure",
        });

        // The simulated cleanup failure means the partial file remains.
        // afterEach removes the temporary test directory.
        await expect(stat(filePath)).resolves.toBeDefined();
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

    // Destination failure after the file has opened.
    it("should clean up the file and destroy the source when destination writing fails", async () => {
        const key = "destination-failure.txt";

        const failingStorage = new FailingWriteStorageAdapter({
            directory,
        });

        const source = new PassThrough();

        const uploadPromise = failingStorage.upload({
            key,
            stream: source,
            contentType: "text/plain",
        });

        source.write(Buffer.alloc(1024 * 1024, "a"));

        await expect(uploadPromise).rejects.toMatchObject({
            code: UploadErrorCode.STORAGE_ERROR,
        });

        expect(source.destroyed).toBe(true);

        await expect(
            stat(join(directory, key)),
        ).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    it.each([
        null,
        undefined,
        123,
        {},
        "",
        ".",
        "folder/../file.txt",
        "folder/../../outside.txt",
        String.raw`folder\..\file.txt`,
        String.raw`folder\..\..\outside.txt`,
    ])("should reject invalid storage keys: %s", async (key) => {
        await expect(
            storage.upload({
                key: key as never,
                stream: Readable.from(["Test"]),
                contentType: "text/plain",
            }),
        ).rejects.toBeInstanceOf(UploadError);
    });

    it("should reject invalid keys when deleting files", async () => {
        await expect(
            storage.delete(null as never),
        ).rejects.toBeInstanceOf(UploadError);
    });
});
