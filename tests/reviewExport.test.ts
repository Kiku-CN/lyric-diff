import { describe, expect, it } from 'vitest';
import { alignSubtitles } from '../src/lib/alignment';
import { createExportEntries } from '../src/lib/reviewExport';
import { exportSrt, exportTxt, parseSubtitle } from '../src/lib/subtitles';

describe('review export', () => {
  const source = '1\n00:00:01,000 --> 00:00:03,000\n第一句\n\n2\n00:00:05,000 --> 00:00:07,000\n第二句';

  it('keeps all reference-only rows in TXT but only middle rows in SRT', () => {
    const entries = parseSubtitle(source, 'srt');
    const rows = alignSubtitles(entries, ['开场', '第一句', '中间新增', '第二句', '尾声']);
    expect(exportTxt(createExportEntries(entries, rows, 'txt'))).toBe('开场\n第一句\n中间新增\n第二句\n尾声\n');
    expect(exportSrt(createExportEntries(entries, rows, 'srt'))).toBe(
      '1\n00:00:01,000 --> 00:00:03,000\n第一句\n\n' +
      '2\n00:00:03,000 --> 00:00:05,000\n中间新增\n\n' +
      '3\n00:00:05,000 --> 00:00:07,000\n第二句\n',
    );
  });

  it('inserts multiple lyrics into a zero-gap interval without changing original times', () => {
    const entries = parseSubtitle(
      '1\n00:00:01,000 --> 00:00:03,000\n第一句\n\n2\n00:00:03,000 --> 00:00:05,000\n第二句',
      'srt',
    );
    const rows = alignSubtitles(entries, ['第一句', '插入甲', '插入乙', '第二句']);
    const output = createExportEntries(entries, rows, 'srt');
    expect(output.map(({ text, startMs, endMs }) => [text, startMs, endMs])).toEqual([
      ['第一句', 1000, 3000], ['插入甲', 1000, 2000], ['插入乙', 2000, 3000], ['第二句', 3000, 5000],
    ]);
  });

  it('falls back to a positive-duration overlap when both anchors start together', () => {
    const entries = parseSubtitle(
      '1\n00:00:03,000 --> 00:00:03,500\n第一句\n\n2\n00:00:03,000 --> 00:00:04,000\n第二句',
      'srt',
    );
    const rows = alignSubtitles(entries, ['第一句', '新增', '第二句']);
    const output = createExportEntries(entries, rows, 'srt');
    expect(output.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
      [3000, 3500], [3000, 3001], [3000, 4000],
    ]);
  });

  it('uses edited add-row text and omits it from both exports when cleared', () => {
    const entries = parseSubtitle(source, 'srt');
    const rows = alignSubtitles(entries, ['第一句', '新增', '第二句']);
    const addRow = rows.find((row) => row.kind === 'add')!;
    addRow.chosenText = '手动修订';
    expect(createExportEntries(entries, rows, 'srt')[1].text).toBe('手动修订');
    addRow.chosenText = '';
    expect(createExportEntries(entries, rows, 'srt').map((entry) => entry.text)).toEqual(['第一句', '第二句']);
    expect(exportTxt(createExportEntries(entries, rows, 'txt'))).toBe('第一句\n第二句\n');
  });
});
