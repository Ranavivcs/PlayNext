// Small formatting helpers shared across the dashboard's server components.

export function formatPlaytime(minutes: number): string {
  if (minutes <= 0) return "unplayed";
  const hours = minutes / 60;
  return hours < 1 ? `${minutes} min` : `${hours.toFixed(1)} h`;
}

export function formatSyncedAt(iso: string): string {
  return new Date(iso).toLocaleString();
}
