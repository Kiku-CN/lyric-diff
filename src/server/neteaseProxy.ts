const FALLBACK_UPSTREAMS = [
  'https://music.163.com',
  'https://netease-cloud-music-wheat.vercel.app',
  'https://ezmusic-api.vercel.app',
  'https://ncm.zhenxin.me',
  'https://music.mcseekeri.com',
];

function toUpstreamUrl(base: string, pathname: string, search: string): string {
  if (pathname === '/lyric/v1' && base !== 'https://music.163.com') {
    return `${base}/lyric/new${search}`;
  }
  if (base === 'https://music.163.com') {
    const params = new URLSearchParams(search);
    if (pathname === '/search') {
      return `${base}/api/search/get/web?s=${encodeURIComponent(params.get('keywords') ?? '')}&limit=${params.get('limit') ?? '8'}&offset=0&type=1`;
    }
    if (pathname === '/lyric') {
      return `${base}/api/song/lyric?id=${encodeURIComponent(params.get('id') ?? '')}&lv=1&kv=1&tv=-1`;
    }
    if (pathname === '/lyric/v1') {
      return `${base}/api/song/lyric/v1?id=${encodeURIComponent(params.get('id') ?? '')}&cp=false&lv=0&tv=0&rv=0&kv=0&yv=0&ytv=0&yrv=0`;
    }
  }
  return `${base}${pathname}${search}`;
}

export function buildNeteaseUpstreamUrls(pathname: string, search: string, primary = 'https://netease-cloud-music-api.vercel.app'): string[] {
  return [primary, ...FALLBACK_UPSTREAMS].filter((base, index, bases) => bases.indexOf(base) === index).map((base) => toUpstreamUrl(base, pathname, search));
}

export function getNeteaseUpstreams(): string[] {
  const configured = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.NETEASE_API_BASE_URL;
  return configured ? [configured] : FALLBACK_UPSTREAMS;
}
