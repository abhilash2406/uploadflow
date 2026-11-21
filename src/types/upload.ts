
import type { Readable } from "node:stream";
import type { StorageAdapter } from "./storage.js";

/**
 * Input provided by the consumer when uploading a file.
 */
export interface UploadInput {
  stream: Readable;
  filename: string;
  contentType?: string;
}

/**
 * Supported upload lifecycle statuses.
 */
export type UploadStatus =
  | "completed"
  | "quarantined"
  | "rejected";

/**
 * Metadata detected during file inspection.
 */
export interface DetectedFile {
  mimeType: string;
  extension: string;
}

/**
 * Information returned by the storage provider.
 */
export interface StoredFile {
  key: string;
  size: number;
}

/**
 * Final response returned after processing an upload.
 */
export interface UploadResult {
  id: string;
  key: string;
  originalName: string;
  mimeType: string;
  size: number;
  status: UploadStatus;
}

/**
 * Configuration for the UploadFlow engine.
 */
export interface UploadConfig {
  maxFileSize: number;
  allowedMimeTypes: readonly string[];
  storage: StorageAdapter;
}
