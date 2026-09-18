/** Uploads an image and resolves with its public URL. Without a handler, images are embedded as data URLs. */
export type DocumentImageUploadHandler = (file: File) => Promise<string>;

export type DocumentMenuAction =
  | 'source'
  | 'print'
  | 'exportHtml'
  | 'exportWord'
  | 'exportPdf'
  | 'importWord'
  | 'formattingMarks'
  | 'ruler'
  | 'outline'
  | 'tableOfContents'
  | 'comments'
  | 'addComment'
  | 'footnote'
  | 'trackChanges'
  | 'changes'
  | 'fullscreen';

/**
 * Tools of the editor toolbar, in the order they appear. Pass a list of them as the `tools` prop to show only those;
 * keyboard shortcuts, the `/` menu and the right-click menu keep working either way.
 */
export const TOOLBAR_TOOLS = [
  /** Undo and redo. */
  'history',
  'formatPainter',
  /** Paragraph, heading, quote and code block. */
  'blockStyle',
  'fontFamily',
  /** Size field, size menu and the larger / smaller buttons. */
  'fontSize',
  /** Bold, italic, underline and the menu with strike, sub- and superscript, inline code and clear formatting. */
  'marks',
  /** Letter case and the Latin / Cyrillic conversion. */
  'textCase',
  'color',
  'highlight',
  'align',
  /** Line height and paragraph spacing. */
  'lineHeight',
  'direction',
  /** Bullet, numbered and task lists with the numbering style. */
  'lists',
  'indent',
  'link',
  'image',
  'table',
  'specialCharacters',
  /** The { } menu; shown only when `variables` are passed. */
  'variables',
  'signature',
  /** Page and section breaks, horizontal rule, dates, amount in words, footnote and table of contents. */
  'insert',
  /** Track changes, the changes panel and, with `v-model:comments`, the comment tools. */
  'review',
  'search',
  'templates',
  'headerFooter',
  'pageSetup',
  /** Print, export, Word import, navigation pane, ruler, formatting marks, HTML source and fullscreen. */
  'more'
] as const;

/** A tool of the editor toolbar; see {@link TOOLBAR_TOOLS}. */
export type ToolbarTool = (typeof TOOLBAR_TOOLS)[number];
