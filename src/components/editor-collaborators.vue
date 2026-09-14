<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, watch } from 'vue';

import { type Collaborator, collaboratorColor } from '../core/collaboration';
import type { DocumentEngine } from '../core/engine/engine';

/** Carets and selections of the other people editing the document, drawn over the canvas. */
defineOptions({ name: 'EditorCollaborators' });

interface Props {
  /** Engine that measures positions in the document. */
  engine: DocumentEngine;
  /** People whose carets are drawn. */
  collaborators: readonly Collaborator[];
  /** Element the marks are positioned in; it must be positioned itself. */
  container: HTMLElement;
  /** Scrolling canvas; marks outside it are hidden. */
  scrollTarget: HTMLElement;
  /** Changes whenever the layout may move text (zoom, view mode, page setup), so the marks are measured again. */
  layoutKey: string;
}

const props = defineProps<Props>();

/** A rectangle relative to the container. */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What is drawn for one collaborator. */
interface Mark {
  id: string;
  name: string;
  color: string;
  selection: Box[];
  caret: Box | null;
}

const marks = shallowRef<Mark[]>([]);
let frame = 0;

/** Measures every collaborator's selection against the container, leaving out what has scrolled out of the canvas. */
const measure = () => {
  frame = 0;
  const container = props.container.getBoundingClientRect();
  const visible = props.scrollTarget.getBoundingClientRect();
  const toBox = (rect: DOMRect): Box | null =>
    rect.bottom < visible.top || rect.top > visible.bottom
      ? null
      : { left: rect.left - container.left, top: rect.top - container.top, width: rect.width, height: rect.height };
  marks.value = props.collaborators
    .filter(collaborator => collaborator.selection)
    .map(collaborator => {
      const selection = collaborator.selection as NonNullable<Collaborator['selection']>;
      const rects = props.engine.getOffsetRects(selection);
      const caretRects = props.engine.getOffsetRects({ anchor: selection.focus, focus: selection.focus });
      const caret = caretRects[0] ? toBox(caretRects[0]) : null;
      return {
        id: collaborator.id,
        name: collaborator.name,
        color: collaboratorColor(collaborator),
        selection:
          selection.anchor === selection.focus ? [] : rects.map(toBox).filter((box): box is Box => box !== null),
        caret
      };
    });
};

/** Measures again on the next frame, once the layout has settled. */
const schedule = () => {
  if (!frame) frame = requestAnimationFrame(measure);
};

watch(() => [props.collaborators, props.layoutKey], schedule, { deep: true });

const disposers: Array<() => void> = [];
onMounted(() => {
  props.scrollTarget.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  disposers.push(
    () => props.scrollTarget.removeEventListener('scroll', schedule),
    () => window.removeEventListener('resize', schedule),
    props.engine.on('update', schedule)
  );
  schedule();
});

onBeforeUnmount(() => {
  for (const dispose of disposers) dispose();
  cancelAnimationFrame(frame);
});
</script>

<template>
  <div class="doc-collaborators" aria-hidden="true">
    <template v-for="mark in marks" :key="mark.id">
      <span
        v-for="(box, index) in mark.selection"
        :key="`${mark.id}-${index}`"
        class="doc-collaborators__selection"
        :style="{
          left: `${box.left}px`,
          top: `${box.top}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
          background: mark.color
        }"
      />
      <span
        v-if="mark.caret"
        class="doc-collaborators__caret"
        :style="{ left: `${mark.caret.left}px`, top: `${mark.caret.top}px`, height: `${mark.caret.height}px`, background: mark.color }"
      >
        <span class="doc-collaborators__name" :style="{ background: mark.color }">{{ mark.name }}</span>
      </span>
    </template>
  </div>
</template>

<style scoped>
.doc-collaborators {
  position: absolute;
  z-index: 2;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.doc-collaborators__selection {
  position: absolute;
  opacity: 22%;
}

.doc-collaborators__caret {
  position: absolute;
  width: 2px;
  margin-left: -1px;
}

.doc-collaborators__name {
  position: absolute;
  bottom: 100%;
  left: -1px;
  padding: 1px 5px;
  border-radius: 3px 3px 3px 0;
  color: #fff;
  font: 600 11px/16px system-ui, sans-serif;
  white-space: nowrap;
}
</style>
