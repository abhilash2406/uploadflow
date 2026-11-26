
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import type {
    UploadConfig,
    UploadInput,
    UploadResult,
} from "../types/upload.js";

import { validateFile } from "../validation/validation-engine.js";
import { validateFileSize } from "../validation/size-validator.js";
import { validateUploadConfig } from "../validation/config-validator.js";
import { validateUploadInput } from "../validation/input-validator.js";

import { UploadError } from "../errors/upload-error.js";
import { UploadErrorCode } from "../errors/error-codes.js";

const FILE_SIGNATURE_SIZE = 4100;

function createAbortError(): UploadError {
    return new UploadError({
        code: UploadErrorCode.UPLOAD_ABORTED,
        message: "Upload was aborted",
    });
}

export class UploadEngine {
    private readonly config: UploadConfig;

    constructor(config: UploadConfig) {
        validateUploadConfig(config);
        this.config = config;
    }

    async upload(input: UploadInput): Promise<UploadResult> {
        // 1. Validate input before accessing the stream.
        validateUploadInput(input);

        const id = randomUUID();

        const initialChunks: Buffer[] = [];
        let initialSize = 0;
        let sourceEnded = false;
        let pendingChunk: Buffer | undefined;
        let validatedStream: Readable | undefined;
        let storedKey: string | undefined;

        const signal = input.signal;
        const abortError = createAbortError();

        let iterator:
            ReturnType<Readable[typeof Symbol.asyncIterator]> | undefined;

        // Track iterator cleanup to prevent duplicate return() calls.
        let iteratorCleanupStarted = false;

        const closeSourceIterator = async (): Promise<void> => {
            if (
                sourceEnded ||
                iteratorCleanupStarted ||
                !iterator?.return
            ) {
                return;
            }

            iteratorCleanupStarted = true;

            try {
                await iterator.return();
            } catch {
                // Preserve the original upload error.
            }
        };

        const handleAbort = () => {
            if (!input.stream.destroyed) {
                input.stream.destroy();
            }

            if (validatedStream && !validatedStream.destroyed) {
                validatedStream.destroy();
            }
        };

        try {
            // 2. Create the iterator inside the try block.
            const sourceIterator = input.stream[Symbol.asyncIterator]();
            iterator = sourceIterator;

            if (signal?.aborted) {
                throw abortError;
            }

            signal?.addEventListener("abort", handleAbort, { once: true });

            // 3. Read only the initial bytes required for detection.
            while (
                initialSize < FILE_SIGNATURE_SIZE &&
                !sourceEnded
            ) {
                if (signal?.aborted) {
                    throw abortError;
                }

                const next = await sourceIterator.next();

                if (signal?.aborted) {
                    throw abortError;
                }

                if (next.done) {
                    sourceEnded = true;
                    break;
                }

                const chunk = Buffer.isBuffer(next.value)
                    ? next.value
                    : Buffer.from(next.value);

                const remaining = FILE_SIGNATURE_SIZE - initialSize;

                if (chunk.length <= remaining) {
                    initialChunks.push(chunk);
                    initialSize += chunk.length;
                } else {
                    initialChunks.push(chunk.subarray(0, remaining));
                    pendingChunk = chunk.subarray(remaining);
                    initialSize += remaining;
                }

                validateFileSize(
                    initialSize,
                    this.config.maxFileSize,
                );
            }

            if (signal?.aborted) {
                throw abortError;
            }

            // 4. Detect actual file type and validate MIME.
            const detectedFile = await validateFile(
                Buffer.concat(initialChunks),
                {
                    allowedMimeTypes: this.config.allowedMimeTypes,
                },
            );

            if (signal?.aborted) {
                throw abortError;
            }

            // 5. Replay inspected bytes and continue reading the source.
            const engine = this;

            async function* replayStream() {
                let totalSize = 0;

                try {
                    for (const chunk of initialChunks) {
                        if (signal?.aborted) {
                            throw abortError;
                        }

                        totalSize += chunk.length;

                        validateFileSize(
                            totalSize,
                            engine.config.maxFileSize,
                        );

                        yield chunk;
                    }

                    if (pendingChunk?.length) {
                        if (signal?.aborted) {
                            throw abortError;
                        }

                        totalSize += pendingChunk.length;

                        validateFileSize(
                            totalSize,
                            engine.config.maxFileSize,
                        );

                        yield pendingChunk;
                    }

                    while (!sourceEnded) {
                        if (signal?.aborted) {
                            throw abortError;
                        }

                        const next = await sourceIterator.next();

                        if (signal?.aborted) {
                            throw abortError;
                        }

                        if (next.done) {
                            sourceEnded = true;
                            break;
                        }

                        const chunk = Buffer.isBuffer(next.value)
                            ? next.value
                            : Buffer.from(next.value);

                        totalSize += chunk.length;

                        validateFileSize(
                            totalSize,
                            engine.config.maxFileSize,
                        );

                        yield chunk;
                    }
                } finally {
                    await closeSourceIterator();
                }
            }

            validatedStream = Readable.from(
                replayStream(),
                { objectMode: false },
            );

            // 6. Store the validated stream.
            const key = `${id}.${detectedFile.extension}`;

            let storedFile;

            try {
                storedFile = await this.config.storage.upload({
                    key,
                    stream: validatedStream,
                    contentType: detectedFile.mimeType,
                    signal,
                });
            } catch (storageError) {
                // Preserve errors already classified by the storage adapter.
                if (storageError instanceof UploadError) {
                    throw storageError;
                }

                // Raw errors from custom storage adapters are storage failures.
                throw new UploadError({
                    code: UploadErrorCode.STORAGE_ERROR,
                    message: "Failed to store uploaded file",
                    cause: storageError,
                });
            }

            // Track the stored file immediately after storage succeeds.
            storedKey = storedFile.key;

            if (signal?.aborted) {
                throw abortError;
            }

            // 7. Return upload metadata.
            return {
                id,
                key: storedFile.key,
                originalName: input.filename,
                mimeType: detectedFile.mimeType,
                size: storedFile.size,
                status: "completed",
            };
        } catch (error) {
            // Stop any streams still being consumed.
            if (validatedStream && !validatedStream.destroyed) {
                validatedStream.destroy();
            }

            if (!input.stream.destroyed && !sourceEnded) {
                input.stream.destroy();
            }

            // Close the source iterator only once.
            await closeSourceIterator();

            // Clean up a file that was stored before the abort.
            if (signal?.aborted) {
                if (storedKey) {
                    try {
                        await this.config.storage.delete(storedKey);
                        storedKey = undefined;
                    } catch (cleanupError) {
                        throw new UploadError({
                            code: UploadErrorCode.UPLOAD_ABORTED,
                            message:
                                "Upload was aborted, but stored file cleanup failed",
                            cause: new AggregateError(
                                [abortError, cleanupError],
                                "Upload abort and stored file cleanup both failed",
                            ),
                        });
                    }
                }

                throw abortError;
            }

            if (error instanceof UploadError) {
                throw error;
            }

            throw new UploadError({
                code: UploadErrorCode.STREAM_ERROR,
                message: "Failed to process upload stream",
                cause: error,
            });
        } finally {
            signal?.removeEventListener("abort", handleAbort);
        }
    }
}
