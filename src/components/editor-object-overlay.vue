<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

import type { DocumentEngine } from '../core/engine/engine';
import { columnBorderAt, columnWidth } from '../core/engine/tables';

/**
 * Interactive layer above the page content: a selection frame with corner handles to resize the selected image, and
 * a guide line for dragging table column borders. Drawn in the stage's unscaled coordinates.
 */
defineOptions({ name: 'EditorObjectOverlay' });

interface Props {
  /** Engine whose selected image and tables are edited. */
  engine: DocumentEngine;
  /** Zoom in percent, needed to convert pointer movement into document pixels. */
  zoom: number;
}

const props = defineProps<Props>();

/** Corner of the image frame a resize handle sits on. */
type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Rectangle in the stage's unscaled coordinates. */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Image size shown while resizing. */
interface ImageSize {
  width: number;
  height: number;
}

/** Vertical guide line shown while dragging a column border. */
interface ColumnGuide {
  left: number;
  top: number;
  height: number;
}

/** Column border currently under the pointer. */
interface ColumnHover {
  table: HTMLTableElement;
  /** Index of the column whose right border is hovered. */
  index: number;
}

const CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
/** Distance from a cell border, in screen pixels at 100% zoom, at which column resizing starts. */
const BORDER_TOLERANCE = 4;
const MIN_IMAGE_WIDTH = 40;
const MIN_COLUMN_WIDTH = 40;
/** Class on the editable root that shows the column-resize cursor. */
const RESIZE_CLASS = 'is-column-resize';
/** Zoom percentage that shows the document at its real size. */
const ACTUAL_SIZE_ZOOM = 100;
const PRIMARY_BUTTON = 0;

/** Frame around the selected image, or `null` when no image is selected. */
const imageBox = ref<Box | null>(null);
/** Live size label while an image is being resized. */
const imageSize = ref<ImageSize | null>(null);
/** Guide line while a column border is being dragged. */
const guide = ref<ColumnGuide | null>(null);

let measureFrame = 0;
let hover: ColumnHover | null = null;
let draggingColumn = false;
/** Cleanup callbacks for DOM listeners and engine subscriptions. */
const disposers: Array<() => void> = [];

/** Formats a number of pixels as a CSS length. */
const px = (value: number) => `${value}px`;

/** Zoom as a scale factor. */
const scale = () => props.zoom / ACTUAL_SIZE_ZOOM;

/** Box of an element in the unscaled coordinates of the page stage. */
const relativeBox = (element: Element): Box => {
  const origin = props.engine.root.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const factor = scale();
  return {
    left: (rect.left - origin.left) / factor,
    top: (rect.top - origin.top) / factor,
    width: rect.width / factor,
    height: rect.height / factor
  };
};

/** Updates the frame around the selected image. */
const measure = () => {
  measureFrame = 0;
  const image = props.engine.selectedImage;
  imageBox.value = image && props.engine.isEditable ? relativeBox(image) : null;
};

/** Coalesces frame measurements into one per animation frame. */
const scheduleMeasure = () => {
  if (!measureFrame) measureFrame = requestAnimationFrame(measure);
};

/** Width available to content inside the editable root's padding; images never grow beyond it. */
const contentWidth = () => {
  const { root } = props.engine;
  const style = getComputedStyle(root);
  return root.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
};

/**
 * Resizes the selected image from a corner handle, keeping its aspect ratio. The preview changes the element directly;
 * on release the original attributes are restored and the final size is committed as a single undo step.
 */
const startImageResize = (corner: Corner, event: PointerEvent) => {
  const image = props.engine.selectedImage;
  if (!image) return;
  const startX = event.clientX;
  const startWidth = image.getBoundingClientRect().width / scale();
  const ratio =
    image.naturalWidth && image.naturalHeight
      ? image.naturalHeight / image.naturalWidth
      : image.offsetHeight / Math.max(1, image.offsetWidth);
  const originalAttributes = { width: image.getAttribute('width'), height: image.getAttribute('height') };
  const direction = corner.endsWith('left') ? -1 : 1;
  const maxWidth = contentWidth();
  let width = Math.round(startWidth);

  /** Previews the size under the pointer. */
  const onPointerMove = (move: PointerEvent) => {
    const next = startWidth + ((move.clientX - startX) / scale()) * direction;
    width = Math.round(Math.min(maxWidth, Math.max(MIN_IMAGE_WIDTH, next)));
    image.setAttribute('width', String(width));
    image.setAttribute('height', String(Math.round(width * ratio)));
    imageSize.value = { width, height: Math.round(width * ratio) };
    scheduleMeasure();
  };

  /** Restores the previewed attributes and commits the final size through the engine. */
  const onPointerUp = () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    imageSize.value = null;
    for (const [name, value] of Object.entries(originalAttributes)) {
      if (value === null) image.removeAttribute(name);
      else image.setAttribute(name, value);
    }
    if (width !== Math.round(startWidth)) {
      props.engine.updateImage(image, { width, height: Math.round(width * ratio) });
    }
    scheduleMeasure();
  };

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
};

/** Detects a hovered column border and shows the resize cursor over it. */
const onContentMouseMove = (event: MouseEvent) => {
  if (draggingColumn || event.buttons) return;
  const target = event.target as HTMLElement;
  const cell = target.closest?.('td, th') as HTMLTableCellElement | null;
  const table = cell?.closest('table') ?? null;
  const index =
    cell && table && props.engine.isEditable && props.engine.root.contains(table)
      ? columnBorderAt(table, cell, event.clientX, BORDER_TOLERANCE * scale())
      : null;
  hover = index !== null && table ? { table, index } : null;
  props.engine.root.classList.toggle(RESIZE_CLASS, hover !== null);
};

/**
 * Drags a hovered column border with a guide line, like Word; the width is applied on release. Runs in the capture
 * phase so the engine does not start a text or cell selection.
 */
const onContentMouseDown = (event: MouseEvent) => {
  if (!hover || event.button !== PRIMARY_BUTTON) return;
  event.preventDefault();
  event.stopPropagation();
  const { table, index } = hover;
  const startX = event.clientX;
  const startWidth = columnWidth(table, index);
  const tableBox = relativeBox(table);
  const originX = (startX - props.engine.root.getBoundingClientRect().left) / scale();
  let width = startWidth;
  draggingColumn = true;
  guide.value = { left: originX, top: tableBox.top, height: tableBox.height };

  /** Moves the guide line with the pointer. */
  const onMouseMove = (move: MouseEvent) => {
    width = Math.max(MIN_COLUMN_WIDTH, startWidth + (move.clientX - startX) / scale());
    guide.value = { left: originX + width - startWidth, top: tableBox.top, height: tableBox.height };
  };

  /** Removes the guide and applies the new column width as one undo step. */
  const onMouseUp = () => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    draggingColumn = false;
    guide.value = null;
    if (Math.round(width) !== Math.round(startWidth)) props.engine.resizeColumn(table, index, width);
  };

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
};

/** Keeps the image frame aligned when the zoom changes. */
watch(() => props.zoom, scheduleMeasure);

/** Listens to pointer movement on the content and to engine changes that move the selected image. */
onMounted(() => {
  const { root } = props.engine;
  root.addEventListener('mousemove', onContentMouseMove);
  root.addEventListener('mousedown', onContentMouseDown, true);
  disposers.push(
    props.engine.on('selection', scheduleMeasure),
    props.engine.on('update', scheduleMeasure),
    () => root.removeEventListener('mousemove', onContentMouseMove),
    () => root.removeEventListener('mousedown', onContentMouseDown, true)
  );
  scheduleMeasure();
});

/** Removes every listener and pending measurement. */
onBeforeUnmount(() => {
  for (const dispose of disposers) dispose();
  cancelAnimationFrame(measureFrame);
});
</script>

<template>
  <div class="object-overlay" aria-hidden="true">
    <div
      v-if="imageBox"
      class="object-overlay__image"
      :style="{
        left: px(imageBox.left),
        top: px(imageBox.top),
        width: px(imageBox.width),
        height: px(imageBox.height)
      }"
    >
      <span
        v-for="corner in CORNERS"
        :key="corner"
        class="object-overlay__handle"
        :class="`is-${corner}`"
        @pointerdown.prevent.stop="startImageResize(corner, $event)"
      />
      <span v-if="imageSize" class="object-overlay__size">{{ imageSize.width }} × {{ imageSize.height }}</span>
    </div>
    <div
      v-if="guide"
      class="object-overlay__guide"
      :style="{ left: px(guide.left), top: px(guide.top), height: px(guide.height) }"
    />
  </div>
</template>

<style scoped>
.object-overlay {
  position: absolute;
  z-index: 3;
  inset: 0;
  pointer-events: none;
}

/* Selected image frame and resize handles */
.object-overlay__image {
  position: absolute;
  box-sizing: border-box;
  outline: 2px solid #3b82f6;
  outline-offset: 1px;
}

.object-overlay__handle {
  position: absolute;
  width: 10px;
  height: 10px;
  box-sizing: border-box;
  border: 1.5px solid #3b82f6;
  border-radius: 2px;
  background: #fff;
  pointer-events: auto;
}

.object-overlay__handle.is-top-left {
  top: -6px;
  left: -6px;
  cursor: nwse-resize;
}

.object-overlay__handle.is-top-right {
  top: -6px;
  right: -6px;
  cursor: nesw-resize;
}

.object-overlay__handle.is-bottom-left {
  bottom: -6px;
  left: -6px;
  cursor: nesw-resize;
}

.object-overlay__handle.is-bottom-right {
  right: -6px;
  bottom: -6px;
  cursor: nwse-resize;
}

.object-overlay__size {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  color: #fff;
  background: rgb(16 24 40 / 75%);
  font: 11px/16px system-ui, sans-serif;
}

/* Column resize guide */
.object-overlay__guide {
  position: absolute;
  width: 0;
  border-left: 1px dashed #3b82f6;
}
</style>
