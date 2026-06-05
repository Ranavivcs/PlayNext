import Link from "next/link";
import { signup } from "../login/actions";
import { PasswordFields } from "@/components/password-fields";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Link href="/" className="brand">
            <span className="brand-logo">▶</span>
            Play<span className="brand-grad">Next</span>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Find your next favorite game
            </p>
          </div>
        </div>

        <div className="panel p-6">
          {error && <p className="mb-4 rounded-lg banner-err px-3 py-2 text-sm">{error}</p>}

          <form action={signup} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="display_name" className="text-sm font-medium">
                Display name
              </label>
              <input id="display_name" name="display_name" type="text" className="field" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <input id="email" name="email" type="email" required className="field" />
            </div>
            <PasswordFields label="Password" />
            <button type="submit" className="btn btn-primary w-full">
              Sign up
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-brand hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
