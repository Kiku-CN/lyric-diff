import type { SubtitleEntry } from './subtitles';

export type AlignmentRow = {
  id: string;
  kind: 'equal' | 'change' | 'add' | 'remove';
  localIds: string[];
  localText: string;
  referenceText: string;
  chosenText: string;
};

type Transition = {
  localCount: number;
  referenceCount: number;
};

const GROUP_LIMIT = 3;

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
      const substitution = diagonal + (left[i - 1] === right[j - 1] ? 0 : 1);
      previous[j] = Math.min(substitution, previous[j] + 1, previous[j - 1] + 1);
      diagonal = above;
    }
  }
  return previous[right.length];
}

function groupCost(localTexts: string[], referenceTexts: string[]): number {
  const local = normalize(localTexts.join(''));
  const reference = normalize(referenceTexts.join(''));
  const denominator = Math.max(local.length, reference.length, 1);
  const distance = editDistance(local, reference) / denominator;
  const lineCountPenalty = Math.abs(localTexts.length - referenceTexts.length) * 0.55;
  const groupPenalty = (localTexts.length + referenceTexts.length - 2) * 0.04;
  return distance + lineCountPenalty + groupPenalty;
}

function setIfBetter(
  scores: number[][],
  transitions: Array<Array<Transition | undefined>>,
  row: number,
  column: number,
  score: number,
  transition: Transition,
) {
  if (score < scores[row][column]) {
    scores[row][column] = score;
    transitions[row][column] = transition;
  }
}

export function alignSubtitles(local: SubtitleEntry[], referenceLines: string[]): AlignmentRow[] {
  const scores = Array.from({ length: local.length + 1 }, () => Array<number>(referenceLines.length + 1).fill(Number.POSITIVE_INFINITY));
  const transitions = Array.from({ length: local.length + 1 }, () => Array<Transition | undefined>(referenceLines.length + 1).fill(undefined));
  scores[0][0] = 0;

  for (let i = 0; i <= local.length; i += 1) {
    for (let j = 0; j <= referenceLines.length; j += 1) {
      if (!Number.isFinite(scores[i][j])) continue;

      for (let localCount = 1; localCount <= GROUP_LIMIT && i + localCount <= local.length; localCount += 1) {
        for (let referenceCount = 1; referenceCount <= GROUP_LIMIT && j + referenceCount <= referenceLines.length; referenceCount += 1) {
          const localTexts = local.slice(i, i + localCount).map((entry) => entry.text);
          const referenceTexts = referenceLines.slice(j, j + referenceCount);
          setIfBetter(scores, transitions, i + localCount, j + referenceCount, scores[i][j] + groupCost(localTexts, referenceTexts), { localCount, referenceCount });
        }
      }

      for (let localCount = 1; localCount <= GROUP_LIMIT && i + localCount <= local.length; localCount += 1) {
        setIfBetter(scores, transitions, i + localCount, j, scores[i][j] + 0.82 + (localCount - 1) * 0.06, { localCount, referenceCount: 0 });
      }
      for (let referenceCount = 1; referenceCount <= GROUP_LIMIT && j + referenceCount <= referenceLines.length; referenceCount += 1) {
        setIfBetter(scores, transitions, i, j + referenceCount, scores[i][j] + 0.82 + (referenceCount - 1) * 0.06, { localCount: 0, referenceCount });
      }
    }
  }

  const rows: AlignmentRow[] = [];
  let i = local.length;
  let j = referenceLines.length;
  while (i > 0 || j > 0) {
    const transition = transitions[i][j];
    if (!transition) break;
    const startI = i - transition.localCount;
    const startJ = j - transition.referenceCount;
    const localGroup = local.slice(startI, i);
    const referenceGroup = referenceLines.slice(startJ, j);
    const localIds = localGroup.map((entry) => entry.id);
    const localText = localGroup.map((entry) => entry.text).join('\n');
    const referenceText = referenceGroup.join('\n');
    const kind: AlignmentRow['kind'] = transition.localCount === 0 ? 'add' : transition.referenceCount === 0 ? 'remove' : normalize(localText) === normalize(referenceText) ? 'equal' : 'change';
    rows.unshift({
      id: `${kind}-${localIds.join('-') || 'reference'}-${j}`,
      kind,
      localIds,
      localText,
      referenceText,
      chosenText: localText,
    });
    i = startI;
    j = startJ;
  }
  return rows;
}
