export class HttpError extends Error {
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
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export type ErrorBody = {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
};

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}

export function isMissingConfigError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith("Missing required configuration:")
  );
}

export function toErrorBody(error: unknown): { status: number; body: ErrorBody } {
  if (isHttpError(error)) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
        },
      },
    };
  }

  if (isMissingConfigError(error)) {
    return {
      status: 503,
      body: {
        error: {
          code: "not_configured",
          message: "Authentication is not configured.",
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: "internal",
        message: "Something went wrong.",
      },
    },
  };
}
