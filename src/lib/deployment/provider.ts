import type { DeploymentProvider, DeploymentSelection } from "@/lib/deployment/types";

export function getDeploymentProvider(): DeploymentProvider | null {
  return null;
}

export function getDeploymentSelection(): DeploymentSelection {
  return {
    provider: null,
    vercelAllowed: false,
  };
}
