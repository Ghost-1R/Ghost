import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { assertNoSymlinkEscape, assertWorkspacePathAllowed, type CodeWorkspaceContract } from "./workspace";

export const HARMLESS_FIXTURE_ID = "harmless-node";
export const HARMLESS_FIXTURE_RELATIVE = path.join(".ghost", "pilot-fixtures", "harmless-node");

/** Allowlisted pilot commands — never arbitrary shell. */
export const PILOT_COMMANDS = {
  validate: ["node", "--check", "build.mjs"],
  build: ["node", "./build.mjs"],
  test: ["node", "--test", "./test.mjs"],
  testFail: ["node", "--test", "./test-fail.mjs"],
  timeout: ["node", "./timeout.mjs"],
} as const;

export type PilotCommandName = keyof typeof PILOT_COMMANDS;

export type FixtureManifest = {
  fixtureId: string;
  sourcePath: string;
  contentSha256: string;
  fileCount: number;
  files: Array<{ relativePath: string; sha256: string; bytes: number }>;
};

function hashFile(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

function walkFiles(root: string, base = root): Array<{ relativePath: string; abs: string }> {
  const out: Array<{ relativePath: string; abs: string }> = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(abs, base));
    } else if (entry.isFile()) {
      out.push({ relativePath: path.relative(base, abs), abs });
    }
  }
  return out;
}

export function resolveHarmlessFixtureSource(appRoot = process.cwd()): string {
  return path.resolve(appRoot, HARMLESS_FIXTURE_RELATIVE);
}

export function buildFixtureManifest(sourcePath: string): FixtureManifest {
  const files = walkFiles(sourcePath).map((file) => ({
    relativePath: file.relativePath,
    sha256: hashFile(file.abs),
    bytes: statSync(file.abs).size,
  }));
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const contentSha256 = createHash("sha256")
    .update(files.map((f) => `${f.relativePath}:${f.sha256}`).join("|"))
    .digest("hex");
  return {
    fixtureId: HARMLESS_FIXTURE_ID,
    sourcePath,
    contentSha256,
    fileCount: files.length,
    files,
  };
}

export type MaterializeResult =
  | { ok: true; workspaceFixturePath: string; manifest: FixtureManifest }
  | { ok: false; reason: string; message: string };

/**
 * Copy the harmless fixture into an isolated workspace.
 * Rejects if workspace path allows symlink escape or secret filenames.
 */
export function materializeHarmlessFixture(
  contract: CodeWorkspaceContract,
  appRoot = process.cwd(),
): MaterializeResult {
  const source = resolveHarmlessFixtureSource(appRoot);
  if (!existsSync(source)) {
    return { ok: false, reason: "FIXTURE_MISSING", message: `Fixture not found at ${source}` };
  }

  const targetRel = "fixture";
  const allowed = assertWorkspacePathAllowed(contract, path.join(targetRel, "package.json"));
  if (!allowed.ok) {
    return { ok: false, reason: allowed.reason, message: allowed.message };
  }

  mkdirSync(contract.hostPath, { recursive: true });
  const target = path.join(contract.hostPath, targetRel);
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });

  const escape = assertNoSymlinkEscape(contract.hostPath, target);
  if (!escape.ok) {
    rmSync(target, { recursive: true, force: true });
    return { ok: false, reason: escape.reason, message: escape.message };
  }

  // Reject if copied tree contains forbidden secret basenames.
  for (const file of walkFiles(target)) {
    const check = assertWorkspacePathAllowed(contract, path.join(targetRel, file.relativePath));
    if (!check.ok) {
      rmSync(target, { recursive: true, force: true });
      return { ok: false, reason: check.reason, message: check.message };
    }
  }

  return {
    ok: true,
    workspaceFixturePath: target,
    manifest: buildFixtureManifest(target),
  };
}

export function getPilotCommand(name: PilotCommandName): readonly string[] {
  return PILOT_COMMANDS[name];
}
