
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

    it("should return undefined for unknown file types", async () => {
        const unknown = Buffer.from("This is a plain text file");

        const result = await detectFileType(unknown);

        expect(result).toBeUndefined();
    });
});
