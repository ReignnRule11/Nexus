import { HttpError } from "@/lib/http-error";

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 50;

export type PageParams = {
  limit: number;
  cursor: string | null;
};

export type PageResult<T> = {
  items: T[];
  nextCursor: string | null;
};

export function parsePageParams(
  searchParams: URLSearchParams,
  defaults: { limit?: number; maxLimit?: number } = {},
): PageParams {
  const maxLimit = defaults.maxLimit ?? MAX_PAGE_LIMIT;
  const defaultLimit = defaults.limit ?? DEFAULT_PAGE_LIMIT;
  const rawLimit = searchParams.get("limit");
  const cursor = searchParams.get("cursor");

  let limit = defaultLimit;
  if (rawLimit !== null) {
    const parsed = Number.parseInt(rawLimit, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new HttpError(400, "invalid_input", "Invalid pagination.", {
        limit: "limit must be a positive integer.",
      });
    }
    limit = Math.min(parsed, maxLimit);
  }

  if (cursor !== null && cursor.trim() === "") {
    throw new HttpError(400, "invalid_input", "Invalid pagination.", {
      cursor: "cursor must be a non-empty string.",
    });
  }

  return {
    limit,
    cursor: cursor && cursor.trim() !== "" ? cursor.trim() : null,
  };
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString(
    "base64url",
  );
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new HttpError(400, "invalid_input", "Invalid pagination.", {
      cursor: "cursor is invalid.",
    });
  }

  const separator = decoded.lastIndexOf("|");
  if (separator === -1) {
    throw new HttpError(400, "invalid_input", "Invalid pagination.", {
      cursor: "cursor is invalid.",
    });
  }

  const createdAt = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(createdAt.getTime()) || id.length === 0) {
    throw new HttpError(400, "invalid_input", "Invalid pagination.", {
      cursor: "cursor is invalid.",
    });
  }

  return { createdAt, id };
}
