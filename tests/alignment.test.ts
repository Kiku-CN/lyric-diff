import { describe, expect, it } from 'vitest';
import { alignSubtitles } from '../src/lib/alignment';

const local = (text: string, id: string) => ({ id, index: Number(id), text });

describe('lyric alignment', () => {
  it('marks changed words while keeping local line identity', () => {
    const rows = alignSubtitles([local('夜空中最亮的星', '1')], ['夜空中最亮的星星']);
    expect(rows[0]).toMatchObject({ kind: 'change', localIds: ['1'], chosenText: '夜空中最亮的星星' });
  });

  it('keeps repeated chorus and represents reference insertion', () => {
    const rows = alignSubtitles(
      [local('再见吧', '1'), local('再见吧', '2')],
      ['再见吧', '再见吧', '再见吧'],
      { algorithm: 'from-start', smartSegmentation: false },
    );
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.kind === 'add')).toHaveLength(1);
    expect(rows.filter((row) => row.localIds.length === 1)).toHaveLength(2);
  });

  it('groups multiple reference lines under one SRT baseline entry', () => {
    const rows = alignSubtitles([local('你好世界', '1')], ['你好', '世界']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'equal', localIds: ['1'], referenceText: '你好\n世界' });
  });

  it('keeps every SRT entry as a baseline row when reference lines are merged', () => {
    const rows = alignSubtitles([local('你好', '1'), local('世界', '2'), local('后来', '3')], ['你好世界', '后来'], { algorithm: 'from-start', smartSegmentation: false });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ kind: 'change', localIds: ['1'], referenceText: '你好世界' });
    expect(rows[1]).toMatchObject({ kind: 'remove', localIds: ['2'], referenceText: '' });
    expect(rows[2]).toMatchObject({ kind: 'equal', localIds: ['3'], referenceText: '后来' });
  });

  it('ignores singer markers when comparing lyric content', () => {
    const rows = alignSubtitles([local('拥抱的时候 心情有点痛', '1')], ['（孙）拥抱的时候 心情有点痛']);
    expect(rows[0]).toMatchObject({ kind: 'equal', localIds: ['1'] });
  });

  it('finds a partial chorus in the middle without attaching unrelated verses', () => {
    const rows = alignSubtitles(
      [local('副歌第一句', '1'), local('副歌第二句', '2')],
      ['开场', '主歌', '副歌第一句', '副歌第二句', '尾声'],
      { algorithm: 'fragment', smartSegmentation: false },
    );
    expect(rows.map((row) => row.referenceText)).toEqual(['开场', '主歌', '副歌第一句', '副歌第二句', '尾声']);
    expect(rows.map((row) => row.kind)).toEqual(['add', 'add', 'equal', 'equal', 'add']);
    expect(rows.filter((row) => row.kind === 'add').map((row) => row.includeInExport)).toEqual([false, false, false]);
  });

  it('keeps the from-start algorithm anchored to the beginning', () => {
    const rows = alignSubtitles(
      [local('副歌第一句', '1'), local('副歌第二句', '2')],
      ['开场', '主歌', '副歌第一句', '副歌第二句'],
      { algorithm: 'from-start', smartSegmentation: false },
    );
    expect(rows[0].referenceText).not.toBe('副歌第一句');
  });

  it.each(['fragment', 'from-start'] as const)('splits one reference line across SRT rows in %s mode', (algorithm) => {
    const rows = alignSubtitles(
      [local('我就住在月亮', '1'), local('笑容下面的小街道', '2')],
      ['我就住在月亮笑容下面的小街道'],
      { algorithm, smartSegmentation: true },
    );
    expect(rows.map((row) => row.referenceText)).toEqual(['我就住在月亮', '笑容下面的小街道']);
    expect(rows.map((row) => row.kind)).toEqual(['equal', 'equal']);
  });

  it('preserves every reference character when splitting corrected text', () => {
    const rows = alignSubtitles(
      [local('我就住在月亮', '1'), local('笑容下面的小街道', '2')],
      ['我就住在月亮，笑容下面的小街道'],
      { algorithm: 'fragment', smartSegmentation: true },
    );
    expect(rows.map((row) => row.referenceText).join('')).toBe('我就住在月亮，笑容下面的小街道');
    expect(rows[1].referenceText).toBe('笑容下面的小街道');
  });

  it('keeps a one-character recognition correction in its original SRT row', () => {
    const rows = alignSubtitles(
      [local('我就住在月亮', '1'), local('笑容下面的小街到', '2')],
      ['我就住在月亮笑容下面的小街道'],
      { algorithm: 'fragment', smartSegmentation: true },
    );
    expect(rows.map((row) => row.referenceText)).toEqual(['我就住在月亮', '笑容下面的小街道']);
  });

  it('leaves merged reference text on one row when smart segmentation is off in fragment mode', () => {
    const rows = alignSubtitles(
      [local('你好', '1'), local('世界', '2')], ['你好世界'],
      { algorithm: 'fragment', smartSegmentation: false },
    );
    expect(rows.filter((row) => row.referenceText)).toHaveLength(1);
  });

  it('keeps unmatched SRT rows and never borrows skipped reference verses', () => {
    const rows = alignSubtitles(
      [local('现场喊话', '1'), local('副歌', '2')],
      ['开场', '副歌', '尾声'],
      { algorithm: 'fragment', smartSegmentation: true },
    );
    expect(rows.map((row) => row.referenceText)).toEqual(['开场', '', '副歌', '尾声']);
    expect(rows[1].chosenText).toBe('现场喊话');
  });

  it('selects the best repeated chorus using the surrounding lines', () => {
    const rows = alignSubtitles(
      [local('副歌', '1'), local('结尾独唱', '2')],
      ['副歌', '前奏', '副歌', '结尾独唱'],
      { algorithm: 'fragment', smartSegmentation: false },
    );
    expect(rows.map((row) => row.referenceText)).toEqual(['副歌', '前奏', '副歌', '结尾独唱']);
    expect(rows.map((row) => row.kind)).toEqual(['add', 'add', 'equal', 'equal']);
  });

  it.each(['fragment', 'from-start'] as const)('retains an unmatched reference line between SRT entries in %s mode', (algorithm) => {
    const rows = alignSubtitles(
      [local('第一句', '1'), local('第二句', '2')],
      ['第一句', '没有唱到的句子', '第二句'],
      { algorithm, smartSegmentation: false },
    );
    expect(rows.map((row) => [row.kind, row.referenceText])).toEqual([
      ['equal', '第一句'], ['add', '没有唱到的句子'], ['equal', '第二句'],
    ]);
    expect(rows[1].localIds).toEqual([]);
    expect(rows[1].includeInExport).toBe(true);
  });

  it('retains unmatched lines even when no SRT line matches', () => {
    const rows = alignSubtitles([local('现场说话', '1')], ['完全不同', '另一句']);
    expect(rows.filter((row) => row.kind === 'add').map((row) => row.referenceText)).toEqual(['完全不同', '另一句']);
    expect(rows.find((row) => row.localIds[0] === '1')?.chosenText).toBe('现场说话');
  });

  it('retains reference lyrics when the imported subtitle is empty', () => {
    const rows = alignSubtitles([], ['第一句', '第二句']);
    expect(rows.map((row) => [row.kind, row.referenceText])).toEqual([
      ['add', '第一句'], ['add', '第二句'],
    ]);
  });

  it.each(['fragment', 'from-start'] as const)('keeps a short extra reference line separate from an exact match in %s mode', (algorithm) => {
    const rows = alignSubtitles(
      [local('这是很长很长的一句', '1'), local('下一句', '2')],
      ['这是很长很长的一句', '啊', '下一句'],
      { algorithm, smartSegmentation: false },
    );
    expect(rows.map((row) => [row.kind, row.referenceText])).toEqual([
      ['equal', '这是很长很长的一句'], ['add', '啊'], ['equal', '下一句'],
    ]);
  });
});
