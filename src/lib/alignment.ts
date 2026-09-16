import type { SubtitleEntry } from './subtitles';
import { matchingAlgorithms, type MatchingAlgorithm } from './matchingAlgorithms';
import { editDistance, normalize } from './lyricSimilarity';
import { splitReferenceLine } from './smartSegmentation';

export type AlignmentRow = {
  id: string;
  kind: 'equal' | 'change' | 'add' | 'remove';
  localIds: string[];
  localText: string;
  referenceText: string;
  chosenText: string;
  includeInExport: boolean;
};

const REFERENCE_GROUP_LIMIT = 4;
const LOCAL_GROUP_LIMIT = 3;

export type AlignmentOptions = {
  algorithm: MatchingAlgorithm;
  smartSegmentation: boolean;
};

function groupCost(localText: string, referenceTexts: string[]): number {
  if (referenceTexts.length === 0) return 0.92;
  const local = normalize(localText);
  const reference = normalize(referenceTexts.join(''));
  const denominator = Math.max(local.length, reference.length, 1);
  const distance = editDistance(local, reference) / denominator;
  const lineCountPenalty = Math.max(referenceTexts.length - 1, 0) * 0.06;
  const extraLinePenalty = referenceTexts.length > 1 && referenceTexts.some((line) => normalize(line) === local) ? 0.35 : 0;
  return distance + lineCountPenalty + extraLinePenalty;
}

type Transition = { kind: 'match'; referenceCount: number; localCount: number; parts?: string[] } | { kind: 'add' };

type Assignment = { localIndex: number; referenceGroup: string[] } | { referenceIndex: number };

function referenceOnlyRow(referenceText: string, index: number): AlignmentRow {
  return { id: `add-reference-${index}`, kind: 'add', localIds: [], localText: '', referenceText, chosenText: referenceText, includeInExport: false };
}

export function alignSubtitles(local: SubtitleEntry[], referenceLines: string[], options: AlignmentOptions = { algorithm: 'fragment', smartSegmentation: false }): AlignmentRow[] {
  if (local.length === 0) return referenceLines.map(referenceOnlyRow);
  const strategy = matchingAlgorithms[options.algorithm];
  const scores = Array.from({ length: local.length + 1 }, () => Array<number>(referenceLines.length + 1).fill(Number.POSITIVE_INFINITY));
  const transitions = Array.from({ length: local.length + 1 }, () => Array<Transition | undefined>(referenceLines.length + 1).fill(undefined));
  for (let j = 0; j <= referenceLines.length; j += 1) scores[0][j] = strategy.initialCost(j);

  for (let i = 0; i < local.length; i += 1) {
    for (let j = 0; j <= referenceLines.length; j += 1) {
      if (!Number.isFinite(scores[i][j])) continue;
      if (j < referenceLines.length && scores[i][j] + 0.35 < scores[i][j + 1]) {
        scores[i][j + 1] = scores[i][j] + 0.35;
        transitions[i][j + 1] = { kind: 'add' };
      }
      for (let referenceCount = 0; referenceCount <= REFERENCE_GROUP_LIMIT && j + referenceCount <= referenceLines.length; referenceCount += 1) {
        const cost = groupCost(local[i].text, referenceLines.slice(j, j + referenceCount));
        const weakMatchPenalty = options.algorithm === 'fragment' && referenceCount > 0 && cost >= 0.7 ? 0.25 : 0;
        const candidate = scores[i][j] + cost + weakMatchPenalty + (referenceCount > 0 ? i * 0.000001 : 0);
        if (candidate < scores[i + 1][j + referenceCount]) {
          scores[i + 1][j + referenceCount] = candidate;
          transitions[i + 1][j + referenceCount] = { kind: 'match', referenceCount, localCount: 1 };
        }
      }
      if (options.smartSegmentation && j < referenceLines.length) {
        for (let localCount = 2; localCount <= LOCAL_GROUP_LIMIT && i + localCount <= local.length; localCount += 1) {
          const localTexts = local.slice(i, i + localCount).map((entry) => entry.text);
          const combinedCost = groupCost(localTexts.join(''), [referenceLines[j]]);
          if (combinedCost >= 0.55 || Array.from(referenceLines[j]).length < localCount) continue;
          const parts = splitReferenceLine(referenceLines[j], localTexts);
          const segmentCosts = parts.map((part, index) => {
            const left = normalize(localTexts[index]);
            const right = normalize(part);
            return editDistance(left, right) / Math.max(left.length, right.length, 1);
          });
          if (segmentCosts.some((cost) => cost >= 0.65)) continue;
          const candidate = scores[i][j] + combinedCost + segmentCosts.reduce((sum, cost) => sum + cost, 0) * 0.2 + (localCount - 1) * 0.08;
          if (candidate < scores[i + localCount][j + 1]) {
            scores[i + localCount][j + 1] = candidate;
            transitions[i + localCount][j + 1] = { kind: 'match', referenceCount: 1, localCount, parts };
          }
        }
      }
    }
  }

  let endReferenceIndex = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let j = 0; j <= referenceLines.length; j += 1) {
    const candidate = scores[local.length][j] + strategy.trailingCost(referenceLines.length - j);
    if (candidate < bestScore) {
      bestScore = candidate;
      endReferenceIndex = j;
    }
  }

  const reversed: Assignment[] = [];
  let i = local.length;
  let j = endReferenceIndex;
  while (i > 0) {
    const transition = transitions[i][j];
    if (!transition) {
      reversed.push({ localIndex: i - 1, referenceGroup: [] });
      i -= 1;
      continue;
    }
    if (transition.kind === 'add') {
      reversed.push({ referenceIndex: j - 1 });
      j -= 1;
      continue;
    }
    const startJ = j - transition.referenceCount;
    if (transition.localCount > 1) {
      const parts = transition.parts!;
      for (let part = parts.length - 1; part >= 0; part -= 1) reversed.push({ localIndex: i - transition.localCount + part, referenceGroup: [parts[part]] });
    } else {
      reversed.push({ localIndex: i - 1, referenceGroup: referenceLines.slice(startJ, j) });
    }
    i -= transition.localCount;
    j = startJ;
  }

  for (let index = j - 1; index >= 0; index -= 1) reversed.push({ referenceIndex: index });
  const assignments = reversed.reverse();
  for (let index = endReferenceIndex; index < referenceLines.length; index += 1) assignments.push({ referenceIndex: index });

  const rows = assignments.map((assignment) => {
    if ('referenceIndex' in assignment) {
      return referenceOnlyRow(referenceLines[assignment.referenceIndex], assignment.referenceIndex);
    }
    const { localIndex, referenceGroup } = assignment;
    const entry = local[localIndex];
    const referenceText = referenceGroup.join('\n');
    const kind: AlignmentRow['kind'] = referenceGroup.length === 0
      ? 'remove'
      : normalize(entry.text) === normalize(referenceText) ? 'equal' : 'change';
    return {
      id: `${kind}-${entry.id}-${localIndex}`,
      kind,
      localIds: [entry.id],
      localText: entry.text,
      referenceText,
      chosenText: referenceText || entry.text,
      includeInExport: true,
    };
  });
  const lastLocalIndex = rows.reduce((last, row, index) => row.localIds.length === 1 ? index : last, -1);
  let hasPreviousLocal = false;
  rows.forEach((row, index) => {
    if (row.kind === 'add') row.includeInExport = hasPreviousLocal && index < lastLocalIndex;
    else hasPreviousLocal = true;
  });
  return rows;
}
