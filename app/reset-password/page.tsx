import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updatePassword } from "../login/actions";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // Reached via /auth/callback, which created a recovery session. If there's no
  // session (link expired or visited directly), send them to request a new one.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/forgot-password");
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Link href="/" className="brand">
            <span className="brand-logo">▶</span>
            Play<span className="brand-grad">Next</span>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Choose a new password</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Signed in as {user.email}
            </p>
          </div>
        </div>

        <div className="panel p-6">
          {error && <p className="mb-4 rounded-lg banner-err px-3 py-2 text-sm">{error}</p>}

          <form action={updatePassword} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium">
                New password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={6}
                className="field"
              />
            </div>
            <button type="submit" className="btn btn-primary w-full">
              Update password
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
