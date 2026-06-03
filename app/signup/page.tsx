import Link from "next/link";
import { signup } from "../login/actions";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold">Create your account</h1>
          <p className="text-sm text-gray-500">Start matching with games</p>
        </div>

        {error && (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
        )}

        <form action={signup} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="display_name" className="text-sm font-medium">Display name</label>
            <input
              id="display_name"
              name="display_name"
              type="text"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="email" className="text-sm font-medium">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="password" className="text-sm font-medium">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-black px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Sign up
          </button>
        </form>

        <p className="text-center text-sm text-gray-500">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-black underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
