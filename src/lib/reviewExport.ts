import type { AlignmentRow } from './alignment';
import type { SubtitleEntry } from './subtitles';

export function createExportEntries(entries: SubtitleEntry[], rows: AlignmentRow[], format: 'srt' | 'txt'): SubtitleEntry[] {
  if (rows.length === 0) return entries;
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const result: SubtitleEntry[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.localIds.length === 1) {
      const entry = byId.get(row.localIds[0]);
      if (entry) result.push({ ...entry, text: row.chosenText });
      continue;
    }
    if (row.kind !== 'add' || !row.chosenText.trim()) continue;
    if (format === 'txt') {
      result.push({ id: row.id, index: result.length + 1, text: row.chosenText });
      continue;
    }

    const start = index;
    while (index + 1 < rows.length && rows[index + 1].kind === 'add') index += 1;
    const additions = rows.slice(start, index + 1).filter((item) => item.chosenText.trim());
    const previous = rows.slice(0, start).reverse().find((item) => item.localIds.length === 1);
    const next = rows.slice(index + 1).find((item) => item.localIds.length === 1);
    const before = previous && byId.get(previous.localIds[0]);
    const after = next && byId.get(next.localIds[0]);
    if (before?.startMs === undefined || before.endMs === undefined || after?.startMs === undefined) continue;

    const gapStart = before.endMs;
    const gapEnd = after.startMs;
    const intervalStart = gapEnd > gapStart ? gapStart : before.startMs < gapEnd ? before.startMs : gapEnd;
    const intervalEnd = gapEnd > intervalStart ? gapEnd : intervalStart + additions.length;
    const span = intervalEnd - intervalStart;
    additions.forEach((item, offset) => {
      const startMs = intervalStart + Math.floor(span * offset / additions.length);
      const endMs = Math.max(startMs + 1, intervalStart + Math.floor(span * (offset + 1) / additions.length));
      result.push({ id: item.id, index: result.length + 1, startMs, endMs, text: item.chosenText });
    });
  }
  return result;
}
