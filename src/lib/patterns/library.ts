import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parsePattern, type PatternRecord } from "./parse";

export async function loadPatterns(directory: string): Promise<PatternRecord[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const patterns: PatternRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const markdown = await readFile(path.join(directory, entry.name, "PATTERN.md"), "utf8").catch(() => "");
    if (!markdown) {
      continue;
    }
    patterns.push(parsePattern(entry.name, markdown));
  }
  return patterns;
}
