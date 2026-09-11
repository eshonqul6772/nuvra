/** Editor commands reachable through keyboard shortcuts. */
export type KeyCommand =
  | 'undo'
  | 'redo'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'code'
  | 'subscript'
  | 'superscript'
  | 'highlight'
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'alignJustify'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'blockquote'
  | 'codeBlock'
  | 'pageBreak';

/** Apple platforms use Command instead of Control as the shortcut modifier. */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** Shortcuts pressed with Mod+Shift, keyed by physical key code. */
const SHIFT_COMMANDS: Record<string, KeyCommand> = {
  KeyZ: 'redo',
  KeyS: 'strike',
  KeyL: 'alignLeft',
  KeyE: 'alignCenter',
  KeyR: 'alignRight',
  KeyJ: 'alignJustify',
  Digit7: 'orderedList',
  Digit8: 'bulletList',
  Digit9: 'taskList',
  KeyB: 'blockquote',
  KeyH: 'highlight'
};

/** Shortcuts pressed with Mod alone, keyed by physical key code. */
const PLAIN_COMMANDS: Record<string, KeyCommand> = {
  KeyZ: 'undo',
  KeyY: 'redo',
  KeyB: 'bold',
  KeyI: 'italic',
  KeyU: 'underline',
  KeyE: 'code',
  Comma: 'subscript',
  Period: 'superscript',
  Enter: 'pageBreak',
  NumpadEnter: 'pageBreak'
};

/** Key code with Mod+Alt that turns the block into a paragraph. */
const PARAGRAPH_KEY = 'Digit0';

/** Key code with Mod+Alt that toggles a code block. */
const CODE_BLOCK_KEY = 'KeyC';

/** Mod+Alt+1…6 set the heading level. */
const HEADING_KEY = /^Digit([1-6])$/;

/**
 * Returns the editor command for a key press, or `null` when it is not a shortcut. Physical key codes are used so
 * shortcuts keep working with Cyrillic and other keyboard layouts; AltGr combinations are left to text input.
 */
export const matchKeyCommand = (event: KeyboardEvent): KeyCommand | null => {
  const mod = IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!mod || event.getModifierState?.('AltGraph')) return null;
  const { code, shiftKey, altKey } = event;
  if (!altKey) return (shiftKey ? SHIFT_COMMANDS[code] : PLAIN_COMMANDS[code]) ?? null;
  if (shiftKey) return null;
  if (code === PARAGRAPH_KEY) return 'paragraph';
  if (code === CODE_BLOCK_KEY) return 'codeBlock';
  const level = HEADING_KEY.exec(code)?.[1];
  return level ? (`heading${level}` as KeyCommand) : null;
};
