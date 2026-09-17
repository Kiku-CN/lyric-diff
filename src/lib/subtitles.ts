export type SubtitleEntry = {
  id: string;
  index: number;
  startMs?: number;
  endMs?: number;
  text: string;
};

const timePattern = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/;

function toMs(value: string): number {
  const match = value.match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) throw new Error(`无法识别时间轴：${value}`);
  return Number(match[1]) * 3_600_000 + Number(match[2]) * 60_000 + Number(match[3]) * 1_000 + Number(match[4]);
}

function fromMs(value: number): string {
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  const seconds = Math.floor((value % 60_000) / 1_000);
  const milliseconds = value % 1_000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

export function parseSubtitle(input: string, extension: 'srt' | 'txt'): SubtitleEntry[] {
  if (extension === 'txt') {
    return input.split(/\r?\n/).map((text) => text.trim()).filter(Boolean).map((text, index) => ({
      id: String(index + 1), index: index + 1, text,
    }));
  }

  const blocks = input.replace(/^\uFEFF/, '').split(/\r?\n\s*\r?\n/);
  return blocks.flatMap((block, blockIndex) => {
    const lines = block.split(/\r?\n/).map((line) => line.trimEnd());
    if (lines.every((line) => !line.trim())) return [];
    if (lines.length < 2) throw new Error(`第 ${blockIndex + 1} 段格式错误`);
    const indexLine = lines[0].trim();
    const timingLine = lines[1].trim();
    const timing = timingLine.match(timePattern);
    if (!timing) throw new Error(`第 ${blockIndex + 1} 段时间轴格式错误`);
    if (!/^\d+$/.test(indexLine)) throw new Error(`第 ${blockIndex + 1} 段序号格式错误`);
    const index = Number(indexLine);
    const text = lines.slice(2).join('\n').trim();
    return [{ id: String(index), index, startMs: toMs(timingLine.slice(0, 12)), endMs: toMs(timingLine.slice(17)), text }];
  });
}

export function exportSrt(entries: SubtitleEntry[]): string {
  return entries.filter((entry) => entry.startMs !== undefined && entry.endMs !== undefined).map((entry, index) => {
    return `${index + 1}\n${fromMs(entry.startMs!)} --> ${fromMs(entry.endMs!)}\n${entry.text}`;
  }).join('\n\n') + (entries.length ? '\n' : '');
}

export function exportTxt(entries: SubtitleEntry[]): string {
  return entries.map((entry) => entry.text).filter(Boolean).join('\n') + (entries.length ? '\n' : '');
}
