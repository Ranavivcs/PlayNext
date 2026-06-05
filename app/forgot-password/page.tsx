import Link from "next/link";
import { requestPasswordReset } from "../login/actions";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Link href="/" className="brand">
            <span className="brand-logo">▶</span>
            Play<span className="brand-grad">Next</span>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              We&apos;ll email you a link to set a new one
            </p>
          </div>
        </div>

        <div className="panel p-6">
          {sent ? (
            <div className="space-y-3">
              <p className="rounded-lg banner-ok px-3 py-2 text-sm">
                If an account exists for that email, a reset link is on its way. Check your
                inbox (and spam).
              </p>
              <p className="text-xs text-faint">
                The link expires shortly. Didn&apos;t get it? You can request another below.
              </p>
            </div>
          ) : (
            <form action={requestPasswordReset} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-sm font-medium">
                  Email
                </label>
                <input id="email" name="email" type="email" required className="field" />
              </div>
              <button type="submit" className="btn btn-primary w-full">
                Send reset link
              </button>
            </form>
          )}
        </div>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          Remembered it?{" "}
          <Link href="/login" className="font-semibold text-brand hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
