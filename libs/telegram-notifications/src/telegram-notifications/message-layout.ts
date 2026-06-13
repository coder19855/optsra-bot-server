import { scenarioRule } from './telegram-palette';

/** Short neutral divider — marks where a Telegram section starts or ends. */
export const TELEGRAM_MSG_RULE = scenarioRule('muted');

/** Blank lines + divider + blank lines between major sections. */
export const TELEGRAM_SECTION_GAP = `\n\n${TELEGRAM_MSG_RULE}\n\n`;

export { scenarioRule };

/** Join major sections with a visible divider and breathing room. */
export function joinTelegramSections(
  ...sections: Array<string | null | undefined>
): string {
  return sections
    .map((section) => section?.trim())
    .filter((section): section is string => Boolean(section))
    .join(TELEGRAM_SECTION_GAP);
}

/** Join lines inside one section (no divider between them). */
export function joinTelegramLines(
  ...lines: Array<string | null | undefined>
): string {
  return lines
    .map((line) => line?.trim())
    .filter((line): line is string => Boolean(line))
    .join('\n');
}