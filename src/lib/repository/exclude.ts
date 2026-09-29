const EXCLUDED_DIRECTORIES = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

export function isExcludedRepositoryPath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/").replace(/^\.\//, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => EXCLUDED_DIRECTORIES.has(segment))) {
    return true;
  }

  const base = segments.at(-1) ?? normalized;
  if (base === ".env" || base.startsWith(".env.") || segments.some((segment) => segment === ".env" || segment.startsWith(".env."))) {
    return true;
  }
  if (/\.(?:pem|key)$/i.test(base)) {
    return true;
  }
  if (segments.some((segment) => /^(?:credentials|secrets)/i.test(segment))) {
    return true;
  }
  return false;
}

const SECRET_TEXT =
  /(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]+|OPENAI_API_KEY\s*=\s*\S+|SUPABASE_SERVICE_ROLE\s*=\s*\S+)/;

export function containsSecretMaterial(value: string): boolean {
  return SECRET_TEXT.test(value);
}
