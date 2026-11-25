
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
    });

    describe("validation", () => {
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
            }).toThrow("S3 part size must be at least 5 MiB");
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
