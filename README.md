# UploadFlow

A streaming-first secure file ingestion pipeline for Node.js.

UploadFlow helps Node.js applications handle file uploads with signature-based file validation, streaming file-size enforcement, and pluggable storage adapters.

## Features

- Streaming-first file processing
- File type detection using file signatures
- MIME type validation
- Maximum file-size enforcement
- Pluggable storage adapters
- Local filesystem storage
- Abort and cancellation support
- Structured error handling
- TypeScript support

## Requirements

- Node.js >= 20
- ES module support

## Installation

Using npm:

```bash
npm install uploadflow
```

Or using pnpm:

```bash
pnpm add uploadflow
```

## Quick Start

```typescript
import {
    UploadEngine,
    LocalStorageAdapter,
} from "uploadflow";

import { createReadStream } from "node:fs";

const storage = new LocalStorageAdapter({
    directory: "./uploads",
});

const upload = new UploadEngine({
    maxFileSize: 5 * 1024 * 1024,
    allowedMimeTypes: [
        "image/jpeg",
        "application/pdf",
    ],
    storage,
});

const result = await upload.upload({
    stream: createReadStream("./example.pdf"),
    filename: "example.pdf",
});

console.log(result);
```

## Upload Result

A successful upload returns an `UploadResult` object:

```typescript
{
    id: string;
    key: string;
    originalName: string;
    mimeType: string;
    size: number;
    status: "completed";
}
```

## Configuration

| Option | Type | Description |
|---|---|---|
| `maxFileSize` | `number` | Maximum allowed file size in bytes |
| `allowedMimeTypes` | `string[]` | Accepted MIME types |
| `storage` | `StorageAdapter` | Storage adapter used for uploads |

## Local Storage

UploadFlow includes a local filesystem storage adapter.

```typescript
const storage = new LocalStorageAdapter({
    directory: "./uploads",
});
```

The directory defaults to `./uploads` when not specified.

## Upload Cancellation

UploadFlow supports `AbortSignal` for cancelling uploads.

```typescript
const controller = new AbortController();

