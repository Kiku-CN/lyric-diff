import { describe, expect, it } from 'vitest';
import { alignSubtitles } from '../src/lib/alignment';

const local = (text: string, id: string) => ({ id, index: Number(id), text });

describe('lyric alignment', () => {
  it('marks changed words while keeping local line identity', () => {
    const rows = alignSubtitles([local('夜空中最亮的星', '1')], ['夜空中最亮的星星']);
    expect(rows[0]).toMatchObject({ kind: 'change', localIds: ['1'], chosenText: '夜空中最亮的星' });
  });

  it('keeps repeated chorus and represents reference insertion', () => {
    const rows = alignSubtitles(
      [local('再见吧', '1'), local('再见吧', '2')],
      ['再见吧', '再见吧', '再见吧'],
    );
    expect(rows.filter((row) => row.kind === 'equal')).toHaveLength(2);
    expect(rows.some((row) => row.kind === 'add' && row.referenceText === '再见吧')).toBe(true);
  });

  it('groups multiple reference lines under one SRT baseline entry', () => {
    const rows = alignSubtitles([local('你好世界', '1')], ['你好', '世界']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'equal', localIds: ['1'], referenceText: '你好\n世界' });
  });

  it('groups multiple SRT entries against one reference line without shifting later rows', () => {
    const rows = alignSubtitles([local('你好', '1'), local('世界', '2'), local('后来', '3')], ['你好世界', '后来']);
    expect(rows[0]).toMatchObject({ kind: 'equal', localIds: ['1', '2'], localText: '你好\n世界', referenceText: '你好世界' });
    expect(rows[1]).toMatchObject({ kind: 'equal', localIds: ['3'], referenceText: '后来' });
  });
});
