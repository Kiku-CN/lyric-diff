import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { fetchNeteaseLyric, searchNetease } from '../src/server/netease';

vi.mock('../src/server/netease', () => ({
  searchNetease: vi.fn(),
  fetchNeteaseLyric: vi.fn(),
  stripLyricTimestamps: (lyric: string) => lyric.split('\n').filter(Boolean),
}));

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('playlist mode controls', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.mocked(searchNetease).mockImplementation(async (query) => [{
      id: query === '歌A' ? 101 : 202,
      name: query,
      artists: '歌手',
      album: '专辑',
    }]);
    vi.mocked(fetchNeteaseLyric).mockImplementation(async (id) => id === 101 ? 'A1\nA2' : 'B1\nB2');
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('searches and fetches every playlist item in order', async () => {
    await act(async () => root.render(<App />));
    const source = '1\n00:00:01,000 --> 00:00:02,000\nA1\n\n2\n00:00:02,000 --> 00:00:03,000\nA2\n\n3\n00:00:03,000 --> 00:00:04,000\nB1\n\n4\n00:00:04,000 --> 00:00:05,000\nB2';
    await act(async () => setInputValue(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="剪映识别结果 SRT"]')!, source));
    await act(async () => container.querySelector<HTMLButtonElement>('.confirm-source')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('button[role="tab"][aria-label="歌单模式"]')!.click());
    await act(async () => setInputValue(container.querySelector<HTMLTextAreaElement>('#playlist')!, '歌A\n歌B'));
    await act(async () => container.querySelector<HTMLFormElement>('form.playlist-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

    expect(vi.mocked(searchNetease).mock.calls.map(([query]) => query)).toEqual(['歌A', '歌B']);
    expect(vi.mocked(fetchNeteaseLyric).mock.calls.map(([id]) => id)).toEqual([101, 202]);
    expect(Array.from(container.querySelectorAll('.diff-row .reference-line > span')).map((cell) => cell.textContent)).toEqual(['A1', 'A2', 'B1', 'B2']);
    expect(container.querySelectorAll('.playlist-track').length).toBe(2);
  });

  it('keeps normal search independent from the playlist textarea', async () => {
    await act(async () => root.render(<App />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[role="tab"][aria-label="歌单模式"]')!.click());
    await act(async () => setInputValue(container.querySelector<HTMLTextAreaElement>('#playlist')!, '歌单里的歌'));
    await act(async () => container.querySelector<HTMLButtonElement>('button[role="tab"][aria-label="普通模式"]')!.click());
    await act(async () => setInputValue(container.querySelector<HTMLInputElement>('#song-query')!, '手动搜索'));
    await act(async () => container.querySelector<HTMLFormElement>('form.search-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

    expect(vi.mocked(searchNetease)).toHaveBeenCalledWith('手动搜索');
    expect(vi.mocked(searchNetease)).not.toHaveBeenCalledWith('歌单里的歌');
  });

  it('keeps successful playlist tracks when one search fails', async () => {
    vi.mocked(searchNetease).mockImplementation(async (query) => {
      if (query === '失败歌') throw new Error('搜索失败');
      return [{ id: 101, name: '歌A', artists: '歌手', album: '专辑' }];
    });
    await act(async () => root.render(<App />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[role="tab"][aria-label="歌单模式"]')!.click());
    await act(async () => setInputValue(container.querySelector<HTMLTextAreaElement>('#playlist')!, '歌A\n失败歌'));
    await act(async () => container.querySelector<HTMLFormElement>('form.playlist-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

    expect(vi.mocked(fetchNeteaseLyric)).toHaveBeenCalledWith(101);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('1 首歌曲未能获取歌词');
    expect(Array.from(container.querySelectorAll('.reference-line > span')).map((line) => line.textContent)).toContain('A1');
    expect(container.querySelectorAll('.playlist-track').length).toBe(2);
  });
});
