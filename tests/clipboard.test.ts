import { describe, expect, it } from 'vitest';
import { copyText, splitReferenceLines } from '../src/lib/clipboard';

describe('copyText', () => {
  it('writes the provided lyric text to the clipboard', async () => {
    let copied = '';
    await copyText('参考歌词', { writeText: async (text: string) => { copied = text; } });
    expect(copied).toBe('参考歌词');
  });

  it('splits grouped reference text into individually copyable lines', () => {
    expect(splitReferenceLines('第一句\n第二句')).toEqual(['第一句', '第二句']);
  });
});
