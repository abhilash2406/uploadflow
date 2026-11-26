
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { UploadEngine } from "../../src/core/upload-engine.js";
import { LocalStorageAdapter } from "../../src/storage/local-storage.js";
import { UploadErrorCode } from "../../src/errors/error-codes.js";
import type { StorageAdapter } from "../../src/types/storage.js";

describe("UploadEngine", () => {
    let directory: string;
    let engine: UploadEngine;

    const jpeg = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0,
        0x00, 0x10, 0x4a, 0x46,
        0x49, 0x46, 0x00, 0x01,
    ]);

    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), "uploadflow-"));

        const storage = new LocalStorageAdapter({ directory });

        engine = new UploadEngine({
            maxFileSize: 1024 * 1024,
            allowedMimeTypes: [
                "image/jpeg",
                "image/png",
                "application/pdf",
            ],
            storage,
        });
    });

    afterEach(async () => {
        await rm(directory, { recursive: true, force: true });
    });

    it("should reject invalid configuration during construction", () => {
        expect(
            () =>
                new UploadEngine({
                    maxFileSize: 0,
                    allowedMimeTypes: ["image/jpeg"],
                    storage: new LocalStorageAdapter({ directory }),
                }),
        ).toThrow(
            expect.objectContaining({
                code: UploadErrorCode.VALIDATION_ERROR,
            }),
        );
    });

    it("should reject an empty MIME allowlist during construction", () => {
        expect(
            () =>
                new UploadEngine({
                    maxFileSize: 1024 * 1024,
                    allowedMimeTypes: [],
                    storage: new LocalStorageAdapter({ directory }),
                }),
        ).toThrow(
            expect.objectContaining({
                code: UploadErrorCode.VALIDATION_ERROR,
            }),
        );
    });

    it("should upload a valid JPEG successfully", async () => {
        const result = await engine.upload({
            filename: "photo.jpg",
            contentType: "image/jpeg",
            stream: Readable.from([jpeg]),
        });

        expect(result.status).toBe("completed");
        expect(result.originalName).toBe("photo.jpg");
        expect(result.mimeType).toBe("image/jpeg");
        expect(result.size).toBe(jpeg.length);

        const savedFile = await readFile(join(directory, result.key));

        expect(savedFile).toEqual(jpeg);
    });

    it("should upload a valid PDF successfully", async () => {
        const pdf = Buffer.from(
            "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF",
        );

        const result = await engine.upload({
            filename: "document.pdf",
            contentType: "application/pdf",
            stream: Readable.from([pdf]),
        });

        expect(result.status).toBe("completed");
        expect(result.mimeType).toBe("application/pdf");
        expect(result.size).toBe(pdf.length);
    });

    it("should reject unsupported MIME types", async () => {
        const pdfOnlyEngine = new UploadEngine({
            maxFileSize: 1024 * 1024,
            allowedMimeTypes: ["application/pdf"],
            storage: new LocalStorageAdapter({ directory }),
        });

        await expect(
            pdfOnlyEngine.upload({
                filename: "photo.jpg",
                stream: Readable.from([jpeg]),
            }),
        ).rejects.toMatchObject({
            code: UploadErrorCode.UNSUPPORTED_FILE_TYPE,
        });
    });

    it("should reject unknown file formats", async () => {
        const unknown = Buffer.from("This is not a recognized file format");

        await expect(
            engine.upload({
                filename: "unknown.bin",
                stream: Readable.from([unknown]),
            }),
        ).rejects.toMatchObject({
            code: UploadErrorCode.INVALID_FILE,
        });
    });

    it("should reject files exceeding the maximum size", async () => {
        const smallLimitEngine = new UploadEngine({
            maxFileSize: 100,
            allowedMimeTypes: ["image/jpeg"],
            storage: new LocalStorageAdapter({ directory }),
        });

        const oversizedStream = Readable.from([
            Buffer.concat([jpeg, Buffer.alloc(5000)]),
        ]);

        await expect(
            smallLimitEngine.upload({
                filename: "large.jpg",
                stream: oversizedStream,
            }),
        ).rejects.toMatchObject({
            code: UploadErrorCode.FILE_TOO_LARGE,
        });

        expect(await readdir(directory)).toHaveLength(0);
    });

    it("should use detected MIME type instead of client MIME type", async () => {
        const result = await engine.upload({
            filename: "photo.jpg",
            contentType: "application/pdf",
            stream: Readable.from([jpeg]),
        });

        expect(result.mimeType).toBe("image/jpeg");
    });

    it("should clean up partially uploaded files when the stream fails", async () => {
        const initialChunk = Buffer.concat([
            jpeg,
            Buffer.alloc(4100 - jpeg.length),
        ]);

        const failingStream = Readable.from(
            (async function* () {
                yield initialChunk;
                throw new Error("Simulated stream failure");
            })(),
        );

        await expect(
            engine.upload({
                filename: "failed.jpg",
                stream: failingStream,
            }),
        ).rejects.toMatchObject({
            code: UploadErrorCode.STREAM_ERROR,
        });

        expect(await readdir(directory)).toHaveLength(0);
    });

    it("should reject an already aborted upload", async () => {
        const controller = new AbortController();
        controller.abort();

        const stream = Readable.from([jpeg]);

        await expect(
            engine.upload({
                stream,
                filename: "test.jpg",
                signal: controller.signal,
            }),
        ).rejects.toMatchObject({
            code: UploadErrorCode.UPLOAD_ABORTED,
        });
    });

    it("should abort an upload while streaming", async () => {
        const controller = new AbortController();

        async function* slowStream() {
            yield Buffer.concat([
                jpeg,
                Buffer.alloc(4100 - jpeg.length),
            ]);

            controller.abort();

            yield Buffer.alloc(1024);
        }

        await expect(
            engine.upload({
                filename: "cancelled.jpg",
                stream: Readable.from(slowStream()),
                signal: controller.signal,
            }),
        ).rejects.toMatchObject({
            code: UploadErrorCode.UPLOAD_ABORTED,
        });

        expect(await readdir(directory)).toHaveLength(0);
    });

    it("should delete the stored file when aborted immediately after storage succeeds", async () => {
        const controller = new AbortController();

        const localStorage = new LocalStorageAdapter({ directory });

        const abortingStorage: StorageAdapter = {
            upload: async (options) => {
                const result = await localStorage.upload(options);

                controller.abort();

                return result;
            },

            delete: (key) => localStorage.delete(key),
        };

        const raceEngine = new UploadEngine({
            maxFileSize: 1024 * 1024,
            allowedMimeTypes: ["image/jpeg"],
            storage: abortingStorage,
        });

        await expect(
            raceEngine.upload({
                filename: "race-condition.jpg",
                stream: Readable.from([jpeg]),
                signal: controller.signal,
            }),
        ).rejects.toMatchObject({
            code: UploadErrorCode.UPLOAD_ABORTED,
        });

        expect(await readdir(directory)).toHaveLength(0);
    });

    it("should clean up partial files when size limit is exceeded during streaming", async () => {
        const smallLimitEngine = new UploadEngine({
            maxFileSize: 5000,
            allowedMimeTypes: ["image/jpeg"],
            storage: new LocalStorageAdapter({ directory }),
        });

        const stream = Readable.from([
            Buffer.concat([
                jpeg,
                Buffer.alloc(4100 - jpeg.length),
            ]),
            Buffer.alloc(2000),
        ]);

        await expect(
            smallLimitEngine.upload({
                filename: "oversized.jpg",
                stream,
            }),
        ).rejects.toMatchObject({
            code: UploadErrorCode.FILE_TOO_LARGE,
        });

        expect(await readdir(directory)).toHaveLength(0);
    });


    it("should reject missing upload input", async () => {
        await expect(
            engine.upload(undefined as never),
        ).rejects.toMatchObject({
            code: UploadErrorCode.VALIDATION_ERROR,
        });
    });

    it("should reject an empty filename", async () => {
        await expect(
            engine.upload({
                filename: "   ",
                stream: Readable.from([jpeg]),
            }),
        ).rejects.toMatchObject({
            code: UploadErrorCode.VALIDATION_ERROR,
        });
    });

    it("should reject filenames containing control characters", async () => {
        await expect(
            engine.upload({
                filename: "photo\u0000.jpg",
                stream: Readable.from([jpeg]),
            }),
        ).rejects.toMatchObject({
            code: UploadErrorCode.VALIDATION_ERROR,
        });
    });

    it("should reject an invalid abort signal", async () => {
        await expect(
            engine.upload({
                filename: "photo.jpg",
                stream: Readable.from([jpeg]),
                signal: {} as AbortSignal,
            }),
        ).rejects.toMatchObject({
            code: UploadErrorCode.VALIDATION_ERROR,
        });
    });

    it("should reject an invalid stream", async () => {
        await expect(
            engine.upload({
                filename: "photo.jpg",
                stream: {} as Readable,
            }),
        ).rejects.toMatchObject({
            code: UploadErrorCode.VALIDATION_ERROR,
        });
    });



    it("should clean up the source iterator only once when upload fails", async () => {
        let returnCalls = 0;
        let nextCalls = 0;

        const source = {
            destroyed: false,

            destroy() {
                this.destroyed = true;
                return this;
            },

            [Symbol.asyncIterator]() {
                return {
                    async next() {
                        nextCalls++;

                        if (nextCalls === 1) {
                            return {
                                done: false as const,
                                value: Buffer.concat([
                                    jpeg,
                                    Buffer.alloc(4100 - jpeg.length),
                                ]),
                            };
                        }

                        return {
                            done: false as const,
                            value: Buffer.alloc(1024),
                        };
                    },

                    async return() {
                        returnCalls++;

                        return {
                            done: true as const,
                            value: undefined,
                        };
                    },
                };
            },
        };

        const failingStorage: StorageAdapter = {
            upload: async (options) => {
                // Start consuming the validated stream.
                for await (const chunk of options.stream) {
                    void chunk;
                    break;
                }

                // Simulate a storage failure after consumption starts.
                throw new Error("Simulated storage failure");
            },
            delete: async () => { },
        };

        const failingEngine = new UploadEngine({
            maxFileSize: 1024 * 1024,
            allowedMimeTypes: ["image/jpeg"],
            storage: failingStorage,
        });

        await expect(
            failingEngine.upload({
                filename: "iterator-test.jpg",
                stream: source as unknown as Readable,
            }),
        ).rejects.toMatchObject({
            code: UploadErrorCode.STREAM_ERROR,
        });

        expect(returnCalls).toBe(1);
    });



});
