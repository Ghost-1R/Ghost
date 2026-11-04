"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore, useState, type ReactNode } from "react";
import { signOut } from "@/lib/auth/actions";
import { GhostCore } from "@/components/ghost/experience";
import { TopCommandSearch } from "@/components/shell/top-command";

type NavProject = { id: string; name: string };

type NavItem = {
  href: string;
  label: string;
  match?: "exact" | "prefix";
};

/** Phone + iPad (incl. landscape) keep a collapsible charcoal sidebar. */
const MOBILE_QUERY = "(max-width: 1180px)";

function subscribeToMobile(onStoreChange: () => void) {
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

function getMobileSnapshot() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function getMobileServerSnapshot() {
  return false;
}

function contextProjectId(pathname: string, projects: NavProject[]): string | null {
  const match = pathname.match(/^\/projects\/([^/]+)/);
  if (match && match[1] !== "new") return match[1];
  return projects[0]?.id ?? null;
}

export type NavFlags = {
  showCompanies: boolean;
  showTeam: boolean;
  showMyWork: boolean;
  showSettings: boolean;
};

/** Without flags the shell keeps the pre-teams founder navigation. */
const DEFAULT_NAV_FLAGS: NavFlags = {
  showCompanies: true,
  showTeam: true,
  showMyWork: false,
  showSettings: true,
};

/** Founder-facing primary navigation — deep OS routes stay reachable from project pages. */
function buildPrimaryNav(projectId: string | null, flags: NavFlags): NavItem[] {
  const workerHref = projectId ? `/projects/${projectId}/workspace` : "/projects";
  const items: NavItem[] = [
    { href: "/dashboard", label: "Today", match: "exact" },
    { href: "/projects", label: "Projects", match: "exact" },
  ];
  if (flags.showCompanies) items.push({ href: "/companies", label: "Companies", match: "prefix" });
  items.push({ href: workerHref, label: "Worker", match: "prefix" });
  items.push({ href: "/files", label: "Files", match: "exact" });
  items.push({ href: "/decisions", label: "Decisions", match: "exact" });
  if (flags.showTeam) items.push({ href: "/team", label: "Team", match: "exact" });
  if (flags.showMyWork) items.push({ href: "/team/my-work", label: "My Work", match: "exact" });
  if (flags.showSettings) items.push({ href: "/settings", label: "Settings", match: "exact" });
  return items;
}

function isCurrent(pathname: string, href: string, match: "exact" | "prefix" = "prefix"): boolean {
  const pathOnly = href.split("#")[0] ?? href;
  if (match === "exact") {
    if (pathOnly === "/projects") {
      return pathname === "/projects" || pathname === "/projects/new";
    }
    if (pathOnly === "/dashboard") {
      return pathname === "/dashboard" || pathname === "/";
    }
    return pathname === pathOnly;
  }
  if (pathOnly.endsWith("/workspace")) {
    return pathname.includes("/workspace");
  }
  return pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
}

export function AppShell({
  email,
  projects,
  navFlags,
  children,
}: {
  email: string | null;
  projects: NavProject[];
  navFlags?: Partial<NavFlags>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [pendingNav, setPendingNav] = useState<{ href: string; from: string } | null>(null);
  const mobile = useSyncExternalStore(subscribeToMobile, getMobileSnapshot, getMobileServerSnapshot);
  const open = openPath === pathname;
  const pending = pendingNav?.from === pathname ? pendingNav.href : null;
  const activeId = contextProjectId(pathname, projects);
  const flags: NavFlags = { ...DEFAULT_NAV_FLAGS, ...navFlags };
  const items = buildPrimaryNav(activeId, flags);

  return (
    <div className="shell ghost-light">
      {mobile && open ? (
        <button className="backdrop" type="button" aria-label="Close navigation" onClick={() => setOpenPath(null)} />
      ) : null}
      <aside
        id="app-nav"
        className="sidebar os-sidebar"
        data-open={open ? "true" : "false"}
        {...(mobile && !open ? { inert: true as const } : {})}
      >
        <Link className="wordmark" href="/dashboard">
          <GhostCore size="mark" />
          GHOST
        </Link>
        <nav aria-label="Primary" className="os-nav">
          <ul className="nav-list">
            {items.map((item) => {
              const current = isCurrent(pathname, item.href, item.match);
              return (
                <li key={item.label}>
                  <Link
                    className="nav-link"
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    aria-busy={pending === item.href ? true : undefined}
                    onClick={() => {
                      if (!current) setPendingNav({ href: item.href, from: pathname });
                      if (mobile) setOpenPath(null);
                    }}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {projects.length > 0 ? (
          <div className="os-nav-projects">
            <p className="os-nav-label">Projects</p>
            <ul className="nav-list">
              {projects.slice(0, 8).map((project) => (
                <li key={project.id}>
                  <Link
                    className="nav-link"
                    href={`/projects/${project.id}/workspace`}
                    aria-current={
                      activeId === project.id && pathname.startsWith(`/projects/${project.id}`)
                        ? "page"
                        : undefined
                    }
                  >
                    {project.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="sidebar-footer">
          <form action={signOut}>
            <button className="button-secondary" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar os-topbar">
          <button
            className="menu-button"
            type="button"
            aria-expanded={open}
            aria-controls="app-nav"
            onClick={() => setOpenPath(open ? null : pathname)}
          >
            {open ? "Close" : "Menu"}
          </button>
          {pathname === "/dashboard" ? (
            <p className="topbar-today-label quiet">Today</p>
          ) : pathname.includes("/workspace") ? (
            <p className="topbar-today-label quiet">Worker</p>
          ) : (
            <TopCommandSearch />
          )}
          <div className="topbar-actions">
            <Link className="button ask-ghost-jump" href="/dashboard#ask-ghost">
              Ask Ghost
            </Link>
            {flags.showSettings ? (
              <Link className="button-secondary topbar-profile" href="/settings" title={email ?? "Settings"}>
                Account
              </Link>
            ) : (
              <span className="topbar-profile quiet" title={email ?? undefined}>
                {email ?? "Account"}
              </span>
            )}
          </div>
        </header>
        <div className="content os-content" id="main">
          {children}
        </div>
      </div>
    </div>
  );
}
