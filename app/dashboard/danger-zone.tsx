import { deleteAccount } from "./actions";

/** Collapsed "Danger zone": permanent account deletion (admin cascade). */
export function DangerZone() {
  return (
    <section className="mt-10">
      <details className="rounded-xl border border-destructive/40 bg-destructive/5">
        <summary className="cursor-pointer select-none px-5 py-3.5 text-sm font-semibold text-destructive">
          Danger zone
        </summary>
        <div className="space-y-4 border-t border-destructive/30 p-5">
          <div>
            <p className="text-sm font-medium">Delete account</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Permanently deletes your account, your synced library, preferences, and
              recommendations. This also unlinks your Steam account so it can be linked to a new
              account. This can&apos;t be undone.
            </p>
          </div>
          <form action={deleteAccount} className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="confirm" className="h-4 w-4 accent-[var(--brand)]" />
              I understand this is permanent.
            </label>
            <button
              type="submit"
              className="rounded-lg border border-destructive/60 bg-destructive/10 px-4 py-2 text-sm font-semibold text-destructive transition hover:bg-destructive/20"
            >
              Delete my account
            </button>
          </form>
        </div>
      </details>
    </section>
  );
}
