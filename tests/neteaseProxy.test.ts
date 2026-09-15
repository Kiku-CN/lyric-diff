import { describe, expect, it } from 'vitest';
import { buildNeteaseUpstreamUrls } from '../src/server/neteaseProxy';

describe('netease proxy upstreams', () => {
  it('builds a primary and fallback URL while preserving the query', () => {
    expect(buildNeteaseUpstreamUrls('/search', '?keywords=%E5%8E%9F%E7%82%B9&limit=8', 'https://primary.example')).toEqual([
      'https://primary.example/search?keywords=%E5%8E%9F%E7%82%B9&limit=8',
      'https://music.163.com/api/search/get/web?s=%E5%8E%9F%E7%82%B9&limit=8&offset=0&type=1',
      'https://netease-cloud-music-wheat.vercel.app/search?keywords=%E5%8E%9F%E7%82%B9&limit=8',
      'https://ezmusic-api.vercel.app/search?keywords=%E5%8E%9F%E7%82%B9&limit=8',
      'https://ncm.zhenxin.me/search?keywords=%E5%8E%9F%E7%82%B9&limit=8',
      'https://music.mcseekeri.com/search?keywords=%E5%8E%9F%E7%82%B9&limit=8',
    ]);
  });

  it('maps the local search contract to the official NetEase endpoint', () => {
    expect(buildNeteaseUpstreamUrls('/search', '?keywords=%E5%8E%9F%E7%82%B9&limit=8', 'https://music.163.com')[0]).toBe(
      'https://music.163.com/api/search/get/web?s=%E5%8E%9F%E7%82%B9&limit=8&offset=0&type=1',
    );
  });
});
