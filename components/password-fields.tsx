"use client";

import { useState } from "react";

// New-password + confirm, with a show/hide toggle and a strength meter. Posts
// `password` and `confirm_password` to the parent server form (the action also
// re-checks the match server-side — never trust the client). Used by signup and
// the reset-password page.

const LABELS = ["Very weak", "Weak", "Fair", "Good", "Strong"];
const COLORS = [
  "bg-rose-500",
  "bg-orange-500",
  "bg-amber-400",
  "bg-lime-400",
  "bg-emerald-400",
];

/** 0..4 — length + character-class variety. Dependency-free, good enough for UX. */
function scorePassword(pw: string): number {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

export function PasswordFields({
  label = "Password",
  minLength = 6,
}: {
  label?: string;
  minLength?: number;
}) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);

  const score = scorePassword(pw);
  const mismatch = confirm.length > 0 && confirm !== pw;
  const type = show ? "text" : "password";

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          {label}
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={type}
            required
            minLength={minLength}
            autoComplete="new-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className="field pr-14"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-faint hover:text-brand"
            aria-label={show ? "Hide password" : "Show password"}
          >
            {show ? "Hide" : "Show"}
          </button>
        </div>

        {pw.length > 0 && (
          <div className="space-y-1 pt-0.5">
            <div className="flex h-1.5 gap-1">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`h-full flex-1 rounded-full transition-colors ${
                    i < score ? COLORS[score] : "bg-[var(--bar-track)]"
                  }`}
                />
              ))}
            </div>
            <p className="text-xs text-faint">
              Strength: <span className="font-medium text-foreground">{LABELS[score]}</span>
            </p>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="confirm_password" className="text-sm font-medium">
          Confirm password
        </label>
        <input
          id="confirm_password"
          name="confirm_password"
          type={type}
          required
          minLength={minLength}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="field"
        />
        {mismatch && <p className="text-xs text-destructive">Passwords don&apos;t match.</p>}
      </div>
    </div>
  );
}
