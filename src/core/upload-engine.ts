
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import type {
    UploadConfig,
    UploadInput,
    UploadResult,
} from "../types/upload.js";

import { validateFile } from "../validation/validation-engine.js";
import { validateFileSize } from "../validation/size-validator.js";
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
    constructor(private readonly config: UploadConfig) { }

    async upload(input: UploadInput): Promise<UploadResult> {
        const id = randomUUID();
        const iterator = input.stream[Symbol.asyncIterator]();

        const initialChunks: Buffer[] = [];
        let initialSize = 0;
        let sourceEnded = false;
        let pendingChunk: Buffer | undefined;
        let validatedStream: Readable | undefined;

        const signal = input.signal;
        const abortError = createAbortError();

        const handleAbort = () => {
            if (!input.stream.destroyed) {
                input.stream.destroy();
            }

            if (validatedStream && !validatedStream.destroyed) {
                validatedStream.destroy();
            }
        };

        try {
            if (signal?.aborted) {
                throw abortError;
            }

            signal?.addEventListener("abort", handleAbort, { once: true });

            // 1. Read only the initial bytes required for detection.
            while (
                initialSize < FILE_SIGNATURE_SIZE &&
                !sourceEnded
            ) {
                if (signal?.aborted) {
                    throw abortError;
                }

                const next = await iterator.next();

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

            // 2. Detect actual file type and validate MIME.
            const detectedFile = await validateFile(
                Buffer.concat(initialChunks),
                {
                    allowedMimeTypes: this.config.allowedMimeTypes,
                },
            );

            if (signal?.aborted) {
                throw abortError;
            }

            // 3. Replay inspected bytes and continue reading the source.
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

                        const next = await iterator.next();

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
                    if (!sourceEnded) {
                        await iterator.return?.();
                    }
                }
            }

            validatedStream = Readable.from(
                replayStream(),
                { objectMode: false },
            );

            // 4. Store the validated stream.
            const key = `${id}.${detectedFile.extension}`;

            const storedFile = await this.config.storage.upload({
                key,
                stream: validatedStream,
                contentType: detectedFile.mimeType,
                signal,
            });

            if (signal?.aborted) {
                throw abortError;
            }

            // 5. Return upload metadata.
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

            if (!sourceEnded) {
                try {
                    await iterator.return?.();
                } catch {
                    // Preserve the original upload error.
                }
            }

            if (signal?.aborted) {
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
