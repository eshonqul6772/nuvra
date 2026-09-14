<script setup lang="ts">
import { computed, ref } from 'vue';

import type { ParagraphIndents } from '../core/engine/blocks';
import { type EditorLabelKey, useEditorLabels } from '../core/labels';
import type { PageMargins, PageMetrics } from '../core/page';

/**
 * Horizontal ruler above the sheet, as in office suites: it shows the page in centimetres, marks the margins and
 * carries the indent markers of the paragraph at the caret. Every marker can be dragged; the value is applied when
 * the pointer is released, so a drag is a single undo step.
 */
defineOptions({ name: 'EditorRuler' });

const { t } = useEditorLabels();

interface Props {
  /** Read-only documents show the ruler but do not let it be dragged. */
  disabled: boolean | undefined;
  /** Indents of the paragraph at the caret, in pixels. */
  indents: ParagraphIndents;
  /** Page geometry in pixels. */
  metrics: PageMetrics;
  /** Zoom in percent, which the ruler is drawn at. */
  zoom: number;
}

const props = defineProps<Props>();

interface Emits {
  /** New left and right margins in millimetres, after a margin marker was dragged. */
  updateMargins: [margins: Pick<PageMargins, 'left' | 'right'>];
  /** New indents in pixels, after an indent marker was dragged. */
  updateIndents: [indents: Partial<ParagraphIndents>];
}

const emit = defineEmits<Emits>();

/** The markers a user can drag. */
type Handle = 'marginLeft' | 'marginRight' | 'indentLeft' | 'indentRight' | 'firstLine';

/** CSS pixels per millimetre at 96 DPI. */
const PX_PER_MM = 96 / 25.4;
/** Distance between two tick marks, in millimetres. */
const TICK_MM = 5;
/** Every second tick is labelled, which puts a number on every centimetre. */
const LABEL_MM = 10;
/** Narrowest text area a margin drag may leave, in pixels. */
const MIN_TEXT_WIDTH = 20 * PX_PER_MM;
/** Smallest distance between the left and right indent markers, in pixels. */
const MIN_INDENT_GAP = 5 * PX_PER_MM;
/** Zoom percentage at which the ruler is drawn at its real size. */
const ACTUAL_SIZE_ZOOM = 100;

const rulerRef = ref<HTMLElement>();
/** Marker being dragged, or `null` while the ruler is idle. */
const dragging = ref<Handle | null>(null);
/** Position of the dragged marker in page pixels, shown until the drag ends. */
const preview = ref(0);

/** Zoom as a scale factor. */
const scale = computed(() => props.zoom / ACTUAL_SIZE_ZOOM);

/** Width of the ruler in screen pixels. */
const width = computed(() => props.metrics.width * scale.value);

/** Distance from the left paper edge to the right margin, in page pixels. */
const rightMarginStart = computed(() => props.metrics.width - props.metrics.marginRight);

/** Position of a marker in page pixels, taking the ongoing drag into account. */
const positionOf = (handle: Handle): number => {
  if (dragging.value === handle) return preview.value;
  const { metrics, indents } = props;
  switch (handle) {
    case 'marginLeft':
      return metrics.marginLeft;
    case 'marginRight':
      return rightMarginStart.value;
    case 'indentLeft':
      return metrics.marginLeft + indents.left;
    case 'indentRight':
      return rightMarginStart.value - indents.right;
    default:
      return metrics.marginLeft + indents.left + indents.firstLine;
  }
};

/** Screen position of a marker, used by its inline style. */
const offsetOf = (handle: Handle) => `${positionOf(handle) * scale.value}px`;

/** Ticks of the ruler: every half centimetre, numbered every centimetre, counted from the left margin. */
const ticks = computed(() => {
  const { width: paper, marginLeft } = props.metrics;
  const list: Array<{ key: string; left: string; label: string | null }> = [];
  for (let position = 0; position <= paper; position += TICK_MM * PX_PER_MM) {
    const fromMargin = Math.round((position - marginLeft) / PX_PER_MM);
    const labelled = Math.abs(fromMargin) % LABEL_MM === 0;
    list.push({
      key: String(Math.round(position)),
      left: `${position * scale.value}px`,
      label: labelled && fromMargin !== 0 ? String(Math.abs(fromMargin) / LABEL_MM) : null
    });
  }
  return list;
});

/** The text area of the page, drawn brighter than the margins. */
const textAreaStyle = computed(() => ({
  left: `${props.metrics.marginLeft * scale.value}px`,
  width: `${(rightMarginStart.value - props.metrics.marginLeft) * scale.value}px`
}));

/** Keeps a value within a range. */
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Snaps a distance to whole millimetres, which is how office rulers step. */
const snap = (value: number) => Math.round(value / PX_PER_MM) * PX_PER_MM;

/** Page pixels under the pointer. */
const pagePosition = (clientX: number) => {
  const rect = rulerRef.value?.getBoundingClientRect();
  return rect ? (clientX - rect.left) / scale.value : 0;
};

/** Range a marker may be dragged in, in page pixels. */
const limitsOf = (handle: Handle): [number, number] => {
  const { metrics, indents } = props;
  const textLeft = metrics.marginLeft;
  const textRight = rightMarginStart.value;
  switch (handle) {
    case 'marginLeft':
      return [0, textRight - MIN_TEXT_WIDTH];
    case 'marginRight':
      return [textLeft + MIN_TEXT_WIDTH, metrics.width];
    case 'indentLeft':
      return [textLeft, textRight - indents.right - MIN_INDENT_GAP];
    case 'indentRight':
      return [textLeft + indents.left + MIN_INDENT_GAP, textRight];
    default:
      // The first line may hang out to the left margin, but never past the paper.
      return [Math.max(0, textLeft - indents.left), textRight - indents.right - MIN_INDENT_GAP];
  }
};

/** Starts dragging a marker; the pointer is captured so the drag survives leaving the ruler. */
const onPointerDown = (handle: Handle, event: PointerEvent) => {
  if (props.disabled) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  dragging.value = handle;
  preview.value = positionOf(handle);
};

/** Follows the pointer while a marker is dragged. */
const onPointerMove = (event: PointerEvent) => {
  const handle = dragging.value;
  if (!handle) return;
  const [min, max] = limitsOf(handle);
  preview.value = clamp(snap(pagePosition(event.clientX)), min, max);
};

/** Applies the dragged value as one change and ends the drag. */
const onPointerUp = () => {
  const handle = dragging.value;
  if (!handle) return;
  const { metrics, indents } = props;
  const position = preview.value;
  dragging.value = null;
  if (handle === 'marginLeft' || handle === 'marginRight') {
    const left = handle === 'marginLeft' ? position : metrics.marginLeft;
    const right = handle === 'marginRight' ? metrics.width - position : metrics.marginRight;
    emit('updateMargins', {
      left: Math.round((left / PX_PER_MM) * 10) / 10,
      right: Math.round((right / PX_PER_MM) * 10) / 10
    });
    return;
  }
  if (handle === 'indentLeft') {
    // The first line keeps its own distance from the paragraph, as it does in office suites.
    emit('updateIndents', { left: position - metrics.marginLeft });
    return;
  }
  if (handle === 'indentRight') {
    emit('updateIndents', { right: rightMarginStart.value - position });
    return;
  }
  emit('updateIndents', { firstLine: position - metrics.marginLeft - indents.left });
};

/** Markers with their label keys and the class that draws their shape. */
const HANDLES = [
  { key: 'firstLine', modifier: 'first-line', label: 'editor.ruler.firstLine' },
  { key: 'indentLeft', modifier: 'indent-left', label: 'editor.ruler.indentLeft' },
  { key: 'indentRight', modifier: 'indent-right', label: 'editor.ruler.indentRight' },
  { key: 'marginLeft', modifier: 'margin', label: 'editor.ruler.marginLeft' },
  { key: 'marginRight', modifier: 'margin', label: 'editor.ruler.marginRight' }
] as const satisfies ReadonlyArray<{ key: Handle; modifier: string; label: EditorLabelKey }>;

/** Name of a marker; it is translated on every render, so a language switch reaches the ruler as well. */
const labelOf = (key: EditorLabelKey) => t(key);
</script>

<template>
  <div ref="rulerRef" class="doc-ruler" :style="{ width: `${width}px` }" aria-hidden="true">
    <div class="doc-ruler__text-area" :style="textAreaStyle" />
    <span
      v-for="tick in ticks"
      :key="tick.key"
      class="doc-ruler__tick"
      :class="{ 'is-labelled': tick.label !== null }"
      :style="{ left: tick.left }"
    >
      <i v-if="tick.label">{{ tick.label }}</i>
    </span>
    <button
      v-for="handle in HANDLES"
      :key="handle.key"
      type="button"
      class="doc-ruler__handle"
      :class="[`doc-ruler__handle--${handle.modifier}`, { 'is-dragging': dragging === handle.key }]"
      :style="{ left: offsetOf(handle.key) }"
      :disabled="disabled"
      :title="labelOf(handle.label)"
      :aria-label="labelOf(handle.label)"
      @pointerdown="onPointerDown(handle.key, $event)"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    />
    <div v-if="dragging" class="doc-ruler__guide" :style="{ left: `${preview * scale}px` }" />
  </div>
</template>

<style scoped>
/* The ruler is as wide as the sheet and sits right above it. */
.doc-ruler {
  position: relative;
  box-sizing: border-box;
  height: 26px;
  border: 1px solid var(--nuvra-border-lighter);
  border-radius: 4px;
  background: var(--nuvra-fill);
  user-select: none;
}

/* The part of the page that holds text, drawn brighter than the margins. */
.doc-ruler__text-area {
  position: absolute;
  top: 0;
  bottom: 0;
  background: var(--nuvra-bg);
}

/* Half centimetres are short marks; whole centimetres carry their number instead, as on an office ruler. */
.doc-ruler__tick {
  position: absolute;
  top: 50%;
  width: 1px;
  height: 4px;
  margin-top: -2px;
  background: var(--nuvra-text-placeholder);
  pointer-events: none;
}

.doc-ruler__tick.is-labelled {
  background: transparent;
}

.doc-ruler__tick i {
  position: absolute;
  top: -5px;
  left: 50%;
  color: var(--nuvra-text-muted);
  font: 9px/1 system-ui, sans-serif;
  font-style: normal;
  transform: translateX(-50%);
}

/*
 * Draggable markers: triangles for the indents, a bar for the margins. The three bands never overlap, so every
 * marker keeps its own hit area even when they sit at the same position.
 */
.doc-ruler__handle {
  position: absolute;
  width: 14px;
  height: 8px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: ew-resize;
  transform: translateX(-7px);
}

.doc-ruler__handle:disabled {
  cursor: default;
}

.doc-ruler__handle::before {
  position: absolute;
  inset: 1px 2px;
  background: var(--nuvra-color-primary);
  content: "";
  opacity: 70%;
}

.doc-ruler__handle:hover::before,
.doc-ruler__handle.is-dragging::before {
  opacity: 100%;
}

.doc-ruler__handle--first-line {
  top: 0;
}

.doc-ruler__handle--first-line::before {
  clip-path: polygon(0 0, 100% 0, 50% 100%);
}

.doc-ruler__handle--indent-left,
.doc-ruler__handle--indent-right {
  bottom: 0;
}

.doc-ruler__handle--indent-left::before,
.doc-ruler__handle--indent-right::before {
  clip-path: polygon(50% 0, 100% 100%, 0 100%);
}

.doc-ruler__handle--margin {
  top: 8px;
  height: 8px;
}

.doc-ruler__handle--margin::before {
  inset: 0 6px;
  border-radius: 1px;
  background: var(--nuvra-text-muted);
}

/* Line that follows the marker while it is dragged. */
.doc-ruler__guide {
  position: absolute;
  top: 100%;
  width: 1px;
  height: 60vh;
  background: var(--nuvra-color-primary);
  opacity: 50%;
  pointer-events: none;
}
</style>
