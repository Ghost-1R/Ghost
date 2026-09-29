import { REDACTED, redactSecrets } from "../security/redact";
import { OUTPUT_LIMIT } from "./checks";

const SECRET_ASSIGNMENT =
  /(?:authorization\s*:\s*\S+|cookie\s*:\s*\S+|password\s*[:=]\s*\S+|api[_-]?key\s*[:=]\s*\S+|supabase_service_role\s*[:=]\s*\S+)/gi;

export function sanitizeOutput(value: string, limit = OUTPUT_LIMIT): string {
  const redacted = redactSecrets(value).replace(SECRET_ASSIGNMENT, REDACTED);
  if (redacted.length <= limit) {
    return redacted;
  }
  return `${redacted.slice(0, limit)}\n[truncated]`;
}
