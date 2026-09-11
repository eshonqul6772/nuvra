import { escapeRegExp, isBreak, isText, textBlocksWithin } from './dom';

/** Matching options of the find bar. */
interface SearchOptions {
  /** Match letter case exactly. */
  caseSensitive: boolean;
  /** Only match whole words. */
  wholeWord: boolean;
}

/** Match counter shown in the find bar. */
export interface SearchState {
  /** Number of matches in the document. */
  total: number;
  /** 1-based index of the current match, 0 when there is none. */
  current: number;
}

/** Text node of a block with the offset of its first character within the block text. */
interface Segment {
  node: Text;
  start: number;
}

/** Names used by `::highlight()` rules in editor-ui.css. */
const MATCH_HIGHLIGHT = 'doc-search';
const CURRENT_HIGHLIGHT = 'doc-search-current';
/** Letters, digits and the apostrophes used in Uzbek words count as part of a word. */
const WORD_BEFORE = String.raw`(?<![\p{L}\p{N}_'‘’ʻ])`;
const WORD_AFTER = String.raw`(?![\p{L}\p{N}_'‘’ʻ])`;

/** Whether the browser supports the CSS Custom Highlight API; without it matches are still navigable. */
const supportsHighlights = () => typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

/** DOM range for block-text offsets `from`..`to`, or `null` when they do not map onto text nodes. */
const rangeFor = (segments: Segment[], from: number, to: number): Range | null => {
  const start = segments.find(segment => from >= segment.start && from < segment.start + segment.node.length);
  const end = segments.find(segment => to > segment.start && to <= segment.start + segment.node.length);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, from - start.start);
  range.setEnd(end.node, to - end.start);
  return range;
};

/** Find and replace without touching the document markup: matches are painted with CSS highlights. */
export class SearchController {
  /** Current search term; empty when the search is inactive. */
  private term = '';
  /** Current matching options. */
  private options: SearchOptions = { caseSensitive: false, wholeWord: false };
  /** Live ranges of all matches in document order. */
  private results: Range[] = [];
  /** Index of the current match, -1 when there is none. */
  private index = -1;

  /**
   * @param root the editable document element.
   * @param onChange called with the match counter whenever it may have changed.
   */
  constructor(
    private readonly root: HTMLElement,
    private readonly onChange: (state: SearchState) => void
  ) {}

  /** Current match counter. */
  get state(): SearchState {
    return { total: this.results.length, current: this.index + 1 };
  }

  /** Whether a search term is set, so the results must follow document edits. */
  get active(): boolean {
    return this.term !== '';
  }

  /** Starts a new search; options not passed keep their previous value. */
  setQuery(term: string, options: Partial<SearchOptions> = {}): void {
    this.term = term;
    this.options = { ...this.options, ...options };
    this.refresh(true);
  }

  /** Re-runs the search, e.g. after the document changed, keeping the current match position unless `reset`. */
  refresh(reset = false): void {
    this.results = this.term ? this.find() : [];
    if (reset || this.index < 0) this.index = this.results.length ? 0 : -1;
    else this.index = Math.min(this.index, this.results.length - 1);
    this.paint();
    this.onChange(this.state);
  }

  /** Moves to the next match, wrapping around, and scrolls it into view. */
  next(): void {
    if (!this.results.length) return;
    this.index = (this.index + 1) % this.results.length;
    this.reveal();
  }

  /** Moves to the previous match, wrapping around, and scrolls it into view. */
  previous(): void {
    if (!this.results.length) return;
    this.index = (this.index - 1 + this.results.length) % this.results.length;
    this.reveal();
  }

  /**
   * Replaces the current match; the caller records history and tidies the markup.
   * @returns whether a match was replaced.
   */
  replaceCurrent(replacement: string): boolean {
    const range = this.results[this.index];
    if (!range || range.collapsed) return false;
    this.replaceRange(range, replacement);
    this.refresh();
    return true;
  }

  /**
   * Replaces every match, last first so earlier ranges stay valid.
   * @returns the number of replaced matches.
   */
  replaceAll(replacement: string): number {
    const ranges = [...this.results].reverse();
    for (const range of ranges) this.replaceRange(range, replacement);
    this.refresh(true);
    return ranges.length;
  }

  /** Ends the search and removes the highlights. */
  clear(): void {
    this.term = '';
    this.results = [];
    this.index = -1;
    if (supportsHighlights()) {
      CSS.highlights.delete(MATCH_HIGHLIGHT);
      CSS.highlights.delete(CURRENT_HIGHLIGHT);
    }
    this.onChange(this.state);
  }

  /** Finds all matches block by block; line breaks count as newlines so matches never span them. */
  private find(): Range[] {
    const body = escapeRegExp(this.term);
    const pattern = this.options.wholeWord ? `${WORD_BEFORE}${body}${WORD_AFTER}` : body;
    const regex = new RegExp(pattern, this.options.caseSensitive ? 'gu' : 'giu');
    const ranges: Range[] = [];
    for (const block of textBlocksWithin(this.root)) {
      const segments: Segment[] = [];
      let text = '';
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (isText(node)) {
          segments.push({ node, start: text.length });
          text += node.data;
        } else if (isBreak(node)) {
          text += '\n';
        }
      }
      if (!text) continue;
      for (const match of text.matchAll(regex)) {
        if (!match[0]) continue;
        const range = rangeFor(segments, match.index, match.index + match[0].length);
        if (range) ranges.push(range);
      }
    }
    return ranges;
  }

  /** Paints all matches and, separately, the current one. */
  private paint() {
    if (!supportsHighlights()) return;
    const current = this.results[this.index];
    const matches = new Highlight();
    for (const range of this.results) if (range !== current) matches.add(range);
    CSS.highlights.set(MATCH_HIGHLIGHT, matches);
    if (current) CSS.highlights.set(CURRENT_HIGHLIGHT, new Highlight(current));
    else CSS.highlights.delete(CURRENT_HIGHLIGHT);
  }

  /** Repaints, scrolls the current match into the middle of the view and reports the counter. */
  private reveal() {
    this.paint();
    const range = this.results[this.index];
    range?.startContainer.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' });
    this.onChange(this.state);
  }

  /** Replaces the content of one match with plain text (an empty replacement deletes the match). */
  private replaceRange(range: Range, replacement: string) {
    range.deleteContents();
    if (replacement) range.insertNode(document.createTextNode(replacement));
  }
}
