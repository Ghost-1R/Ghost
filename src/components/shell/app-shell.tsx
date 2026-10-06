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

type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
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

function buildGroups(projectId: string | null): NavGroup[] {
  const project = projectId ? `/projects/${projectId}` : "/projects";
  return [
    {
      id: "core",
      label: "Core",
      items: [
        { href: "/dashboard", label: "Dashboard", match: "exact" },
        { href: projectId ? project : "/projects", label: "Brain" },
      ],
    },
    {
      id: "think",
      label: "Think",
      items: [
        { href: "/ideas", label: "Idea Lab" },
        { href: "/ideas", label: "Strategy" },
      ],
    },
    {
      id: "define",
      label: "Define",
      items: [
        { href: projectId ? `${project}/architect` : "/projects", label: "Product Architect" },
        { href: projectId ? `${project}/architecture` : "/projects", label: "System Architecture" },
      ],
    },
    {
      id: "build",
      label: "Build",
      items: [
        { href: projectId ? `${project}/build-plan` : "/projects", label: "Build Plan" },
        { href: projectId ? `${project}/execution` : "/projects", label: "Build Execution" },
      ],
    },
    {
      id: "verify",
      label: "Verify",
      items: [
        { href: projectId ? `${project}/verification` : "/projects", label: "Test & Verification" },
        { href: projectId ? `${project}/deploy` : "/projects", label: "Deploy" },
      ],
    },
    {
      id: "learn",
      label: "Learn",
      items: [
        { href: "/memory", label: "Memory" },
        { href: "/patterns", label: "Patterns" },
      ],
    },
    {
      id: "system",
      label: "System",
      items: [
        { href: "/inspector", label: "Inspector" },
        { href: "/presentation", label: "Presentation" },
        { href: "/settings", label: "Settings" },
      ],
    },
  ];
}

function isCurrent(pathname: string, href: string, match: "exact" | "prefix" = "prefix"): boolean {
  if (href === "/dashboard" || match === "exact") {
    return pathname === href;
  }
  if (href === "/ideas") {
    return pathname === "/ideas" || pathname.startsWith("/ideas/");
  }
  if (href === "/projects") {
    return pathname === "/projects" || pathname === "/projects/new";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
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
  const mobile = useSyncExternalStore(subscribeToMobile, getMobileSnapshot, getMobileServerSnapshot);
  const open = openPath === pathname;
  const pending = pendingNav?.from === pathname ? pendingNav.href : null;
  const activeId = contextProjectId(pathname, projects);
  const groups = buildGroups(activeId);

  return (
    <div className="shell">
      {mobile && open ? (
        <button className="backdrop" type="button" aria-label="Close navigation" onClick={() => setOpenPath(null)} />
      ) : null}
      <aside id="app-nav" className="sidebar os-sidebar" data-open={open} inert={mobile && !open ? true : undefined}>
        <Link className="wordmark" href="/dashboard">
          <GhostCore size="mark" />
          GHOST
        </Link>
        <nav aria-label="Primary" className="os-nav">
          {groups.map((group) => (
            <div className="os-nav-group" key={group.id}>
              <p className="os-nav-label">{group.label}</p>
              <ul className="nav-list">
                {group.items.map((item) => {
                  const current = isCurrent(pathname, item.href, item.match);
                  return (
                    <li key={`${group.id}-${item.label}`}>
                      <Link
                        className="nav-link"
                        href={item.href}
                        aria-current={current ? "page" : undefined}
                        aria-busy={pending === item.href}
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
            </div>
          ))}
        </nav>

        <div className="os-nav-projects">
          <p className="os-nav-label">Projects</p>
          <ul className="nav-list">
            {projects.slice(0, 6).map((project) => (
              <li key={project.id}>
                <Link
                  className="nav-link"
                  href={`/projects/${project.id}`}
                  aria-current={activeId === project.id && pathname.startsWith(`/projects/${project.id}`) ? "page" : undefined}
                >
                  {project.name}
                </Link>
              </li>
            ))}
          </ul>
          <div className="os-nav-project-actions">
            <Link className="nav-link nav-link-accent" href="/projects/new">
              + New Project
            </Link>
            <Link className="nav-link" href="/projects">
              All Projects
            </Link>
          </div>
        </div>

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
          <TopCommandSearch />
          <div className="topbar-actions">
            <Link className="button" href="/projects/new">
              New Project
            </Link>
            <Link className="button-secondary topbar-profile" href="/settings" title={email ?? "Settings"}>
              {email ? email.split("@")[0] : "Profile"}
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
