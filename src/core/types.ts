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
