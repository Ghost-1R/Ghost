const PROVIDER_KEY = /(?<![A-Za-z0-9])(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9]{8,}|xai-[A-Za-z0-9]{8,})/g;
const ACCESS_TOKEN = /(?:ghp_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){0,2})/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;

export const REDACTED = "[redacted]";

export function redactSecrets(value: string): string {
  return value.replace(PROVIDER_KEY, REDACTED).replace(ACCESS_TOKEN, REDACTED).replace(BEARER, `Bearer ${REDACTED}`);
}
