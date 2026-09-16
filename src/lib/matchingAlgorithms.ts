export type MatchingAlgorithm = 'fragment' | 'from-start';

export type MatchingStrategy = {
  initialCost: (referenceIndex: number) => number;
  trailingCost: (remainingLines: number) => number;
};

export const matchingAlgorithms: Record<MatchingAlgorithm, MatchingStrategy> = {
  fragment: {
    initialCost: () => 0,
    trailingCost: () => 0,
  },
  'from-start': {
    initialCost: (referenceIndex) => referenceIndex === 0 ? 0 : Number.POSITIVE_INFINITY,
    trailingCost: (remainingLines) => remainingLines * 0.92,
  },
};
