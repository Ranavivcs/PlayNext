import Link from "next/link";
import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Link href="/" className="brand">
            <span className="brand-logo">▶</span>
            Play<span className="brand-grad">Next</span>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
            <p className="mt-1 text-sm text-muted-foreground">Sign in to keep playing next</p>
          </div>
        </div>

        <div className="panel p-6">
          {message && <p className="mb-4 rounded-lg banner-ok px-3 py-2 text-sm">{message}</p>}
          {error && <p className="mb-4 rounded-lg banner-err px-3 py-2 text-sm">{error}</p>}

          <form action={login} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <input id="email" name="email" type="email" required className="field" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <input id="password" name="password" type="password" required className="field" />
            </div>
            <button type="submit" className="btn btn-primary w-full">
              Sign in
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          No account?{" "}
          <Link href="/signup" className="font-semibold text-brand hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}
