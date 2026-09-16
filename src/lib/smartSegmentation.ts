import { editDistance, normalize } from './lyricSimilarity';

export function splitReferenceLine(reference: string, localTexts: string[]): string[] {
  const characters = Array.from(reference);
  const count = localTexts.length;
  const scores = Array.from({ length: count + 1 }, () => Array<number>(characters.length + 1).fill(Number.POSITIVE_INFINITY));
  const boundaries = Array.from({ length: count + 1 }, () => Array<number>(characters.length + 1).fill(-1));
  scores[0][0] = 0;

  for (let i = 0; i < count; i += 1) {
    for (let start = i; start <= characters.length - (count - i); start += 1) {
      if (!Number.isFinite(scores[i][start])) continue;
      for (let end = start + 1; end <= characters.length - (count - i - 1); end += 1) {
        const part = characters.slice(start, end).join('');
        const cost = scores[i][start] + editDistance(normalize(localTexts[i]), normalize(part));
        if (cost <= scores[i + 1][end]) {
          scores[i + 1][end] = cost;
          boundaries[i + 1][end] = start;
        }
      }
    }
  }

  const result: string[] = [];
  let end = characters.length;
  for (let i = count; i > 0; i -= 1) {
    const start = boundaries[i][end];
    result.unshift(characters.slice(start, end).join(''));
    end = start;
  }
  return result;
}
