import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchNeteaseLyric, stripLyricTimestamps } from '../src/server/netease';

describe('netease lyrics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the ordinary lyric when it is available', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ lrc: { lyric: '[00:01.00]普通歌词' } }), { status: 200 }),
    );

    await expect(fetchNeteaseLyric(17)).resolves.toBe('[00:01.00]普通歌词');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/netease/lyric?id=17');
  });

  it('falls back to yrc when the ordinary lyric is empty', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ yrc: { lyric: '[100,200](100,80,0)逐(180,80,0)字歌词' } }), { status: 200 }));

    await expect(fetchNeteaseLyric(1824020871)).resolves.toBe('[100,200](100,80,0)逐(180,80,0)字歌词');
    expect(fetchMock).toHaveBeenCalledWith('/api/netease/lyric/v1?id=1824020871');
  });

  it('strips metadata, line timestamps, and per-word timestamps from yrc lyrics', () => {
    const metadata = '{"t":0,"c":[{"tx":"作词: "},{"tx":"歌手"}]}';
    expect(stripLyricTimestamps(`${metadata}\n[100,200](100,80,0)逐(180,80,0)字歌词\n[300,400]下一句`)).toEqual(['逐字歌词', '下一句']);
  });
});
