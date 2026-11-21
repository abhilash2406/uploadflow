
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

  const counter = new Transform({
    transform(chunk, encoding, callback) {
      size += Buffer.byteLength(chunk);
      callback(null, chunk);
    },
  });

  try {
    // 1. Create parent directories first
    await mkdir(dirname(filePath), { recursive: true });

    // 2. Create the write stream only after directory exists
    const output = createWriteStream(filePath, { flags: "wx" });

    output.once("open", () => {
      fileCreated = true;
    });

    // 3. Stream the file to disk
    await pipeline(stream, counter, output, { signal });

    // 4. Return stored file information
    return {
      key,
      size,
    };
  } catch (error) {
    // Never delete an existing file if creation failed
    if (fileCreated) {
      await rm(filePath, { force: true }).catch(() => undefined);
    }

    if (signal?.aborted) {
      throw new UploadError({
        code: UploadErrorCode.UPLOAD_ABORTED,
        message: "Upload was aborted",
        cause: error,
      });
    }

    throw new UploadError({
      code: UploadErrorCode.STORAGE_ERROR,
      message: "Failed to store file locally",
      cause: error,
    });
  }
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
