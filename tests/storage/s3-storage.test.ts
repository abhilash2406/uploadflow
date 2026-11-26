
import { PassThrough, Readable } from "node:stream";

import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import {
    S3Client,
    DeleteObjectCommand,
} from "@aws-sdk/client-s3";

import { UploadErrorCode } from "../../src/errors/index.js";
import { S3StorageAdapter } from "../../src/storage/s3-storage.js";

const mocks = vi.hoisted(() => ({
    upload: vi.fn(),
}));

vi.mock("@aws-sdk/lib-storage", () => ({
    Upload: vi.fn().mockImplementation(function (this: any, options) {
        this.done = () => mocks.upload(options);
    }),
}));

describe("S3StorageAdapter", () => {
    let client: S3Client;
    let send: ReturnType<typeof vi.fn>;
    let adapter: S3StorageAdapter;

    beforeEach(() => {
        vi.clearAllMocks();

        mocks.upload.mockImplementation(async (options: any) => {
            for await (const chunk of options.params.Body) {
                void chunk;
            }

            return {};
        });

        send = vi.fn().mockResolvedValue({});
        client = { send } as unknown as S3Client;

        adapter = new S3StorageAdapter({
            client,
            bucket: "test-bucket",
        });
    });

    describe("upload", () => {
        it("should upload a file and return its key and size", async () => {
            const content = Buffer.from("Hello UploadFlow");

            const result = await adapter.upload({
                key: "documents/test.txt",
                stream: Readable.from([content]),
                contentType: "text/plain",
            });

            expect(result).toEqual({
                key: "documents/test.txt",
                size: content.length,
            });

            expect(mocks.upload).toHaveBeenCalledOnce();
        });

        it("should pass the correct S3 upload configuration", async () => {
            await adapter.upload({
                key: "documents/test.txt",
                stream: Readable.from(["Hello"]),
                contentType: "text/plain",
            });

            const options = mocks.upload.mock.calls[0][0];

            expect(options.params).toMatchObject({
                Bucket: "test-bucket",
                Key: "documents/test.txt",
                ContentType: "text/plain",
            });

            expect(options.queueSize).toBe(4);
            expect(options.partSize).toBe(5 * 1024 * 1024);
            expect(options.leavePartsOnError).toBe(false);
        });
    });

    describe("delete", () => {
        it("should delete an object from S3", async () => {
            await adapter.delete("documents/test.txt");

            expect(send).toHaveBeenCalledOnce();

            const command = send.mock.calls[0][0];

            expect(command).toBeInstanceOf(DeleteObjectCommand);
            expect(command.input).toEqual({
                Bucket: "test-bucket",
                Key: "documents/test.txt",
            });
        });

        it.each([
            null,
            undefined,
            123,
            {},
            "",
            " ",
            "documents/\0test.txt",
            "documents/\ntest.txt",
        ])("should reject invalid object keys when deleting: %s", async (key) => {
            await expect(
                adapter.delete(key as never),
            ).rejects.toMatchObject({
                code: UploadErrorCode.INVALID_FILE,
            });

            expect(send).not.toHaveBeenCalled();
        });
    });

    describe("validation", () => {
        it("should reject missing constructor options", () => {
            expect(() => {
                new S3StorageAdapter(undefined as never);
            }).toThrow("S3 storage options must be an object");
        });

        it("should reject a non-string bucket name", () => {
            expect(() => {
                new S3StorageAdapter({
                    client,
                    bucket: 123 as never,
                });
            }).toThrow("S3 bucket name cannot be empty");
        });

        it("should reject a missing S3 client", () => {
            expect(() => {
                new S3StorageAdapter({
                    client: null as never,
                    bucket: "test-bucket",
                });
            }).toThrow("A valid S3 client must be provided");
        });

        it("should reject an S3 client without send()", () => {
            expect(() => {
                new S3StorageAdapter({
                    client: {} as S3Client,
                    bucket: "test-bucket",
                });
            }).toThrow("A valid S3 client must be provided");
        });

        it("should reject an unsafe queue size", () => {
            expect(() => {
                new S3StorageAdapter({
                    client,
                    bucket: "test-bucket",
                    queueSize: Number.MAX_SAFE_INTEGER + 1,
                });
            }).toThrow("S3 queue size must be a positive integer");
        });

        it("should reject an unsafe part size", () => {
            expect(() => {
                new S3StorageAdapter({
                    client,
                    bucket: "test-bucket",
                    partSize: Number.MAX_SAFE_INTEGER + 1,
                });
            }).toThrow("S3 part size must be between 5 MiB and 5 GiB");
        });

        it("should reject an empty bucket name", () => {
            expect(() => {
                new S3StorageAdapter({
                    client,
                    bucket: "",
                });
            }).toThrow("S3 bucket name cannot be empty");
        });

        it("should reject an invalid queue size", () => {
            expect(() => {
                new S3StorageAdapter({
                    client,
                    bucket: "test-bucket",
                    queueSize: 0,
                });
            }).toThrow("S3 queue size must be a positive integer");
        });

        it("should reject a part size below 5 MiB", () => {
            expect(() => {
                new S3StorageAdapter({
                    client,
                    bucket: "test-bucket",
                    partSize: 1024,
                });
            }).toThrow("S3 part size must be between 5 MiB and 5 GiB");
        });

        // Multipart memory configuration tests

        it("should accept the default multipart memory configuration", () => {
            expect(() => {
                new S3StorageAdapter({
                    client,
                    bucket: "test-bucket",
                });
            }).not.toThrow();
        });

        it("should accept a custom multipart memory limit of 256 MiB", () => {
            expect(() => {
                new S3StorageAdapter({
                    client,
                    bucket: "test-bucket",
                    queueSize: 4,
                    partSize: 64 * 1024 * 1024,
                    maxBufferedBytes: 256 * 1024 * 1024,
                });
            }).not.toThrow();
        });

        it("should reject a zero maxBufferedBytes value", () => {
            expect(() => {
                new S3StorageAdapter({
                    client,
                    bucket: "test-bucket",
                    maxBufferedBytes: 0,
                });
            }).toThrow(
                "S3 maxBufferedBytes must be a positive safe integer",
            );
        });

        it("should reject an unsafe maxBufferedBytes value", () => {
            expect(() => {
                new S3StorageAdapter({
                    client,
                    bucket: "test-bucket",
                    maxBufferedBytes: Number.MAX_SAFE_INTEGER + 1,
                });
            }).toThrow(
                "S3 maxBufferedBytes must be a positive safe integer",
            );
        });

        it("should reject multipart configuration exceeding the memory limit", () => {
            expect(() => {
                new S3StorageAdapter({
                    client,
                    bucket: "test-bucket",
                    queueSize: 5,
                    partSize: 32 * 1024 * 1024,
                    maxBufferedBytes: 128 * 1024 * 1024,
                });
            }).toThrow(
                "S3 multipart configuration exceeds maxBufferedBytes",
            );
        });

        it("should reject multipart configuration exceeding the default memory limit", () => {
            expect(() => {
                new S3StorageAdapter({
                    client,
                    bucket: "test-bucket",
                    queueSize: 4,
                    partSize: 40 * 1024 * 1024,
                });
            }).toThrow(
                "S3 multipart configuration exceeds maxBufferedBytes",
            );
        });

        // Runtime upload input validation tests

        it.each([
            null,
            undefined,
            123,
            "invalid",
        ])("should reject invalid upload options: %s", async (options) => {
            await expect(
                adapter.upload(options as never),
            ).rejects.toMatchObject({
                code: UploadErrorCode.VALIDATION_ERROR,
            });

            expect(mocks.upload).not.toHaveBeenCalled();
        });

        it.each([
            null,
            undefined,
            {},
            { pipe: () => {} },
        ])("should reject an invalid readable stream: %s", async (stream) => {
            await expect(
                adapter.upload({
                    key: "documents/test.txt",
                    stream: stream as never,
                    contentType: "text/plain",
                }),
            ).rejects.toMatchObject({
                code: UploadErrorCode.VALIDATION_ERROR,
            });

            expect(mocks.upload).not.toHaveBeenCalled();
        });

        it.each([
            null,
            undefined,
            123,
            "",
            " ",
            "text/plain\n",
        ])("should reject an invalid content type: %s", async (contentType) => {
            await expect(
                adapter.upload({
                    key: "documents/test.txt",
                    stream: Readable.from(["Hello"]),
                    contentType: contentType as never,
                }),
            ).rejects.toMatchObject({
                code: UploadErrorCode.VALIDATION_ERROR,
            });

            expect(mocks.upload).not.toHaveBeenCalled();
        });

        it.each([
            null,
            {},
            { aborted: false },
        ])("should reject an invalid AbortSignal: %s", async (signal) => {
            await expect(
                adapter.upload({
                    key: "documents/test.txt",
                    stream: Readable.from(["Hello"]),
                    contentType: "text/plain",
                    signal: signal as never,
                }),
            ).rejects.toMatchObject({
                code: UploadErrorCode.VALIDATION_ERROR,
            });

            expect(mocks.upload).not.toHaveBeenCalled();
        });

        it("should reject an empty object key", async () => {
            await expect(
                adapter.upload({
                    key: " ",
                    stream: Readable.from(["Hello"]),
                    contentType: "text/plain",
                }),
            ).rejects.toMatchObject({
                code: UploadErrorCode.INVALID_FILE,
            });
        });

        it.each([
            null,
            undefined,
            123,
            {},
        ])("should reject invalid object key types: %s", async (key) => {
            await expect(
                adapter.upload({
                    key: key as never,
                    stream: Readable.from(["Hello"]),
                    contentType: "text/plain",
                }),
            ).rejects.toMatchObject({
                code: UploadErrorCode.INVALID_FILE,
            });
        });

        it.each([
            "documents/\0test.txt",
            "documents/\ntest.txt",
            "documents/\rtest.txt",
        ])("should reject object keys containing control characters", async (key) => {
            await expect(
                adapter.upload({
                    key,
                    stream: Readable.from(["Hello"]),
                    contentType: "text/plain",
                }),
            ).rejects.toMatchObject({
                code: UploadErrorCode.INVALID_FILE,
            });
        });

        it("should reject an already aborted upload", async () => {
            const controller = new AbortController();
            controller.abort();

            await expect(
                adapter.upload({
                    key: "documents/test.txt",
                    stream: Readable.from(["Hello"]),
                    contentType: "text/plain",
                    signal: controller.signal,
                }),
            ).rejects.toMatchObject({
                code: UploadErrorCode.UPLOAD_ABORTED,
            });
        });
    });

    describe("error handling", () => {
        it("should map S3 upload failures to STORAGE_ERROR and destroy the source stream", async () => {
            const stream = new PassThrough();
            let uploadOptions: any;

            mocks.upload.mockImplementationOnce(async (options: any) => {
                uploadOptions = options;
                throw new Error("S3 service unavailable");
            });

            await expect(
                adapter.upload({
                    key: "documents/test.txt",
                    stream,
                    contentType: "text/plain",
                }),
            ).rejects.toMatchObject({
                code: UploadErrorCode.STORAGE_ERROR,
            });

            expect(uploadOptions.abortController.signal.aborted).toBe(true);
            expect(stream.destroyed).toBe(true);
        });

        it("should map source stream failures to STREAM_ERROR and abort the S3 upload", async () => {
            const failingStream = Readable.from(
                (async function* () {
                    yield Buffer.from("Hello");
                    throw new Error("Source stream failed");
                })(),
            );

            let uploadOptions: any;

            mocks.upload.mockImplementationOnce(async (options: any) => {
                uploadOptions = options;

                for await (const chunk of options.params.Body) {
                    void chunk;
                }

                return {};
            });

            await expect(
                adapter.upload({
                    key: "documents/test.txt",
                    stream: failingStream,
                    contentType: "text/plain",
                }),
            ).rejects.toMatchObject({
                code: UploadErrorCode.STREAM_ERROR,
            });

            expect(uploadOptions.abortController.signal.aborted).toBe(true);
            expect(failingStream.destroyed).toBe(true);
        });

        it("should map S3 deletion failures to STORAGE_ERROR", async () => {
            send.mockRejectedValueOnce(
                new Error("S3 delete failed"),
            );

            await expect(
                adapter.delete("documents/test.txt"),
            ).rejects.toMatchObject({
                code: UploadErrorCode.STORAGE_ERROR,
            });
        });

        it("should abort an upload when the signal is triggered mid-upload", async () => {
            const stream = new PassThrough();
            const controller = new AbortController();

            let notifyBodyStarted!: () => void;

            const bodyStarted = new Promise<void>((resolve) => {
                notifyBodyStarted = resolve;
            });

            mocks.upload.mockImplementationOnce(async (options: any) => {
                for await (const chunk of options.params.Body) {
                    notifyBodyStarted();
                }

                return {};
            });

            const uploadPromise = adapter.upload({
                key: "documents/test.txt",
                stream,
                contentType: "text/plain",
                signal: controller.signal,
            });

            stream.write(Buffer.from("Hello"));

            await bodyStarted;

            controller.abort();

            await expect(uploadPromise).rejects.toMatchObject({
                code: UploadErrorCode.UPLOAD_ABORTED,
            });

            expect(stream.destroyed).toBe(true);
        });
    });
});
