"use client";

import { useRef, type FormEvent } from "react";

export function TopCommandSearch() {
  const inputRef = useRef<HTMLInputElement>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = inputRef.current?.value.trim() ?? "";
    const field = document.getElementById("ghost-command") as HTMLTextAreaElement | null;
    const dock = document.getElementById("ask-ghost");
    dock?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (field) {
      if (value) field.value = value;
      field.focus();
    }
  }

  return (
    <form className="top-command" onSubmit={onSubmit} role="search">
      <label className="sr-only" htmlFor="top-command-input">
        Search or ask Ghost
      </label>
      <input
        id="top-command-input"
        ref={inputRef}
        type="search"
        name="q"
        autoComplete="off"
        placeholder="Search projects, ideas, decisions, blockers, or ask Ghost..."
      />
      <button className="button-secondary top-command-go" type="submit">
        Ask
      </button>
    </form>
  );
}
