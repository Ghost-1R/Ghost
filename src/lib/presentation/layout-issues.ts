export type LayoutSample = {
  viewport: "mobile" | "tablet" | "desktop";
  path: string;
  landed: string;
  overflow: boolean;
  clipped: string[];
  menuVisible: boolean;
  navVisible: number;
  textLength: number;
  email: boolean;
  password: boolean;
  signIn: boolean;
  ask: boolean;
};

export function layoutIssues(sample: LayoutSample, kind: "login" | "app" | "project"): string[] {
  const issues: string[] = [];
  const where = `${sample.viewport} ${sample.path}`;
  if (sample.overflow) {
    issues.push(`${where}: horizontal overflow`);
  }
  if (sample.clipped.length > 0) {
    issues.push(`${where}: clipped controls ${sample.clipped.join(", ")}`);
  }
  if (sample.textLength < 20) {
    issues.push(`${where}: unreadable or empty text`);
  }
  if (kind === "login") {
    if (!sample.email || !sample.password || !sample.signIn) {
      issues.push(`${where}: sign-in form is incomplete`);
    }
    return issues;
  }
  if (sample.landed.startsWith("/login")) {
    issues.push(`${where}: signed-in page returned to login`);
  }
  if (sample.viewport === "desktop") {
    if (sample.navVisible < 1) {
      issues.push(`${where}: primary navigation is hidden`);
    }
  } else if (!sample.menuVisible) {
    issues.push(`${where}: mobile navigation control is hidden`);
  }
  if (kind === "project" && !sample.ask) {
    issues.push(`${where}: conversation field is hidden`);
  }
  return issues;
}
