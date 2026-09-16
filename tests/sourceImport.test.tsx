import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';

const firstSrt = '1\n00:00:01,000 --> 00:00:03,000\n第一句\n\n2\n00:00:04,000 --> 00:00:06,000\n第二句';
const replacementSrt = '1\n00:00:01,000 --> 00:00:03,000\n替换后的第一句\n\n2\n00:00:04,000 --> 00:00:06,000\n第二句';

vi.mock('../src/server/netease', () => ({
  searchNetease: vi.fn(),
  fetchNeteaseLyric: vi.fn(),
  stripLyricTimestamps: (lyric: string) => lyric.split('\n').filter(Boolean),
}));

function createFile(name: string, text: string): File {
  const file = new File([text], name, { type: 'text/plain' });
  Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(text) });
  return file;
}

function createPendingFile(name: string) {
  let resolveText!: (text: string) => void;
  const textPromise = new Promise<string>((done) => { resolveText = done; });
  const file = new File([], name, { type: 'text/plain' });
  Object.defineProperty(file, 'text', { value: () => textPromise });
  return { file, resolve: resolveText };
}

function dispatchDrop(target: HTMLElement, files: File[]) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files, types: ['Files'] } });
  target.dispatchEvent(event);
}

describe('SRT source import and editing', () => {
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

  it('accepts only SRT files and imports a dropped SRT file', async () => {
    await act(async () => root.render(<App />));

    expect(container.querySelector<HTMLButtonElement>('button.upload-button')).not.toBeNull();
    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabs[0].getAttribute('aria-controls')).toBe('source-srt-panel');
    expect(container.querySelector('[role="tabpanel"]')).not.toBeNull();
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(fileInput.accept).not.toContain('.txt');
    expect(fileInput.accept).toContain('.srt');

    const dropzone = container.querySelector<HTMLElement>('.source-dropzone')!;
    const file = createFile('现场.srt', firstSrt);
    await act(async () => {
      dispatchDrop(dropzone, [file]);
    });

    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="剪映识别结果 SRT"]')?.value).toBe(firstSrt);
    const panel = container.querySelector<HTMLElement>('.source-panel')!;
    const replacementFile = createFile('替换.srt', replacementSrt);
    await act(async () => {
      dispatchDrop(panel, [replacementFile]);
    });
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="剪映识别结果 SRT"]')?.value).toBe(replacementSrt);
    await act(async () => container.querySelector<HTMLButtonElement>('[role="tab"]:nth-child(2)')!.click());
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="解析后的 TXT"]')?.value).toBe('替换后的第一句\n第二句\n');

    const txtFile = createFile('现场.txt', '不应被导入');
    await act(async () => {
      dispatchDrop(dropzone, [txtFile]);
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('仅支持 SRT');
    await act(async () => container.querySelector<HTMLButtonElement>('[role="tab"]:nth-child(1)')!.click());
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="剪映识别结果 SRT"]')?.value).toBe(replacementSrt);
  });

  it('keeps TXT read-only and applies edited SRT only after confirmation', async () => {
    await act(async () => root.render(<App />));
    const dropzone = container.querySelector<HTMLElement>('.source-dropzone')!;
    const file = createFile('现场.srt', firstSrt);
    await act(async () => {
      dispatchDrop(dropzone, [file]);
    });

    const srtEditor = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="剪映识别结果 SRT"]')!;
    await act(async () => container.querySelector<HTMLButtonElement>('[role="tab"]:nth-child(2)')!.click());
    const txtPreview = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="解析后的 TXT"]')!;
    expect(txtPreview.readOnly).toBe(true);
    expect(txtPreview.value).toBe('第一句\n第二句\n');
    await act(async () => container.querySelector<HTMLButtonElement>('[role="tab"]:nth-child(1)')!.click());

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(srtEditor, replacementSrt);
      srtEditor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector<HTMLButtonElement>('.confirm-source')).not.toBeNull();

    await act(async () => container.querySelector<HTMLButtonElement>('.confirm-source')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[role="tab"]:nth-child(2)')!.click());
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="解析后的 TXT"]')?.value).toBe('替换后的第一句\n第二句\n');
    expect(container.querySelector('.confirm-source')).toBeNull();
  });

  it('moves between source views with arrow keys', async () => {
    await act(async () => root.render(<App />));
    const srtTab = container.querySelector<HTMLButtonElement>('[role="tab"]:nth-child(1)')!;
    const txtTab = container.querySelector<HTMLButtonElement>('[role="tab"]:nth-child(2)')!;
    await act(async () => srtTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(txtTab.getAttribute('aria-selected')).toBe('true');
    await act(async () => txtTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    expect(srtTab.getAttribute('aria-selected')).toBe('true');
  });

  it('does not replace the confirmed source when edited SRT is invalid', async () => {
    await act(async () => root.render(<App />));
    const dropzone = container.querySelector<HTMLElement>('.source-dropzone')!;
    const file = createFile('现场.srt', firstSrt);
    await act(async () => {
      dispatchDrop(dropzone, [file]);
    });

    const srtEditor = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="剪映识别结果 SRT"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(srtEditor, 'not an srt');
      srtEditor.dispatchEvent(new Event('input', { bubbles: true }));
      container.querySelector<HTMLButtonElement>('.confirm-source')!.click();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('格式错误');
    await act(async () => container.querySelector<HTMLButtonElement>('[role="tab"]:nth-child(2)')!.click());
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="解析后的 TXT"]')?.value).toBe('第一句\n第二句\n');
  });

  it('keeps the latest dropped file when file reads finish out of order', async () => {
    await act(async () => root.render(<App />));
    const dropzone = container.querySelector<HTMLElement>('.source-dropzone')!;
    const first = createPendingFile('先拖入.srt');
    const second = createPendingFile('后拖入.srt');

    await act(async () => {
      dispatchDrop(dropzone, [first.file]);
      dispatchDrop(dropzone, [second.file]);
    });
    await act(async () => second.resolve(replacementSrt));
    await act(async () => first.resolve(firstSrt));

    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="剪映识别结果 SRT"]')?.value).toBe(replacementSrt);
  });
});
