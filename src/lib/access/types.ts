export type TeamRole = "PROJECT_ADMIN" | "TEAM_MEMBER";

export type AssignmentKind = "HUMAN" | "AI";

export type AssignmentStatus =
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "IN_REVIEW"
  | "COMPLETED"
  | "CANCELLED";

export type CompanyKind = "OPERATING" | "INTERNAL";

export type WorkspaceActor =
  | { kind: "founder"; userId: string }
  | { kind: "project_admin"; userId: string; companyIds: string[] }
  | { kind: "team_member"; userId: string; companyIds: string[]; projectIds: string[] };

export type Permission =
  | "settings.read"
  | "settings.write"
  | "company.manage"
  | "company.read"
  | "team.invite"
  | "team.revoke"
  | "team.preview"
  | "project.admin"
  | "project.read"
  | "assignment.create"
  | "assignment.review"
  | "assignment.submit"
  | "map.view"
  | "map.grant";

export const CATALOG_COMPANIES = [
  {
    slug: "ivoire-market",
    name: "Ivoire Market",
    kind: "OPERATING" as const,
    description: "Formerly Ivoire Shop — customer storefront and order operations.",
    siteUrl: "https://ivoire.example",
    matchProject: (name: string) => /ivoire/i.test(name),
  },
  {
    slug: "im-distributors",
    name: "IM Distributors",
    kind: "OPERATING" as const,
    description: "Wholesale and distributor operations for Ivoire Market.",
    siteUrl: null as string | null,
    matchProject: (name: string) => /im\s*dist|distributor/i.test(name),
  },
  {
    slug: "badger-united",
    name: "Badger United",
    kind: "OPERATING" as const,
    description: "Badger United operating company.",
    siteUrl: null as string | null,
    matchProject: (name: string) => /badger/i.test(name),
  },
  {
    slug: "internal",
    name: "Internal",
    kind: "INTERNAL" as const,
    description: "Ghost pilots, verification, and internal tooling projects.",
    siteUrl: null as string | null,
    matchProject: (name: string) =>
      /ghost|pilot|verif|workspace|approval|internal/i.test(name) || name.trim().length > 0,
  },
] as const;
