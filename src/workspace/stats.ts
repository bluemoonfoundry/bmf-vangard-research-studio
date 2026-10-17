export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export interface TextStats {
  words: number;
  chars: number;
  charsNoSpaces: number;
  paragraphs: number;
  lines: number;
  /** Minutes at 225 words per minute, rounded up; 0 for empty text. */
  readingMinutes: number;
}

export function textStats(text: string): TextStats {
  const words = wordCount(text);
  return {
    words,
    chars: text.length,
    charsNoSpaces: text.replace(/\s+/g, '').length,
    paragraphs: text.split(/\n+/).filter(p => p.trim()).length,
    lines: text ? text.split('\n').length : 0,
    readingMinutes: Math.ceil(words / 225),
  };
}
