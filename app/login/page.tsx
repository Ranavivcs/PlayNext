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
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold">Welcome back</h1>
          <p className="text-sm text-gray-500">Sign in to PlayNext</p>
        </div>

        {message && (
          <p className="rounded-md bg-green-50 p-3 text-sm text-green-700">{message}</p>
        )}
        {error && (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
        )}

        <form action={login} className="space-y-4">
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
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-black px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Sign in
          </button>
        </form>

        <p className="text-center text-sm text-gray-500">
          No account?{" "}
          <Link href="/signup" className="font-medium text-black underline">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}
