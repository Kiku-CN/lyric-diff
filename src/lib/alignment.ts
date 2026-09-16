import type { SubtitleEntry } from './subtitles';

export type AlignmentRow = {
  id: string;
  kind: 'equal' | 'change' | 'add' | 'remove';
  localIds: string[];
  localText: string;
  referenceText: string;
  chosenText: string;
};

const REFERENCE_GROUP_LIMIT = 4;

function normalize(text: string): string {
  return text
    .replace(/^[（(][^）)]{1,8}[）)]\s*/u, '')
    .replace(/^[^:：]{1,4}[:：]\s*$/u, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .toLowerCase();
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
        previous[j] + 1,
        previous[j - 1] + 1,
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function groupCost(localText: string, referenceTexts: string[]): number {
  if (referenceTexts.length === 0) return 0.92;
  const local = normalize(localText);
  const reference = normalize(referenceTexts.join(''));
  const denominator = Math.max(local.length, reference.length, 1);
  const distance = editDistance(local, reference) / denominator;
  const lineCountPenalty = Math.max(referenceTexts.length - 1, 0) * 0.06;
  return distance + lineCountPenalty;
}

type Transition = { referenceCount: number };

export function alignSubtitles(local: SubtitleEntry[], referenceLines: string[]): AlignmentRow[] {
  if (local.length === 0) return [];
  const scores = Array.from({ length: local.length + 1 }, () => Array<number>(referenceLines.length + 1).fill(Number.POSITIVE_INFINITY));
  const transitions = Array.from({ length: local.length + 1 }, () => Array<Transition | undefined>(referenceLines.length + 1).fill(undefined));
  scores[0][0] = 0;

  for (let i = 0; i < local.length; i += 1) {
    for (let j = 0; j <= referenceLines.length; j += 1) {
      if (!Number.isFinite(scores[i][j])) continue;
      for (let referenceCount = 0; referenceCount <= REFERENCE_GROUP_LIMIT && j + referenceCount <= referenceLines.length; referenceCount += 1) {
        const candidate = scores[i][j] + groupCost(local[i].text, referenceLines.slice(j, j + referenceCount)) + (referenceCount > 0 ? i * 0.000001 : 0);
        if (candidate < scores[i + 1][j + referenceCount]) {
          scores[i + 1][j + referenceCount] = candidate;
          transitions[i + 1][j + referenceCount] = { referenceCount };
        }
      }
    }
  }

  let endReferenceIndex = referenceLines.length;
  let bestScore = scores[local.length][endReferenceIndex];
  for (let j = 0; j < referenceLines.length; j += 1) {
    const candidate = scores[local.length][j] + (referenceLines.length - j) * 0.92;
    if (candidate < bestScore) {
      bestScore = candidate;
      endReferenceIndex = j;
    }
  }

  const assignments: string[][] = [];
  let i = local.length;
  let j = endReferenceIndex;
  while (i > 0) {
    const transition = transitions[i][j];
    if (!transition) {
      assignments.unshift([]);
      i -= 1;
      continue;
    }
    const startJ = j - transition.referenceCount;
    assignments.unshift(referenceLines.slice(startJ, j));
    i -= 1;
    j = startJ;
  }

  if (endReferenceIndex < referenceLines.length && assignments.length > 0) {
    assignments[assignments.length - 1].push(...referenceLines.slice(endReferenceIndex));
  }

  return local.map((entry, index) => {
    const referenceGroup = assignments[index] ?? [];
    const referenceText = referenceGroup.join('\n');
    const kind: AlignmentRow['kind'] = referenceGroup.length === 0
      ? 'remove'
      : normalize(entry.text) === normalize(referenceText) ? 'equal' : 'change';
    return {
      id: `${kind}-${entry.id}-${index}`,
      kind,
      localIds: [entry.id],
      localText: entry.text,
      referenceText,
      chosenText: referenceText || entry.text,
    };
  });
}
