import { describe, expect, it } from "vitest";
import {
  MEDIA_POLICY,
  createMediaObjectKey,
  isAllowedMediaByteSize,
  isAllowedMediaMimeType,
  isOpaqueObjectKey,
  mediaLimits,
  sanitizeDisplayFilename,
} from "@/lib/media-policy";

describe("media policy", () => {
  it("documents image-only limits and rejects executable types", () => {
    expect(MEDIA_POLICY).toMatch(/Image-only/);
    expect(isAllowedMediaMimeType("image/jpeg")).toBe(true);
    expect(isAllowedMediaMimeType("image/png")).toBe(true);
    expect(isAllowedMediaMimeType("text/html")).toBe(false);
    expect(isAllowedMediaMimeType("application/javascript")).toBe(false);
    expect(isAllowedMediaMimeType("application/x-msdownload")).toBe(false);
    expect(isAllowedMediaMimeType("application/x-sh")).toBe(false);
    expect(mediaLimits.maxAttachmentsPerPost).toBe(4);
    expect(mediaLimits.maxImageBytes).toBe(8 * 1024 * 1024);
  });

  it("rejects oversized and empty payloads", () => {
    expect(isAllowedMediaByteSize(1)).toBe(true);
    expect(isAllowedMediaByteSize(mediaLimits.maxImageBytes)).toBe(true);
    expect(isAllowedMediaByteSize(mediaLimits.maxImageBytes + 1)).toBe(false);
    expect(isAllowedMediaByteSize(0)).toBe(false);
  });

  it("sanitizes filenames and never uses them as object keys", () => {
    expect(sanitizeDisplayFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeDisplayFilename("C:\\\\Windows\\\\photo.jpg")).toBe(
      "photo.jpg",
    );
    const key = createMediaObjectKey();
    expect(isOpaqueObjectKey(key)).toBe(true);
    expect(key).not.toContain("photo.jpg");
    expect(key).not.toContain("..");
  });
});
