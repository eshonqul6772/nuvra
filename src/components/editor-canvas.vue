<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { rangeFromPoint } from '../core/engine/clipboard';
import type { DocumentEngine } from '../core/engine/engine';
import { selectRange } from '../core/engine/selection';
import { t } from '../core/labels';
import type { DocumentViewMode, PageMetrics } from '../core/page';
import EditorObjectOverlay from './editor-object-overlay.vue';

/**
 * Scrollable grey canvas that shows the document either as paginated sheets (page view) or as one sheet that fills
 * the canvas (web view). Owns the editable element the engine takes over.
 */
defineOptions({ name: 'EditorCanvas' });

interface Props {
  /** Grow with the content between the editor's min and max height instead of filling a fixed height. */
  autoHeight: boolean;
  /** Engine working on the editable element; `null` until the parent has created it. */
  engine: DocumentEngine | null;
  /** Page size and margins in pixels. */
  metrics: PageMetrics;
  /** Number of sheets drawn behind the content in page view. */
  pageCount: number;
  /** Paginated sheets or a single web sheet. */
  viewMode: DocumentViewMode;
  /** Zoom in percent. */
  zoom: number;
}

const props = defineProps<Props>();

interface Emits {
  /** The width available for the sheet changed; widths of a hidden canvas (source mode) are not reported. */
  resize: [contentWidth: number];
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

/** Zoom as a scale factor. */
const scale = computed(() => props.zoom / ACTUAL_SIZE_ZOOM);
/** Vertical distance from the top of one sheet to the top of the next. */
const period = computed(() => props.metrics.height + props.metrics.gap);

/**
 * Unscaled stage width. In web view the sheet always fills the canvas inside its grey padding at any zoom, so it is
 * the viewport width divided by the scale.
 */
const stageWidth = computed(() =>
  props.viewMode === 'page' ? props.metrics.width : Math.max(1, viewport.value.width / scale.value)
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
  const { metrics, pageCount, viewMode } = props;
  return {
    width: px(stageWidth.value),
    minHeight: viewMode === 'web' ? webMinHeight.value : undefined,
    transform: scale.value === 1 ? undefined : `scale(${scale.value})`,
    '--page-height': px(metrics.height),
    '--pages-height': px(pageCount * period.value - metrics.gap),
    '--margin-top': px(metrics.marginTop),
    '--margin-right': px(metrics.marginRight),
    '--margin-bottom': px(metrics.marginBottom),
    '--margin-left': px(metrics.marginLeft),
    '--page-break-label': JSON.stringify(t('editor.pageBreak'))
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

/** Zoom percentage at which the page width fills the canvas, or `0` before the canvas has been measured. */
const getFitWidthZoom = () =>
  viewport.value.width ? Math.floor((viewport.value.width / props.metrics.width) * ACTUAL_SIZE_ZOOM) : 0;

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
  >
    <div class="doc-canvas__sizer" :style="sizerStyle">
      <div ref="stageRef" class="doc-canvas__stage" :style="stageStyle">
        <div v-if="viewMode === 'page'" class="doc-canvas__sheets" aria-hidden="true">
          <div
            v-for="index in pageCount"
            :key="index"
            class="doc-canvas__sheet"
            :style="{ top: px((index - 1) * period) }"
          >
            <span class="doc-canvas__page-number">{{ index }}</span>
          </div>
        </div>
        <div ref="contentRef" class="doc-canvas__content" />
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

/* Page geometry defaults (A4, normal margins); the stage style overrides them inline from the page settings. */
.doc-canvas__stage {
  --page-height: 1123px;
  --pages-height: 1123px;
  --margin-top: 96px;
  --margin-right: 96px;
  --margin-bottom: 96px;
  --margin-left: 96px;
  --page-break-label: "";

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

/* Editable content */
.doc-canvas__content {
  position: relative;
  box-sizing: border-box;
  min-height: inherit;
  outline: none;
  caret-color: #1f2328;
}

.doc-canvas.is-page .doc-canvas__content {
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
