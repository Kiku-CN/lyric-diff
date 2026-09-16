import { describe, expect, it } from 'vitest';
import { alignSubtitles } from '../src/lib/alignment';
import { createExportEntries } from '../src/lib/reviewExport';
import { exportSrt, exportTxt, parseSubtitle } from '../src/lib/subtitles';

describe('review export', () => {
  const source = '1\n00:00:01,000 --> 00:00:03,000\n第一句\n\n2\n00:00:05,000 --> 00:00:07,000\n第二句';

  it('exports only default-selected middle additions to TXT and SRT', () => {
    const entries = parseSubtitle(source, 'srt');
    const rows = alignSubtitles(entries, ['开场', '第一句', '中间新增', '第二句', '尾声']);
    expect(rows.filter((row) => row.kind === 'add').map((row) => row.includeInExport)).toEqual([false, true, false]);
    expect(exportTxt(createExportEntries(entries, rows, 'txt'))).toBe('第一句\n中间新增\n第二句\n');
    expect(exportSrt(createExportEntries(entries, rows, 'srt'))).toBe(
      '1\n00:00:01,000 --> 00:00:03,000\n第一句\n\n' +
      '2\n00:00:03,000 --> 00:00:05,000\n中间新增\n\n' +
      '3\n00:00:05,000 --> 00:00:07,000\n第二句\n',
    );
  });

  it('exports manually selected leading and trailing lines with inferred SRT times', () => {
    const entries = parseSubtitle(source, 'srt');
    const rows = alignSubtitles(entries, ['开场', '第一句', '第二句', '尾声']);
    rows.filter((row) => row.kind === 'add').forEach((row) => { row.includeInExport = true; });
    expect(exportTxt(createExportEntries(entries, rows, 'txt'))).toBe('开场\n第一句\n第二句\n尾声\n');
    expect(createExportEntries(entries, rows, 'srt').map(({ text, startMs, endMs }) => [text, startMs, endMs])).toEqual([
      ['开场', 1000, 3000], ['第一句', 1000, 3000], ['第二句', 5000, 7000], ['尾声', 7000, 9000],
    ]);
  });

  it('places multiple leading lines before the first subtitle when enough time exists', () => {
    const entries = parseSubtitle(
      '1\n00:00:05,000 --> 00:00:07,000\n第一句\n\n2\n00:00:08,000 --> 00:00:10,000\n第二句',
      'srt',
    );
    const rows = alignSubtitles(entries, ['片头甲', '片头乙', '第一句', '第二句']);
    rows.filter((row) => row.kind === 'add').forEach((row) => { row.includeInExport = true; });
    expect(createExportEntries(entries, rows, 'srt').map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
      [1000, 3000], [3000, 5000], [5000, 7000], [8000, 10000],
    ]);
  });

  it('omits unchecked lyrics within a consecutive added group', () => {
    const entries = parseSubtitle(source, 'srt');
    const rows = alignSubtitles(entries, ['第一句', '插入甲', '插入乙', '第二句']);
    rows.find((row) => row.chosenText === '插入乙')!.includeInExport = false;
    expect(createExportEntries(entries, rows, 'srt').map(({ text, startMs, endMs }) => [text, startMs, endMs])).toEqual([
      ['第一句', 1000, 3000], ['插入甲', 3000, 5000], ['第二句', 5000, 7000],
    ]);
  });

  it('does not invent SRT timestamps when no original timed subtitle exists', () => {
    const entries = parseSubtitle('现场一句', 'txt');
    const rows = alignSubtitles(entries, ['参考片头', '现场一句']);
    rows[0].includeInExport = true;
    expect(createExportEntries(entries, rows, 'srt')).toEqual(entries);
    expect(exportTxt(createExportEntries(entries, rows, 'txt'))).toBe('参考片头\n现场一句\n');
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
    addRow.includeInExport = false;
    expect(createExportEntries(entries, rows, 'srt').map((entry) => entry.text)).toEqual(['第一句', '第二句']);
    expect(exportTxt(createExportEntries(entries, rows, 'txt'))).toBe('第一句\n第二句\n');
    addRow.includeInExport = true;
    addRow.chosenText = '';
    expect(createExportEntries(entries, rows, 'srt').map((entry) => entry.text)).toEqual(['第一句', '第二句']);
    expect(exportTxt(createExportEntries(entries, rows, 'txt'))).toBe('第一句\n第二句\n');
  });
});
