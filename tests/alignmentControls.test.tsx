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

describe('alignment controls', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.mocked(searchNetease).mockResolvedValue([{ id: 17, name: '现场曲', artists: '歌手', album: '专辑' }]);
    vi.mocked(fetchNeteaseLyric).mockResolvedValue('无关开场\n把酒倒满朋友一生一起走\n那些日子不再有\n无关结尾');
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('recomputes cached lyrics when switching algorithm and segmentation independently', async () => {
    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLFormElement>('form.search-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.candidate')!.click();
    });

    const algorithm = container.querySelector<HTMLSelectElement>('select[aria-label="对比算法"]')!;
    const segmentation = container.querySelector<HTMLInputElement>('input[aria-label="智能分句"]')!;
    const referenceCells = () => Array.from(container.querySelectorAll('.diff-row:not(.add) .diff-cell.reference')).map((cell) => cell.textContent);

    expect(algorithm.value).toBe('fragment');
    expect(segmentation.checked).toBe(false);
    expect(Array.from(container.querySelectorAll('.diff-row.add .diff-cell.reference')).map((cell) => cell.textContent)).toEqual(['无关开场复制', '无关结尾复制']);
    expect(container.querySelector<HTMLButtonElement>('.diff-row.add .row-controls button')!.disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('.diff-row.add .row-controls input')!.disabled).toBe(false);

    const firstEdit = container.querySelector<HTMLInputElement>('.diff-row:not(.add) .row-controls input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(firstEdit, '手工校对');
      firstEdit.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(firstEdit.value).toBe('手工校对');

    await act(async () => {
      segmentation.click();
    });
    expect(referenceCells()[0]).toContain('把酒倒满');
    expect(referenceCells()[1]).toContain('朋友一生一起走');
    const currentEdit = container.querySelector<HTMLInputElement>('.diff-row:not(.add) .row-controls input')!;
    expect(currentEdit.value).not.toBe('手工校对');

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(currentEdit, '再次校对');
      currentEdit.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(currentEdit.value).toBe('再次校对');

    await act(async () => {
      algorithm.value = 'from-start';
      algorithm.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelector<HTMLInputElement>('.diff-row:not(.add) .row-controls input')!.value).not.toBe('再次校对');
    expect(vi.mocked(fetchNeteaseLyric)).toHaveBeenCalledTimes(1);
  });

  it('uses the latest settings when lyrics finish loading', async () => {
    let resolveLyric!: (value: string) => void;
    vi.mocked(fetchNeteaseLyric).mockReturnValue(new Promise((resolve) => { resolveLyric = resolve; }));
    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLFormElement>('form.search-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    act(() => { container.querySelector<HTMLButtonElement>('.candidate')!.click(); });
    await act(async () => {
      const algorithm = container.querySelector<HTMLSelectElement>('select[aria-label="对比算法"]')!;
      algorithm.value = 'from-start';
      algorithm.dispatchEvent(new Event('change', { bubbles: true }));
      container.querySelector<HTMLInputElement>('input[aria-label="智能分句"]')!.click();
    });
    await act(async () => resolveLyric('把酒倒满朋友一生一起走\n那些日子不再有'));
    const referenceCells = Array.from(container.querySelectorAll('.diff-cell.reference')).map((cell) => cell.textContent);
    expect(referenceCells[0]).toContain('把酒倒满');
    expect(referenceCells[1]).toContain('朋友一生一起走');
  });

  it('lets users toggle export for leading, middle and trailing reference additions', async () => {
    vi.mocked(fetchNeteaseLyric).mockResolvedValue('片头\n把酒倒满\n中间新增\n朋友一生一起走\n那些日子不再有\n片尾');
    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLFormElement>('form.search-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('.candidate')!.click());
    const checkboxes = () => Array.from(container.querySelectorAll<HTMLInputElement>('.diff-row.add .row-controls input[type="checkbox"]'));
    expect(checkboxes().map((checkbox) => checkbox.checked)).toEqual([false, true, false]);
    await act(async () => {
      checkboxes()[0].click();
      checkboxes()[1].click();
      checkboxes()[2].click();
    });
    expect(checkboxes().map((checkbox) => checkbox.checked)).toEqual([true, false, true]);
  });
});
