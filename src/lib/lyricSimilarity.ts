export function normalize(text: string): string {
  return text
    .replace(/^[（(][^）)]{1,8}[）)]\s*/u, '')
    .replace(/^[^:：]{1,4}[:：]\s*$/u, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .toLowerCase();
}

export function editDistance(left: string, right: string): number {
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
