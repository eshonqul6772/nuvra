<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import type { ParagraphIndents } from '../core/engine/blocks';
import { rangeFromPoint } from '../core/engine/clipboard';
import type { DocumentEngine } from '../core/engine/engine';
import { selectRange } from '../core/engine/selection';
import { type SheetFootnote, footnotesHtml } from '../core/footnotes';
import { useEditorLabels } from '../core/labels';
import {
  type DocumentViewMode,
  type PageHeaderFooter,
  type PageMargins,
  type PageMetrics,
  type PageSettings,
  WATERMARK_ANGLE,
  ZOOM_STEP,
  hasHeaderFooterText,
  hasWatermarkText,
  pageNumberOf,
  renderHeaderFooter,
  showsRunningTexts,
  watermarkFontSize
} from '../core/page';
import { type SheetGeometry, uniformSheets } from '../core/pagination';
import EditorObjectOverlay from './editor-object-overlay.vue';
import EditorRuler from './editor-ruler.vue';

/**
 * Scrollable grey canvas that shows the document either as paginated sheets (page view) or as one sheet that fills
 * the canvas (web view). Owns the editable element the engine takes over.
 */
defineOptions({ name: 'EditorCanvas' });

const { t } = useEditorLabels();

interface Props {
  /** Grow with the content between the editor's min and max height instead of filling a fixed height. */
  autoHeight: boolean;
  /** Read-only document: the ruler is shown but cannot be dragged. */
  disabled: boolean | undefined;
  /** Document title, used by the `{title}` token of the header and footer. */
  documentTitle: string;
  /** Engine working on the editable element; `null` until the parent has created it. */
  engine: DocumentEngine | null;
  /** Footnotes of every sheet, drawn at its bottom; the web view shows all of them after the document. */
  footnotes: SheetFootnote[][];
  /** Page setup: running texts, watermark and page numbering of every sheet. */
  page: PageSettings;
  /** Indents of the paragraph at the caret, shown by the ruler. */
  indents: ParagraphIndents;
  /** Page size and margins in pixels. */
  metrics: PageMetrics;
  /** Number of sheets drawn behind the content in page view. */
  pageCount: number;
  /** Position, size and orientation of every sheet, as laid out by pagination; empty until the first layout. */
  sheets: readonly SheetGeometry[];
  /** Whether the ruler is drawn above the sheet; it is only ever shown in the page view. */
  rulerVisible: boolean;
  /** Paginated sheets or a single web sheet. */
  viewMode: DocumentViewMode;
  /** Zoom in percent. */
  zoom: number;
}

const props = defineProps<Props>();

interface Emits {
  /** The width available for the sheet changed; widths of a hidden canvas (source mode) are not reported. */
  resize: [contentWidth: number];
  /** New indents of the paragraph at the caret, dragged on the ruler. */
  updateIndents: [indents: Partial<ParagraphIndents>];
  /** New left and right margins in millimetres, dragged on the ruler. */
  updateMargins: [margins: Pick<PageMargins, 'left' | 'right'>];
  /** The user asked to zoom by this many percent with Ctrl/⌘ and the wheel, or a trackpad pinch. */
  zoom: [delta: number];
}

const emit = defineEmits<Emits>();

/** Zoom percentage that shows the document at its real size. */
const ACTUAL_SIZE_ZOOM = 100;
/** Clicks outside the sheet are moved this many pixels inside it before looking up the caret position. */
const CARET_HIT_INSET = 2;
const PRIMARY_BUTTON = 0;

const scrollRef = ref<HTMLElement>();
const stageRef = ref<HTMLElement>();
/** The editable element; the engine takes it over as its root. */
const contentRef = ref<HTMLElement>();
/** Content box of the scroll container, i.e. without its grey padding. */
const viewport = ref({ width: 0, height: 0 });
/** Unscaled height of the stage, used to size the scrollable area. */
const stageHeight = ref(0);

let observer: ResizeObserver | undefined;

/** Formats a number of pixels as a CSS length. */
const px = (value: number) => `${value}px`;

/** Restricts a value to the `[min, max]` interval. */
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Parts of a running text, in the order they are drawn. */
const RUNNING_PARTS = ['left', 'center', 'right'] as const;

/** Whether the document has a header, and whether it has a footer. */
const hasHeader = computed(() => hasHeaderFooterText(props.page.header));
const hasFooter = computed(() => hasHeaderFooterText(props.page.footer));

/** One part of a header or footer with its tokens replaced for the given sheet. */
const runningText = (
  value: PageHeaderFooter | undefined,
  part: (typeof RUNNING_PARTS)[number],
  sheet: number
): string =>
  value
    ? renderHeaderFooter(value[part], {
        page: pageNumberOf(props.page, sheet),
        pages: props.pageCount,
        title: props.documentTitle
      })
    : '';

/** Text of the watermark, empty when the document has none. */
const watermarkText = computed(() =>
  hasWatermarkText(props.page.watermark) ? (props.page.watermark?.text.trim() ?? '') : ''
);

/** Colour, size and angle of the watermark on a sheet; it is sized to span that sheet's paper. */
const watermarkStyle = (sheet: SheetGeometry) => {
  const { watermark } = props.page;
  const diagonal = watermark?.diagonal ?? true;
  return {
    color: watermark?.color,
    fontSize: px(watermarkFontSize(sheet.width, sheet.height, watermarkText.value, diagonal)),
    transform: diagonal ? `rotate(${WATERMARK_ANGLE}deg)` : undefined
  };
};

/** Zoom as a scale factor. */
const scale = computed(() => props.zoom / ACTUAL_SIZE_ZOOM);

/** Every sheet to draw: the laid-out geometry, or alike sheets while pagination has not reported yet. */
const sheetList = computed(() =>
  props.sheets.length === props.pageCount ? props.sheets : uniformSheets(props.metrics, props.pageCount)
);

/** Width of the widest sheet; sheets turned by a section break can be wider than the document's own. */
const widestSheet = computed(() => Math.max(props.metrics.width, ...sheetList.value.map(sheet => sheet.width)));

/** Height from the top of the first sheet to the bottom of the last. */
const sheetsHeight = computed(() => {
  const last = sheetList.value.at(-1);
  return last ? last.top + last.height : props.metrics.height;
});

/**
 * Unscaled stage width. In web view the sheet always fills the canvas inside its grey padding at any zoom, so it is
 * the viewport width divided by the scale.
 */
const stageWidth = computed(() =>
  props.viewMode === 'page' ? widestSheet.value : Math.max(1, viewport.value.width / scale.value)
);

/**
 * Minimum height of the web sheet: at least the visible canvas height. A growing editor uses its minimum height
 * instead, so it can shrink back when text is removed.
 */
const webMinHeight = computed(() =>
  props.autoHeight
    ? `max(0px, calc((var(--doc-editor-min-height) - 2 * var(--doc-editor-canvas-padding)) / ${scale.value}))`
    : px(viewport.value.height / scale.value)
);

/**
 * The stage is laid out at 100% and scaled with a transform, so pagination can measure real offsets while the sizer
 * reserves the scaled footprint for scrolling. Page geometry is passed to the content styles as CSS variables.
 */
const stageStyle = computed(() => {
  const { metrics, viewMode } = props;
  return {
    width: px(stageWidth.value),
    minHeight: viewMode === 'web' ? webMinHeight.value : undefined,
    transform: scale.value === 1 ? undefined : `scale(${scale.value})`,
    '--page-width': px(metrics.width),
    '--page-height': px(metrics.height),
    '--pages-height': px(sheetsHeight.value),
    // Blocks of a turned section get the text width of their sheet by this much less right margin.
    '--rotated-shift': px(metrics.width - metrics.height),
    '--margin-top': px(metrics.marginTop),
    '--margin-right': px(metrics.marginRight),
    '--margin-bottom': px(metrics.marginBottom),
    '--margin-left': px(metrics.marginLeft),
    '--page-break-label': JSON.stringify(t('editor.pageBreak')),
    '--section-landscape-label': JSON.stringify(t('editor.sectionBreak.landscape')),
    '--section-portrait-label': JSON.stringify(t('editor.sectionBreak.portrait'))
  };
});

/** Scaled footprint of the stage, which defines the scrollable size of the canvas. */
const sizerStyle = computed(() => ({
  width: px(stageWidth.value * scale.value),
  height: px(stageHeight.value * scale.value)
}));

/** Clicks on the grey canvas place the caret on the nearest line of the sheet instead of doing nothing. */
const onCanvasMouseDown = (event: MouseEvent) => {
  const scroll = scrollRef.value;
  const content = contentRef.value;
  const target = event.target as HTMLElement;
  if (!scroll || !content || !props.engine || event.button !== PRIMARY_BUTTON) return;
  if (target !== scroll && !target.classList.contains('doc-canvas__sizer')) return;
  // Clicks on the scrollbars also target the scroll container.
  if (target === scroll && (event.offsetX >= scroll.clientWidth || event.offsetY >= scroll.clientHeight)) return;

  event.preventDefault();
  const rect = content.getBoundingClientRect();
  const range = rangeFromPoint(
    clamp(event.clientX, rect.left + CARET_HIT_INSET, rect.right - CARET_HIT_INSET),
    clamp(event.clientY, rect.top + CARET_HIT_INSET, rect.bottom - CARET_HIT_INSET)
  );
  if (range && content.contains(range.startContainer)) {
    content.focus({ preventScroll: true });
    selectRange(range);
  } else {
    props.engine.focus('end');
  }
};

/** Ctrl/⌘ with the wheel zooms the document instead of scrolling it; a trackpad pinch arrives as the same event. */
const onWheel = (event: WheelEvent) => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  emit('zoom', event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP);
};

/** Zoom percentage at which the page width fills the canvas, or `0` before the canvas has been measured. */
const getFitWidthZoom = () =>
  viewport.value.width ? Math.floor((viewport.value.width / widestSheet.value) * ACTUAL_SIZE_ZOOM) : 0;

/** Pending measurement frame; `0` when none is scheduled. */
let measureFrame = 0;

/** Measures the stage height and the canvas content box, reporting width changes to the parent. */
const measure = (scroll: HTMLElement, stage: HTMLElement) => {
  measureFrame = 0;
  stageHeight.value = stage.offsetHeight;
  const style = getComputedStyle(scroll);
  const width = scroll.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
  const height = scroll.clientHeight - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom);
  // A canvas hidden by source mode reports zero; keep the last real size.
  if (width <= 0 || (width === viewport.value.width && height === viewport.value.height)) return;
  viewport.value = { width, height };
  emit('resize', width);
};

/**
 * Starts observing the canvas and the stage so sizes follow layout changes. Measuring waits for the next frame:
 * the new sizes resize the observed stage, which inside the observer callback would trigger a ResizeObserver loop.
 */
onMounted(() => {
  const scroll = scrollRef.value;
  const stage = stageRef.value;
  if (!scroll || !stage || typeof ResizeObserver === 'undefined') return;
  observer = new ResizeObserver(() => {
    if (!measureFrame) measureFrame = requestAnimationFrame(() => measure(scroll, stage));
  });
  observer.observe(scroll);
  observer.observe(stage);
});

/** Stops observing sizes and drops a pending measurement. */
onBeforeUnmount(() => {
  observer?.disconnect();
  cancelAnimationFrame(measureFrame);
});

defineExpose({
  /** The editable element the engine is created on. */
  contentElement: contentRef,
  /** Zoom percentage that makes the page fill the canvas width. */
  getFitWidthZoom,
  /** The scroll container, followed by floating menus. */
  scrollElement: scrollRef
});
</script>

<template>
  <div
    ref="scrollRef"
    class="doc-canvas"
    :class="[`is-${viewMode}`, { 'is-auto': autoHeight }]"
    @mousedown="onCanvasMouseDown"
    @wheel="onWheel"
  >
    <div v-if="rulerVisible && viewMode === 'page'" class="doc-canvas__ruler">
      <EditorRuler
        class="doc-canvas__ruler-track"
        :disabled="disabled"
        :indents="indents"
        :metrics="metrics"
        :zoom="zoom"
        @update-indents="emit('updateIndents', $event)"
        @update-margins="emit('updateMargins', $event)"
      />
    </div>
    <div class="doc-canvas__sizer" :style="sizerStyle">
      <div ref="stageRef" class="doc-canvas__stage" :style="stageStyle">
        <div v-if="viewMode === 'page'" class="doc-canvas__sheets" aria-hidden="true">
          <div
            v-for="(sheet, sheetIndex) in sheetList"
            :key="sheetIndex"
            class="doc-canvas__sheet"
            :style="{ top: px(sheet.top), width: px(sheet.width), height: px(sheet.height) }"
          >
            <div v-if="watermarkText" class="doc-canvas__watermark" :style="watermarkStyle(sheet)">
              {{ watermarkText }}
            </div>
            <!-- Note texts are escaped by footnotesHtml. -->
            <div
              v-if="footnotes[sheetIndex]?.length"
              class="doc-canvas__footnotes"
              v-html="footnotesHtml(footnotes[sheetIndex] ?? [])"
            />
            <template v-if="showsRunningTexts(page, sheetIndex + 1)">
              <div v-if="hasHeader" class="doc-canvas__running doc-canvas__running--header">
                <span v-for="part in RUNNING_PARTS" :key="part">{{ runningText(page.header, part, sheetIndex + 1) }}</span>
              </div>
              <div v-if="hasFooter" class="doc-canvas__running doc-canvas__running--footer">
                <span v-for="part in RUNNING_PARTS" :key="part">{{ runningText(page.footer, part, sheetIndex + 1) }}</span>
              </div>
              <span v-else class="doc-canvas__page-number">{{ pageNumberOf(page, sheetIndex + 1) }}</span>
            </template>
          </div>
        </div>
        <div ref="contentRef" class="doc-canvas__content" />
        <div
          v-if="viewMode === 'web' && footnotes[0]?.length"
          class="doc-canvas__web-footnotes"
          v-html="footnotesHtml(footnotes[0] ?? [])"
        />
        <EditorObjectOverlay v-if="engine" :engine="engine" :zoom="zoom" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Canvas and scaled stage */
.doc-canvas {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  box-sizing: border-box;
  overflow: auto;
  padding: var(--doc-editor-canvas-padding);
  background: #e9ebef;
  overscroll-behavior: contain;
}

.doc-canvas.is-auto {
  flex: none;
  min-height: var(--doc-editor-min-height);
  max-height: var(--doc-editor-max-height);
}

.doc-canvas__sizer {
  position: relative;
  margin: 0 auto;
}

/*
 * The ruler scrolls with the sheet sideways and stays right under the toolbar while the document scrolls. Its band
 * covers the canvas padding, so the scrolling text never shows between the toolbar and the ruler.
 */
.doc-canvas__ruler {
  position: sticky;
  z-index: 3;
  top: calc(-1 * var(--doc-editor-canvas-padding));
  box-sizing: border-box;
  width: max-content;
  min-width: calc(100% + 2 * var(--doc-editor-canvas-padding));
  margin: calc(-1 * var(--doc-editor-canvas-padding)) calc(-1 * var(--doc-editor-canvas-padding)) 16px;
  padding: 8px var(--doc-editor-canvas-padding);
  background: inherit;
}

.doc-canvas__ruler-track {
  margin: 0 auto;
}

/* Page geometry defaults (A4, normal margins); the stage style overrides them inline from the page settings. */
.doc-canvas__stage {
  --page-height: 1123px;
  --pages-height: 1123px;
  --margin-top: 96px;
  --margin-right: 96px;
  --margin-bottom: 96px;
  --margin-left: 96px;
  --page-break-label: "";
  --section-landscape-label: "";
  --section-portrait-label: "";

  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
}

/* Like a page, the web sheet sits on the grey canvas, separated from the editor frame. */
.doc-canvas.is-web .doc-canvas__stage {
  background: #fff;
  box-shadow:
    0 0 0 1px rgb(16 24 40 / 6%),
    0 1px 4px rgb(16 24 40 / 8%);
}

/* Page view sheets */
.doc-canvas__sheets {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.doc-canvas__sheet {
  position: absolute;
  left: 0;
  width: 100%;
  height: var(--page-height);
  background: #fff;
  box-shadow:
    0 0 0 1px rgb(16 24 40 / 6%),
    0 2px 8px rgb(16 24 40 / 10%);
}

.doc-canvas__page-number {
  position: absolute;
  right: 0;
  bottom: calc(var(--margin-bottom) / 2 - 8px);
  left: 0;
  color: #98a2b3;
  font: 11px/16px system-ui, sans-serif;
  text-align: center;
}

/* Watermark behind the text; the sheets are drawn under the document, so it never covers the content. */
.doc-canvas__watermark {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-family: "Times New Roman", Times, serif;
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 1;
  opacity: 16%;
  text-transform: uppercase;
  white-space: nowrap;
}

/* Notes of the footnotes, right above the bottom margin of their sheet; pagination keeps the space free. */
.doc-canvas__footnotes {
  position: absolute;
  right: var(--margin-right);
  bottom: var(--margin-bottom);
  left: var(--margin-left);
}

.doc-canvas.is-web .doc-canvas__web-footnotes {
  padding: 0 56px 32px;
}

.doc-canvas.is-auto.is-web .doc-canvas__web-footnotes {
  padding: 0 20px 16px;
}

/* Header and footer, drawn in the page margins of every sheet. */
.doc-canvas__running {
  /* The side parts take what they need and the centre keeps the rest, so a lone centred text uses the whole line. */
  position: absolute;
  right: var(--margin-right);
  left: var(--margin-left);
  display: grid;
  align-items: center;
  gap: 12px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  color: #475467;
  font: 10pt/1.4 "Times New Roman", Times, serif;
}

.doc-canvas__running span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-canvas__running span:nth-child(2) {
  text-align: center;
}

.doc-canvas__running span:nth-child(3) {
  text-align: right;
}

.doc-canvas__running--header {
  top: max(6px, calc(var(--margin-top) / 2 - 8px));
}

.doc-canvas__running--footer {
  bottom: max(6px, calc(var(--margin-bottom) / 2 - 8px));
}

/* Editable content */
.doc-canvas__content {
  position: relative;
  box-sizing: border-box;
  min-height: inherit;
  outline: none;
  caret-color: #1f2328;
}

.doc-canvas.is-page .doc-canvas__content {
  /* The text column keeps the document's own page width even when a turned sheet makes the stage wider. */
  width: var(--page-width);
  min-height: var(--pages-height);
  padding: var(--margin-top) var(--margin-right) var(--margin-bottom) var(--margin-left);
}

.doc-canvas.is-web .doc-canvas__content {
  padding: 40px 56px;
}

.doc-canvas.is-auto.is-web .doc-canvas__content {
  padding: 16px 20px;
}
</style>
