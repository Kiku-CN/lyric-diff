import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { fetchNeteaseLyric, searchNetease } from '../src/server/netease';

const replacementSrt = '1\n00:00:01,000 --> 00:00:03,000\n替换后的第一句\n\n2\n00:00:04,000 --> 00:00:06,000\n第二句';

vi.mock('../src/server/netease', () => ({
  searchNetease: vi.fn(),
  fetchNeteaseLyric: vi.fn(),
  stripLyricTimestamps: (lyric: string) => lyric.split('\n').filter(Boolean),
}));

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set
    ?? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('review table behavior', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('shows local subtitle rows before a reference lyric is selected', async () => {
    await act(async () => root.render(<App />));

    expect(container.querySelectorAll('.diff-row')).toHaveLength(3);
    expect(container.querySelector('.empty-review')).toBeNull();
    expect(container.querySelector<HTMLElement>('.diff-row .local')?.textContent).toContain('把酒倒满');
  });

  it('keeps the line-number column empty in the header and aligns the three labels after it', async () => {
    await act(async () => root.render(<App />));

    const headers = Array.from(container.querySelectorAll<HTMLElement>('.diff-header > span'));
    expect(headers).toHaveLength(4);
    expect(headers.map((header) => header.textContent)).toEqual(['', '剪映现场版', '网易云参考版', '处理']);
  });

  it('uses the local row timestamp as the line-number title', async () => {
    await act(async () => root.render(<App />));

    expect(container.querySelector<HTMLElement>('.diff-row .line-number')?.title).toBe('00:00:01,000');
  });

  it('shows a review checkbox after export and updates the selected row', async () => {
    await act(async () => root.render(<App />));

    const reviewToggles = Array.from(container.querySelectorAll<HTMLInputElement>('input[aria-label^="复核第"]'));
    expect(reviewToggles).toHaveLength(3);
    expect(reviewToggles.every((toggle) => !toggle.checked)).toBe(true);

    await act(async () => reviewToggles[1].click());

    expect(container.querySelector<HTMLInputElement>('input[aria-label="复核第 2 行"]')?.checked).toBe(true);
  });

  it('preserves the searched and selected NetEase state when the SRT source changes', async () => {
    vi.mocked(searchNetease).mockResolvedValue([{ id: 17, name: '现场曲', artists: '歌手', album: '专辑' }]);
    vi.mocked(fetchNeteaseLyric).mockResolvedValue('把酒倒满\n朋友一生一起走\n那些日子不再有');
    await act(async () => root.render(<App />));

    await act(async () => {
      setInputValue(container.querySelector<HTMLInputElement>('#song-query')!, '现场曲');
      container.querySelector<HTMLFormElement>('form.search-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('.candidate')!.click());
    expect(container.querySelector<HTMLButtonElement>('.candidate.chosen')).not.toBeNull();

    await act(async () => {
      const editor = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="剪映识别结果 SRT"]')!;
      setInputValue(editor, replacementSrt);
      container.querySelector<HTMLButtonElement>('.confirm-source')!.click();
    });

    expect(container.querySelector<HTMLButtonElement>('.candidate.chosen')).not.toBeNull();
    expect(container.querySelector('.review-heading > div:first-child > p:not(.section-kicker)')?.textContent).toContain('现场曲');
    expect(container.querySelector<HTMLElement>('.diff-row .local')?.textContent).toContain('替换后的第一句');
  });
});
