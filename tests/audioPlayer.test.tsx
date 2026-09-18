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

function createAudioFile() {
  return new File(['audio'], '现场.mp3', { type: 'audio/mpeg' });
}

function selectFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('audio player', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:audio') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('shows a fixed custom player after importing an audio file', async () => {
    await act(async () => root.render(<App />));
    const input = container.querySelector<HTMLInputElement>('input.audio-file-input')!;

    await act(async () => selectFile(input, createAudioFile()));

    expect(input.accept).toBe('audio/*');
    expect(container.querySelector('.audio-player')).not.toBeNull();
    expect(container.querySelector<HTMLAudioElement>('.audio-engine')?.src).toBe('blob:audio');
    expect(container.querySelector<HTMLButtonElement>('.audio-play-toggle')?.getAttribute('aria-label')).toContain('播放');
  });

  it('moves the audio position with integrated step controls', async () => {
    await act(async () => root.render(<App />));
    const input = container.querySelector<HTMLInputElement>('input.audio-file-input')!;
    await act(async () => selectFile(input, createAudioFile()));
    const audio = container.querySelector<HTMLAudioElement>('.audio-engine')!;
    audio.currentTime = 20;

    await act(async () => container.querySelector<HTMLButtonElement>('[data-audio-step="-5"]')!.click());
    expect(audio.currentTime).toBe(15);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-audio-step="10"]')!.click());
    expect(audio.currentTime).toBe(25);
  });

  it('supports space and arrow keys for audio playback shortcuts', async () => {
    await act(async () => root.render(<App />));
    await act(async () => selectFile(container.querySelector<HTMLInputElement>('input.audio-file-input')!, createAudioFile()));
    const audio = container.querySelector<HTMLAudioElement>('.audio-engine')!;
    audio.currentTime = 20;
    const focusedButton = container.querySelector<HTMLButtonElement>('.audio-play-toggle')!;
    focusedButton.focus();

    await act(async () => focusedButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    expect(audio.currentTime).toBe(15);
    expect(document.activeElement).not.toBe(focusedButton);
    await act(async () => focusedButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(audio.currentTime).toBe(20);
    await act(async () => focusedButton.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('leaves keyboard shortcuts available for text editing', async () => {
    await act(async () => root.render(<App />));
    await act(async () => selectFile(container.querySelector<HTMLInputElement>('input.audio-file-input')!, createAudioFile()));
    const audio = container.querySelector<HTMLAudioElement>('.audio-engine')!;
    audio.currentTime = 20;
    const editor = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="剪映识别结果 SRT"]')!;
    editor.focus();

    await act(async () => editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    expect(audio.currentTime).toBe(20);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('does not toggle an export checkbox when audio space shortcut is used', async () => {
    vi.mocked(searchNetease).mockResolvedValue([{ id: 17, name: '现场曲', artists: '歌手', album: '专辑' }]);
    vi.mocked(fetchNeteaseLyric).mockResolvedValue('把酒倒满\n朋友一生一起走\n那些日子不再有');
    await act(async () => root.render(<App />));
    await act(async () => selectFile(container.querySelector<HTMLInputElement>('input.audio-file-input')!, createAudioFile()));
    await act(async () => container.querySelector<HTMLFormElement>('form.search-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await act(async () => container.querySelector<HTMLButtonElement>('.candidate')!.click());

    const checkbox = container.querySelector<HTMLInputElement>('.export-toggle input')!;
    const initialValue = checkbox.checked;
    checkbox.focus();
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    await act(async () => checkbox.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(checkbox.checked).toBe(initialValue);
    expect(document.activeElement).not.toBe(checkbox);
  });

  it('jumps to the local subtitle timestamp from a review row', async () => {
    vi.mocked(searchNetease).mockResolvedValue([{ id: 17, name: '现场曲', artists: '歌手', album: '专辑' }]);
    vi.mocked(fetchNeteaseLyric).mockResolvedValue('把酒倒满\n朋友一生一起走\n那些日子不再有');
    await act(async () => root.render(<App />));
    await act(async () => selectFile(container.querySelector<HTMLInputElement>('input.audio-file-input')!, createAudioFile()));
    await act(async () => container.querySelector<HTMLFormElement>('form.search-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await act(async () => container.querySelector<HTMLButtonElement>('.candidate')!.click());

    const audio = container.querySelector<HTMLAudioElement>('.audio-engine')!;
    await act(async () => container.querySelector<HTMLButtonElement>('.row-playback')!.click());
    expect(audio.currentTime).toBe(1);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('shows the active state on the row currently being played', async () => {
    vi.mocked(searchNetease).mockResolvedValue([{ id: 17, name: '现场曲', artists: '歌手', album: '专辑' }]);
    vi.mocked(fetchNeteaseLyric).mockResolvedValue('把酒倒满\n朋友一生一起走\n那些日子不再有');
    await act(async () => root.render(<App />));
    await act(async () => selectFile(container.querySelector<HTMLInputElement>('input.audio-file-input')!, createAudioFile()));
    await act(async () => container.querySelector<HTMLFormElement>('form.search-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await act(async () => container.querySelector<HTMLButtonElement>('.candidate')!.click());

    const rowButton = container.querySelector<HTMLButtonElement>('.row-playback')!;
    expect(rowButton.classList.contains('playing')).toBe(false);
    await act(async () => rowButton.click());
    expect(rowButton.classList.contains('playing')).toBe(true);
    expect(rowButton.textContent).toContain('播放中');
    expect(rowButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('pauses row playback at the row end timestamp', async () => {
    vi.mocked(searchNetease).mockResolvedValue([{ id: 17, name: '现场曲', artists: '歌手', album: '专辑' }]);
    vi.mocked(fetchNeteaseLyric).mockResolvedValue('把酒倒满\n朋友一生一起走\n那些日子不再有');
    await act(async () => root.render(<App />));
    await act(async () => selectFile(container.querySelector<HTMLInputElement>('input.audio-file-input')!, createAudioFile()));
    await act(async () => container.querySelector<HTMLFormElement>('form.search-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await act(async () => container.querySelector<HTMLButtonElement>('.candidate')!.click());

    const audio = container.querySelector<HTMLAudioElement>('.audio-engine')!;
    await act(async () => container.querySelector<HTMLButtonElement>('.row-playback')!.click());
    vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
    audio.currentTime = 2.5;
    await act(async () => audio.dispatchEvent(new Event('timeupdate', { bubbles: true })));
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
    audio.currentTime = 3;
    await act(async () => audio.dispatchEvent(new Event('timeupdate', { bubbles: true })));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
  });
});
