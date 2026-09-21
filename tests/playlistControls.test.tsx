import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { PlaylistMatchPanel } from '../src/App';
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function createAudioFile() {
  return new File(['audio'], '现场.mp3', { type: 'audio/mpeg' });
}

function selectFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('playlist mode controls', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:audio') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
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
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('keeps playlist typing local until the form is submitted', async () => {
    const onSubmit = vi.fn();
    await act(async () => root.render(<PlaylistMatchPanel initialValue="" isMatchingPlaylist={false} playlistTracks={[]} onDraftChange={vi.fn()} onSubmit={onSubmit} onChooseSong={vi.fn()} onRetryTrack={vi.fn()} />));

    await act(async () => setInputValue(container.querySelector<HTMLTextAreaElement>('#playlist')!, '歌A\n歌B'));
    expect(onSubmit).not.toHaveBeenCalled();

    await act(async () => container.querySelector<HTMLFormElement>('form.playlist-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

    expect(onSubmit).toHaveBeenCalledWith('歌A\n歌B');
  });

  it('shows each successful search immediately but waits for all searches before fetching lyrics', async () => {
    const secondSearch = deferred<Awaited<ReturnType<typeof searchNetease>>>();
    vi.mocked(searchNetease).mockImplementation(async (query) => query === '歌A'
      ? [{ id: 101, name: '歌A候选', artists: '歌手A', album: '专辑A' }]
      : secondSearch.promise);
    await act(async () => root.render(<App />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[role="tab"][aria-label="歌单模式"]')!.click());
    await act(async () => setInputValue(container.querySelector<HTMLTextAreaElement>('#playlist')!, '歌A\n歌B'));
    await act(async () => container.querySelector<HTMLFormElement>('form.playlist-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });

    expect(container.textContent).toContain('歌A候选 · 歌手A');
    expect(container.textContent).toContain('已找到 1 个候选，等待其它歌曲搜索');
    expect(vi.mocked(fetchNeteaseLyric)).not.toHaveBeenCalled();

    secondSearch.resolve([{ id: 202, name: '歌B候选', artists: '歌手B', album: '专辑B' }]);
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(vi.mocked(fetchNeteaseLyric)).toHaveBeenCalledTimes(2);
  });

  it('keeps a candidate change behind the all-searches barrier', async () => {
    const secondSearch = deferred<Awaited<ReturnType<typeof searchNetease>>>();
    vi.mocked(searchNetease).mockImplementation(async (query) => query === '歌A'
      ? [
        { id: 101, name: '歌A候选一', artists: '歌手A', album: '专辑A' },
        { id: 111, name: '歌A候选二', artists: '歌手A', album: '专辑A' },
      ]
      : secondSearch.promise);
    await act(async () => root.render(<App />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[role="tab"][aria-label="歌单模式"]')!.click());
    await act(async () => setInputValue(container.querySelector<HTMLTextAreaElement>('#playlist')!, '歌A\n歌B'));
    await act(async () => container.querySelector<HTMLFormElement>('form.playlist-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    const candidateSelect = container.querySelector<HTMLSelectElement>('select[aria-label="选择第 1 首歌曲"]')!;
    await act(async () => {
      candidateSelect.value = '111';
      candidateSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    expect(vi.mocked(fetchNeteaseLyric)).not.toHaveBeenCalled();

    secondSearch.resolve([{ id: 202, name: '歌B候选', artists: '歌手B', album: '专辑B' }]);
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(vi.mocked(fetchNeteaseLyric)).toHaveBeenCalledWith(111);
  });

  it('searches and fetches every playlist item in order', async () => {
    await act(async () => root.render(<App />));
    const source = '1\n00:00:01,000 --> 00:00:02,000\nA1\n\n2\n00:00:02,000 --> 00:00:03,000\nA2\n\n3\n00:00:03,000 --> 00:00:04,000\nB1\n\n4\n00:00:04,000 --> 00:00:05,000\nB2';
    await act(async () => setInputValue(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="剪映识别结果 SRT"]')!, source));
    await act(async () => container.querySelector<HTMLButtonElement>('.confirm-source')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('button[role="tab"][aria-label="歌单模式"]')!.click());
    await act(async () => setInputValue(container.querySelector<HTMLTextAreaElement>('#playlist')!, '歌A\n歌B'));
    await act(async () => container.querySelector<HTMLFormElement>('form.playlist-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(vi.mocked(searchNetease).mock.calls.map(([query]) => query)).toEqual(['歌A', '歌B']);
    expect(vi.mocked(fetchNeteaseLyric).mock.calls.map(([id]) => id)).toEqual([101, 202]);
    expect(Array.from(container.querySelectorAll('.diff-row .reference-line > span')).map((cell) => cell.textContent)).toEqual(['A1', 'A2', 'B1', 'B2']);
    expect(container.querySelectorAll('.playlist-track').length).toBe(2);
  });

  it('shows a song outline and jumps to the selected song section', async () => {
    const source = '1\n00:00:01,000 --> 00:00:02,000\nA1\n\n2\n00:00:02,000 --> 00:00:03,000\nA2\n\n3\n00:00:03,000 --> 00:00:04,000\nB1\n\n4\n00:00:04,000 --> 00:00:05,000\nB2';
    await act(async () => root.render(<App />));
    await act(async () => setInputValue(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="剪映识别结果 SRT"]')!, source));
    await act(async () => container.querySelector<HTMLButtonElement>('.confirm-source')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('button[role="tab"][aria-label="歌单模式"]')!.click());
    await act(async () => setInputValue(container.querySelector<HTMLTextAreaElement>('#playlist')!, '歌A\n歌B'));
    await act(async () => container.querySelector<HTMLFormElement>('form.playlist-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await act(async () => { await vi.runAllTimersAsync(); });

    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    const outlineToggle = container.querySelector<HTMLButtonElement>('.review-outline-toggle')!;
    expect(outlineToggle.getAttribute('aria-expanded')).toBe('false');
    await act(async () => outlineToggle.click());
    expect(outlineToggle.getAttribute('aria-expanded')).toBe('true');
    const outlineButtons = container.querySelectorAll<HTMLButtonElement>('.review-outline-song');
    expect(outlineButtons).toHaveLength(2);
    expect(outlineButtons[0].textContent).toContain('歌A');

    await act(async () => outlineButtons[1].click());

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(container.querySelector('[data-track-index="1"]')).not.toBeNull();

    await act(async () => outlineToggle.click());
    expect(outlineToggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('marks the song containing the current audio row in the outline', async () => {
    const source = '1\n00:00:01,000 --> 00:00:02,000\nA1\n\n2\n00:00:03,000 --> 00:00:04,000\nB1';
    await act(async () => root.render(<App />));
    await act(async () => setInputValue(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="剪映识别结果 SRT"]')!, source));
    await act(async () => container.querySelector<HTMLButtonElement>('.confirm-source')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('button[role="tab"][aria-label="歌单模式"]')!.click());
    await act(async () => setInputValue(container.querySelector<HTMLTextAreaElement>('#playlist')!, '歌A\n歌B'));
    await act(async () => container.querySelector<HTMLFormElement>('form.playlist-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await act(async () => { await vi.runAllTimersAsync(); });

    await act(async () => selectFile(container.querySelector<HTMLInputElement>('input.audio-file-input')!, createAudioFile()));
    const audio = container.querySelector<HTMLAudioElement>('.audio-engine')!;
    audio.currentTime = 3.5;
    await act(async () => audio.dispatchEvent(new Event('timeupdate', { bubbles: true })));

    const activeOutlineItem = container.querySelector('.review-outline [aria-current="true"]');
    expect(activeOutlineItem?.textContent).toContain('歌B');
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
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(vi.mocked(fetchNeteaseLyric)).toHaveBeenCalledWith(101);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('1 首歌曲未能获取歌词');
    expect(Array.from(container.querySelectorAll('.reference-line > span')).map((line) => line.textContent)).toContain('A1');
    expect(container.querySelectorAll('.playlist-track').length).toBe(2);
  });

  it('retries only the selected playlist track', async () => {
    let failedOnce = false;
    vi.mocked(searchNetease).mockImplementation(async (query) => {
      if (query === '失败歌' && !failedOnce) {
        failedOnce = true;
        throw new Error('搜索失败');
      }
      return [{ id: query === '歌A' ? 101 : 303, name: query, artists: '歌手', album: '专辑' }];
    });
    await act(async () => root.render(<App />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[role="tab"][aria-label="歌单模式"]')!.click());
    await act(async () => setInputValue(container.querySelector<HTMLTextAreaElement>('#playlist')!, '歌A\n失败歌'));
    await act(async () => container.querySelector<HTMLFormElement>('form.playlist-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await act(async () => { await vi.runAllTimersAsync(); });

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="重新搜索第 2 首歌曲"]')!.click());
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(vi.mocked(searchNetease).mock.calls.map(([query]) => query)).toEqual(['歌A', '失败歌', '失败歌']);
    expect(container.textContent).toContain('失败歌 · 歌手');
  });

  it('serializes retries for different playlist tracks', async () => {
    await act(async () => root.render(<App />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[role="tab"][aria-label="歌单模式"]')!.click());
    await act(async () => setInputValue(container.querySelector<HTMLTextAreaElement>('#playlist')!, '歌A\n歌B'));
    await act(async () => container.querySelector<HTMLFormElement>('form.playlist-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await act(async () => { await vi.runAllTimersAsync(); });

    const firstRetry = deferred<Awaited<ReturnType<typeof searchNetease>>>();
    vi.mocked(searchNetease).mockClear();
    vi.mocked(searchNetease).mockImplementation(async (query) => query === '歌A'
      ? firstRetry.promise
      : [{ id: 202, name: '歌B', artists: '歌手', album: '专辑' }]);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="重新搜索第 1 首歌曲"]')!.click();
      container.querySelector<HTMLButtonElement>('button[aria-label="重新搜索第 2 首歌曲"]')!.click();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    expect(vi.mocked(searchNetease).mock.calls.map(([query]) => query)).toEqual(['歌A']);

    firstRetry.resolve([{ id: 101, name: '歌A', artists: '歌手', album: '专辑' }]);
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(vi.mocked(searchNetease).mock.calls.map(([query]) => query)).toEqual(['歌A', '歌B']);
  });

  it('edits one playlist query, syncs the playlist text, and searches the new query', async () => {
    await act(async () => root.render(<App />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[role="tab"][aria-label="歌单模式"]')!.click());
    await act(async () => setInputValue(container.querySelector<HTMLTextAreaElement>('#playlist')!, '歌A\n歌B'));
    await act(async () => container.querySelector<HTMLFormElement>('form.playlist-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await act(async () => { await vi.runAllTimersAsync(); });

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="编辑第 1 首歌曲"]')!.click());
    await act(async () => setInputValue(container.querySelector<HTMLInputElement>('input[aria-label="编辑第 1 首歌曲名"]')!, '新歌'));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="保存并重新搜索第 1 首歌曲"]')!.click());
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(vi.mocked(searchNetease)).toHaveBeenLastCalledWith('新歌');
    expect(container.querySelector<HTMLTextAreaElement>('#playlist')!.value).toBe('新歌\n歌B');
    expect(container.querySelector('.playlist-track strong')?.textContent).toBe('新歌');
  });
});
