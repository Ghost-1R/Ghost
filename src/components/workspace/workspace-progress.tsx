"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function WorkspaceProgress({
  projectId,
  initialUpdatedAt,
}: {
  projectId: string;
  initialUpdatedAt: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"live" | "offline">("live");

  useEffect(() => {
    let cancelled = false;
    let last = initialUpdatedAt;
    const tick = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch(`/api/workspace/${projectId}/status`, {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          if (!cancelled) setMode("offline");
          return;
        }
        const body = (await response.json()) as { updatedAt?: string };
        if (!cancelled) setMode("live");
        if (body.updatedAt && body.updatedAt !== last) {
          last = body.updatedAt;
          router.refresh();
        }
      } catch {
        if (!cancelled) setMode("offline");
      }
    };
    const id = window.setInterval(tick, 4000);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [projectId, initialUpdatedAt, router]);

  return (
    <p className="quiet workspace-progress" role="status">
      {mode === "live"
        ? "Progress updates without a manual refresh."
        : "Live updates paused — reconnect or refresh to recover."}
    </p>
  );
}
