import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight">PlayNext</h1>
        <p className="max-w-md text-gray-500">
          Personalized Steam game recommendations from a hybrid ranking engine.
        </p>
      </div>
      <div className="flex gap-3">
        {user ? (
          <Link
            href="/dashboard"
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Go to dashboard
          </Link>
        ) : (
          <>
            <Link
              href="/login"
              className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Sign up
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
