/**
 * Public API of the document editor: the editor itself, its form-field wrapper (`Editor`), page settings, the image
 * upload contract, and the built-in interface languages.
 */

export { default as DocumentEditor } from './components/document-editor.vue';
export type { EditorLocale, EditorLocaleCode, EditorLocaleInput } from './core/labels';
export { editorLocales, enLocale as en, ruLocale as ru, setEditorLocale, uzLocale as uz } from './core/labels';
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
