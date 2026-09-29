"use client";

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="stack">
      <h1>This page failed to render.</h1>
      <p className="alert" role="alert">
        {error.message}
      </p>
      <button className="button" type="button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
