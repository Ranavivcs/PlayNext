"use client";

import { useFormStatus } from "react-dom";

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}

/**
 * Submit button that reflects the parent <form>'s pending state (React
 * useFormStatus): shows a spinner + `pendingText` and disables itself while the
 * server action runs, so the user gets immediate feedback. Must be rendered
 * inside the <form> it submits.
 */
export function SubmitButton({
  children,
  pendingText,
  className,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${className ?? ""} inline-flex items-center justify-center gap-2 ${
        pending ? "cursor-progress opacity-70" : ""
      }`}
    >
      {pending ? (
        <>
          <Spinner />
          {pendingText ?? "Working…"}
        </>
      ) : (
        children
      )}
    </button>
  );
}
