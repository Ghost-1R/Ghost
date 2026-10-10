"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore, useState, type ReactNode } from "react";
import { signOut } from "@/lib/auth/actions";
import { GhostCore } from "@/components/ghost/experience";
import { TopCommandSearch } from "@/components/shell/top-command";

type NavProject = { id: string; name: string };

type NavItem = {
  href: string;
  label: string;
  match?: "exact" | "prefix";
};

type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
  collapsible?: boolean;
};

const MOBILE_QUERY = "(max-width: 899px)";

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

/** Companion-first primary nav; deeper OS routes stay under Build / System. */
function buildGroups(projectId: string | null): NavGroup[] {
  const project = projectId ? `/projects/${projectId}` : "/projects";
  return [
    {
      id: "primary",
      label: "Ghost",
      items: [
        { href: "/dashboard#ask-ghost", label: "Ask Ghost", match: "exact" },
        { href: "/dashboard", label: "Home", match: "exact" },
        { href: projectId ? project : "/projects", label: "Active Project" },
        { href: "/projects", label: "Projects", match: "exact" },
        { href: "/memory", label: "Memory" },
      ],
    },
    {
      id: "build",
      label: "Build",
      collapsible: true,
      items: [
        { href: "/ideas", label: "Idea Lab" },
        { href: projectId ? `${project}/architect` : "/projects", label: "Product Architect" },
        { href: projectId ? `${project}/architecture` : "/projects", label: "System Architecture" },
        { href: projectId ? `${project}/build-plan` : "/projects", label: "Build Plan" },
        { href: projectId ? `${project}/execution` : "/projects", label: "Build Execution" },
        { href: projectId ? `${project}/verification` : "/projects", label: "Verification" },
        { href: projectId ? `${project}/deploy` : "/projects", label: "Deploy" },
      ],
    },
    {
      id: "system",
      label: "System",
      collapsible: true,
      items: [
        { href: "/patterns", label: "Patterns" },
        { href: "/approvals", label: "Approvals" },
        { href: "/development-tasks", label: "Remote Dev" },
        { href: "/inspector", label: "Inspector" },
        { href: "/presentation", label: "Presentation" },
        { href: "/settings", label: "Settings" },
      ],
    },
  ];
}

function isCurrent(pathname: string, href: string, match: "exact" | "prefix" = "prefix"): boolean {
  const pathOnly = href.split("#")[0] ?? href;
  // Ask Ghost is an in-page jump; do not steal Home's active state.
  if (href.includes("#ask-ghost")) {
    return false;
  }
  if (match === "exact") {
    if (pathOnly === "/projects") {
      return pathname === "/projects" || pathname === "/projects/new";
    }
    return pathname === pathOnly;
  }
  if (pathOnly === "/ideas") {
    return pathname === "/ideas" || pathname.startsWith("/ideas/");
  }
  if (pathOnly === "/projects") {
    return pathname === "/projects" || pathname === "/projects/new";
  }
  if (pathOnly === "/memory") {
    return pathname === "/memory" || pathname.startsWith("/memory/");
  }
  return pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
}

function groupHasCurrent(pathname: string, group: NavGroup): boolean {
  return group.items.some((item) => isCurrent(pathname, item.href, item.match));
}

export function AppShell({
  email,
  projects,
  children,
}: {
  email: string | null;
  projects: NavProject[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [pendingNav, setPendingNav] = useState<{ href: string; from: string } | null>(null);
  // Keep the first paint identical to SSR (desktop shell), then apply the real viewport.
  const [viewportReady, setViewportReady] = useState(false);
  useEffect(() => {
    setViewportReady(true);
  }, []);
  const mobileMedia = useSyncExternalStore(subscribeToMobile, getMobileSnapshot, getMobileServerSnapshot);
  const mobile = viewportReady ? mobileMedia : false;
  const open = openPath === pathname;
  const pending = pendingNav?.from === pathname ? pendingNav.href : null;
  const activeId = contextProjectId(pathname, projects);
  const groups = buildGroups(activeId);

  return (
    <div className="shell">
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
          {groups.map((group) => {
            const currentInGroup = groupHasCurrent(pathname, group);
            const body = (
              <ul className="nav-list">
                {group.items.map((item) => {
                  const current = isCurrent(pathname, item.href, item.match);
                  return (
                    <li key={`${group.id}-${item.label}`}>
                      <Link
                        className={
                          item.href.includes("#ask-ghost") ? "nav-link nav-link-accent" : "nav-link"
                        }
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
            );

            if (group.collapsible) {
              return (
                <details className="os-nav-group os-nav-collapse" key={group.id} open={currentInGroup}>
                  <summary className="os-nav-label os-nav-summary">{group.label}</summary>
                  {body}
                </details>
              );
            }

            return (
              <div className="os-nav-group" key={group.id}>
                <p className="os-nav-label">{group.label}</p>
                {body}
              </div>
            );
          })}
        </nav>

        {projects.length > 1 ? (
          <div className="os-nav-projects">
            <p className="os-nav-label">Switch project</p>
            <ul className="nav-list">
              {projects.slice(0, 6).map((project) => (
                <li key={project.id}>
                  <Link
                    className="nav-link"
                    href={`/projects/${project.id}`}
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
          {pathname === "/dashboard" ? <div className="topbar-spacer" aria-hidden="true" /> : <TopCommandSearch />}
          <div className="topbar-actions">
            <Link className="button" href="/dashboard#ask-ghost">
              Ask Ghost
            </Link>
            <Link className="button-secondary topbar-profile" href="/settings" title={email ?? "Settings"}>
              Account
            </Link>
          </div>
        </header>
        <div className="content os-content" id="main">
          {children}
        </div>
      </div>
    </div>
  );
}
