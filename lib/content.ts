const POST_BODY_MAX_LENGTH = 5000;
const COMMENT_BODY_MAX_LENGTH = 2000;

export const contentLimits = {
  postBodyMaxLength: POST_BODY_MAX_LENGTH,
  commentBodyMaxLength: COMMENT_BODY_MAX_LENGTH,
} as const;

export function unicodeLength(value: string): number {
  return Array.from(value).length;
}

export function isBlankContent(value: string): boolean {
  return value.trim().length === 0;
}

export function isValidPostBody(body: string): boolean {
  return !isBlankContent(body) && unicodeLength(body) <= POST_BODY_MAX_LENGTH;
}

export function isValidCommentBody(body: string): boolean {
  return !isBlankContent(body) && unicodeLength(body) <= COMMENT_BODY_MAX_LENGTH;
}
