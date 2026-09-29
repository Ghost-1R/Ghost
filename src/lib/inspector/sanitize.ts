import { OUTPUT_LIMIT } from "./checks";

const SECRET_TEXT =
  /(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|bearer\s+[A-Za-z0-9._~+/-]+=*|authorization\s*:\s*\S+|cookie\s*:\s*\S+|password\s*[:=]\s*\S+|api[_-]?key\s*[:=]\s*\S+|supabase_service_role\s*[:=]\s*\S+)/gi;

export function sanitizeOutput(value: string, limit = OUTPUT_LIMIT): string {
  const redacted = value.replace(SECRET_TEXT, "[redacted]");
  if (redacted.length <= limit) {
    return redacted;
  }
  return `${redacted.slice(0, limit)}\n[truncated]`;
}
