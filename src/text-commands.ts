import type { Settings } from "./settings";

export interface TextCommand {
  phrase: string;
  replacement: string;
  aliases?: string[];
}

const TIMESTAMP_TOKEN = "{{timestamp}}";
const DATE_TOKEN = "{{date}}";

export const DEFAULT_TEXT_COMMANDS: TextCommand[] = [
  { phrase: "new line", replacement: "\n", aliases: ["newline"] },
  { phrase: "new paragraph", replacement: "\n\n", aliases: ["insert paragraph"] },
  { phrase: "new bullet", replacement: "\n- ", aliases: ["bullet point"] },
  { phrase: "comma", replacement: ", " },
  { phrase: "period", replacement: ". " },
  { phrase: "question mark", replacement: "? " },
  { phrase: "exclamation mark", replacement: "! " },
  { phrase: "colon", replacement: ": " },
  { phrase: "semicolon", replacement: "; " },
  { phrase: "open quote", replacement: '"', aliases: ["begin quote", "start quote"] },
  { phrase: "close quote", replacement: '"', aliases: ["end quote", "finish quote"] },
  { phrase: "open parenthesis", replacement: "(" },
  { phrase: "close parenthesis", replacement: ")" },
  { phrase: "code block start", replacement: "\n```\n" },
  { phrase: "code block end", replacement: "\n```\n" },
  {
    phrase: "insert timestamp",
    replacement: TIMESTAMP_TOKEN,
    aliases: ["insert time stamp", "insert the timestamp", "insert the time stamp"],
  },
  { phrase: "insert date", replacement: DATE_TOKEN, aliases: ["insert the date"] },
];

const MAX_COMMAND_PHRASE_WORDS = DEFAULT_TEXT_COMMANDS.reduce((max, command) => {
  return Math.max(max, countWords(command.phrase));
}, 1);

const COMMAND_TAIL_GUARD_CHARS = MAX_COMMAND_PHRASE_WORDS * 12;

export function getCommandTailGuardChars(): number {
  return COMMAND_TAIL_GUARD_CHARS;
}

function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, " ");
}

function countWords(text: string): number {
  const normalized = normalizePhrase(text);
  if (!normalized) {
    return 0;
  }
  return normalized.split(" ").length;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatTimestamp(now: Date): string {
  return now.toISOString();
}

function formatDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function resolveReplacement(replacement: string, now: Date): string {
  let resolved = replacement;

  if (resolved.includes(TIMESTAMP_TOKEN)) {
    resolved = resolved.split(TIMESTAMP_TOKEN).join(formatTimestamp(now));
  }

  if (resolved.includes(DATE_TOKEN)) {
    resolved = resolved.split(DATE_TOKEN).join(formatDate(now));
  }

  return resolved;
}

function normalizeSpacing(text: string): string {
  return text
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([(])\s+/g, "$1")
    .replace(/\s+([)])/g, "$1")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ {2,}/g, " ")
    .trimEnd();
}

function getActiveCommands(settings: Settings): TextCommand[] {
  if (!settings.textCommandsEnabled) {
    return [];
  }

  const custom = settings.customTextCommands.filter((command) => {
    return normalizePhrase(command.phrase).length > 0;
  });

  return [...DEFAULT_TEXT_COMMANDS, ...custom];
}

export function applyTextCommands(
  input: string,
  settings: Settings,
  now: Date = new Date()
): string {
  const commands = getActiveCommands(settings)
    .flatMap((command) => {
      const phrases = [command.phrase, ...(command.aliases ?? [])];
      const replacement = resolveReplacement(command.replacement, now);

      return phrases.map((phrase) => ({
        phrase: normalizePhrase(phrase),
        replacement,
      }));
    })
    .filter((command) => command.phrase.length > 0)
    .sort((a, b) => b.phrase.length - a.phrase.length);

  if (commands.length === 0) {
    return input;
  }

  let output = input;
  for (const command of commands) {
    const escapedPhrase = escapeRegex(command.phrase).replace(/\ /g, "\\s+");
    const pattern = new RegExp(
      `(^|[\\s(\\[{\"'])${escapedPhrase}(?=$|[\\s.,!?;:)]|[\"'])`,
      "gi"
    );
    output = output.replace(pattern, (_match, prefix: string) => {
      return `${prefix}${command.replacement}`;
    });
  }

  return normalizeSpacing(output);
}
