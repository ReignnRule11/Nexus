import "server-only";

import { createHash, createHmac } from "node:crypto";
import type { S3StorageConfig } from "@/lib/env";
import type { ObjectDeleteResult, ObjectStorage } from "@/lib/storage";

type FetchLike = typeof fetch;

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodePath(objectKey: string): string {
  return objectKey
    .split("/")
    .map((segment) => encodeRfc3986(segment))
    .join("/");
}

function amzDate(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function signingKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${encodeRfc3986(key)}=${encodeRfc3986(params[key] ?? "")}`)
    .join("&");
}

function resolveEndpoint(config: S3StorageConfig): {
  host: string;
  urlPrefix: string;
  canonicalUriPrefix: string;
} {
  if (config.endpoint) {
    const parsed = new URL(config.endpoint);
    return {
      host: parsed.host,
      urlPrefix: `${parsed.origin}/${encodeRfc3986(config.bucket)}`,
      canonicalUriPrefix: `/${encodePath(config.bucket)}`,
    };
  }

  const host = `${config.bucket}.s3.${config.region}.amazonaws.com`;
  return {
    host,
    urlPrefix: `https://${host}`,
    canonicalUriPrefix: "",
  };
}

function presign(
  config: S3StorageConfig,
  input: {
    method: "GET" | "PUT";
    objectKey: string;
    expiresInSeconds: number;
    headers: Record<string, string>;
    now?: Date;
  },
): { url: string; expiresAt: Date } {
  const now = input.now ?? new Date();
  const { amzDate: date, dateStamp } = amzDate(now);
  const endpoint = resolveEndpoint(config);
  const credential = `${config.accessKeyId}/${dateStamp}/${config.region}/s3/aws4_request`;
  const headerMap: Record<string, string> = { host: endpoint.host };
  for (const [name, value] of Object.entries(input.headers)) {
    headerMap[name.toLowerCase()] = value;
  }
  const signedHeaderNames = Object.keys(headerMap).sort();
  const canonicalHeaders = `${signedHeaderNames
    .map((name) => `${name}:${headerMap[name] ?? ""}`)
    .join("\n")}\n`;
  const signedHeaders = signedHeaderNames.join(";");
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": date,
    "X-Amz-Expires": String(input.expiresInSeconds),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const canonicalRequest = [
    input.method,
    `${endpoint.canonicalUriPrefix}/${encodePath(input.objectKey)}`,
    canonicalQuery(query),
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    date,
    `${dateStamp}/${config.region}/s3/aws4_request`,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = createHmac(
    "sha256",
    signingKey(config.secretAccessKey, dateStamp, config.region),
  )
    .update(stringToSign, "utf8")
    .digest("hex");
  query["X-Amz-Signature"] = signature;
  return {
    url: `${endpoint.urlPrefix}/${encodePath(input.objectKey)}?${canonicalQuery(query)}`,
    expiresAt: new Date(now.getTime() + input.expiresInSeconds * 1000),
  };
}

function authorizationHeader(
  config: S3StorageConfig,
  input: {
    method: "HEAD" | "DELETE";
    objectKey: string;
    now?: Date;
  },
): { url: string; headers: Record<string, string> } {
  const now = input.now ?? new Date();
  const { amzDate: date, dateStamp } = amzDate(now);
  const endpoint = resolveEndpoint(config);
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    input.method,
    `${endpoint.canonicalUriPrefix}/${encodePath(input.objectKey)}`,
    "",
    `host:${endpoint.host}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:${date}\n`,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    date,
    `${dateStamp}/${config.region}/s3/aws4_request`,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = createHmac(
    "sha256",
    signingKey(config.secretAccessKey, dateStamp, config.region),
  )
    .update(stringToSign, "utf8")
    .digest("hex");
  return {
    url: `${endpoint.urlPrefix}/${encodePath(input.objectKey)}`,
    headers: {
      host: endpoint.host,
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
      "x-amz-date": date,
      authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${dateStamp}/${config.region}/s3/aws4_request, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

function storageFailure(): never {
  throw new Error("Object storage request failed.");
}

export function createS3ObjectStorage(
  config: S3StorageConfig,
  fetchImpl: FetchLike = fetch,
): ObjectStorage {
  return {
    async createUploadUrl(input) {
      const signed = presign(config, {
        method: "PUT",
        objectKey: input.objectKey,
        expiresInSeconds: input.expiresInSeconds,
        headers: {
          "content-length": String(input.contentLength),
          "content-type": input.contentType,
        },
      });
      return {
        url: signed.url,
        method: "PUT",
        headers: {
          "content-length": String(input.contentLength),
          "content-type": input.contentType,
        },
        expiresAt: signed.expiresAt,
      };
    },

    async createDownloadUrl(input) {
      const signed = presign(config, {
        method: "GET",
        objectKey: input.objectKey,
        expiresInSeconds: input.expiresInSeconds,
        headers: {},
      });
      return {
        url: signed.url,
        method: "GET",
        expiresAt: signed.expiresAt,
      };
    },

    async headObject(objectKey) {
      const signed = authorizationHeader(config, {
        method: "HEAD",
        objectKey,
      });
      let response: Response;
      try {
        response = await fetchImpl(signed.url, {
          method: "HEAD",
          headers: signed.headers,
        });
      } catch {
        storageFailure();
      }
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        storageFailure();
      }
      const lengthHeader = response.headers.get("content-length");
      const contentLength = lengthHeader ? Number.parseInt(lengthHeader, 10) : NaN;
      return {
        contentLength: Number.isFinite(contentLength) ? contentLength : 0,
        contentType: response.headers.get("content-type") ?? undefined,
        etag: response.headers.get("etag") ?? undefined,
      };
    },

    async deleteObject(objectKey): Promise<ObjectDeleteResult> {
      const signed = authorizationHeader(config, {
        method: "DELETE",
        objectKey,
      });
      let response: Response;
      try {
        response = await fetchImpl(signed.url, {
          method: "DELETE",
          headers: signed.headers,
        });
      } catch {
        storageFailure();
      }
      if (response.status === 404) {
        return { deleted: false, missing: true };
      }
      if (!response.ok) {
        storageFailure();
      }
      return { deleted: true, missing: false };
    },
  };
}
