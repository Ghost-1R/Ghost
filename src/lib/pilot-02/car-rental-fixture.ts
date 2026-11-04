import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { assertNoSymlinkEscape, assertWorkspacePathAllowed, type CodeWorkspaceContract } from "@/lib/agent-runtime/workspace";
import { PILOT_02_FIXTURE_RELATIVE } from "./task-contract";

export const CAR_RENTAL_PILOT_COMMANDS = {
  validate: ["node", "./validate.mjs"],
  build: ["node", "./build.mjs"],
  test: ["node", "--test", "./test.mjs"],
  testFail: ["node", "--test", "./test-fail.mjs"],
  timeout: ["node", "./timeout.mjs"],
} as const;

export type CarRentalPilotCommand = keyof typeof CAR_RENTAL_PILOT_COMMANDS;

export type CarRentalFixtureManifest = {
  fixtureId: "car-rental-validate";
  sourcePath: string;
  contentSha256: string;
  fileCount: number;
  files: Array<{ relativePath: string; sha256: string; bytes: number }>;
  attribution: "CURSOR_PREPARED_SAMPLE_PLUS_VALIDATION_SCRIPTS";
};

function walkFiles(root: string, base = root): Array<{ relativePath: string; abs: string }> {
  const out: Array<{ relativePath: string; abs: string }> = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(abs, base));
    else if (entry.isFile()) out.push({ relativePath: path.relative(base, abs).replace(/\\/g, "/"), abs });
  }
  return out;
}

export function resolveCarRentalFixtureSource(appRoot = process.cwd()): string {
  return path.resolve(appRoot, PILOT_02_FIXTURE_RELATIVE);
}

export function buildCarRentalFixtureManifest(sourcePath: string): CarRentalFixtureManifest {
  const files = walkFiles(sourcePath).map((file) => ({
    relativePath: file.relativePath,
    sha256: createHash("sha256").update(readFileSync(file.abs)).digest("hex"),
    bytes: statSync(file.abs).size,
  }));
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const contentSha256 = createHash("sha256")
    .update(files.map((f) => `${f.relativePath}:${f.sha256}`).join("|"))
    .digest("hex");
  return {
    fixtureId: "car-rental-validate",
    sourcePath,
    contentSha256,
    fileCount: files.length,
    files,
    attribution: "CURSOR_PREPARED_SAMPLE_PLUS_VALIDATION_SCRIPTS",
  };
}

export function materializeCarRentalFixture(
  contract: CodeWorkspaceContract,
  appRoot = process.cwd(),
):
  | { ok: true; workspaceFixturePath: string; manifest: CarRentalFixtureManifest }
  | { ok: false; reason: string; message: string } {
  const source = resolveCarRentalFixtureSource(appRoot);
  if (!existsSync(source)) {
    return { ok: false, reason: "FIXTURE_MISSING", message: `Fixture not found at ${source}` };
  }
  const targetRel = "fixture";
  const allowed = assertWorkspacePathAllowed(contract, path.join(targetRel, "package.json"));
  if (!allowed.ok) return { ok: false, reason: allowed.reason, message: allowed.message };

  mkdirSync(contract.hostPath, { recursive: true });
  const target = path.join(contract.hostPath, targetRel);
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });

  const escape = assertNoSymlinkEscape(contract.hostPath, target);
  if (!escape.ok) {
    rmSync(target, { recursive: true, force: true });
    return { ok: false, reason: escape.reason, message: escape.message };
  }

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
    manifest: buildCarRentalFixtureManifest(target),
  };
}
