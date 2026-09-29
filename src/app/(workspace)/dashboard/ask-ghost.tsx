"use client";

import { useState } from "react";

export function AskGhost() {
  const [value, setValue] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        setNotice(
          value.trim().length === 0
            ? "Nothing was submitted. Ghost conversation is not connected."
            : "Kept in this browser only. Ghost did not send this text to a model, and it was not stored.",
        );
      }}
    >
      <label className="field">
        <span>What should Ghost take on?</span>
        <textarea
          id="ask-ghost"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Describe the work. Nothing here is sent yet."
        />
      </label>
      <p className="quiet">No model is connected. This control does not produce an answer.</p>
      <button className="button" type="submit">
        Hold locally
      </button>
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}
    </form>
  );
}
