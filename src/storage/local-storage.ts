
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import {
    resolve,
    relative,
    isAbsolute,
    dirname,
    sep,
} from "node:path";
import { Transform } from "node:stream";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { StorageAdapter, StoredFile } from "../types/storage.js";
import { UploadError, UploadErrorCode } from "../errors/index.js";

export interface LocalStorageOptions {
    directory?: string;
}

export class LocalStorageAdapter implements StorageAdapter {
    private readonly directory: string;

    constructor(options: LocalStorageOptions = {}) {
        this.directory = resolve(options.directory ?? "./uploads");
    }

    async upload(options: {
        key: string;
        stream: Readable;
        contentType: string;
        signal?: AbortSignal;
    }): Promise<StoredFile> {
        const { key, stream, signal } = options;

        const filePath = this.resolvePath(key);

        let size = 0;
        let fileCreated = false;

        // Track the origin of the first stream failure.
        let failureOrigin: "source" | "storage" | undefined;
        let failureCause: unknown;

        const captureFailure = (
            origin: "source" | "storage",
            error: Error,
        ) => {
            if (!failureOrigin) {
                failureOrigin = origin;
                failureCause = error;
            }
        };

        const handleSourceError = (error: Error) => {
            captureFailure("source", error);
        };

        const counter = new Transform({
            transform(chunk, encoding, callback) {
                size += Buffer.byteLength(chunk);
                callback(null, chunk);
            },
        });

        let output: ReturnType<typeof createWriteStream> | undefined;

        try {
            // 1. Create parent directories.
            await mkdir(dirname(filePath), { recursive: true });

            // 2. Create the destination file without overwriting.
            output = this.createOutputStream(filePath);

            output.once("open", () => {
                fileCreated = true;
            });

            // 3. Track errors from their original sources.
            stream.on("error", handleSourceError);

            output.on("error", (error) => {
                captureFailure("storage", error);
            });

            // 4. Stream the file to disk.
            await pipeline(stream, counter, output, { signal });

            // 5. Return stored file information.
            return {
                key,
                size,
            };
        } catch (error) {
            // Never delete an existing file if creation failed.
            if (fileCreated) {
                await rm(filePath, { force: true }).catch(() => undefined);
            }

            // Cancellation takes priority.
            if (signal?.aborted) {
                throw new UploadError({
                    code: UploadErrorCode.UPLOAD_ABORTED,
                    message: "Upload was aborted",
                    cause: error,
                });
            }

            // Preserve existing UploadError codes.
            if (error instanceof UploadError) {
                throw error;
            }

            // Classify the original failure.
            if (failureOrigin === "source") {
                throw new UploadError({
                    code: UploadErrorCode.STREAM_ERROR,
                    message: "Failed to read the incoming upload stream",
                    cause: failureCause ?? error,
                });
            }

            throw new UploadError({
                code: UploadErrorCode.STORAGE_ERROR,
                message: "Failed to store file locally",
                cause: failureCause ?? error,
            });
        } finally {
            stream.removeListener("error", handleSourceError);
        }
    }

    /**
     * Creates the destination write stream.
     * Protected so tests can simulate destination failures.
     */
    protected createOutputStream(
        filePath: string,
    ): ReturnType<typeof createWriteStream> {
        return createWriteStream(filePath, { flags: "wx" });
    }

    async delete(key: string): Promise<void> {
        const filePath = this.resolvePath(key);

        try {
            await rm(filePath);
        } catch (error) {
            throw new UploadError({
                code: UploadErrorCode.STORAGE_ERROR,
                message: "Failed to delete stored file",
                cause: error,
            });
        }
    }

    private resolvePath(key: string): string {
        const filePath = resolve(this.directory, key);
        const relativePath = relative(this.directory, filePath);

        if (
            !key ||
            relativePath === "" ||
            relativePath === "." ||
            isAbsolute(relativePath) ||
            relativePath === ".." ||
            relativePath.startsWith(`..${sep}`)
        ) {
            throw new UploadError({
                code: UploadErrorCode.INVALID_FILE,
                message: "Invalid storage key",
            });
        }

        return filePath;
    }
}
