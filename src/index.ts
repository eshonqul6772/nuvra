/**
 * Public API of the document editor: the editor itself, its form-field wrapper (`Editor`), page settings, the image
 * upload contract, and label translation.
 */

export { default as DocumentEditor } from './components/document-editor.vue';
export type { EditorLabelKey, EditorTranslator } from './core/labels';
export { editorMessages, setEditorTranslator } from './core/labels';
export type {
  DocumentViewMode,
  PageHeaderFooter,
  PageMargins,
  PageOrientation,
  PageSettings,
  PageSizeKey,
  PageWatermark
} from './core/page';
export { createHeaderFooter, createPageSettings, createWatermark } from './core/page';
export type { DocumentImageUploadHandler } from './core/types';
export { default as Editor } from './editor.vue';
