import { describe, expect, it } from 'vitest';
import { alignPlaylist, type PlaylistTrackReference } from '../src/lib/playlistMatching';

const local = (text: string, id: string) => ({ id, index: Number(id), text });

const tracks: PlaylistTrackReference[] = [
  { id: 'song-a', name: '第一首', artists: '甲', lines: ['第一句', '第二句'] },
  { id: 'song-b', name: '第二首', artists: '乙', lines: ['第三句', '第四句'] },
];

describe('playlist lyric matching', () => {
  it('matches tracks in playlist order and annotates each row with its track', () => {
    const rows = alignPlaylist([
      local('第一句', '1'),
      local('第二句', '2'),
      local('第三句', '3'),
      local('第四句', '4'),
    ], tracks);

    expect(rows.map((row) => row.referenceText)).toEqual(['第一句', '第二句', '第三句', '第四句']);
    expect(rows.map((row) => row.trackIndex)).toEqual([0, 0, 1, 1]);
  });

  it('does not merge reference lines across two playlist tracks', () => {
    const rows = alignPlaylist([local('第一句第二句', '1')], [
      { id: 'song-a', name: '第一首', artists: '甲', lines: ['第一句'] },
      { id: 'song-b', name: '第二首', artists: '乙', lines: ['第二句'] },
    ]);

    expect(rows.some((row) => row.referenceText.includes('\n'))).toBe(false);
    expect(rows.filter((row) => row.trackIndex === 0)).toHaveLength(1);
    expect(rows.filter((row) => row.trackIndex === 1)).toHaveLength(1);
  });

  it('keeps local-only rows when a playlist track has no lyric lines', () => {
    const rows = alignPlaylist([
      local('第一句', '1'),
      local('现场串场', '2'),
      local('第三句', '3'),
    ], [
      tracks[0],
      { id: 'song-empty', name: '无歌词', artists: '丙', lines: [] },
      { id: 'song-c', name: '第三首', artists: '丁', lines: ['第三句'] },
    ]);

    expect(rows.find((row) => row.localText === '现场串场')).toMatchObject({ kind: 'remove' });
    expect(rows.find((row) => row.localText === '第三句')).toMatchObject({ trackIndex: 2, kind: 'equal' });
  });

  it('keeps spoken interludes with the surrounding ordered song segments', () => {
    const rows = alignPlaylist([
      local('开场串场', '1'),
      local('第一句', '2'),
      local('第二句', '3'),
      local('现场互动', '4'),
      local('第三句', '5'),
      local('第四句', '6'),
      local('谢幕串场', '7'),
    ], tracks);

    expect(rows.filter((row) => row.trackIndex === 0).map((row) => row.localText)).toEqual(['开场串场', '第一句', '第二句', '现场互动']);
    expect(rows.filter((row) => row.trackIndex === 1).map((row) => row.localText)).toEqual(['第三句', '第四句', '谢幕串场']);
  });
});
