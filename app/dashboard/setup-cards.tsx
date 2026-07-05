import type React from "react";
import { syncSteamLibrary } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { formatPlaytime, formatSyncedAt } from "./format";

export interface SteamAccount {
  steam_id: string;
  persona_name: string | null;
  avatar_url: string | null;
  profile_public: boolean | null;
  last_synced_at: string | null;
}

export interface TopGame {
  appId: number;
  playtimeForever: number;
  name: string;
  headerImage: string | null;
}

/** Secondary "Setup" area below the games: Steam account + library summary. */
export function SetupCards({
  steam,
  gameCount,
  topGames,
}: {
  steam: SteamAccount | null;
  gameCount: number;
  topGames: TopGame[];
}) {
  return (
    <section>
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-faint">Setup</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <DashboardCard title="Steam account" hint="Link your Steam account">
          {steam ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                {steam.avatar_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={steam.avatar_url}
                    alt=""
                    className="h-10 w-10 rounded-lg"
                    width={40}
                    height={40}
                  />
                )}
                <div>
                  <p className="font-semibold text-foreground">
                    {steam.persona_name ?? steam.steam_id}
                  </p>
                  <p className="text-xs text-faint">
                    {steam.profile_public ? "Public profile" : "Private profile"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <form action={syncSteamLibrary}>
                  <SubmitButton className="btn btn-primary btn-sm" pendingText="Syncing…">
                    {steam.last_synced_at ? "Re-sync library" : "Sync library"}
                  </SubmitButton>
                </form>
                <a href="/api/steam/link" className="text-xs text-faint underline hover:text-brand">
                  Change account
                </a>
              </div>
            </div>
          ) : (
            <a href="/api/steam/link" className="btn btn-primary btn-sm">
              Link Steam account
            </a>
          )}
        </DashboardCard>
        <DashboardCard title="Your library" hint="Owned games & playtime">
          {!steam ? (
            "Link Steam to import."
          ) : !steam.last_synced_at ? (
            'Click "Sync library" to import your games.'
          ) : (
            <div className="space-y-3">
              <p className="text-foreground">
                <span className="text-lg font-bold text-brand">{gameCount}</span> games imported
              </p>
              {topGames.length > 0 && (
                <ul className="space-y-1.5">
                  {topGames.map((g) => (
                    <li key={g.appId} className="flex items-center justify-between gap-2">
                      <span className="truncate">{g.name}</span>
                      <span className="shrink-0 text-xs text-faint">
                        {formatPlaytime(g.playtimeForever)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-faint">Last synced {formatSyncedAt(steam.last_synced_at)}</p>
            </div>
          )}
        </DashboardCard>
      </div>
    </section>
  );
}

function DashboardCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel p-5">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-faint">{hint}</p>
      <div className="mt-4 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}
