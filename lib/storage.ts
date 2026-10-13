import "server-only";

import { loadStorageConfig } from "@/lib/env";
import { createS3ObjectStorage } from "@/lib/storage-s3";

export type StorageObjectMetadata = {
  contentLength: number;
  contentType: string | undefined;
  etag: string | undefined;
};

export type PresignedUpload = {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: Date;
};

export type PresignedDownload = {
  url: string;
  method: "GET";
  expiresAt: Date;
};

export type ObjectDeleteResult = {
  deleted: boolean;
  missing: boolean;
};

export type ObjectStorage = {
  createUploadUrl(input: {
    objectKey: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds: number;
  }): Promise<PresignedUpload>;
  createDownloadUrl(input: {
    objectKey: string;
    expiresInSeconds: number;
  }): Promise<PresignedDownload>;
  headObject(objectKey: string): Promise<StorageObjectMetadata | null>;
  deleteObject(objectKey: string): Promise<ObjectDeleteResult>;
};

let testOverride: ObjectStorage | undefined;

export function setObjectStorageForTests(storage: ObjectStorage | undefined): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "Test storage overrides are only available when NODE_ENV=test.",
    );
  }
  testOverride = storage;
}

export function getObjectStorage(): ObjectStorage {
  if (process.env.NODE_ENV === "test" && testOverride) {
    return testOverride;
  }

  const config = loadStorageConfig();
  if (!config) {
    throw new Error(
      "Missing required configuration: STORAGE_DRIVER. Object storage is unavailable until a private S3-compatible bucket is provided. Do not use fake credentials.",
    );
  }

  return createS3ObjectStorage(config);
}
