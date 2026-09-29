import type { CheckDefinition } from "./types";

export const OUTPUT_LIMIT = 1200;

const SAFE_TIMEOUT_MS = 180_000;

export const SAFE_CHECKS: CheckDefinition[] = [
  {
    id: "test",
    name: "Tests",
    type: "TEST",
    scope: "local",
    risk: "SAFE",
    command: ["npm", "test"],
    expectedExit: 0,
    timeoutMs: SAFE_TIMEOUT_MS,
  },
  {
    id: "lint",
    name: "Lint",
    type: "LINT",
    scope: "local",
    risk: "SAFE",
    command: ["npm", "run", "lint"],
    expectedExit: 0,
    timeoutMs: SAFE_TIMEOUT_MS,
  },
  {
    id: "typescript",
    name: "TypeScript",
    type: "TYPESCRIPT",
    scope: "local",
    risk: "SAFE",
    command: ["npx", "tsc", "--noEmit"],
    expectedExit: 0,
    timeoutMs: SAFE_TIMEOUT_MS,
  },
  {
    id: "build",
    name: "Build",
    type: "BUILD",
    scope: "local",
    risk: "SAFE",
    command: ["npm", "run", "build"],
    expectedExit: 0,
    timeoutMs: SAFE_TIMEOUT_MS,
  },
  {
    id: "git-status",
    name: "Git status",
    type: "GIT_STATUS",
    scope: "local",
    risk: "SAFE",
    command: null,
    expectedExit: 0,
    timeoutMs: 20_000,
  },
  {
    id: "repository-readme",
    name: "Repository README",
    type: "REPOSITORY_FILE",
    scope: "local",
    risk: "SAFE",
    command: null,
    expectedExit: null,
    timeoutMs: 5_000,
  },
  {
    id: "database",
    name: "Database",
    type: "DATABASE_REMOTE",
    scope: "remote",
    risk: "SAFE",
    command: null,
    expectedExit: null,
    timeoutMs: 5_000,
  },
  {
    id: "auth-signup",
    name: "Auth sign-up",
    type: "AUTH_ROUTE",
    scope: "remote",
    risk: "SAFE",
    command: null,
    expectedExit: null,
    timeoutMs: 5_000,
  },
  {
    id: "deployment",
    name: "Production deployment",
    type: "DEPLOYMENT",
    scope: "remote",
    risk: "SAFE",
    command: null,
    expectedExit: null,
    timeoutMs: 5_000,
  },
  {
    id: "github-remote",
    name: "GitHub remote",
    type: "CUSTOM",
    scope: "remote",
    risk: "SAFE",
    command: null,
    expectedExit: null,
    timeoutMs: 5_000,
  },
  {
    id: "model-grounding",
    name: "Model grounding",
    type: "MODEL_GROUNDING",
    scope: "local",
    risk: "SAFE",
    command: null,
    expectedExit: null,
    timeoutMs: 5_000,
  },
];

export const DISPOSABLE_FAIL_COMMAND = ["node", "-e", "process.exit(1)"] as const;

export const DISPOSABLE_FAILURE_CHECK: CheckDefinition = {
  id: "disposable-fail",
  name: "Disposable failure",
  type: "CUSTOM",
  scope: "local",
  risk: "SAFE",
  command: [...DISPOSABLE_FAIL_COMMAND],
  expectedExit: 0,
  timeoutMs: 15_000,
};

const ALLOWED_COMMANDS = new Set(
  [...SAFE_CHECKS, DISPOSABLE_FAILURE_CHECK]
    .map((check) => (check.command ? JSON.stringify(check.command) : null))
    .filter((command): command is string => Boolean(command)),
);

export function findSafeCheck(id: string): CheckDefinition | null {
  return SAFE_CHECKS.find((check) => check.id === id) ?? null;
}

export function commandAllowed(command: readonly string[] | null): boolean {
  if (!command) {
    return false;
  }
  return ALLOWED_COMMANDS.has(JSON.stringify(command));
}

export function shellInputRejected(value: string): boolean {
  return findSafeCheck(value) === null;
}
