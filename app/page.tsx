import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { deleted } = await searchParams;

  return (
    <main className="flex flex-1 flex-col">
      {deleted && (
        <div className="mx-auto mt-4 w-full max-w-5xl px-6">
          <p className="rounded-lg banner-ok px-3 py-2 text-sm">
            Your account has been deleted.
          </p>
        </div>
      )}
      {/* top bar */}
      <nav className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <span className="brand">
          <span className="brand-logo">▶</span>
          Play<span className="brand-grad">Next</span>
        </span>
        {/* Logged in → the hero already has the dashboard CTA, so keep the top bar
            clean (brand only). Logged out → quick sign-in / sign-up up top. */}
        {!user && (
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn btn-ghost btn-sm">
              Sign in
            </Link>
            <Link href="/signup" className="btn btn-primary btn-sm">
              Get started
            </Link>
          </div>
        )}
      </nav>

      {/* hero */}
      <section className="mx-auto w-full max-w-5xl px-6 pt-16 pb-8 text-center">
        <span className="text-xs font-bold uppercase tracking-[0.16em] text-brand">
          Steam game recommendations
        </span>
        <h1 className="mx-auto mt-4 max-w-3xl text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
          Find your <span className="brand-grad">next favorite</span> game to play.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
          PlayNext learns your taste from the games you actually play and ranks what to
          play next — with a real algorithm, not a guess.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          {user ? (
            <Link href="/dashboard" className="btn btn-primary">
              Go to dashboard
            </Link>
          ) : (
            <>
              <Link href="/signup" className="btn btn-primary">
                Get started — it&apos;s free
              </Link>
              <Link href="/login" className="btn btn-ghost">
                Sign in
              </Link>
            </>
          )}
        </div>

        {/* two paths */}
        <div className="mx-auto mt-14 grid max-w-2xl gap-4 text-left sm:grid-cols-2">
          <PathCard
            tag="Path 1"
            title="Link your Steam"
            body="We read your library & playtime and rank games you don't own yet."
          />
          <PathCard
            tag="Path 2"
            title="Pick a few games"
            body="No Steam needed — choose games you love and we find similar ones."
          />
        </div>

      </section>

      {/* How it works — why the engine is different and trustworthy */}
      <section className="mx-auto w-full max-w-5xl px-6 pb-24">
        <div className="mb-8 text-center">
          <span className="text-xs font-bold uppercase tracking-[0.16em] text-brand">
            How it works
          </span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Why PlayNext is different
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-base text-muted-foreground">
            Most stores push whatever&apos;s trending. PlayNext ranks for{" "}
            <span className="text-foreground">you</span> — and shows its work.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FeatureCard
            icon="🧮"
            title="We do the math — you see why"
            body="PlayNext measures how well each game fits you and ranks accordingly, then shows a clear breakdown of why it's there."
          />
          <FeatureCard
            icon="⏱️"
            title="Learns from what you actually play"
            body="The hours you pour into a game count more than a star rating you never gave. Your real playtime is the signal we learn from."
          />
          <FeatureCard
            icon="🔍"
            title="You see exactly why"
            body="Every recommendation comes with a colour-coded breakdown of the reasons it ranked — nothing hidden. Hover any part to see what it means."
          />
          <FeatureCard
            icon="✨"
            title="AI explains, never decides"
            body="The algorithm does the ranking. The AI only turns the reasons into a sentence — it never chooses your games for you."
          />
        </div>
        <p className="mt-8 text-center text-xs text-faint">
          Built as a CS final project — the ranking algorithm is ours, and it&apos;s fully
          explainable.
        </p>
      </section>
    </main>
  );
}

function FeatureCard({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="panel p-5 text-left">
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary text-lg">
          {icon}
        </span>
        <h3 className="text-base font-semibold">{title}</h3>
      </div>
      <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function PathCard({ tag, title, body }: { tag: string; title: string; body: string }) {
  return (
    <div className="panel p-5">
      <span className="inline-block rounded-full border border-border bg-secondary px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-brand">
        {tag}
      </span>
      <h3 className="mt-3 text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
