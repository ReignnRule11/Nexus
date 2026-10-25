import type { ApiErrorBody } from "@/lib/client/types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function userMessageForError(error: unknown): string {
  if (isApiError(error)) {
    if (error.code === "not_configured") {
      return "This service is not configured yet.";
    }
    if (error.code === "unauthenticated") {
      return "Sign in to continue.";
    }
    if (error.code === "account_inactive") {
      return "This account cannot perform that action.";
    }
    if (error.code === "forbidden") {
      return "You cannot perform that action.";
    }
    if (error.code === "not_found") {
      return "That item is not available.";
    }
    if (error.code === "network") {
      return "Network request failed. Try again.";
    }
    if (error.code === "rate_limited") {
      return "Too many requests. Try again later.";
    }
    return error.message;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return "Request cancelled.";
  }
  return "Something went wrong.";
}

let csrfToken: string | null = null;
let csrfInFlight: Promise<string> | null = null;

export function clearClientSessionState(): void {
  csrfToken = null;
  csrfInFlight = null;
}

async function readCsrfToken(): Promise<string> {
  if (csrfToken) {
    return csrfToken;
  }
  if (csrfInFlight) {
    return csrfInFlight;
  }
  csrfInFlight = (async () => {
    const response = await fetch("/api/auth/csrf", {
      method: "GET",
      credentials: "same-origin",
    });
    if (!response.ok) {
      throw await toApiError(response);
    }
    const body = (await response.json()) as { csrfToken: string };
    csrfToken = body.csrfToken;
    return body.csrfToken;
  })();
  try {
    return await csrfInFlight;
  } finally {
    csrfInFlight = null;
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  let code = "internal";
  let message = "Something went wrong.";
  let fields: Record<string, string> | undefined;
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body.error?.code) {
      code = body.error.code;
    }
    if (body.error?.message) {
      message = body.error.message;
    }
    fields = body.error?.fields;
  } catch {
    message = "Something went wrong.";
  }
  return new ApiError(response.status, code, message, fields);
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {
    accept: "application/json",
    ...(options.headers ?? {}),
  };
  const init: RequestInit = {
    method,
    credentials: "same-origin",
    signal: options.signal,
  };

  if (method !== "GET" && method !== "HEAD") {
    headers["x-csrf-token"] = await readCsrfToken();
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
  }

  init.headers = headers;

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new ApiError(0, "network", "Network request failed. Try again.");
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function withCursor(path: string, cursor: string | null, extra?: Record<string, string>): string {
  const url = new URL(path, "http://local.invalid");
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      url.searchParams.set(key, value);
    }
  }
  return `${url.pathname}${url.search}`;
}
