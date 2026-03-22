export function escapeWhitespaceForLog(text: string): string {
  return text
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}
