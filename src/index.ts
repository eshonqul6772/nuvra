/**
 * Public API of the document editor: the editor itself, its form-field wrapper (`Editor`), page settings, the image
 * upload contract, and the built-in interface languages.
 */

export { default as DocumentCompare } from './compare.vue';
export { default as DocumentEditor } from './components/document-editor.vue';
export type { Collaborator, SelectionOffsets } from './core/collaboration';
export { collaboratorColor } from './core/collaboration';
export type { DocumentComment, DocumentCommentReply } from './core/comments';
export { createCommentId } from './core/comments';
export { formatLongDate, formatShortDate } from './core/dates';
export type { DocumentComparison } from './core/diff';
export { compareDocuments } from './core/diff';
export type { DocumentTemplate, DocumentTemplateId } from './core/document-templates';
export { getDocumentTemplate } from './core/document-templates';
export type { DocxSource } from './core/docx/export';
export { buildDocx } from './core/docx/export';
export type { DocxImport } from './core/docx/import';
export { readDocx } from './core/docx/import';
export type { DocumentEngine, TrackedChange } from './core/engine/engine';
export type { IconName } from './core/icons';
export type { EditorLocale, EditorLocaleCode, EditorLocaleInput } from './core/labels';
export {
  editorLocales,
  enLocale as en,
  ruLocale as ru,
  setEditorLocale,
  uzCyrlLocale as uzCyrl,
  uzLocale as uz
} from './core/labels';
export type { NumberWordsLocale } from './core/numbers';
export { formatAmountInWords, numberToWords, parseAmount } from './core/numbers';
export type { OutlineHeading, TableOfContentsEntry, TableOfContentsOptions } from './core/outline';
export { buildTableOfContents, readOutline } from './core/outline';
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
export type { SlashCommand } from './core/slash-commands';
export type { FillTemplateOptions, TemplateValues, TemplateVariable } from './core/templates';
export { fillTemplate, getTemplateVariables } from './core/templates';
export type { TransliterationDirection } from './core/transliterate';
export { transliterate } from './core/transliterate';
export type { DocumentImageUploadHandler, ToolbarTool } from './core/types';
export { TOOLBAR_TOOLS } from './core/types';
export type { EditorUiState } from './core/ui-state';
export { default as Editor } from './editor.vue';
export { default as DocumentForm } from './form.vue';
