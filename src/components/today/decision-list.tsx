"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Settles the list after a decision resolve submit (optimistic visual cue). */
export function DecisionList({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  const [settling, setSettling] = useState(false);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const onSubmit = () => {
      setSettling(true);
      window.setTimeout(() => setSettling(false), 700);
    };
    root.addEventListener("submit", onSubmit);
    return () => root.removeEventListener("submit", onSubmit);
  }, []);

  return (
    <ul className="today-card-list today-decision-list" data-settling={settling ? "true" : "false"} ref={ref}>
      {children}
    </ul>
  );
}
