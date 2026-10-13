import { describe, expect, it } from "vitest";
import { loadStorageConfig, requireStorageConfig } from "@/lib/env";
import { createS3ObjectStorage } from "@/lib/storage-s3";

const s3Config = {
  driver: "s3" as const,
  bucket: "nexus-private",
  region: "us-east-1",
  accessKeyId: "AKIAEXAMPLEKEYID",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};

describe("object storage configuration", () => {
  it("does not fall back to filesystem, memory, or public URLs", () => {
    expect(loadStorageConfig({})).toBeUndefined();
    expect(() => requireStorageConfig({})).toThrow(
      /Missing required configuration: STORAGE_DRIVER/,
    );
    expect(() =>
      loadStorageConfig({ STORAGE_DRIVER: "memory" }),
    ).toThrow(/STORAGE_DRIVER/);
    expect(() =>
      loadStorageConfig({ STORAGE_DRIVER: "local" }),
    ).toThrow(/STORAGE_DRIVER/);
  });

  it("requires a complete private S3 configuration", () => {
    expect(() =>
      loadStorageConfig({ STORAGE_DRIVER: "s3", S3_BUCKET: "only-bucket" }),
    ).toThrow(/S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY/);
  });
});

describe("S3 storage adapter", () => {
  it("creates short-lived signed URLs without leaking the secret key", async () => {
    const storage = createS3ObjectStorage(s3Config, async () => {
      throw new Error("network should not run for signing");
    });
    const upload = await storage.createUploadUrl({
      objectKey: "media/11111111-1111-4111-8111-111111111111",
      contentType: "image/jpeg",
      contentLength: 12,
      expiresInSeconds: 300,
    });
    expect(upload.method).toBe("PUT");
    expect(upload.url).toContain("X-Amz-Signature=");
    expect(upload.url).toContain("nexus-private");
    expect(upload.url).not.toContain(s3Config.secretAccessKey);
    expect(JSON.stringify(upload)).not.toContain(s3Config.secretAccessKey);

    const download = await storage.createDownloadUrl({
      objectKey: "media/11111111-1111-4111-8111-111111111111",
      expiresInSeconds: 120,
    });
    expect(download.method).toBe("GET");
    expect(download.url).not.toContain(s3Config.secretAccessKey);
  });

  it("treats missing objects as absent and maps provider failures without leaking credentials", async () => {
    const storage = createS3ObjectStorage(s3Config, async () => {
      return new Response(null, { status: 404 });
    });
    expect(
      await storage.headObject("media/11111111-1111-4111-8111-111111111111"),
    ).toBeNull();
    expect(
      await storage.deleteObject("media/11111111-1111-4111-8111-111111111111"),
    ).toEqual({ deleted: false, missing: true });

    const failing = createS3ObjectStorage(s3Config, async () => {
      throw new Error("secret=wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY");
    });
    await expect(
      failing.headObject("media/11111111-1111-4111-8111-111111111111"),
    ).rejects.toThrow(/Object storage request failed/);
  });
});
