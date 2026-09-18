<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';

import type { Collaborator, SelectionOffsets } from '../core/collaboration';
import { type DocumentComment, createCommentId, sortComments } from '../core/comments';
import { formatLongDate, formatShortDate } from '../core/dates';
import { templateVariableLabel } from '../core/document-templates';
import { DocumentEngine, type TrackedChange } from '../core/engine/engine';
import type { ListKind } from '../core/engine/lists';
import type { SheetFootnote } from '../core/footnotes';
import type { IconName } from '../core/icons';
import { type EditorLabelKey, type EditorLocaleInput, useEditorLabels } from '../core/labels';
import {
  type OutlineHeading,
  type OutlineView,
  TABLE_OF_CONTENTS_DEPTH,
  type TableOfContentsEntry,
  buildTableOfContents
} from '../core/outline';
import {
  type DocumentViewMode,
  type PageSettings,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  createPageSettings,
  getPageMetrics,
  pageNumberOf
} from '../core/page';
import {
  type PaginationController,
  type SheetGeometry,
  createPagination,
  sheetIndexAt,
  splitIntoPages,
  uniformSheets
} from '../core/pagination';
import { SIGNATURE_PRESETS, buildSignatureBlock } from '../core/signature';
import type { SlashCommand } from '../core/slash-commands';
import type { TemplateVariable } from '../core/templates';
import type { DocumentImageUploadHandler, DocumentMenuAction, ToolbarTool } from '../core/types';
import { EMPTY_UI_STATE, type EditorUiState, isSameUiState } from '../core/ui-state';
import EditorBubbleMenus from './editor-bubble-menus.vue';
// biome-ignore lint/style/useImportType: Component is rendered in the template.
import EditorCanvas from './editor-canvas.vue';
import EditorChanges from './editor-changes.vue';
import EditorCollaborators from './editor-collaborators.vue';
import EditorComments from './editor-comments.vue';
import EditorContextMenu from './editor-context-menu.vue';
// biome-ignore lint/style/useImportType: Component is rendered in the template.
import EditorFindBar from './editor-find-bar.vue';
import EditorFootnoteForm from './editor-footnote-form.vue';
import EditorOutline from './editor-outline.vue';
import EditorSlashMenu from './editor-slash-menu.vue';
import EditorStatusBar from './editor-status-bar.vue';
// biome-ignore lint/style/useImportType: Component is rendered in the template.
import EditorToolbar from './editor-toolbar.vue';

import '../styles/document-content.css';
import '../styles/editor-ui.css';

/**
 * Word-like document editor. Wires the editing engine to the toolbar, the page or web canvas, the find bar, the
 * status bar, and the contextual bubble menus. The document HTML is bound with `v-model`, page settings with
 * `v-model:page`.
 */
defineOptions({ name: 'DocumentEditor', inheritAttrs: false });

/** A CSS length: numbers are pixels, strings are used as written (for example, `'100%'` or `'auto'`). */
type CssSize = number | string;

interface Props {
  /** Places the caret at the end of the document as soon as the editor is ready. */
  autofocus?: boolean;
  /** Gray space around the page or web sheet that separates the document from the editor frame. */
  canvasPadding?: CssSize;
  /** Other people editing the document; their carets and selections are drawn over it. */
  collaborators?: readonly Collaborator[];
  /** Name written as the author of new comments, replies and tracked changes. */
  author?: string;
  /** View shown first; form fields use the lighter web view. */
  defaultViewMode?: DocumentViewMode;
  /** Makes the document read-only and disables every editing control. */
  disabled?: boolean;
  /** Height of the whole editor, or `'auto'` to grow with the content between `minHeight` and `maxHeight`. */
  height?: CssSize;
  /** Interface language: a built-in locale (`uz`, `en`, `ru`) or its code; defaults to the app-wide language. */
  locale?: EditorLocaleInput;
  /** Largest height of an auto-height editor; longer documents scroll inside it. */
  maxHeight?: CssSize;
  /** Largest accepted image file, in megabytes. */
  maxImageSizeMb?: number;
  /** Largest number of characters the document may contain; `0` means unlimited. */
  maxLength?: number;
  /** Smallest height of an auto-height editor. */
  minHeight?: CssSize;
  /** Text shown while the document is empty; falls back to the translated default placeholder. */
  placeholder?: string;
  /** Commands of the host application, listed first in the `/` menu. */
  slashCommands?: readonly SlashCommand[];
  /** Shows the ruler above the sheet in the page view; users can also toggle it in the document menu. */
  ruler?: boolean;
  /** Used as the print title and the exported file name. */
  title?: string;
  /**
   * Toolbar tools to show, such as `['history', 'marks', 'lists', 'link']`; every tool without a list. Keyboard
   * shortcuts, the `/` menu and the right-click menu are not affected.
   */
  tools?: readonly ToolbarTool[];
  /** Uploads an inserted image and resolves with its URL; without it images are embedded as data URLs. */
  uploadImage?: DocumentImageUploadHandler;
  /** Template variables the user can insert; typing `{{name}}` of one of them inserts it as well. */
  variables?: readonly TemplateVariable[];
}

const props = withDefaults(defineProps<Props>(), {
  autofocus: false,
  canvasPadding: 50,
  collaborators: () => [],
  author: '',
  defaultViewMode: 'page',
  disabled: false,
  height: 760,
  locale: undefined,
  maxHeight: 600,
  maxImageSizeMb: 10,
  maxLength: 0,
  minHeight: 240,
  placeholder: '',
  ruler: true,
  slashCommands: () => [],
  title: '',
  tools: undefined,
  uploadImage: undefined,
  variables: () => []
});

const { t, locale } = useEditorLabels(() => props.locale);

interface Emits {
  /** The editing surface lost focus; pending model updates have already been written. */
  blur: [];
  /** The editing surface received focus. */
  focus: [];
  /** An image was rejected by validation or its upload failed. */
  uploadError: [error: unknown];
  /** A Word file could not be read; the document is left unchanged. */
  importError: [error: unknown];
  /** The PDF could not be drawn, for example because the browser does not allow it. */
  exportError: [error: unknown];
  /** The caret or selection moved; `null` when it left the document. Send it to the other people editing. */
  selectionChange: [selection: SelectionOffsets | null];
}

const emit = defineEmits<Emits>();

defineSlots<{
  /**
   * Buttons of the host application, placed at the start of the toolbar's right-hand group. `engine` runs editing
   * commands, `state` describes the formatting at the caret and `disabled` tells whether editing is possible.
   */
  toolbar?: (props: { engine: DocumentEngine; state: EditorUiState; disabled: boolean }) => unknown;
}>();

/** Document HTML. An empty document is written as an empty string; typing updates it after a short delay. */
const model = defineModel<string>({ default: '' });

/** Paper size, orientation, and margins used by the page view, printing, and export. */
const page = defineModel<PageSettings>('page', { default: createPageSettings });

/** Whether edits are recorded as tracked changes; the toolbar can switch it. */
const trackChanges = defineModel<boolean>('trackChanges', { default: false });

/** Comments on the document; binding it turns the comment tools on. The HTML keeps only their anchors. */
const comments = defineModel<DocumentComment[] | undefined>('comments', { default: undefined });

/** Delay before typing is serialized into the model; serializing the whole document per keystroke is expensive. */
const MODEL_UPDATE_DELAY = 200;
/** MIME types accepted as images. */
const IMAGE_MIME = /^image\//;
const BYTES_PER_MEGABYTE = 1024 * 1024;
/** Zoom percentage that shows the document at its real size. */
const ACTUAL_SIZE_ZOOM = 100;
/** Closing tags after which the HTML source view starts a new line. */
const SOURCE_LINE_ENDINGS = /(<\/(?:p|h[1-6]|li|ul|ol|blockquote|pre|table|thead|tbody|tr|div)>|<hr>)(?!\n)/g;

/** Converts a size prop into a CSS length; numbers are pixels. */
const toCssSize = (value: CssSize) => (typeof value === 'number' ? `${value}px` : value);

const sectionRef = ref<HTMLElement>();
/** Area under the toolbar that panels and the `/` menu are positioned in. */
const bodyRef = ref<HTMLElement>();
const canvasRef = ref<InstanceType<typeof EditorCanvas>>();
const toolbarRef = ref<InstanceType<typeof EditorToolbar>>();
const findBarRef = ref<InstanceType<typeof EditorFindBar>>();

/** The editing engine, created once the canvas has mounted its editable element. */
const engine = shallowRef<DocumentEngine | null>(null);
/** Where the editor is teleported in fullscreen: the surrounding dialog or drawer, otherwise `body`. */
const fullscreenTarget = shallowRef<HTMLElement | 'body'>('body');
const viewMode = ref<DocumentViewMode>(props.defaultViewMode);
/** Zoom in percent. */
const zoom = ref(ACTUAL_SIZE_ZOOM);
const fullscreen = ref(false);
/** Whether the raw HTML textarea replaces the canvas. */
const sourceMode = ref(false);
/** Whether paragraph marks are drawn at the end of every line, as in office suites. */
const formattingMarks = ref(false);
/** Whether the ruler is shown; it starts from the prop and the document menu toggles it. */
const rulerVisible = ref(props.ruler);
/** HTML edited in source mode; applied to the document when source mode is left. */
const sourceHtml = ref('');
const findOpen = ref(false);
/** Whether the find bar also shows the replacement row. */
const replaceOpen = ref(false);
/** Whether images are currently being read or uploaded. */
const uploading = ref(false);
const pageCount = ref(1);
/** Position, size and orientation of every sheet, as laid out by pagination. */
const sheetGeometry = shallowRef<SheetGeometry[]>([]);
/** Sheets of the current layout, or alike sheets while pagination has not reported them. */
const currentSheets = () =>
  sheetGeometry.value.length === pageCount.value ? sheetGeometry.value : uniformSheets(metrics.value, pageCount.value);
/** Footnotes of every sheet, as laid out by pagination. */
const footnotePages = shallowRef<SheetFootnote[][]>([]);
/** Page that contains the caret, shown in the status bar. */
const currentPage = ref(1);
/** Toolbar snapshot; replaced only when a visible value changes, so the toolbar does not re-render per keystroke. */
const uiState = shallowRef<EditorUiState>(EMPTY_UI_STATE);
const stats = shallowRef({ words: 0, characters: 0 });

let pagination: PaginationController | null = null;
/** Last HTML written to the model, used to ignore the model echo of our own updates. */
let lastEmitted = model.value;
/** Whether the document changed since it was last serialized into the model. */
let dirty = false;
let modelTimer: ReturnType<typeof setTimeout> | undefined;
let uiSyncFrame = 0;
/** Body `overflow` value to restore when fullscreen ends. */
let previousBodyOverflow = '';
/** Until the user picks zoom, narrow containers (phones, side panels) shrink the page to fit. */
let autoZoom = true;
/** Last content width reported by the canvas, used by automatic zoom. */
let canvasWidth = 0;
/** Unsubscribe callbacks for engine events. */
const disposers: Array<() => void> = [];

/** Page geometry in pixels for the chosen paper settings. */
const metrics = computed(() => getPageMetrics(page.value));
/** Scroll container of the canvas, which bubble menus follow while scrolling. */
const canvasScroll = computed(() => canvasRef.value?.scrollElement);
/** Auto height applies only outside fullscreen, where the editor always fills the viewport. */
const autoHeight = computed(() => props.height === 'auto' && !fullscreen.value);
/** CSS variables shared with the canvas. */
const rootStyle = computed(() => ({
  '--doc-editor-canvas-padding': toCssSize(props.canvasPadding),
  '--doc-editor-height': toCssSize(props.height),
  '--doc-editor-min-height': toCssSize(props.minHeight),
  '--doc-editor-max-height': toCssSize(props.maxHeight)
}));

/** Recounts words and characters for the status bar. */
const refreshStats = () => {
  if (engine.value) stats.value = engine.value.getStats();
};

/** Writes the current document HTML into the model right away and cancels a pending delayed update. */
const flushModel = () => {
  clearTimeout(modelTimer);
  modelTimer = undefined;
  dirty = false;
  const instance = engine.value;
  if (!instance) return;
  refreshStats();
  const html = instance.isEmpty ? '' : instance.getHTML();
  if (html === lastEmitted) return;
  lastEmitted = html;
  model.value = html;
};

/** Marks the document as changed and serializes it once typing pauses. */
const scheduleModelUpdate = () => {
  dirty = true;
  clearTimeout(modelTimer);
  modelTimer = setTimeout(flushModel, MODEL_UPDATE_DELAY);
};

/** Page number that contains the caret; always 1 outside a multipage page view. */
const readCurrentPage = () => {
  const instance = engine.value;
  const selection = document.getSelection();
  if (!instance || viewMode.value !== 'page' || pageCount.value < 2 || !selection?.rangeCount) return 1;
  const range = selection.getRangeAt(0);
  const container = range.startContainer;
  if (!instance.root.contains(container)) return currentPage.value;
  // A collapsed caret in an empty line has no client rect; its element's box is close enough.
  const caretRect =
    range.getClientRects()[0] ??
    (container instanceof Element ? container : container.parentElement)?.getBoundingClientRect();
  if (!caretRect) return currentPage.value;
  const offset = (caretRect.top - instance.root.getBoundingClientRect().top) / (zoom.value / ACTUAL_SIZE_ZOOM);
  return Math.min(pageCount.value, sheetIndexAt(currentSheets(), offset) + 1);
};

/** Reads the toolbar state and current page; the snapshot is published only when a visible value changed. */
const syncUiState = () => {
  uiSyncFrame = 0;
  const instance = engine.value;
  if (!instance) return;
  const next = instance.getState();
  if (!isSameUiState(uiState.value, next)) uiState.value = next;
  currentPage.value = readCurrentPage();
};

/** Coalesces toolbar state reads into one per animation frame. */
const scheduleUiSync = () => {
  if (!uiSyncFrame) uiSyncFrame = requestAnimationFrame(syncUiState);
};

/** Reads an image file as a data URL, used when no upload handler is provided. */
const readImageAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error(t('editor.imageReadError')));
    reader.onerror = () => reject(reader.error ?? new Error(t('editor.imageReadError')));
    reader.readAsDataURL(file);
  });

/** Returns the reason a file cannot be inserted as an image, or `null` when it is acceptable. */
const validateImage = (file: File) => {
  if (!IMAGE_MIME.test(file.type)) return new Error(t('editor.imageTypeError'));
  if (file.size > props.maxImageSizeMb * BYTES_PER_MEGABYTE) {
    return new Error(t('editor.imageSizeError', { size: props.maxImageSizeMb }));
  }
  return null;
};

/** Validates, uploads (or embeds) and inserts images one after another; failures are reported via `uploadError`. */
const insertImages = async (files: File[]) => {
  if (!engine.value || props.disabled || !files.length) return;
  uploading.value = true;
  try {
    for (const file of files) {
      const error = validateImage(file);
      if (error) {
        emit('uploadError', error);
        continue;
      }
      try {
        const src = props.uploadImage ? await props.uploadImage(file) : await readImageAsDataUrl(file);
        if (src) engine.value?.insertImage(src, file.name);
        else emit('uploadError', new Error(t('editor.imageUploadError')));
      } catch (uploadError) {
        emit('uploadError', uploadError);
      }
    }
  } finally {
    uploading.value = false;
  }
};

/** Opens the find bar, optionally with the replacement row, or refocuses its input when it is already open. */
const openFind = (withReplace: boolean) => {
  if (sourceMode.value) return;
  if (withReplace && !props.disabled) replaceOpen.value = true;
  if (findOpen.value) findBarRef.value?.focus();
  findOpen.value = true;
};

/** Closes the find bar and returns focus to the document. */
const closeFind = () => {
  findOpen.value = false;
  engine.value?.focus();
};

/** Toolbar search button: opens or closes the find bar. */
const toggleFind = () => (findOpen.value ? closeFind() : openFind(false));

/** Puts block-level closing tags on their own lines so the HTML source is readable. */
const formatHtml = (html: string) => html.replace(SOURCE_LINE_ENDINGS, '$1\n');

/** Switches between the canvas and the HTML source; leaving source mode applies the edited HTML as one undo step. */
const toggleSource = () => {
  const instance = engine.value;
  if (!instance) return;
  if (!sourceMode.value) {
    if (dirty) flushModel();
    findOpen.value = false;
    sourceHtml.value = formatHtml(instance.getHTML());
    sourceMode.value = true;
    return;
  }
  sourceMode.value = false;
  if (!props.disabled) {
    // Parsing through the sanitizer drops scripts, handlers and any markup the editor does not support.
    instance.setContent(sourceHtml.value, { addToHistory: true, emitUpdate: true });
    flushModel();
  }
  void nextTick(() => instance.focus());
};

/** Document HTML, page settings, and title used for printing and export. */
const exportSnapshot = () => {
  const instance = engine.value;
  return {
    html: instance && !instance.isEmpty ? instance.getHTML() : model.value,
    // The page view has the sheets laid out already, so print and export can repeat the running texts per page and
    // break the pages exactly where the editor shows them.
    pages:
      instance && viewMode.value === 'page'
        ? splitIntoPages(instance.root, metrics.value, pageCount.value, currentSheets())
        : undefined,
    rotated: viewMode.value === 'page' ? currentSheets().map(sheet => sheet.rotated) : undefined,
    footnotes: footnotePages.value,
    page: page.value,
    title: props.title || t('editor.document')
  };
};

/** Opens the browser print dialog for the document; the export module is loaded on demand. */
const print = async () => {
  const { buildPrintableHtml, printHtml } = await import('../core/export');
  printHtml(buildPrintableHtml(exportSnapshot()));
};

/**
 * Downloads the document as a standalone HTML page, a Word document (`.docx`) or a PDF; the modules load on demand.
 * A PDF is drawn from the sheets of the page view, so the web view switches to it for the moment of the export.
 */
const exportDocument = async (format: 'html' | 'word' | 'pdf') => {
  const { buildPrintableHtml, downloadFile, paperSize, toFileName } = await import('../core/export');
  if (format === 'pdf') {
    const previousMode = viewMode.value;
    if (previousMode !== 'page') {
      viewMode.value = 'page';
      await nextTick();
      await afterLayout();
      await afterLayout();
    }
    try {
      const snapshot = exportSnapshot();
      const { PDF_MIME, renderPdf } = await import('../core/pdf');
      const pdf = await renderPdf(buildPrintableHtml(snapshot), paperSize(snapshot.page));
      downloadFile(pdf, `${toFileName(snapshot.title)}.pdf`, PDF_MIME);
    } catch (error) {
      emit('exportError', error);
    } finally {
      viewMode.value = previousMode;
    }
    return;
  }
  const snapshot = exportSnapshot();
  const fileName = toFileName(snapshot.title);
  if (format === 'word') {
    const { DOCX_MIME, buildDocx } = await import('../core/docx/export');
    downloadFile(await buildDocx(snapshot), `${fileName}.docx`, DOCX_MIME);
  } else {
    downloadFile(buildPrintableHtml(snapshot), `${fileName}.html`, 'text/html;charset=utf-8');
  }
};

/** Delay after the last edit before the navigation panel re-reads the headings. */
const OUTLINE_REFRESH_DELAY = 300;

/** Whether the navigation panel is open. */
const outlineVisible = ref(false);
/** Whether the navigation panel lists headings or page thumbnails. */
const outlineView = ref<OutlineView>('headings');
/** Clean HTML of every sheet, for the page thumbnails. */
const outlinePages = shallowRef<string[]>([]);
/** Headings shown in the navigation panel, with the page each starts on. */
const outline = shallowRef<Array<OutlineHeading & { page: number | null }>>([]);
let outlineTimer: ReturnType<typeof setTimeout> | undefined;

/** Page number printed on the sheet a top-level block starts on, or `null` outside the page view. */
const pageOfBlock = (element: HTMLElement) => {
  if (viewMode.value !== 'page') return null;
  return pageNumberOf(page.value, sheetIndexAt(currentSheets(), element.offsetTop) + 1);
};

/** Re-reads the headings for the navigation panel; skipped while the panel is closed. */
const refreshOutline = () => {
  clearTimeout(outlineTimer);
  outlineTimer = undefined;
  const instance = engine.value;
  if (!instance || !outlineVisible.value) return;
  if (outlineView.value === 'pages') {
    outlinePages.value =
      viewMode.value === 'page' ? splitIntoPages(instance.root, metrics.value, pageCount.value, currentSheets()) : [];
    return;
  }
  outline.value = instance.getOutline().map(heading => ({ ...heading, page: pageOfBlock(heading.element) }));
};

/** Scrolls the canvas to a sheet chosen in the navigation panel, counted from 0. */
const goToPage = (index: number) => {
  canvasRef.value?.scrollElement?.querySelectorAll('.doc-canvas__sheet')[index]?.scrollIntoView({ block: 'start' });
};

/** Refreshes the navigation panel once editing pauses. */
const scheduleOutlineRefresh = () => {
  if (!outlineVisible.value) return;
  clearTimeout(outlineTimer);
  outlineTimer = setTimeout(refreshOutline, OUTLINE_REFRESH_DELAY);
};

/** Waits until pagination has laid out the latest change. */
const afterLayout = () =>
  new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** Lines of the table of contents for the current headings and layout. */
const tableOfContentsEntries = (instance: DocumentEngine) =>
  instance
    .getOutline(TABLE_OF_CONTENTS_DEPTH)
    .map(heading => ({ level: heading.level, text: heading.text, page: pageOfBlock(heading.element) }));

/** HTML of a table of contents with the given lines, as wide as the text area of the page. */
const tableOfContentsHtml = (entries: TableOfContentsEntry[]) => {
  const { width, marginLeft, marginRight } = metrics.value;
  return buildTableOfContents(entries, {
    title: t('editor.toc'),
    emptyText: t('editor.toc.empty'),
    width: viewMode.value === 'page' ? width - marginLeft - marginRight : undefined
  });
};

/**
 * Inserts the table of contents at the caret, or refreshes the existing one. A new table moves the headings after it,
 * so its page numbers are corrected once the document has been laid out again.
 */
const updateTableOfContents = async () => {
  const instance = engine.value;
  if (!instance || props.disabled) return;
  const existed = instance.hasTableOfContents;
  const entries = tableOfContentsEntries(instance);
  instance.setTableOfContents(tableOfContentsHtml(entries));
  if (existed || viewMode.value !== 'page') return;
  await afterLayout();
  const corrected = tableOfContentsEntries(instance);
  if (corrected.some((entry, index) => entry.page !== entries[index]?.page)) {
    // Part of the same insertion: undo removes the table in one step.
    instance.setTableOfContents(tableOfContentsHtml(corrected), { addToHistory: false });
  }
};

/** Whether the host keeps comments with `v-model:comments`; without it the comment tools are hidden. */
const commentsEnabled = computed(() => comments.value !== undefined);
/** Whether the comments panel is open. */
const commentsVisible = ref(false);
/** id of the comment whose text is anchored but whose first message is still being written. */
const draftCommentId = ref<string | null>(null);
/** Ids of the comments anchored in the document, in document order. */
const anchoredCommentIds = shallowRef<string[]>([]);
const anchoredCommentSet = computed(() => new Set(anchoredCommentIds.value));
/** Comments in the order of their anchors. */
const sortedComments = computed(() => sortComments(comments.value ?? [], anchoredCommentIds.value));

/** Re-reads the anchors and redraws resolved and active comments. */
const syncComments = () => {
  const instance = engine.value;
  if (!instance || !commentsEnabled.value) return;
  anchoredCommentIds.value = instance.getCommentIds();
  const resolved = new Set((comments.value ?? []).filter(comment => comment.resolved).map(comment => comment.id));
  instance.decorateComments(resolved, commentsVisible.value ? uiState.value.comment || null : null);
};

/**
 * Starts a comment on the selected text. The text is anchored right away, so the selection survives focus moving to
 * the comment form; abandoning the comment undoes the anchor.
 */
const startComment = () => {
  const instance = engine.value;
  if (!instance || props.disabled || !commentsEnabled.value || draftCommentId.value) return;
  const id = createCommentId();
  if (!instance.addComment(id)) return;
  draftCommentId.value = id;
  commentsVisible.value = true;
};

/** Writes the first message of the drafted comment. */
const saveComment = (text: string) => {
  const id = draftCommentId.value;
  if (!id) return;
  const comment: DocumentComment = { id, text, createdAt: new Date().toISOString(), replies: [] };
  if (props.author) comment.author = props.author;
  comments.value = [...(comments.value ?? []), comment];
  draftCommentId.value = null;
  syncComments();
};

/** Abandons the drafted comment and takes its anchor back. */
const cancelComment = () => {
  if (!draftCommentId.value) return;
  draftCommentId.value = null;
  engine.value?.undo();
};

/** Applies a change to one comment of the model. */
const updateComment = (id: string, change: (comment: DocumentComment) => DocumentComment) => {
  comments.value = (comments.value ?? []).map(comment => (comment.id === id ? change(comment) : comment));
};

const replyToComment = (id: string, text: string) =>
  updateComment(id, comment => ({
    ...comment,
    replies: [
      ...(comment.replies ?? []),
      {
        id: createCommentId(),
        text,
        createdAt: new Date().toISOString(),
        ...(props.author ? { author: props.author } : {})
      }
    ]
  }));

const resolveComment = (id: string, resolved: boolean) => updateComment(id, comment => ({ ...comment, resolved }));

/** Deletes a comment together with its anchor. */
const removeComment = (id: string) => {
  engine.value?.removeComment(id);
  comments.value = (comments.value ?? []).filter(comment => comment.id !== id);
};

watch([comments, commentsVisible, () => uiState.value.comment], syncComments, { deep: true });

/** Last selection reported with `selectionChange`, serialized, so moves within the same position are not sent. */
let reportedSelection = '';

/** Reports where the caret is, for the host to share with other people editing. */
const reportSelection = () => {
  const offsets = engine.value?.getSelectionOffsets() ?? null;
  const key = JSON.stringify(offsets);
  if (key === reportedSelection) return;
  reportedSelection = key;
  emit('selectionChange', offsets);
};

/** Measures collaborator marks again whenever the layout may have moved the text. */
const collaboratorLayoutKey = computed(
  () => `${zoom.value}|${viewMode.value}|${pageCount.value}|${JSON.stringify(page.value)}|${fullscreen.value}`
);

/** Whether the tracked changes panel is open. */
const changesVisible = ref(false);
/** Tracked changes shown in the panel. */
const trackedChanges = shallowRef<TrackedChange[]>([]);

/** Re-reads the tracked changes for the panel; skipped while it is closed. */
const refreshChanges = () => {
  if (changesVisible.value && engine.value) trackedChanges.value = engine.value.getChanges();
};

/** Accepts or rejects one change, or all of them. */
const resolveChanges = (accept: boolean, id?: string) => {
  engine.value?.resolveChanges(accept, id);
  refreshChanges();
};

/** The engine records changes with the current author while tracking is on. */
watch([trackChanges, () => props.author, engine], ([enabled, author, instance]) =>
  instance?.setTrackChanges(enabled, author)
);

/** Footnote whose note is being edited; `isNew` when it was inserted just now and has no text yet. */
const footnoteTarget = shallowRef<{ element: HTMLElement; isNew: boolean; id: number } | null>(null);
/** Counts opened footnote forms, so every opening gets a fresh form. */
let footnoteForms = 0;

/** Inserts a footnote at the caret and opens the form for its text. */
const startFootnote = () => {
  const instance = engine.value;
  if (!instance || props.disabled) return;
  const element = instance.insertFootnote('');
  if (element) footnoteTarget.value = { element, isNew: true, id: ++footnoteForms };
};

/** Saves the note; a new footnote left empty is taken back. */
const saveFootnote = (text: string) => {
  const target = footnoteTarget.value;
  footnoteTarget.value = null;
  if (!target || !engine.value) return;
  if (!text && target.isNew) engine.value.undo();
  else if (text) engine.value.setFootnoteText(target.element, text);
  engine.value.focus();
};

/** Leaves the form; a new footnote without text is taken back. */
const cancelFootnote = () => {
  const target = footnoteTarget.value;
  footnoteTarget.value = null;
  if (target?.isNew) engine.value?.undo();
  engine.value?.focus();
};

const removeFootnote = () => {
  const target = footnoteTarget.value;
  footnoteTarget.value = null;
  if (target) engine.value?.removeFootnote(target.element);
  engine.value?.focus();
};

/** A click on a footnote reference opens its note. */
const onDocumentClick = (event: MouseEvent) => {
  const reference = (event.target as Element | null)?.closest?.<HTMLElement>('sup[data-footnote]');
  if (reference && engine.value?.root.contains(reference))
    footnoteTarget.value = { element: reference, isNew: false, id: ++footnoteForms };
};

/** Commands of the `/` menu: the host's own first, then blocks, lists, fields and signature blocks. */
const slashCommands = computed<SlashCommand[]>(() => {
  const heading = (level: 1 | 2 | 3): SlashCommand => ({
    id: `h${level}`,
    label: t('editor.heading', { level }),
    icon: 'pilcrow',
    keywords: ['heading', 'sarlavha', 'заголовок'],
    run: engine => engine.setBlockType(`H${level}`)
  });
  const list = (kind: ListKind, icon: IconName, label: EditorLabelKey): SlashCommand => ({
    id: kind,
    label: t(label),
    icon,
    keywords: ['list', 'ro‘yxat', 'список'],
    run: engine => engine.toggleList(kind)
  });
  return [
    ...props.slashCommands,
    {
      id: 'paragraph',
      label: t('editor.paragraph'),
      icon: 'pilcrow',
      keywords: ['text', 'matn', 'текст'],
      run: engine => engine.setBlockType('P')
    },
    heading(1),
    heading(2),
    heading(3),
    list('bulletList', 'list', 'editor.bulletList'),
    list('orderedList', 'list-ordered', 'editor.orderedList'),
    list('taskList', 'list-todo', 'editor.taskList'),
    { id: 'quote', label: t('editor.quote'), icon: 'quote', run: engine => engine.toggleBlockquote() },
    { id: 'code', label: t('editor.codeBlock'), icon: 'square-code', run: engine => engine.toggleCodeBlock() },
    {
      id: 'table',
      label: t('editor.table.insert'),
      icon: 'grid-3x3',
      keywords: ['jadval', 'таблица'],
      run: engine => engine.insertTable(3, 3, false)
    },
    {
      id: 'hr',
      label: t('editor.horizontalRule'),
      icon: 'separator-horizontal',
      run: engine => engine.insertHorizontalRule()
    },
    {
      id: 'sectionLandscape',
      label: t('editor.sectionBreak.landscape'),
      icon: 'rectangle-horizontal',
      keywords: ['albom', 'landscape', 'альбомная', 'bo‘lim', 'section'],
      run: engine => engine.insertSectionBreak('landscape')
    },
    {
      id: 'sectionPortrait',
      label: t('editor.sectionBreak.portrait'),
      icon: 'rectangle-vertical',
      keywords: ['kitob', 'portrait', 'книжная', 'bo‘lim', 'section'],
      run: engine => engine.insertSectionBreak('portrait')
    },
    {
      id: 'pageBreak',
      label: t('editor.pageBreak'),
      icon: 'square-split-vertical',
      run: engine => engine.insertPageBreak()
    },
    {
      id: 'footnote',
      label: t('editor.footnote'),
      icon: 'superscript',
      keywords: ['snoska', 'сноска', 'izoh'],
      run: () => startFootnote()
    },
    {
      id: 'toc',
      label: t(uiState.value.tableOfContents ? 'editor.toc.update' : 'editor.toc'),
      icon: 'table-of-contents',
      keywords: ['mundarija', 'оглавление', 'contents'],
      run: () => void updateTableOfContents()
    },
    {
      id: 'date',
      label: t('editor.insertDate'),
      icon: 'calendar-days',
      keywords: ['sana', 'дата'],
      run: engine => engine.insertText(formatShortDate(new Date()))
    },
    {
      id: 'dateLong',
      label: t('editor.insertDateLong'),
      icon: 'calendar-days',
      keywords: ['sana', 'дата'],
      run: engine => engine.insertText(formatLongDate(new Date(), locale.value))
    },
    ...SIGNATURE_PRESETS.map(
      (preset): SlashCommand => ({
        id: `signature-${preset.value}`,
        label: t(preset.label),
        icon: 'signature',
        keywords: ['imzo', 'подпись', 'signature'],
        run: engine => engine.insertContent(buildSignatureBlock(preset.value, t), { asBlocks: true })
      })
    ),
    ...props.variables.map(
      (variable): SlashCommand => ({
        id: `variable-${variable.name}`,
        label: variable.label,
        icon: 'braces',
        keywords: [variable.name],
        run: engine => engine.insertVariable(variable.name)
      })
    )
  ];
});

/** Hidden file input of the "open Word file" menu entry. */
const wordInputRef = ref<HTMLInputElement>();

/**
 * Replaces the document with the content and page setup of a Word file, as one undo step for the content. A file that
 * cannot be read leaves the document unchanged and is reported through `importError`.
 */
const importWord = async (file: File) => {
  const instance = engine.value;
  if (!instance || props.disabled) return;
  try {
    const { readDocx } = await import('../core/docx/import');
    const result = await readDocx(await file.arrayBuffer());
    instance.setContent(result.html, { addToHistory: true, emitUpdate: true });
    page.value = { ...result.page, ...(page.value.watermark ? { watermark: page.value.watermark } : {}) };
    flushModel();
    instance.focus('start');
  } catch (error) {
    emit('importError', error);
  }
};

/** Opens the Word file picked in the file dialog and resets the input so the same file can be picked again. */
const onWordFilePicked = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) void importWord(file);
};

/** Runs an action chosen in the toolbar's "more" menu. */
const onMenu = (action: DocumentMenuAction) => {
  switch (action) {
    case 'source':
      toggleSource();
      break;
    case 'print':
      void print();
      break;
    case 'exportHtml':
      void exportDocument('html');
      break;
    case 'exportWord':
      void exportDocument('word');
      break;
    case 'exportPdf':
      void exportDocument('pdf');
      break;
    case 'importWord':
      wordInputRef.value?.click();
      break;
    case 'ruler':
      rulerVisible.value = !rulerVisible.value;
      break;
    case 'outline':
      outlineVisible.value = !outlineVisible.value;
      refreshOutline();
      break;
    case 'tableOfContents':
      void updateTableOfContents();
      break;
    case 'comments':
      commentsVisible.value = !commentsVisible.value;
      if (!commentsVisible.value) cancelComment();
      break;
    case 'addComment':
      startComment();
      break;
    case 'footnote':
      startFootnote();
      break;
    case 'trackChanges':
      trackChanges.value = !trackChanges.value;
      break;
    case 'changes':
      changesVisible.value = !changesVisible.value;
      refreshChanges();
      break;
    case 'formattingMarks':
      formattingMarks.value = !formattingMarks.value;
      // The class lives on the editable root, which is never serialized, so the marks stay out of the document.
      engine.value?.root.classList.toggle('doc-show-marks', formattingMarks.value);
      break;
    default:
      fullscreen.value = !fullscreen.value;
  }
};

/** Applies zoom chosen by the user, which also turns automatic zoom off. */
const setZoom = (value: number) => {
  autoZoom = false;
  zoom.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
};

/** Applies margins dragged on the ruler. */
const onMarginsChange = (margins: { left: number; right: number }) => {
  page.value = { ...page.value, margins: { ...page.value.margins, ...margins } };
};

/** Zooms by whole steps, e.g. from Ctrl/⌘ and the wheel; the result is snapped to the zoom step. */
const zoomBy = (delta: number) => setZoom(Math.round((zoom.value + delta) / ZOOM_STEP) * ZOOM_STEP);

/** Zooms so the page width fills the canvas. */
const fitWidth = () => {
  const next = canvasRef.value?.getFitWidthZoom();
  if (next) setZoom(next);
};

/** Shrinks the page to fit narrow canvases, never above actual size, until the user picks zoom. */
const applyAutoZoom = () => {
  if (!autoZoom || !canvasWidth || viewMode.value !== 'page') return;
  // The widest sheet has to fit; a section break can turn some sheets wider than the document's own.
  const widest = Math.max(metrics.value.width, ...currentSheets().map(sheet => sheet.width));
  const fitting = Math.floor((canvasWidth / widest) * ACTUAL_SIZE_ZOOM);
  zoom.value = Math.min(ACTUAL_SIZE_ZOOM, Math.max(ZOOM_MIN, fitting));
};

/** Remembers the canvas width reported after a resize and re-evaluates automatic zoom. */
const onCanvasResize = (width: number) => {
  canvasWidth = width;
  applyAutoZoom();
};

/**
 * Editor-level shortcuts: find (Mod+F), replace (Mod+H; Mod+Shift+H stays the engine's highlight), link (Mod+K), print
 * (Mod+P) and Escape. Physical key codes keep the shortcuts working with non-Latin keyboard layouts.
 */
const onKeydown = (event: KeyboardEvent) => {
  const mod = event.ctrlKey || event.metaKey;
  const key = event.code;
  if (mod && !event.altKey && !event.shiftKey && key === 'KeyF') {
    event.preventDefault();
    openFind(false);
  } else if (mod && !event.altKey && !event.shiftKey && key === 'KeyH') {
    event.preventDefault();
    openFind(true);
  } else if (mod && key === 'KeyK' && !props.disabled && !sourceMode.value) {
    event.preventDefault();
    toolbarRef.value?.openLink();
  } else if (mod && event.altKey && key === 'KeyM' && commentsEnabled.value) {
    // Word's shortcut for a new comment.
    event.preventDefault();
    startComment();
  } else if (mod && key === 'KeyP') {
    event.preventDefault();
    void print();
  } else if (event.key === 'Escape' && findOpen.value) {
    // Escape handled by the editor must not also close a surrounding dialog.
    event.stopPropagation();
    closeFind();
  } else if (event.key === 'Escape' && fullscreen.value) {
    event.stopPropagation();
    fullscreen.value = false;
  }
};

/** Replaces the document when the model is changed from outside (not by the editor's own updates). */
watch(model, value => {
  const instance = engine.value;
  if (!instance || value === lastEmitted) return;
  clearTimeout(modelTimer);
  dirty = false;
  lastEmitted = value;
  // Someone else's version of the document keeps the local caret where it was.
  instance.setContent(value, { keepSelection: true });
  refreshStats();
  pagination?.schedule();
  scheduleOutlineRefresh();
  syncComments();
});

/** Page numbers and thumbnails in the navigation panel follow the layout and the chosen list. */
watch([pageCount, viewMode, metrics, () => page.value.firstPageNumber], scheduleOutlineRefresh);
watch(outlineView, refreshOutline);

/** Keeps the engine's editability in sync with the `disabled` prop. */
watch(
  () => props.disabled,
  disabled => engine.value?.setEditable(!disabled)
);

/** Variable chips show the labels of the current variable list, in the current language. */
watch([() => props.variables, locale], () => engine.value?.refreshVariables(), { deep: true });

/** Paginates in page view only; the web view is one continuous sheet. */
watch([metrics, viewMode], ([nextMetrics, mode]) => pagination?.setMetrics(mode === 'page' ? nextMetrics : null));

/** The current page depends on pagination, zoom, and view mode. */
watch([pageCount, zoom, viewMode], scheduleUiSync);

/** Paper, view or section changes can make a page too wide for the canvas again. */
watch([metrics, viewMode, sheetGeometry], applyAutoZoom);

/** Enters or leaves fullscreen: picks the teleport target and locks page scrolling. */
watch(fullscreen, value => {
  if (value) {
    // Inside a dialog or drawer, the editor stays in it, so the dialog's focus trap keeps allowing input.
    fullscreenTarget.value = sectionRef.value?.closest<HTMLElement>('dialog, [role="dialog"]') ?? 'body';
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = previousBodyOverflow;
  }
  // Teleporting moves the editor DOM, which drops the browser selection.
  void nextTick(() => engine.value?.focus());
});

/** Creates the engine on the canvas' editable element and connects pagination and engine events. */
onMounted(() => {
  const root = canvasRef.value?.contentElement;
  if (!root) return;
  const instance = new DocumentEngine(root, {
    content: model.value,
    editable: !props.disabled,
    maxLength: props.maxLength,
    placeholder: () => props.placeholder || t('editor.placeholder'),
    onImageFiles: files => void insertImages(files),
    variableLabel: name =>
      props.variables.find(variable => variable.name === name)?.label ?? templateVariableLabel(name, locale.value)
  });
  root.setAttribute('aria-label', props.title || t('editor.document'));
  pagination = createPagination(root, {
    onPageCount: count => {
      pageCount.value = count;
    },
    onFootnotes: sheets => {
      footnotePages.value = sheets;
    },
    onSheets: sheets => {
      sheetGeometry.value = sheets;
    },
    isComposing: () => instance.composing
  });
  pagination.setMetrics(viewMode.value === 'page' ? metrics.value : null);
  disposers.push(
    instance.on('update', () => {
      scheduleModelUpdate();
      pagination?.schedule();
      scheduleOutlineRefresh();
      syncComments();
      refreshChanges();
    }),
    instance.on('selection', () => {
      scheduleUiSync();
      reportSelection();
    }),
    instance.on('composition', active => {
      if (!active) pagination?.schedule();
    }),
    instance.on('focus', () => emit('focus')),
    instance.on('blur', () => {
      if (dirty) flushModel();
      emit('blur');
    })
  );
  root.addEventListener('click', onDocumentClick);
  disposers.push(() => root.removeEventListener('click', onDocumentClick));
  engine.value = instance;
  refreshStats();
  scheduleUiSync();
  if (props.autofocus) instance.focus('end');
});

/** Writes pending edits into the model before the engine is destroyed, then releases every resource. */
onBeforeUnmount(() => {
  if (dirty) flushModel();
  cancelAnimationFrame(uiSyncFrame);
  clearTimeout(outlineTimer);
  for (const dispose of disposers) dispose();
  pagination?.destroy();
  engine.value?.destroy();
  if (fullscreen.value) document.body.style.overflow = previousBodyOverflow;
});

defineExpose({
  /** The editing engine, for advanced integrations. */
  engine,
  /** Downloads the document as an HTML page. */
  exportHtml: () => exportDocument('html'),
  /** Downloads the document as a Word-compatible file. */
  exportWord: () => exportDocument('word'),
  /** Downloads the document as a PDF drawn from its pages. */
  exportPdf: () => exportDocument('pdf'),
  /** Moves keyboard focus into the document. */
  focus: () => engine.value?.focus(),
  /** Returns the document HTML, including edits not yet written to the model. */
  getHTML: () => {
    flushModel();
    return lastEmitted;
  },
  /** Replaces the document with the content and page setup of a `.docx` file. */
  importWord,
  /** Inserts the chip of a template variable at the selection. */
  insertVariable: (name: string) => engine.value?.insertVariable(name),
  /** Inserts the table of contents at the selection, or refreshes the existing one. */
  updateTableOfContents,
  /** Opens the print dialog. */
  print
});
</script>

<template>
  <Teleport :to="fullscreenTarget" :disabled="!fullscreen">
    <section
      ref="sectionRef"
      v-bind="$attrs"
      class="document-editor"
      :class="{ 'is-auto-height': autoHeight, 'is-fullscreen': fullscreen }"
      :style="rootStyle"
      @keydown="onKeydown"
    >
      <EditorToolbar
        v-if="engine"
        ref="toolbarRef"
        :disabled="disabled"
        :engine="engine"
        :find-open="findOpen"
        :fullscreen="fullscreen"
        :marks-visible="formattingMarks"
        :outline-visible="outlineVisible"
        :comments-enabled="commentsEnabled"
        :comments-visible="commentsVisible"
        :track-changes="trackChanges"
        :changes-visible="changesVisible"
        :page="page"
        :ruler-visible="rulerVisible"
        :source-mode="sourceMode"
        :state="uiState"
        :uploading="uploading"
        :variables="props.variables"
        :tools="props.tools"
        @find="toggleFind"
        @insert-images="insertImages"
        @menu="onMenu"
        @update:page="page = $event"
      >
        <slot name="toolbar" :engine="engine" :state="uiState" :disabled="disabled || sourceMode" />
      </EditorToolbar>

      <div ref="bodyRef" class="document-editor__body">
        <EditorCanvas
          v-show="!sourceMode"
          ref="canvasRef"
          :auto-height="autoHeight"
          :disabled="disabled"
          :document-title="title || t('editor.document')"
          :engine="engine"
          :footnotes="footnotePages"
          :sheets="sheetGeometry"
          :indents="{ left: uiState.indentLeft, right: uiState.indentRight, firstLine: uiState.indentFirstLine }"
          :metrics="metrics"
          :page="page"
          :page-count="pageCount"
          :ruler-visible="rulerVisible"
          :view-mode="viewMode"
          :zoom="zoom"
          @resize="onCanvasResize"
          @update-indents="engine?.setParagraphIndents($event)"
          @update-margins="onMarginsChange"
          @zoom="zoomBy"
        />
        <textarea
          v-if="sourceMode"
          v-model="sourceHtml"
          class="document-editor__source"
          spellcheck="false"
          :aria-label="t('editor.source')"
          :readonly="disabled"
        />
        <EditorCollaborators
          v-if="engine && bodyRef && canvasScroll && props.collaborators.length && !sourceMode"
          :collaborators="props.collaborators"
          :container="bodyRef"
          :engine="engine"
          :layout-key="collaboratorLayoutKey"
          :scroll-target="canvasScroll"
        />
        <EditorSlashMenu
          v-if="engine && bodyRef && !disabled && !sourceMode"
          :commands="slashCommands"
          :container="bodyRef"
          :engine="engine"
        />
        <EditorFootnoteForm
          v-if="engine && bodyRef && footnoteTarget && !sourceMode"
          :key="footnoteTarget.id"
          :container="bodyRef"
          :readonly="disabled"
          :reference="footnoteTarget.element"
          @cancel="cancelFootnote"
          @remove="removeFootnote"
          @save="saveFootnote"
        />
        <EditorOutline
          v-if="engine && outlineVisible && !sourceMode"
          v-model:view="outlineView"
          :first-page-number="page.firstPageNumber ?? 1"
          :headings="outline"
          :metrics="metrics"
          :pages="outlinePages"
          :sheets="currentSheets()"
          @close="outlineVisible = false"
          @select="engine.goToHeading($event)"
          @select-page="goToPage"
        />
        <EditorChanges
          v-if="engine && changesVisible && !sourceMode"
          :changes="trackedChanges"
          :readonly="disabled"
          @close="changesVisible = false"
          @resolve="resolveChanges"
          @select="engine.selectChange($event)"
        />
        <EditorComments
          v-if="engine && commentsEnabled && commentsVisible && !sourceMode"
          :active-id="uiState.comment || null"
          :anchored="anchoredCommentSet"
          :comments="sortedComments"
          :drafting="draftCommentId !== null"
          :readonly="disabled"
          @add="saveComment"
          @cancel-draft="cancelComment"
          @close="commentsVisible = false; cancelComment()"
          @remove="removeComment"
          @reply="replyToComment"
          @resolve="resolveComment"
          @select="engine.selectComment($event)"
        />
        <EditorFindBar
          v-if="engine && findOpen && !sourceMode"
          ref="findBarRef"
          v-model:replace="replaceOpen"
          :engine="engine"
          :readonly="disabled"
          @close="closeFind"
        />
        <div v-if="uploading" class="document-editor__uploading" role="status">{{ t('editor.uploading') }}</div>
      </div>

      <input
        ref="wordInputRef"
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        hidden
        @change="onWordFilePicked"
      />

      <EditorStatusBar
        v-model:view-mode="viewMode"
        :characters="stats.characters"
        :current-page="currentPage"
        :fullscreen="fullscreen"
        :max-length="maxLength"
        :page-count="pageCount"
        :words="stats.words"
        :zoom="zoom"
        @fit-width="fitWidth"
        @toggle-fullscreen="fullscreen = !fullscreen"
        @update:zoom="setZoom"
      />

      <EditorBubbleMenus
        v-if="engine && canvasScroll && !disabled && !sourceMode"
        :engine="engine"
        :scroll-target="canvasScroll"
        @edit-link="toolbarRef?.openLink()"
      />

      <EditorContextMenu
        v-if="engine && !sourceMode"
        :disabled="disabled"
        :engine="engine"
        @edit-link="toolbarRef?.openLink()"
      />
    </section>
  </Teleport>
</template>

<style scoped>
/* Editor frame. The size variables mirror the prop defaults; the component overrides them inline from the props. */
.document-editor {
  --doc-editor-canvas-padding: 50px;
  --doc-editor-height: 760px;
  --doc-editor-min-height: 240px;
  --doc-editor-max-height: 600px;

  position: relative;
  display: flex;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  height: var(--doc-editor-height);
  min-height: 360px;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--nuvra-border);
  border-radius: 10px;
  background: var(--nuvra-bg);
  container-type: inline-size;
  transition: border-color 160ms ease;
}

.document-editor:focus-within {
  border-color: var(--nuvra-color-primary-border);
}

.document-editor.is-auto-height {
  height: auto;
  min-height: 0;
}

/* Fullscreen covers the viewport; --nuvra-fullscreen-z-index sets its stacking order. */
.document-editor.is-fullscreen {
  position: fixed;
  z-index: var(--nuvra-fullscreen-z-index);
  inset: 0;
  height: 100dvh;
  border: 0;
  border-radius: 0;
}

/* Body: canvas, HTML source and overlays */
.document-editor__body {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
}

.document-editor__source {
  flex: 1 1 auto;
  min-height: 0;
  box-sizing: border-box;
  margin: 0;
  padding: 16px 20px;
  border: 0;
  outline: none;
  color: #1f2328;
  background: #fbfcfd;
  font: 13px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace;
  resize: none;
  tab-size: 2;
}

.document-editor__uploading {
  position: absolute;
  bottom: 12px;
  left: 50%;
  padding: 6px 12px;
  border-radius: 999px;
  color: #fff;
  background: rgb(16 24 40 / 80%);
  font-size: 12px;
  pointer-events: none;
  transform: translateX(-50%);
}
</style>
