/** Flash banners from redirect searchParams (success = ok, failure = err). */
export function Banners({
  steam_linked,
  steam_error,
  sync_msg,
  sync_error,
  recs_msg,
  recs_error,
  account_error,
}: {
  steam_linked?: string;
  steam_error?: string;
  sync_msg?: string;
  sync_error?: string;
  recs_msg?: string;
  recs_error?: string;
  account_error?: string;
}) {
  return (
    <>
      {steam_linked && (
        <p className="mb-4 rounded-lg banner-ok px-3 py-2 text-sm">Steam account linked.</p>
      )}
      {steam_error && <p className="mb-4 rounded-lg banner-err px-3 py-2 text-sm">{steam_error}</p>}
      {sync_msg && <p className="mb-4 rounded-lg banner-ok px-3 py-2 text-sm">{sync_msg}</p>}
      {sync_error && (
        <p className="mb-4 rounded-lg banner-err px-3 py-2 text-sm">Sync failed: {sync_error}</p>
      )}
      {recs_msg && <p className="mb-4 rounded-lg banner-ok px-3 py-2 text-sm">{recs_msg}</p>}
      {recs_error && (
        <p className="mb-4 rounded-lg banner-err px-3 py-2 text-sm">
          Recommendations failed: {recs_error}
        </p>
      )}
      {account_error && (
        <p className="mb-4 rounded-lg banner-err px-3 py-2 text-sm">{account_error}</p>
      )}
    </>
  );
}
