export const mediaLimits = {
  maxImageBytes: 8 * 1024 * 1024,
  maxAttachmentsPerPost: 4,
  uploadUrlTtlSeconds: 300,
  downloadUrlTtlSeconds: 120,
} as const;

export const allowedMediaMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type AllowedMediaMimeType = (typeof allowedMediaMimeTypes)[number];

const REJECTED_MIME_TYPES = new Set([
  "application/x-msdownload",
  "application/x-sh",
  "application/javascript",
  "application/x-javascript",
  "text/html",
  "text/javascript",
  "text/jscript",
  "application/xhtml+xml",
]);

export const MEDIA_POLICY =
  "Image-only MVP. Allowed MIME types: image/jpeg, image/png, image/webp, image/gif. Maximum 8 MB per image and 4 attachments per post. Object keys are server-generated UUIDs. Filenames are sanitized for display only and never used as storage keys. Executable and script content is rejected.";

export function isAllowedMediaMimeType(
  value: string,
): value is AllowedMediaMimeType {
  const normalized = value.trim().toLowerCase();
  if (REJECTED_MIME_TYPES.has(normalized)) {
    return false;
  }
  return (allowedMediaMimeTypes as readonly string[]).includes(normalized);
}

export function isAllowedMediaByteSize(byteSize: number): boolean {
  return Number.isInteger(byteSize) && byteSize > 0 && byteSize <= mediaLimits.maxImageBytes;
}

export function sanitizeDisplayFilename(value: string): string {
  const withoutPath = value.replaceAll("\\", "/").split("/").pop() ?? "";
  const cleaned = withoutPath
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^\.+/g, "")
    .slice(0, 180);
  return cleaned.length > 0 ? cleaned : "image";
}

export function createMediaObjectKey(): string {
  return `media/${crypto.randomUUID()}`;
}

export function isOpaqueObjectKey(objectKey: string): boolean {
  return /^media\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    objectKey,
  );
}
