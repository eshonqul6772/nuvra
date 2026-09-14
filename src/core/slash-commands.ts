import type { DocumentEngine } from './engine/engine';
import type { IconName } from './icons';

/** An entry of the `/` command menu, opened by typing `/` at the start of a line or after a space. */
export interface SlashCommand {
  /** Unique id; also matched by the typed filter. */
  id: string;
  /** Name shown in the menu. */
  label: string;
  /** Icon from the editor's icon set. */
  icon?: IconName;
  /** More words the typed filter finds the command by, for example in other languages. */
  keywords?: readonly string[];
  /** Runs the command; the typed `/filter` has already been removed and the caret is where it was. */
  run: (engine: DocumentEngine) => void;
}

/** The `/filter` typed right before the caret: after a space or at the start of the line. */
const TRIGGER = /(?:^|\s)\/([\p{L}\p{N}_.-]{0,32})$/u;

/** The filter typed after `/` before the caret, or `null` when the text does not end with a trigger. */
export const readSlashQuery = (textBeforeCaret: string | null): string | null =>
  textBeforeCaret === null ? null : (TRIGGER.exec(textBeforeCaret)?.[1] ?? null);

/** Commands whose id, label or keywords contain the filter, those starting with it first. */
export const filterSlashCommands = (commands: readonly SlashCommand[], query: string): SlashCommand[] => {
  const needle = query.toLocaleLowerCase();
  if (!needle) return [...commands];
  const scored = commands
    .map(command => {
      const words = [command.label, command.id, ...(command.keywords ?? [])].map(word => word.toLocaleLowerCase());
      const score = words.some(word => word.startsWith(needle)) ? 0 : words.some(word => word.includes(needle)) ? 1 : 2;
      return { command, score };
    })
    .filter(entry => entry.score < 2);
  return scored.sort((a, b) => a.score - b.score).map(entry => entry.command);
};
