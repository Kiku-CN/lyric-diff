import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { buildNeteaseUpstreamUrls, getNeteaseUpstreams } from './src/server/neteaseProxy';

async function proxyNeteaseRequest(pathname: string, search: string): Promise<{ status: number; body: string; contentType: string }> {
  const primary = getNeteaseUpstreams()[0];
  const upstreams = buildNeteaseUpstreamUrls(pathname, search, primary);
  const errors: string[] = [];
  for (const url of upstreams) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json',
          referer: 'https://music.163.com/',
          'user-agent': 'Mozilla/5.0 Lyric-CoCorrect/0.1',
        },
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) {
        errors.push(`${response.status} ${url}`);
        continue;
      }
      return { status: 200, body: await response.text(), contentType: response.headers.get('content-type') ?? 'application/json' };
    } catch (error) {
      errors.push(`${error instanceof Error ? error.message : '网络错误'} ${url}`);
    }
  }
  return { status: 503, body: JSON.stringify({ error: '网易云歌词服务暂时不可用', details: errors }), contentType: 'application/json' };
}

function neteaseProxyPlugin(): Plugin {
  return {
    name: 'netease-fallback-proxy',
    configureServer(server) {
      server.middlewares.use('/api/netease', async (request, response, next) => {
        const requestPath = (request as { url?: string }).url;
        if (!requestPath) {
          next();
          return;
        }
        const requestUrl = new URL(requestPath, 'http://localhost');
        const result = await proxyNeteaseRequest(requestUrl.pathname, requestUrl.search);
        response.statusCode = result.status;
        response.setHeader('content-type', result.contentType);
        response.end(result.body);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), neteaseProxyPlugin()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
  },
});
