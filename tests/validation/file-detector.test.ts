
import { describe, expect, it } from "vitest";

import { detectFileType } from "../../src/validation/file-detector.js";

describe("File Detector", () => {
    it("should detect JPEG files", async () => {
        const jpeg = Buffer.from([
            0xff, 0xd8, 0xff, 0xe0,
            0x00, 0x10, 0x4a, 0x46,
            0x49, 0x46, 0x00, 0x01,
        ]);

        const result = await detectFileType(jpeg);

        expect(result?.mimeType).toBe("image/jpeg");
        expect(result?.extension).toBe("jpg");
    });

    it("should detect PNG files", async () => {
        const png = Buffer.from([
            0x89, 0x50, 0x4e, 0x47,
            0x0d, 0x0a, 0x1a, 0x0a,
            0x00, 0x00, 0x00, 0x0d,
            0x49, 0x48, 0x44, 0x52,
        ]);

        const result = await detectFileType(png);

        expect(result?.mimeType).toBe("image/png");
        expect(result?.extension).toBe("png");
    });

    it("should detect PDF files", async () => {
        const pdf = Buffer.from("%PDF-1.7\n");

        const result = await detectFileType(pdf);

        expect(result?.mimeType).toBe("application/pdf");
        expect(result?.extension).toBe("pdf");
    });

    it("should return undefined for unknown file types", async () => {
        const unknown = Buffer.from("This is a plain text file");

        const result = await detectFileType(unknown);

        expect(result).toBeUndefined();
    });

    it("should return undefined for an empty buffer", async () => {
        const result = await detectFileType(Buffer.alloc(0));

        expect(result).toBeUndefined();
    });

    it("should return undefined for a buffer that is too short to identify", async () => {
        const shortBuffer = Buffer.from([0xff, 0xd8]);

        const result = await detectFileType(shortBuffer);

        expect(result).toBeUndefined();
    });

    it("should not detect plain text as a supported file type", async () => {
        const disguisedFile = Buffer.from(
            "This is not actually a PDF or JPEG file",
        );

        const result = await detectFileType(disguisedFile);

        expect(result).toBeUndefined();
    });
});
