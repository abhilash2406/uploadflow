
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

export interface S3StorageOptions {
    client: S3Client;
    bucket: string;
    queueSize?: number;
    partSize?: number;
}

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

export class S3StorageAdapter implements StorageAdapter {
    private readonly client: S3Client;
    private readonly bucket: string;
    private readonly queueSize: number;
    private readonly partSize: number;

    constructor(options: S3StorageOptions) {
        if (!options.bucket.trim()) {
            throw new UploadError({
                code: UploadErrorCode.INVALID_FILE,
                message: "S3 bucket name cannot be empty",
            });
        }

        const queueSize = options.queueSize ?? 4;
        const partSize = options.partSize ?? 5 * 1024 * 1024;

        if (!Number.isInteger(queueSize) || queueSize < 1) {
            throw new UploadError({
                code: UploadErrorCode.INVALID_FILE,
                message: "S3 queue size must be a positive integer",
            });
        }

        if (!Number.isInteger(partSize) || partSize < 5 * 1024 * 1024) {
            throw new UploadError({
                code: UploadErrorCode.INVALID_FILE,
                message: "S3 part size must be at least 5 MiB",
            });
        }

        this.client = options.client;
        this.bucket = options.bucket;
        this.queueSize = queueSize;
        this.partSize = partSize;
    }

    async upload(options: {
        key: string;
        stream: Readable;
        contentType: string;
        signal?: AbortSignal;
    }): Promise<StoredFile> {
        const { key, stream, contentType, signal } = options;

        validateS3ObjectKey(key);

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
            if (!failureOrigin && !controller.signal.aborted && !signal?.aborted) {
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
                if (!failureOrigin && !controller.signal.aborted && !signal?.aborted) {
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
                if (!failureOrigin && !controller.signal.aborted && !signal?.aborted) {
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
