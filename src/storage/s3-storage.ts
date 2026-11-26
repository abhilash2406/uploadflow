
import {
    S3Client,
    DeleteObjectCommand,
} from "@aws-sdk/client-s3";

import { Upload } from "@aws-sdk/lib-storage";

import type { Readable } from "node:stream";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import type {
    StorageAdapter,
    StoredFile,
} from "../types/storage.js";

import {
    UploadError,
    UploadErrorCode,
} from "../errors/index.js";

const MIN_PART_SIZE = 5 * 1024 * 1024;
const MAX_PART_SIZE = 5 * 1024 * 1024 * 1024;
const DEFAULT_MAX_BUFFERED_BYTES = 128 * 1024 * 1024;

export interface S3StorageOptions {
    client: S3Client;
    bucket: string;
    queueSize?: number;
    partSize?: number;
    maxBufferedBytes?: number;
}

type S3UploadInput = {
    key: string;
    stream: Readable;
    contentType: string;
    signal?: AbortSignal;
};

function validateS3ObjectKey(
    key: unknown,
): asserts key is string {
    if (
        typeof key !== "string" ||
        key.trim().length === 0 ||
        /[\u0000-\u001f\u007f]/.test(key)
    ) {
        throw new UploadError({
            code: UploadErrorCode.INVALID_FILE,
            message: "Invalid S3 object key",
        });
    }
}

function validateS3UploadInput(
    options: unknown,
): asserts options is S3UploadInput {
    if (!options || typeof options !== "object") {
        throw new UploadError({
            code: UploadErrorCode.VALIDATION_ERROR,
            message: "S3 upload options must be an object",
        });
    }

    const input = options as Record<string, unknown>;

    validateS3ObjectKey(input.key);

    const stream = input.stream;

    if (
        !stream ||
        typeof stream !== "object" ||
        typeof (stream as Readable).pipe !== "function" ||
        typeof (stream as Readable).once !== "function" ||
        typeof (stream as Readable).removeListener !== "function" ||
        typeof (stream as Readable).destroy !== "function" ||
        typeof (stream as Readable)[Symbol.asyncIterator] !== "function"
    ) {
        throw new UploadError({
            code: UploadErrorCode.VALIDATION_ERROR,
            message: "stream must be a valid readable Node.js stream",
        });
    }

    if (
        typeof input.contentType !== "string" ||
        input.contentType.trim().length === 0 ||
        /[\u0000-\u001f\u007f]/.test(input.contentType)
    ) {
        throw new UploadError({
            code: UploadErrorCode.VALIDATION_ERROR,
            message: "A valid content type must be provided",
        });
    }

    const signal = input.signal;

    if (
        signal !== undefined &&
        (
            !signal ||
            typeof signal !== "object" ||
            typeof (signal as AbortSignal).aborted !== "boolean" ||
            typeof (signal as AbortSignal).addEventListener !== "function" ||
            typeof (signal as AbortSignal).removeEventListener !== "function"
        )
    ) {
        throw new UploadError({
            code: UploadErrorCode.VALIDATION_ERROR,
            message: "signal must be a valid AbortSignal",
        });
    }
}

export class S3StorageAdapter implements StorageAdapter {
    private readonly client: S3Client;
    private readonly bucket: string;
    private readonly queueSize: number;
    private readonly partSize: number;
    private readonly maxBufferedBytes: number;

    constructor(options: S3StorageOptions) {
        if (!options || typeof options !== "object") {
            throw new UploadError({
                code: UploadErrorCode.VALIDATION_ERROR,
                message: "S3 storage options must be an object",
            });
        }

        if (
            typeof options.bucket !== "string" ||
            options.bucket.trim().length === 0
        ) {
            throw new UploadError({
                code: UploadErrorCode.INVALID_FILE,
                message: "S3 bucket name cannot be empty",
            });
        }

        if (
            !options.client ||
            typeof options.client.send !== "function"
        ) {
            throw new UploadError({
                code: UploadErrorCode.VALIDATION_ERROR,
                message: "A valid S3 client must be provided",
            });
        }

        const queueSize = options.queueSize ?? 4;
        const partSize = options.partSize ?? MIN_PART_SIZE;
        const maxBufferedBytes =
            options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;

        if (!Number.isSafeInteger(queueSize) || queueSize < 1) {
            throw new UploadError({
                code: UploadErrorCode.INVALID_FILE,
                message: "S3 queue size must be a positive integer",
            });
        }

        if (
            !Number.isSafeInteger(partSize) ||
            partSize < MIN_PART_SIZE ||
            partSize > MAX_PART_SIZE
        ) {
            throw new UploadError({
                code: UploadErrorCode.INVALID_FILE,
                message: "S3 part size must be between 5 MiB and 5 GiB",
            });
        }

        if (
            !Number.isSafeInteger(maxBufferedBytes) ||
            maxBufferedBytes < 1
        ) {
            throw new UploadError({
                code: UploadErrorCode.INVALID_FILE,
                message: "S3 maxBufferedBytes must be a positive safe integer",
            });
        }

        if (queueSize > Math.floor(maxBufferedBytes / partSize)) {
            throw new UploadError({
                code: UploadErrorCode.INVALID_FILE,
                message: "S3 multipart configuration exceeds maxBufferedBytes",
            });
        }

        this.client = options.client;
        this.bucket = options.bucket;
        this.queueSize = queueSize;
        this.partSize = partSize;
        this.maxBufferedBytes = maxBufferedBytes;
    }

    async upload(options: {
        key: string;
        stream: Readable;
        contentType: string;
        signal?: AbortSignal;
    }): Promise<StoredFile> {
        validateS3UploadInput(options);

        const { key, stream, contentType, signal } = options;

        if (signal?.aborted) {
            throw new UploadError({
                code: UploadErrorCode.UPLOAD_ABORTED,
                message: "Upload was aborted",
            });
        }

        let size = 0;
        let failureOrigin: "source" | "storage" | undefined;
        let failureCause: unknown;

        const controller = new AbortController();

        const handleSourceError = (error: Error) => {
            if (
                !failureOrigin &&
                !controller.signal.aborted &&
                !signal?.aborted
            ) {
                failureOrigin = "source";
                failureCause = error;
            }
        };

        const counter = new Transform({
            transform(chunk, encoding, callback) {
                size += Buffer.byteLength(chunk);
                callback(null, chunk);
            },
        });

        stream.once("error", handleSourceError);

        const handleAbort = () => {
            controller.abort();
        };

        signal?.addEventListener("abort", handleAbort, {
            once: true,
        });

        try {
            const upload = new Upload({
                client: this.client,
                params: {
                    Bucket: this.bucket,
                    Key: key,
                    Body: counter,
                    ContentType: contentType,
                },
                queueSize: this.queueSize,
                partSize: this.partSize,
                leavePartsOnError: false,
                abortController: controller,
            });

            const uploadPromise = upload.done().catch((error) => {
                if (
                    !failureOrigin &&
                    !controller.signal.aborted &&
                    !signal?.aborted
                ) {
                    failureOrigin = "storage";
                    failureCause = error;
                }

                throw error;
            });

            const streamPromise = pipeline(
                stream,
                counter,
                { signal: controller.signal },
            ).catch((error) => {
                if (
                    !failureOrigin &&
                    !controller.signal.aborted &&
                    !signal?.aborted
                ) {
                    failureOrigin = "source";
                    failureCause = error;
                }

                throw error;
            });

            try {
                await Promise.all([
                    uploadPromise,
                    streamPromise,
                ]);
            } catch (error) {
                controller.abort();

                await Promise.allSettled([
                    uploadPromise,
                    streamPromise,
                ]);

                throw error;
            }

            return {
                key,
                size,
            };
        } catch (error) {
            if (signal?.aborted) {
                throw new UploadError({
                    code: UploadErrorCode.UPLOAD_ABORTED,
                    message: "Upload was aborted",
                    cause: error,
                });
            }

            if (failureOrigin === "source") {
                throw new UploadError({
                    code: UploadErrorCode.STREAM_ERROR,
                    message: "Failed to read the incoming upload stream",
                    cause: failureCause ?? error,
                });
            }

            throw new UploadError({
                code: UploadErrorCode.STORAGE_ERROR,
                message: "Failed to upload file to S3",
                cause: failureCause ?? error,
            });
        } finally {
            stream.removeListener("error", handleSourceError);
            signal?.removeEventListener("abort", handleAbort);
        }
    }

    async delete(key: string): Promise<void> {
        validateS3ObjectKey(key);

        try {
            await this.client.send(
                new DeleteObjectCommand({
                    Bucket: this.bucket,
                    Key: key,
                }),
            );
        } catch (error) {
            throw new UploadError({
                code: UploadErrorCode.STORAGE_ERROR,
                message: "Failed to delete file from S3",
                cause: error,
            });
        }
    }
}
