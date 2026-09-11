<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useZIndex } from 'element-plus';

import { DocumentEngine } from '../core/engine/engine';
import { t } from '../core/labels';
import {
  type DocumentViewMode,
  type PageSettings,
  ZOOM_MAX,
  ZOOM_MIN,
  createPageSettings,
  getPageMetrics
} from '../core/page';
import { type PaginationController, createPagination } from '../core/pagination';
import type { DocumentImageUploadHandler, DocumentMenuAction } from '../core/types';
import { EMPTY_UI_STATE, type EditorUiState, isSameUiState } from '../core/ui-state';
import EditorBubbleMenus from './editor-bubble-menus.vue';
// biome-ignore lint/style/useImportType: Component is rendered in the template.
import EditorCanvas from './editor-canvas.vue';
// biome-ignore lint/style/useImportType: Component is rendered in the template.
import EditorFindBar from './editor-find-bar.vue';
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
  /** View shown first; form fields use the lighter web view. */
  defaultViewMode?: DocumentViewMode;
  /** Makes the document read-only and disables every editing control. */
  disabled?: boolean;
  /** Height of the whole editor, or `'auto'` to grow with the content between `minHeight` and `maxHeight`. */
  height?: CssSize;
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
  /** Used as the print title and the exported file name. */
  title?: string;
  /** Uploads an inserted image and resolves with its URL; without it images are embedded as data URLs. */
  uploadImage?: DocumentImageUploadHandler;
}

const props = withDefaults(defineProps<Props>(), {
  autofocus: false,
  canvasPadding: 50,
  defaultViewMode: 'page',
  disabled: false,
  height: 760,
  maxHeight: 600,
  maxImageSizeMb: 10,
  maxLength: 0,
  minHeight: 240,
  placeholder: '',
  title: '',
  uploadImage: undefined
});

interface Emits {
  /** The editing surface lost focus; pending model updates have already been written. */
  blur: [];
  /** The editing surface received focus. */
  focus: [];
  /** An image was rejected by validation or its upload failed. */
  uploadError: [error: unknown];
}

const emit = defineEmits<Emits>();

/** Document HTML. An empty document is written as an empty string; typing updates it after a short delay. */
const model = defineModel<string>({ default: '' });

/** Paper size, orientation, and margins used by the page view, printing, and export. */
const page = defineModel<PageSettings>('page', { default: createPageSettings });

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
const canvasRef = ref<InstanceType<typeof EditorCanvas>>();
const toolbarRef = ref<InstanceType<typeof EditorToolbar>>();
const findBarRef = ref<InstanceType<typeof EditorFindBar>>();

/** The editing engine, created once the canvas has mounted its editable element. */
const engine = shallowRef<DocumentEngine | null>(null);
/** Where the editor is teleported in fullscreen: the surrounding dialog or drawer, otherwise `body`. */
const fullscreenTarget = shallowRef<HTMLElement | 'body'>('body');
/** Stacking order taken from Element Plus when fullscreen starts. */
const fullscreenZIndex = ref<number>();
const viewMode = ref<DocumentViewMode>(props.defaultViewMode);
/** Zoom in percent. */
const zoom = ref(ACTUAL_SIZE_ZOOM);
const fullscreen = ref(false);
/** Whether the raw HTML textarea replaces the canvas. */
const sourceMode = ref(false);
/** HTML edited in source mode; applied to the document when source mode is left. */
const sourceHtml = ref('');
const findOpen = ref(false);
/** Whether the find bar also shows the replacement row. */
const replaceOpen = ref(false);
/** Whether images are currently being read or uploaded. */
const uploading = ref(false);
const pageCount = ref(1);
/** Page that contains the caret, shown in the status bar. */
const currentPage = ref(1);
/** Toolbar snapshot; replaced only when a visible value changes, so the toolbar does not re-render per keystroke. */
const uiState = shallowRef<EditorUiState>(EMPTY_UI_STATE);
const stats = shallowRef({ words: 0, characters: 0 });

const { nextZIndex } = useZIndex();

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
/** CSS variables shared with the canvas, plus the fullscreen stacking order. */
const rootStyle = computed(() => ({
  '--doc-editor-canvas-padding': toCssSize(props.canvasPadding),
  '--doc-editor-height': toCssSize(props.height),
  '--doc-editor-min-height': toCssSize(props.minHeight),
  '--doc-editor-max-height': toCssSize(props.maxHeight),
  zIndex: fullscreen.value ? fullscreenZIndex.value : undefined
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
  const pageNumber = Math.floor(offset / (metrics.value.height + metrics.value.gap)) + 1;
  return Math.min(pageCount.value, Math.max(1, pageNumber));
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
const exportSnapshot = () => ({
  html: engine.value && !engine.value.isEmpty ? engine.value.getHTML() : model.value,
  page: page.value,
  title: props.title || t('editor.document')
});

/** Opens the browser print dialog for the document; the export module is loaded on demand. */
const print = async () => {
  const { buildPrintableHtml, printHtml } = await import('../core/export');
  printHtml(buildPrintableHtml(exportSnapshot()));
};

/** Downloads the document as a standalone HTML page or as a Word-compatible `.doc` file. */
const exportDocument = async (format: 'html' | 'word') => {
  const { buildPrintableHtml, buildWordHtml, downloadFile, toFileName } = await import('../core/export');
  const snapshot = exportSnapshot();
  const fileName = toFileName(snapshot.title);
  if (format === 'word') downloadFile(buildWordHtml(snapshot), `${fileName}.doc`, 'application/msword');
  else downloadFile(buildPrintableHtml(snapshot), `${fileName}.html`, 'text/html;charset=utf-8');
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
    default:
      fullscreen.value = !fullscreen.value;
  }
};

/** Applies zoom chosen by the user, which also turns automatic zoom off. */
const setZoom = (value: number) => {
  autoZoom = false;
  zoom.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
};

/** Zooms so the page width fills the canvas. */
const fitWidth = () => {
  const next = canvasRef.value?.getFitWidthZoom();
  if (next) setZoom(next);
};

/** Shrinks the page to fit narrow canvases, never above actual size, until the user picks zoom. */
const applyAutoZoom = () => {
  if (!autoZoom || !canvasWidth || viewMode.value !== 'page') return;
  const fitting = Math.floor((canvasWidth / metrics.value.width) * ACTUAL_SIZE_ZOOM);
  zoom.value = Math.min(ACTUAL_SIZE_ZOOM, Math.max(ZOOM_MIN, fitting));
};

/** Remembers the canvas width reported after a resize and re-evaluates automatic zoom. */
const onCanvasResize = (width: number) => {
  canvasWidth = width;
  applyAutoZoom();
};

/**
 * Editor-level shortcuts: find (Mod+F), replace (Mod+H), link (Mod+K), print (Mod+P) and Escape. Physical key codes
 * keep the shortcuts working with non-Latin keyboard layouts.
 */
const onKeydown = (event: KeyboardEvent) => {
  const mod = event.ctrlKey || event.metaKey;
  const key = event.code;
  if (mod && !event.altKey && !event.shiftKey && key === 'KeyF') {
    event.preventDefault();
    openFind(false);
  } else if (mod && !event.altKey && key === 'KeyH') {
    event.preventDefault();
    openFind(true);
  } else if (mod && key === 'KeyK' && !props.disabled && !sourceMode.value) {
    event.preventDefault();
    toolbarRef.value?.openLink();
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
  instance.setContent(value);
  refreshStats();
  pagination?.schedule();
});

/** Keeps the engine's editability in sync with the `disabled` prop. */
watch(
  () => props.disabled,
  disabled => engine.value?.setEditable(!disabled)
);

/** Paginates in page view only; the web view is one continuous sheet. */
watch([metrics, viewMode], ([nextMetrics, mode]) => pagination?.setMetrics(mode === 'page' ? nextMetrics : null));

/** The current page depends on pagination, zoom, and view mode. */
watch([pageCount, zoom, viewMode], scheduleUiSync);

/** Paper or view changes can make the page too wide for the canvas again. */
watch([metrics, viewMode], applyAutoZoom);

/** Enters or leaves fullscreen: picks the teleport target and stacking order, and locks page scrolling. */
watch(fullscreen, value => {
  if (value) {
    // Inside a dialog or drawer, the editor stays in it, so Element Plus' focus trap keeps allowing input.
    fullscreenTarget.value = sectionRef.value?.closest<HTMLElement>('.el-dialog, .el-drawer') ?? 'body';
    // Element Plus' own counter puts the editor above open modals and below poppers opened from it.
    fullscreenZIndex.value = nextZIndex();
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
    onImageFiles: files => void insertImages(files)
  });
  root.setAttribute('aria-label', props.title || t('editor.document'));
  pagination = createPagination(root, {
    onPageCount: count => {
      pageCount.value = count;
    },
    isComposing: () => instance.composing
  });
  pagination.setMetrics(viewMode.value === 'page' ? metrics.value : null);
  disposers.push(
    instance.on('update', () => {
      scheduleModelUpdate();
      pagination?.schedule();
    }),
    instance.on('selection', scheduleUiSync),
    instance.on('composition', active => {
      if (!active) pagination?.schedule();
    }),
    instance.on('focus', () => emit('focus')),
    instance.on('blur', () => {
      if (dirty) flushModel();
      emit('blur');
    })
  );
  engine.value = instance;
  refreshStats();
  scheduleUiSync();
  if (props.autofocus) instance.focus('end');
});

/** Writes pending edits into the model before the engine is destroyed, then releases every resource. */
onBeforeUnmount(() => {
  if (dirty) flushModel();
  cancelAnimationFrame(uiSyncFrame);
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
  /** Moves keyboard focus into the document. */
  focus: () => engine.value?.focus(),
  /** Returns the document HTML, including edits not yet written to the model. */
  getHTML: () => {
    flushModel();
    return lastEmitted;
  },
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
        :page="page"
        :source-mode="sourceMode"
        :state="uiState"
        :uploading="uploading"
        @find="toggleFind"
        @insert-images="insertImages"
        @menu="onMenu"
        @update:page="page = $event"
      />

      <div class="document-editor__body">
        <EditorCanvas
          v-show="!sourceMode"
          ref="canvasRef"
          :auto-height="autoHeight"
          :engine="engine"
          :metrics="metrics"
          :page-count="pageCount"
          :view-mode="viewMode"
          :zoom="zoom"
          @resize="onCanvasResize"
        />
        <textarea
          v-if="sourceMode"
          v-model="sourceHtml"
          class="document-editor__source"
          spellcheck="false"
          :aria-label="t('editor.source')"
          :readonly="disabled"
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
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  background: var(--el-bg-color);
  container-type: inline-size;
  transition: border-color 160ms ease;
}

.document-editor:focus-within {
  border-color: var(--el-color-primary-light-5);
}

.document-editor.is-auto-height {
  height: auto;
  min-height: 0;
}

/* The stacking order comes from Element Plus at runtime (inline z-index). */
.document-editor.is-fullscreen {
  position: fixed;
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
