
import type { Readable } from "node:stream";

/**
 * Information about a successfully stored file.
 */
export interface StoredFile {
  key: string;
  size: number;
}

/**
 * Contract that every storage provider must implement.
 */
export interface StorageAdapter {
  upload(options: {
    key: string;
    stream: Readable;
    contentType: string;
    signal?: AbortSignal;
  }): Promise<StoredFile>;

  delete(key: string): Promise<void>;
}
