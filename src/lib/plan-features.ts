/**
 * A plan's feature list is kept line for line in every language: line 3 in
 * Arabic is line 3 in English. When the Super Admin saves the list in one
 * language, the other languages follow (pure — tested in
 * tests/unit/plan-features.test.ts; translating is the caller's job):
 *
 *   - a new line is translated into the other languages, at the same place;
 *   - a removed line is removed from them;
 *   - a line changed in place changes in this language only, so correcting
 *     a translation never overwrites the other languages (a feature changed
 *     in every language is removed, then added again);
 *   - a language whose list no longer lines up with this one (lists written
 *     separately before) is rebuilt from this one, line by line.
 */

export const featureLines = (text: string | undefined | null): string[] =>
  (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

/** For each new line: the old line it is (unchanged or changed in place), or null when it is new. */
export function matchLines(before: string[], after: string[]): (number | null)[] {
  // Longest common subsequence of unchanged lines.
  const n = before.length;
  const m = after.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (before[i] === after[j]) pairs.push([i++, j++]);
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }
  const result: (number | null)[] = new Array(m).fill(null);
  // Between unchanged lines: lines changed in place are paired up in order (a correction or rewording).
  let prevI = -1;
  let prevJ = -1;
  for (const [i, j] of [...pairs, [n, m] as [number, number]]) {
    const olds = Array.from({ length: i - prevI - 1 }, (_, k) => prevI + 1 + k);
    const news = Array.from({ length: j - prevJ - 1 }, (_, k) => prevJ + 1 + k);
    for (let k = 0; k < Math.min(olds.length, news.length); k++) {
      result[news[k]] = olds[k];
    }
    if (i < n && j < m) result[j] = i;
    prevI = i;
    prevJ = j;
  }
  return result;
}

export type FeatureTranslation = { lang: string; index: number; text: string };

/**
 * The other languages' lists after `lang`'s list became `after` (it was
 * `before`): lines kept from before, and `null` where a line needs
 * translating from `after[index]` (listed in `translate`).
 */
export function syncFeatureLists(
  current: Record<string, string>,
  lang: string,
  after: string[],
  languages: readonly string[],
): { lists: Record<string, (string | null)[]>; translate: FeatureTranslation[] } {
  const before = featureLines(current[lang]);
  const match = matchLines(before, after);
  const lists: Record<string, (string | null)[]> = {};
  const translate: FeatureTranslation[] = [];
  for (const other of languages) {
    if (other === lang) continue;
    const theirs = featureLines(current[other]);
    const aligned = theirs.length > 0 && theirs.length === before.length;
    lists[other] = after.map((line, index) => {
      const from = match[index];
      if (aligned && from !== null) return theirs[from];
      translate.push({ lang: other, index, text: line });
      return null;
    });
  }
  return { lists, translate };
}
