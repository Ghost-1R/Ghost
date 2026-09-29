import type { DeploymentProvider, DeploymentSelection } from "@/lib/deployment/types";
import { isHostedRuntime, productionUrl } from "@/lib/inspector/runtime";

export function getDeploymentProvider(): DeploymentProvider | null {
  return null;
}

export function getDeploymentSelection(env: Record<string, string | undefined> = process.env): DeploymentSelection {
  const hosted = isHostedRuntime(env);
  return {
    provider: hosted || productionUrl(env) ? "render" : null,
    vercelAllowed: false,
    hosted,
  };
}
