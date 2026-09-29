"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  label,
  pendingLabel = "Working…",
  name,
  value,
  variant = "primary",
}: {
  label: string;
  pendingLabel?: string;
  name?: string;
  value?: string;
  variant?: "primary" | "secondary";
}) {
  const { pending } = useFormStatus();

  return (
    <button
      className={variant === "secondary" ? "button-secondary" : "button"}
      type="submit"
      name={name}
      value={value}
      disabled={pending}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
