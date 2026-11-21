import type { Readable } from "node:stream";

export interface StoredFile {
    key: string;
    size: number;
}

export interface StorageAdapter {
    upload(options: {
        key: string;
        stream: Readable;
        contentType: string;
        signal?: AbortSignal;
    }): Promise<StoredFile>;

    delete(key: string): Promise<void>;
}