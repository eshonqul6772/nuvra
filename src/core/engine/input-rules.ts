import { toggleBlockquote, toggleCodeBlock } from './blocks';
import {
  closestTag,
  closestTextBlock,
  createElement,
  createVariable,
  isText,
  renameElement,
  syncTrailingBreak
} from './dom';
import { type Caret, insertInlineAtCaret, startCaret } from './editing';
import { type ListKind, activeListKind, closestListItem, toggleList, toggleTaskItem } from './lists';
import {
  DEFAULT_HIGHLIGHT_COLOR,
  type MarkName,
  type PendingFormat,
  linkAncestor,
  setHighlight,
  setLink,
  toggleMark
} from './marks';

/** What an applied rule leaves behind for the engine. */
interface InputRuleResult {
  /** New caret position, or `null` to restore the caret by text position. */
  caret: Caret | null;
  /** Formatting for the next typed characters, so text after `**bold**` is not bold. */
  pending?: PendingFormat;
}

/** A matched rule; calling it performs the document change. */
type InputRule = () => InputRuleResult;

/** Block-level shortcuts typed at the start of a paragraph. */
type BlockRuleKind = ListKind | 'heading' | 'blockquote' | 'codeBlock' | 'rule';

/** Characters in text before the caret, with the text nodes they came from. */
interface TextBefore {
  /** Text from the block start to the caret, non-breaking spaces normalised to spaces. */
  text: string;
  /** Every text node with the offset of its first character within `text`. */
  segments: Array<{ node: Text; start: number }>;
}

/** Browsers insert a non-breaking space for a trailing space; rules treat both alike. */
const NBSP = String.fromCharCode(160);

/** Characters that can complete a block rule (`# `, `---`, ```` ``` ````). */
const BLOCK_RULE_TRIGGERS = new Set([' ', '`', '-']);
/** Characters that can close an inline mark rule; typed input that is a substring of these also qualifies. */
const MARK_RULE_TRIGGERS = '*_~`=';

/** Automatic replacements for typed character sequences. */
const TYPOGRAPHY: Array<[RegExp, string]> = [
  [/--$/, '—'],
  [/\.\.\.$/, '…'],
  [/<-$/, '←'],
  [/->$/, '→'],
  [/\(c\)$/i, '©'],
  [/\(r\)$/i, '®'],
  [/\(tm\)$/i, '™'],
  [/\(sm\)$/i, '℠'],
  [/\+\/-$/, '±'],
  [/!=$/, '≠'],
  [/<<$/, '«'],
  [/>>$/, '»'],
  [/(?<=\d ?)[x*](?= ?\d$)/, '×']
];

/** Markdown-style inline marks, checked in this order so `**` wins over `*`. */
const INLINE_MARKS: Array<{ pattern: RegExp; mark: MarkName | 'highlight' }> = [
  { pattern: /(\*\*|__)([^*_\s](?:[^*_]*[^*_\s])?)\1$/, mark: 'bold' },
  { pattern: /~~([^~\s](?:[^~]*[^~\s])?)~~$/, mark: 'strike' },
  { pattern: /==([^=\s](?:[^=]*[^=\s])?)==$/, mark: 'highlight' },
  { pattern: /`([^`]+)`$/, mark: 'code' },
  { pattern: /(?<![*_\w])(\*|_)([^*_\s](?:[^*_]*[^*_\s])?)\1$/, mark: 'italic' }
];

/** Delimiters of inline rules whose pattern has no delimiter capture group. */
const FIXED_DELIMITERS: Partial<Record<MarkName | 'highlight', string>> = { highlight: '==', strike: '~~', code: '`' };

/** Markdown-style block shortcuts; the whole text before the caret must match. */
const BLOCK_RULES: Array<{ pattern: RegExp; kind: BlockRuleKind }> = [
  { pattern: /^(#{1,6}) $/, kind: 'heading' },
  { pattern: /^\[( |x)\] $/i, kind: 'taskList' },
  { pattern: /^[-+*] $/, kind: 'bulletList' },
  { pattern: /^(\d+)\. $/, kind: 'orderedList' },
  { pattern: /^> $/, kind: 'blockquote' },
  { pattern: /^```$/, kind: 'codeBlock' },
  { pattern: /^(?:---|—-|___ |\*\*\* )$/, kind: 'rule' }
];

/** A typed `{{name}}` placeholder, completed by its last brace. */
const VARIABLE_PLACEHOLDER = /\{\{\s*([\p{L}\p{N}_.-]{1,64})\s*\}\}$/u;

/** URL followed by the space that was just typed, not already part of a link. */
const AUTOLINK = /(?:^|\s)((?:https?:\/\/|www\.)[^\s]+[^\s.,;:!?)])\s$/;
/** Characters after which a typed quote opens rather than closes. */
const QUOTE_OPENERS = /[\s([{«]/;

/** Collects the text between the start of `block` and the caret. */
const readTextBefore = (block: HTMLElement, range: Range): TextBefore => {
  const before = document.createRange();
  before.setStart(block, 0);
  before.setEnd(range.startContainer, range.startOffset);
  const segments: TextBefore['segments'] = [];
  let text = '';
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!isText(node) || !before.intersectsNode(node)) continue;
    const data = node === range.startContainer ? node.data.slice(0, range.startOffset) : node.data;
    if (before.comparePoint(node, 0) > 0) break;
    segments.push({ node, start: text.length });
    text += data.replaceAll(NBSP, ' ');
  }
  return { text, segments };
};

/** DOM range for character offsets `from`..`to` of a `TextBefore`, or `null` when they fall outside it. */
const rangeOf = ({ segments }: TextBefore, from: number, to: number): Range | null => {
  const start = segments.find(segment => from >= segment.start && from <= segment.start + segment.node.length);
  const end = [...segments].reverse().find(segment => to >= segment.start && to <= segment.start + segment.node.length);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, from - start.start);
  range.setEnd(end.node, to - end.start);
  return range;
};

/** Replaces characters `from`..`to` with `replacement` and returns the caret after it. */
const replaceText = (before: TextBefore, from: number, to: number, replacement: string): Caret | null => {
  const range = rangeOf(before, from, to);
  if (!range) return null;
  range.deleteContents();
  const node = document.createTextNode(replacement);
  range.insertNode(node);
  return { node, offset: replacement.length };
};

/** Matches a block shortcut such as `# `, `- `, `1. `, `[ ] `, `> `, ```` ``` ```` or `---`. */
const blockRule = (root: HTMLElement, block: HTMLElement, before: TextBefore): InputRule | null => {
  if (block.tagName === 'PRE') return null;
  for (const { pattern, kind } of BLOCK_RULES) {
    const match = before.text.match(pattern);
    if (!match) continue;
    const isListRule = kind === 'bulletList' || kind === 'orderedList' || kind === 'taskList';
    if (kind === 'heading' && (block.tagName !== 'P' || closestListItem(block, root) !== null)) return null;
    if (isListRule && activeListKind(root, block) === kind) return null;

    return () => {
      rangeOf(before, 0, before.text.length)?.deleteContents();
      syncTrailingBreak(block);
      const blockRange = document.createRange();
      blockRange.selectNodeContents(block);
      // Commands may replace the block; its position lets the caret find the new element.
      const parent = block.parentNode;
      const index = parent ? Array.prototype.indexOf.call(parent.childNodes, block) : -1;
      let target = block;

      if (kind === 'heading') {
        target = renameElement(block, `h${match[1]?.length ?? 1}`);
      } else if (kind === 'blockquote') {
        toggleBlockquote(root, blockRange);
      } else if (kind === 'codeBlock') {
        toggleCodeBlock(root, blockRange);
        const pre = parent?.childNodes[index];
        const code = pre instanceof HTMLElement ? (pre.querySelector<HTMLElement>('code') ?? pre) : null;
        return { caret: code ? startCaret(code) : null };
      } else if (kind === 'rule') {
        block.before(createElement('hr'));
      } else {
        toggleList(root, blockRange, kind);
        const item = closestListItem(block, root);
        if (kind === 'taskList' && match[1]?.toLowerCase() === 'x' && item) toggleTaskItem(item);
        const start = Number.parseInt(match[1] ?? '', 10);
        if (kind === 'orderedList' && start > 1) item?.parentElement?.setAttribute('start', String(start));
      }
      return { caret: target.isConnected ? startCaret(target) : null };
    };
  }
  return null;
};

/** Matches a closed inline mark such as `**bold**`, `*italic*`, `~~strike~~`, `` `code` `` or `==highlight==`. */
const inlineMarkRule = (root: HTMLElement, before: TextBefore): InputRule | null => {
  for (const { pattern, mark } of INLINE_MARKS) {
    const match = before.text.match(pattern);
    if (!match || match.index === undefined) continue;
    const hasDelimiterGroup = match.length === 3;
    const delimiter = hasDelimiterGroup ? (match[1] ?? '') : (FIXED_DELIMITERS[mark] ?? '');
    const inner = (hasDelimiterGroup ? match[2] : match[1]) ?? '';
    const start = match.index;
    const innerStart = start + delimiter.length;
    const innerEnd = innerStart + inner.length;

    return () => {
      // The closing delimiter goes first so the opening delimiter's offsets stay valid.
      rangeOf(before, innerEnd, before.text.length)?.deleteContents();
      rangeOf(before, start, innerStart)?.deleteContents();
      const block = closestTextBlock(before.segments[0]?.node, root);
      const last = before.segments.at(-1)?.node;
      if (!block || !last) return { caret: null };
      const caretRange = document.createRange();
      caretRange.setStart(last, last.length);
      const updated = readTextBefore(block, caretRange);
      const target = rangeOf(updated, updated.text.length - inner.length, updated.text.length);
      if (!target) return { caret: null };

      if (mark === 'highlight') setHighlight(root, target, DEFAULT_HIGHLIGHT_COLOR);
      else toggleMark(root, target, mark);
      const pending: PendingFormat =
        mark === 'highlight' ? { marks: {}, styles: {}, highlight: null } : { marks: { [mark]: false }, styles: {} };
      // The live range followed the text through splitting and merging, so its end is right after the word.
      return { caret: { node: target.endContainer, offset: target.endOffset }, pending };
    };
  }
  return null;
};

/** Matches smart quotes and the typography replacements. */
const typographyRule = (before: TextBefore, typed: string): InputRule | null => {
  const { text } = before;
  if (typed === '"' || typed === "'") {
    const previous = text.slice(-2, -1);
    const opening = previous === '' || QUOTE_OPENERS.test(previous);
    const replacement = typed === '"' ? (opening ? '“' : '”') : opening ? '‘' : '’';
    return () => ({ caret: replaceText(before, text.length - 1, text.length, replacement) });
  }
  for (const [pattern, replacement] of TYPOGRAPHY) {
    const match = text.match(pattern);
    if (!match || match.index === undefined) continue;
    const from = match.index;
    const to = from + match[0].length;
    return () => ({ caret: replaceText(before, from, to, replacement) });
  }
  return null;
};

/** Matches a URL completed by a typed space and turns it into a link (`www.` addresses get `https://`). */
const autolinkRule = (root: HTMLElement, before: TextBefore, range: Range): InputRule | null => {
  const match = before.text.match(AUTOLINK);
  if (!match?.[1] || linkAncestor(range.startContainer, root)) return null;
  const url = match[1];
  const from = before.text.length - 1 - url.length;
  return () => {
    const target = rangeOf(before, from, from + url.length);
    if (target) setLink(root, target, url.startsWith('www.') ? `https://${url}` : url, null);
    return { caret: null };
  };
};

/** Matches a typed `{{name}}` of a known variable and turns it into the variable chip. */
const variableRule = (
  root: HTMLElement,
  before: TextBefore,
  isKnownVariable: (name: string) => boolean
): InputRule | null => {
  const match = before.text.match(VARIABLE_PLACEHOLDER);
  const name = match?.[1];
  if (!match || match.index === undefined || !name || !isKnownVariable(name)) return null;
  const from = match.index;
  return () => {
    const target = rangeOf(before, from, before.text.length);
    if (!target) return { caret: null };
    target.deleteContents();
    target.collapse(true);
    return { caret: insertInlineAtCaret(root, target, createVariable(name)) };
  };
};

/**
 * Looks for a rule completed by the character that was just typed. The returned function performs the change,
 * so the caller can record an undo step first. Rules never apply inside code.
 *
 * @param isKnownVariable Whether a typed `{{name}}` names a template variable of the editor.
 */
export const matchInputRule = (
  root: HTMLElement,
  range: Range,
  typed: string,
  isKnownVariable: (name: string) => boolean = () => false
): InputRule | null => {
  const block = closestTextBlock(range.startContainer, root);
  if (!block || !range.collapsed || closestTag(range.startContainer, root, 'CODE')) return null;
  const before = readTextBefore(block, range);
  if (!before.text) return null;

  const rule =
    (typed === '}' && block.tagName !== 'PRE' ? variableRule(root, before, isKnownVariable) : null) ??
    (BLOCK_RULE_TRIGGERS.has(typed) ? blockRule(root, block, before) : null) ??
    (MARK_RULE_TRIGGERS.includes(typed) ? inlineMarkRule(root, before) : null) ??
    (typed === ' ' ? autolinkRule(root, before, range) : null);
  return rule ?? typographyRule(before, typed);
};
