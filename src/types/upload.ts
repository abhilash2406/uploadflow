import type { Readable } from "node:stream";
import type { StorageAdapter } from "./storage.js";

export type UploadStatus =
    | "completed"
    | "quarantined"
    | "rejected";

export interface UploadInput {
    stream: Readable;
    filename: string;
    contentType?: string;
    signal?: AbortSignal;
}

export interface UploadResult {
    id: string;
    key: string;
    originalName: string;
    mimeType: string;
    size: number;
    status: UploadStatus;
}

export interface UploadConfig {
    maxFileSize: number;
    allowedMimeTypes: readonly string[];
    storage: StorageAdapter;
}