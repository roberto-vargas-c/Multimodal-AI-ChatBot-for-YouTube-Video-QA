// Which chunks the generator writes questions from: spread evenly over each source, more from bigger sources.

/** n indices spread evenly over 0..count-1, skipping the first and last chunk (intros and credits) when there is room */
export function spread(count: number, n: number): number[] {
  if (count <= 0 || n <= 0) return [];
  const [lo, hi] = count > n + 2 ? [1, count - 2] : [0, count - 1];
  if (n === 1) return [Math.floor((lo + hi) / 2)];
  const out = new Set<number>();
  for (let i = 0; i < n; i++) out.add(Math.round(lo + (i * (hi - lo)) / (n - 1)));
  return [...out];
}

/** Shares a total over sources by their chunk count, at least `min` each (fewer if a source is smaller) */
export function share(counts: number[], total: number, min = 2): number[] {
  const sum = counts.reduce((a, b) => a + b, 0);
  if (sum === 0) return counts.map(() => 0);
  return counts.map(c => Math.min(c, Math.max(min, Math.round((c / sum) * total))));
}
