"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore, useState, type ReactNode } from "react";
import { signOut } from "@/lib/auth/actions";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Home" },
  { href: "/projects", label: "Projects" },
  { href: "/projects/new", label: "New Project" },
  { href: "/memory", label: "Memory" },
  { href: "/settings", label: "Settings" },
] as const;

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

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }
  if (href === "/projects/new") {
    return pathname === "/projects/new";
  }
  if (href === "/projects") {
    return pathname === "/projects" || (pathname.startsWith("/projects/") && pathname !== "/projects/new");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({
  email,
  children,
}: {
  email: string | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const mobile = useSyncExternalStore(subscribeToMobile, getMobileSnapshot, getMobileServerSnapshot);
  const open = openPath === pathname;

  return (
    <div className="shell">
      {mobile && open ? (
        <button className="backdrop" type="button" aria-label="Close navigation" onClick={() => setOpenPath(null)} />
      ) : null}
      <aside id="app-nav" className="sidebar" data-open={open} inert={mobile && !open ? true : undefined}>
        <Link className="wordmark" href="/dashboard">
          <span className="mark" aria-hidden="true" />
          GHOST
        </Link>
        <nav aria-label="Primary">
          <ul className="nav-list">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  className="nav-link"
                  href={item.href}
                  aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="sidebar-footer">
          <form action={signOut}>
            <button className="button-secondary" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button
            className="menu-button"
            type="button"
            aria-expanded={open}
            aria-controls="app-nav"
            onClick={() => setOpenPath(open ? null : pathname)}
          >
            {open ? "Close" : "Menu"}
          </button>
          <p>{email ? `Signed in as ${email}` : "Signed in"}</p>
        </header>
        <div className="content" id="main">
          {children}
        </div>
      </div>
    </div>
  );
}
