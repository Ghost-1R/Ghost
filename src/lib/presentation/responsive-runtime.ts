import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServerClient } from "@supabase/ssr";
import { redactSecrets } from "../security/redact";
import { layoutIssues, type LayoutSample } from "./layout-issues";
import type { ProbeResult } from "./security-probe";

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

type CdpResult = { result?: { result?: { value?: unknown } }; error?: { message?: string } };

const LAYOUT_EXPRESSION = `(() => {
  const view = window.innerWidth;
  const mobile = view < 900;
  const aside = document.querySelector("#app-nav");
  const closed = mobile && aside?.getAttribute("data-open") !== "true";
  function hidden(el) {
    if (!el) return true;
    if (closed && aside && aside.contains(el)) return true;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return true;
    const rect = el.getBoundingClientRect();
    return rect.width < 2 || rect.height < 2;
  }
  const clipped = [];
  for (const el of document.querySelectorAll("a,button,input,textarea,select")) {
    if (hidden(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.right > view + 2 || rect.left < -2) {
      clipped.push((el.getAttribute("aria-label") || el.textContent || el.getAttribute("name") || el.tagName).trim().replace(/\\s+/g, " ").slice(0, 48));
    }
  }
  const menu = document.querySelector(".menu-button");
  const ask = document.querySelector("textarea[name=message]");
  return {
    landed: location.pathname,
    overflow: ((document.querySelector(".shell") || document.querySelector("main") || document.documentElement).scrollWidth > (document.querySelector(".shell") || document.querySelector("main") || document.documentElement).clientWidth + 1),
    clipped: clipped.slice(0, 6),
    menuVisible: Boolean(menu && !hidden(menu)),
    navVisible: [...document.querySelectorAll("nav a")].filter((el) => !hidden(el)).length,
    textLength: (document.body?.innerText || "").replace(/\\s+/g, " ").trim().length,
    email: Boolean(document.querySelector("input[name=email]") && !hidden(document.querySelector("input[name=email]"))),
    password: Boolean(document.querySelector("input[name=password]") && !hidden(document.querySelector("input[name=password]"))),
    signIn: [...document.querySelectorAll("button")].some((el) => (el.textContent || "").includes("Sign in") && !hidden(el)),
    ask: Boolean(ask && !hidden(ask)),
    heading: document.querySelector('h1')?.textContent || '',
  };
})()`;

async function chromePath(): Promise<string | null> {
  const { access } = await import("node:fs/promises");
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

async function openSocket(url: string): Promise<{ send: (method: string, params?: object) => Promise<CdpResult>; close: () => void }> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(new Error("browser socket failed")));
  });
  let next = 0;
  const pending = new Map<number, (value: CdpResult) => void>();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number };
    if (message.id && pending.has(message.id)) {
      const resolve = pending.get(message.id);
      pending.delete(message.id);
      resolve?.(message as CdpResult);
    }
  });
  return {
    send(method, params) {
      const id = ++next;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

export async function sessionCookies(baseUrl: string, email: string, password: string): Promise<Array<{ name: string; value: string; path: string; httpOnly: boolean; sameSite: "Strict" | "Lax" | "None" }>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  const jar: Array<{ name: string; value: string; options?: { path?: string; httpOnly?: boolean; sameSite?: string | boolean } }> = [];
  const supabase = createServerClient(url, publishable, {
    cookies: {
      getAll: () => jar.map((cookie) => ({ name: cookie.name, value: cookie.value })),
      setAll: (cookies) => {
        for (const cookie of cookies) {
          const index = jar.findIndex((item) => item.name === cookie.name);
          const next = { name: cookie.name, value: cookie.value, options: cookie.options };
          if (index >= 0) {
            jar[index] = next;
          } else {
            jar.push(next);
          }
        }
      },
    },
  });
  const signed = await supabase.auth.signInWithPassword({ email, password });
  if (signed.error) {
    throw new Error("founder sign-in failed");
  }
  return jar.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    path: cookie.options?.path || "/",
    httpOnly: Boolean(cookie.options?.httpOnly),
    sameSite: cookie.options?.sameSite === "strict" ? "Strict" : cookie.options?.sameSite === "none" ? "None" : "Lax",
  }));
}

export async function evaluateResponsiveSurfaces(input: { baseUrl: string; projectId: string; email: string; password: string }): Promise<ProbeResult> {
  const lines: string[] = [];
  const issues: string[] = [];
  const reachable = await fetch(`${input.baseUrl}/login`).then((response) => response.ok).catch(() => false);
  if (!reachable) {
    return { status: "blocked", exitCode: 1, output: "Application server was not reachable. No viewport was measured." };
  }
  const executable = await chromePath();
  if (!executable || !input.email || !input.password) {
    return { status: "blocked", exitCode: 1, output: "No inspector-owned browser runtime was available." };
  }
  const profile = await mkdtemp(path.join(tmpdir(), "ghost-responsive-"));
  const port = 9333 + (process.pid % 1000);
  let browser: ChildProcess | null = null;
  let browserSocket: { send: (method: string, params?: object) => Promise<CdpResult>; close: () => void } | null = null;
  let socket: { send: (method: string, params?: object) => Promise<CdpResult>; close: () => void } | null = null;
  try {
    browser = spawn(/* turbopackIgnore: true */ executable, [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      "about:blank",
    ], { windowsHide: true, stdio: "ignore" });
    let version: { webSocketDebuggerUrl?: string } | null = null;
    for (let attempt = 0; attempt < 30 && !version?.webSocketDebuggerUrl; attempt += 1) {
      version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json()).catch(() => null);
      if (!version?.webSocketDebuggerUrl) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    if (!version?.webSocketDebuggerUrl) {
      return { status: "blocked", exitCode: 1, output: "Browser runtime did not open a debugging port." };
    }
    const created = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json()).catch(() => null);
    const pageSocket = (created as { webSocketDebuggerUrl?: string } | null)?.webSocketDebuggerUrl;
    if (!pageSocket) {
      return { status: "blocked", exitCode: 1, output: "Browser runtime did not open a page." };
    }
    browserSocket = await openSocket(version.webSocketDebuggerUrl);
    const targetId = (created as { id?: string }).id ?? "";
    const windowInfo = (await browserSocket.send("Browser.getWindowForTarget", { targetId })) as { result?: { windowId?: number } };
    const windowId = windowInfo.result?.windowId;
    socket = await openSocket(pageSocket);
    await socket.send("Page.enable");
    await socket.send("Network.enable");
    const pages = [
      { path: "/login", kind: "login" as const },
      { path: "/dashboard", kind: "app" as const },
      { path: "/ideas", kind: "app" as const },
      { path: `/projects/${input.projectId}`, kind: "project" as const },
      { path: `/projects/${input.projectId}/architect`, kind: "project" as const },
      { path: `/projects/${input.projectId}/architecture`, kind: "project" as const },
      { path: `/projects/${input.projectId}/build-plan`, kind: "project" as const },
      { path: "/memory", kind: "app" as const },
      { path: "/patterns", kind: "app" as const },
      { path: "/inspector", kind: "app" as const },
      { path: "/presentation", kind: "app" as const },
    ];
    const cookies = await sessionCookies(input.baseUrl, input.email, input.password);
    for (const viewport of VIEWPORTS) {
      if (windowId) {
        await browserSocket.send("Browser.setWindowBounds", {
          windowId,
          bounds: { left: 0, top: 0, width: viewport.width, height: viewport.height, windowState: "normal" },
        });
      }
      await socket.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.width < 900,
      });
      for (const page of pages) {
        if (page.kind === "login") {
          await socket.send("Network.clearBrowserCookies");
        } else {
          for (const cookie of cookies) {
            await socket.send("Network.setCookie", {
              name: cookie.name,
              value: cookie.value,
              url: input.baseUrl,
              path: cookie.path,
              httpOnly: cookie.httpOnly,
              secure: input.baseUrl.startsWith("https"),
              sameSite: cookie.sameSite,
            });
          }
        }
        await socket.send("Page.navigate", { url: `${input.baseUrl}${page.path}` });
        const emulation = await socket.send("Emulation.setDeviceMetricsOverride", {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          mobile: viewport.width < 900,
        });
        const emulationError = (emulation as { error?: { message?: string } }).error?.message;
        if (emulationError) {
          lines.push(`emulation=${emulationError}`);
        }
        let sample: LayoutSample | null = null;
        for (let attempt = 0; attempt < 25; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          const evaluated = await socket.send("Runtime.evaluate", { expression: LAYOUT_EXPRESSION, returnByValue: true });
          const value = evaluated.result?.result?.value as (Omit<LayoutSample, "viewport" | "path"> & { heading?: string }) | undefined;
          if (!value || value.textLength === 0 || !value.landed) {
            continue;
          }
          sample = { ...value, viewport: viewport.name, path: page.path, clipped: value.clipped ?? [] };
          const routed = value.landed === page.path || (page.kind !== "login" && !value.landed.startsWith("/login"));
          const pastSkeleton = Boolean(value.heading && value.heading !== "Loading");
          const projectReady = page.kind !== "project" || value.ask;
          if (routed && pastSkeleton && projectReady) {
            break;
          }
        }
        if (!sample) {
          issues.push(`${viewport.name} ${page.path}: page did not render`);
          continue;
        }
        const pageIssues = layoutIssues(sample, page.kind);
        issues.push(...pageIssues);
        lines.push(`${viewport.name} ${page.path} landed=${sample.landed} overflow=${sample.overflow ? "yes" : "no"} clipped=${sample.clipped.length} nav=${sample.navVisible} menu=${sample.menuVisible ? "yes" : "no"}`);
      }
    }
    const output = [`viewports=mobile,tablet,desktop`, `issues=${issues.length}`, ...issues, ...lines].join("\n");
    return { status: issues.length === 0 ? "passed" : "failed", exitCode: issues.length === 0 ? 0 : 1, output: redactSecrets(output) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "responsive runtime failed";
    return { status: "blocked", exitCode: 1, output: redactSecrets(message) };
  } finally {
    socket?.close();
    browserSocket?.close();
    browser?.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => null);
  }
}
