
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
- AWS S3 storage with multipart uploads
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

## Storage Adapters

UploadFlow supports different storage backends through its `StorageAdapter` interface.

Currently supported:

- Local filesystem
- AWS S3

### Local Storage

UploadFlow includes a local filesystem storage adapter.

```typescript
import { LocalStorageAdapter } from "uploadflow";

const storage = new LocalStorageAdapter({
    directory: "./uploads",
});
```

The directory defaults to `./uploads` when not specified.

### AWS S3 Storage

UploadFlow provides an S3 storage adapter using the AWS SDK.

The adapter supports streaming uploads, multipart uploads, cancellation, and object deletion.

#### AWS Setup

Install the AWS SDK dependencies if they are not already installed:

```bash
npm install @aws-sdk/client-s3 @aws-sdk/lib-storage
```

Create an S3 client using your AWS region:

```typescript
import { S3Client } from "@aws-sdk/client-s3";

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
});
```

Configure AWS credentials using the AWS SDK's default credential provider chain, such as environment credentials, shared AWS configuration, or an IAM role.

Ensure the configured AWS identity has permission to upload and delete objects in the target bucket.

#### S3 Adapter Usage

```typescript
import {
    UploadEngine,
    S3StorageAdapter,
} from "uploadflow";

import { S3Client } from "@aws-sdk/client-s3";
import { createReadStream } from "node:fs";

const region = process.env.AWS_REGION;
const bucket = process.env.AWS_S3_BUCKET;

if (!region || !bucket) {
    throw new Error("AWS_REGION and AWS_S3_BUCKET are required");
}

const s3Client = new S3Client({
    region,
});

const storage = new S3StorageAdapter({
    client: s3Client,
    bucket,
});

const upload = new UploadEngine({
    maxFileSize: 10 * 1024 * 1024,
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

#### S3 Adapter Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `client` | `S3Client` | Required | Configured AWS S3 client |
| `bucket` | `string` | Required | Target S3 bucket |
| `queueSize` | `number` | `4` | Maximum number of concurrent multipart upload parts |
| `partSize` | `number` | `5 MiB` | Multipart upload part size; minimum 5 MiB |

Example:

```typescript
const storage = new S3StorageAdapter({
    client: s3Client,
    bucket: "my-upload-bucket",
    queueSize: 4,
    partSize: 5 * 1024 * 1024,
});
```

The adapter uses multipart upload handling from `@aws-sdk/lib-storage`.

#### Deleting an S3 Object

The S3 adapter also supports deleting uploaded objects:

```typescript
await storage.delete("documents/example.pdf");
```

The supplied key must identify the object in the configured bucket.

## Upload Cancellation

UploadFlow supports `AbortSignal` for cancelling uploads.

```typescript
const controller = new AbortController();

const uploadPromise = upload.upload({
    stream: createReadStream("./example.pdf"),
    filename: "example.pdf",
    signal: controller.signal,
});

// Cancel the upload when needed.
controller.abort();

try {
    const result = await uploadPromise;
    console.log(result);
} catch (error) {
    console.error("Upload failed or was cancelled:", error);
}
```

Cancellation is supported by both local and S3 storage adapters.

## Error Handling

UploadFlow provides a structured `UploadError` class and predefined error codes.

Available error codes:

- `INVALID_FILE`
- `FILE_TOO_LARGE`
- `UNSUPPORTED_FILE_TYPE`
- `VALIDATION_ERROR`
- `STREAM_ERROR`
- `STORAGE_ERROR`
- `UPLOAD_ABORTED`
- `INTERNAL_ERROR`

Example:

```typescript
import {
    UploadError,
    UploadErrorCode,
} from "uploadflow";

try {
    // Perform upload
} catch (error) {
    if (error instanceof UploadError) {
        console.error("Upload error:", error.code);

        if (error.code === UploadErrorCode.FILE_TOO_LARGE) {
            console.error("The uploaded file exceeds the size limit.");
        }
    }

    throw error;
}
```

## Custom Storage Adapters

You can implement your own storage backend by implementing the `StorageAdapter` interface.

```typescript
import type {
    StorageAdapter,
    StoredFile,
} from "uploadflow";

import type { Readable } from "node:stream";

export class CustomStorageAdapter implements StorageAdapter {
    async upload(options: {
        key: string;
        stream: Readable;
        contentType: string;
        signal?: AbortSignal;
    }): Promise<StoredFile> {
        // Implement your streaming storage logic here.

        throw new Error("Not implemented");
    }

    async delete(key: string): Promise<void> {
        // Implement your object deletion logic here.

        throw new Error("Not implemented");
    }
}
```

Custom adapters should preserve streaming behavior, handle cancellation, and return the actual stored file size.

## TypeScript Support

UploadFlow provides TypeScript declarations for its public API, including:

- `UploadConfig`
- `UploadInput`
- `UploadResult`
- `UploadStatus`
- `StorageAdapter`
- `StoredFile`
- `DetectedFile`
- `LocalStorageOptions`
- `S3StorageOptions`

## License

MIT
