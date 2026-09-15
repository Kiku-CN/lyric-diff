export type NeteaseSong = {
  id: number;
  name: string;
  artists: string;
  album: string;
};

export class NeteaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NeteaseError';
  }
}

type SearchResponse = { result?: { songs?: Array<{ id: number; name: string; artists?: Array<{ name: string }>; album?: { name: string } }> } };
type LyricResponse = { lrc?: { lyric?: string } };

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new NeteaseError(`网易云请求失败（${response.status}）`);
  return response.json() as Promise<T>;
}

export async function searchNetease(query: string): Promise<NeteaseSong[]> {
  if (!query.trim()) return [];
  try {
    const data = await getJson<SearchResponse>(`/api/netease/search?keywords=${encodeURIComponent(query)}&limit=8`);
    return (data.result?.songs ?? []).map((song) => ({
      id: song.id,
      name: song.name,
      artists: (song.artists ?? []).map((artist) => artist.name).join(' / '),
      album: song.album?.name ?? '',
    }));
  } catch (error) {
    if (error instanceof NeteaseError) throw error;
    throw new NeteaseError('无法连接网易云歌词服务');
  }
}

export async function fetchNeteaseLyric(songId: number): Promise<string> {
  try {
    const data = await getJson<LyricResponse>(`/api/netease/lyric?id=${songId}`);
    return data.lrc?.lyric ?? '';
  } catch (error) {
    if (error instanceof NeteaseError) throw error;
    throw new NeteaseError('无法获取这首歌的歌词');
  }
}

export function stripLyricTimestamps(lyric: string): string[] {
  return lyric.split(/\r?\n/).map((line) => line.replace(/\[[0-9:.]+\]/g, '').trim()).filter(Boolean);
}
