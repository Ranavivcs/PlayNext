import { signOut } from "../login/actions";

/** Dashboard app bar: brand, the signed-in user, and sign-out. */
export function DashboardHeader({
  displayName,
  email,
}: {
  displayName?: string;
  email?: string;
}) {
  return (
    <header className="panel mb-7 flex items-center justify-between px-5 py-3.5">
      <span className="brand">
        <span className="brand-logo">▶</span>
        Play<span className="brand-grad">Next</span>
      </span>
      <div className="flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium leading-tight">{displayName}</p>
          <p className="text-xs leading-tight text-faint">{email}</p>
        </div>
        <form action={signOut}>
          <button type="submit" className="btn btn-ghost btn-sm">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
