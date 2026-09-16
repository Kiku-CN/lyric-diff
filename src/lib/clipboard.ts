type ClipboardWriter = {
  writeText(text: string): Promise<void>;
};

export async function copyText(text: string, clipboard: ClipboardWriter = navigator.clipboard): Promise<void> {
  await clipboard.writeText(text);
}

export function splitReferenceLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.length > 0);
}
