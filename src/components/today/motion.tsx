"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

export function StaggerBoard({ children }: { children: ReactNode }) {
  return <div className="today-stagger">{children}</div>;
}

export function StaggerCard({
  index,
  children,
  className = "",
}: {
  index: number;
  children: ReactNode;
  className?: string;
}) {
  const style = {
    "--stagger-index": String(index),
  } as CSSProperties;
  return (
    <div className={`today-card ${className}`.trim()} style={style} data-stagger={index}>
      {children}
    </div>
  );
}

export function SoftNavLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Link
      href={href}
      className={className}
      data-soft-open={pressed ? "true" : "false"}
      onClick={() => setPressed(true)}
    >
      {children}
    </Link>
  );
}

export function CheckpointPulse({
  projectId,
  taskId,
  checkpointSequence,
  updatedAt,
}: {
  projectId: string;
  taskId: string;
  checkpointSequence: number;
  updatedAt: string;
}) {
  const router = useRouter();
  const lastCheckpoint = useRef(checkpointSequence);
  const lastUpdated = useRef(updatedAt);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (
      checkpointSequence !== lastCheckpoint.current ||
      updatedAt !== lastUpdated.current
    ) {
      lastCheckpoint.current = checkpointSequence;
      lastUpdated.current = updatedAt;
      setFlash(true);
      const id = window.setTimeout(() => setFlash(false), 900);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [checkpointSequence, updatedAt]);

  useEffect(() => {
    let cancelled = false;
    let last = updatedAt;
    const tick = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch(`/api/workspace/${projectId}/status`, {
          headers: { Accept: "application/json" },
        });
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as {
          updatedAt?: string;
          checkpointSequence?: number;
        };
        if (body.updatedAt && body.updatedAt !== last) {
          last = body.updatedAt;
          router.refresh();
        }
      } catch {
        /* offline — keep last known checkpoint */
      }
    };
    const id = window.setInterval(tick, 4000);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [projectId, taskId, updatedAt, router]);

  return (
    <span
      className="today-checkpoint"
      data-flash={flash ? "true" : "false"}
      data-checkpoint={checkpointSequence}
    >
      Checkpoint {checkpointSequence}
    </span>
  );
}
