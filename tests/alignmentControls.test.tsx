import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { splitReferenceLines } from '../src/lib/clipboard';
import { createExportEntries } from '../src/lib/reviewExport';
import { fetchNeteaseLyric, searchNetease } from '../src/server/netease';

vi.mock('../src/lib/clipboard', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/clipboard')>('../src/lib/clipboard');
  return { ...actual, splitReferenceLines: vi.fn(actual.splitReferenceLines) };
});

vi.mock('../src/lib/reviewExport', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/reviewExport')>('../src/lib/reviewExport');
  return { ...actual, createExportEntries: vi.fn(actual.createExportEntries) };
});

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
    expect(segmentation.checked).toBe(true);
    expect(referenceCells()[0]).toContain('把酒倒满');
    expect(referenceCells()[1]).toContain('朋友一生一起走');
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
    expect(segmentation.checked).toBe(false);
    expect(Array.from(container.querySelectorAll('.diff-cell.reference')).map((cell) => cell.textContent).join('')).toContain('把酒倒满朋友一生一起走');
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

  it('replaces a row edit with clipboard text from the clear-and-paste action', async () => {
    await act(async () => root.render(<App />));
    const clipboard = { readText: vi.fn().mockResolvedValue('剪切板校对文本') };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });

    const input = container.querySelector<HTMLInputElement>('.diff-row:not(.add) .row-controls > input')!;
    const action = container.querySelector<HTMLButtonElement>('.diff-row:not(.add) button[aria-label="清空并粘贴第 1 行"]')!;
    await act(async () => action.click());

    expect(clipboard.readText).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('剪切板校对文本');
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
      container.querySelector<HTMLInputElement>('input[aria-label="智能分句"]')!.click();
    });
    await act(async () => resolveLyric('把酒倒满朋友一生一起走\n那些日子不再有'));
    const referenceCells = Array.from(container.querySelectorAll('.diff-cell.reference')).map((cell) => cell.textContent);
    expect(referenceCells[0]).toContain('把酒倒满');
    expect(referenceCells[1]).toContain('朋友一生一起走');
  });

  it('lets users toggle export on every row with leading and trailing additions initially off', async () => {
    vi.mocked(fetchNeteaseLyric).mockResolvedValue('片头\n把酒倒满\n中间新增\n朋友一生一起走\n那些日子不再有\n片尾');
    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLFormElement>('form.search-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('.candidate')!.click());
    const checkboxes = () => Array.from(container.querySelectorAll<HTMLInputElement>('.diff-row .row-controls input[aria-label^="导出第"]'));
    expect(checkboxes().map((checkbox) => checkbox.checked)).toEqual([false, true, true, true, true, false]);
    await act(async () => {
      checkboxes()[0].click();
      checkboxes()[1].click();
      checkboxes()[5].click();
    });
    expect(checkboxes().map((checkbox) => checkbox.checked)).toEqual([true, false, true, true, true, true]);
  });

  it('uses Shift clicks to apply the clicked export state across a continuous range', async () => {
    vi.mocked(fetchNeteaseLyric).mockResolvedValue('片头\n把酒倒满\n中间新增\n朋友一生一起走\n那些日子不再有\n片尾');
    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLFormElement>('form.search-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('.candidate')!.click());

    const checkboxes = () => Array.from(container.querySelectorAll<HTMLInputElement>('.diff-row .row-controls input[aria-label^="导出第"]'));
    const shiftClick = (checkbox: HTMLInputElement) => checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));

    await act(async () => {
      checkboxes()[1].click();
      shiftClick(checkboxes()[4]);
    });
    expect(checkboxes().map((checkbox) => checkbox.checked)).toEqual([false, false, false, false, false, false]);

    await act(async () => {
      checkboxes()[4].click();
      shiftClick(checkboxes()[1]);
    });
    expect(checkboxes().map((checkbox) => checkbox.checked)).toEqual([false, true, true, true, true, false]);
  });

  it('only rerenders the review row being edited or toggled', async () => {
    vi.mocked(fetchNeteaseLyric).mockResolvedValue('把酒倒满\n朋友一生一起走\n那些日子不再有');
    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLFormElement>('form.search-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('.candidate')!.click());

    vi.mocked(splitReferenceLines).mockClear();
    const edit = container.querySelector<HTMLInputElement>('.diff-row .row-controls > input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(edit, '现场修订');
      edit.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(vi.mocked(splitReferenceLines)).toHaveBeenCalledTimes(1);

    vi.mocked(splitReferenceLines).mockClear();
    await act(async () => container.querySelector<HTMLInputElement>('.diff-row input[type="checkbox"]')!.click());
    expect(vi.mocked(splitReferenceLines)).toHaveBeenCalledTimes(1);
  });

  it('defers export generation until preview or download is requested', async () => {
    vi.mocked(fetchNeteaseLyric).mockResolvedValue('把酒倒满\n朋友一生一起走\n那些日子不再有');
    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLFormElement>('form.search-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('.candidate')!.click());

    vi.mocked(createExportEntries).mockClear();
    const edit = container.querySelector<HTMLInputElement>('.diff-row .row-controls > input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(edit, '现场修订');
      edit.dispatchEvent(new Event('input', { bubbles: true }));
      container.querySelector<HTMLInputElement>('.diff-row:nth-child(2) input[type="checkbox"]')!.click();
    });
    expect(vi.mocked(createExportEntries)).not.toHaveBeenCalled();

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="预览校对稿"]')!.click());
    expect(vi.mocked(createExportEntries)).toHaveBeenCalledTimes(1);
  });

  it('previews the selected TXT export with current edits and excluded rows', async () => {
    vi.mocked(fetchNeteaseLyric).mockResolvedValue('把酒倒满\n朋友一生一起走\n那些日子不再有');
    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLFormElement>('form.search-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('.candidate')!.click());
    const edit = container.querySelector<HTMLInputElement>('.diff-row .row-controls > input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(edit, '现场修订');
      edit.dispatchEvent(new Event('input', { bubbles: true }));
      container.querySelector<HTMLInputElement>('.diff-row:nth-child(2) input[type="checkbox"]')!.click();
      const format = container.querySelector<HTMLSelectElement>('select[aria-label="导出格式"]')!;
      format.value = 'txt';
      format.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="预览校对稿"]')!.click());
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('TXT');
    expect(container.querySelector('.preview-content')?.textContent).toBe('现场修订\n那些日子不再有\n');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="关闭预览"]')!.click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('previews the default SRT source', async () => {
    await act(async () => root.render(<App />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="预览校对稿"]')!.click());
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('把酒倒满');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
