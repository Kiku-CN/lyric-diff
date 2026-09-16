import { describe, expect, it } from 'vitest';
import { exportSrt, exportTxt, parseSubtitle } from '../src/lib/subtitles';

describe('subtitle parsing', () => {
  it('parses SRT timing and preserves multiline text', () => {
    const entries = parseSubtitle(
      '1\n00:00:01,200 --> 00:00:03,500\n第一句\n第二句\n\n2\n00:00:04,000 --> 00:00:05,000\n下一句',
      'srt',
    );

    expect(entries).toEqual([
      { id: '1', index: 1, startMs: 1200, endMs: 3500, text: '第一句\n第二句' },
      { id: '2', index: 2, startMs: 4000, endMs: 5000, text: '下一句' },
    ]);
  });

  it('treats TXT as one entry per non-empty line and exports it', () => {
    const entries = parseSubtitle('  一句  \n\n第二句\n', 'txt');
    expect(entries.map((entry) => entry.text)).toEqual(['一句', '第二句']);
    expect(exportTxt(entries)).toBe('一句\n第二句\n');
  });

  it('exports SRT with original timing', () => {
    const entries = parseSubtitle('1\n00:00:01,200 --> 00:00:03,500\n一句', 'srt');
    expect(exportSrt(entries)).toBe('1\n00:00:01,200 --> 00:00:03,500\n一句\n');
  });

  it('rejects a non-empty malformed SRT block instead of dropping it', () => {
    expect(() => parseSubtitle(
      '1\n00:00:01,000 --> 00:00:02,000\n有效\n\n损坏段落',
      'srt',
    )).toThrow('格式错误');
  });
});
