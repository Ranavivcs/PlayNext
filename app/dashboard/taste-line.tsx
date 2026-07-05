/** Join detected taste styles into a readable phrase: "A", "A and B", "A, B and C". */
function joinStyles(styles: string[]): string {
  if (styles.length <= 1) return styles[0] ?? "";
  return `${styles.slice(0, -1).join(", ")} and ${styles[styles.length - 1]}`;
}

/**
 * Adaptive-engine transparency, in plain words: how it read the user's taste.
 * Names the detected styles when we have them, else a generic fallback.
 */
export function TasteLine({ tasteMode, tasteStyles }: { tasteMode?: string; tasteStyles: string[] }) {
  if (!tasteMode) return null;
  return (
    <p className="mb-5 text-xs text-faint">
      {tasteMode === "clustered" ? (
        tasteStyles.length > 0 ? (
          <>
            🎯 You play{" "}
            <span className="font-medium text-brand">{joinStyles(tasteStyles)}</span> games — so
            each pick is matched to one of your tastes, not just your average.
          </>
        ) : (
          <>
            🎯 You play a few different kinds of games, so these picks match each of your tastes —
            not just your average.
          </>
        )
      ) : tasteStyles.length > 0 ? (
        <>
          🎯 Your taste centers on{" "}
          <span className="font-medium text-brand">{joinStyles(tasteStyles.slice(0, 1))}</span> —
          these picks closely match it.
        </>
      ) : (
        <>🎯 These picks closely match the kind of games you play most.</>
      )}
    </p>
  );
}
