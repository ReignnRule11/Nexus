const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 32;
const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;
const EMAIL_MAX_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DISPLAY_NAME_MIN_LENGTH = 1;
const DISPLAY_NAME_MAX_LENGTH = 80;
const BIO_MAX_LENGTH = 500;
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;
const CONTROL_CHARS = /\p{Cc}/u;

export const identityLimits = {
  usernameMinLength: USERNAME_MIN_LENGTH,
  usernameMaxLength: USERNAME_MAX_LENGTH,
  emailMaxLength: EMAIL_MAX_LENGTH,
  displayNameMinLength: DISPLAY_NAME_MIN_LENGTH,
  displayNameMaxLength: DISPLAY_NAME_MAX_LENGTH,
  bioMaxLength: BIO_MAX_LENGTH,
  passwordMinLength: PASSWORD_MIN_LENGTH,
  passwordMaxLength: PASSWORD_MAX_LENGTH,
} as const;

export function unicodeLength(value: string): number {
  return Array.from(value).length;
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function isValidUsername(username: string): boolean {
  const trimmed = username.trim();
  const normalized = normalizeUsername(username);
  return (
    normalized.length >= USERNAME_MIN_LENGTH &&
    normalized.length <= USERNAME_MAX_LENGTH &&
    USERNAME_PATTERN.test(trimmed)
  );
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  return (
    normalized.length > 0 &&
    normalized.length <= EMAIL_MAX_LENGTH &&
    EMAIL_PATTERN.test(normalized)
  );
}

export function normalizeDisplayName(displayName: string): string {
  return displayName.trim();
}

export function isValidDisplayName(displayName: string): boolean {
  const normalized = normalizeDisplayName(displayName);
  const length = unicodeLength(normalized);
  return (
    length >= DISPLAY_NAME_MIN_LENGTH &&
    length <= DISPLAY_NAME_MAX_LENGTH &&
    !CONTROL_CHARS.test(normalized)
  );
}

export function normalizeBio(bio: string | null | undefined): string | null {
  if (bio === undefined || bio === null) {
    return null;
  }
  const trimmed = bio.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function isValidBio(bio: string | null): boolean {
  if (bio === null) {
    return true;
  }
  return unicodeLength(bio) <= BIO_MAX_LENGTH && !CONTROL_CHARS.test(bio);
}

export function isValidPassword(password: string): boolean {
  return (
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH
  );
}
