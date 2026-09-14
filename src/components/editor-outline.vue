<script setup lang="ts">
import { useEditorLabels } from '../core/labels';
import type { OutlineHeading } from '../core/outline';
import EditorIcon from './editor-icon.vue';

/** Navigation panel: the headings of the document, indented by level, each jumping to its place in the document. */
defineOptions({ name: 'EditorOutline' });

const { t } = useEditorLabels();

interface Props {
  /** Headings of the document with the page each starts on, `null` outside the page view. */
  headings: ReadonlyArray<OutlineHeading & { page: number | null }>;
}

interface Emits {
  /** The panel's close button was pressed. */
  close: [];
  /** A heading was chosen. */
  select: [heading: HTMLElement];
}

defineProps<Props>();
const emit = defineEmits<Emits>();

/** Indentation of one heading level, in pixels. */
const LEVEL_INDENT_PX = 12;
</script>

<template>
  <nav class="doc-outline" :aria-label="t('editor.outline')">
    <header class="doc-outline__header">
      <span>{{ t('editor.outline') }}</span>
      <button
        type="button"
        class="doc-tb-button"
        :aria-label="t('editor.close')"
        :title="t('editor.close')"
        @click="emit('close')"
      >
        <EditorIcon name="x" :size="14" />
      </button>
    </header>
    <ol v-if="headings.length" class="doc-outline__list">
      <li v-for="(heading, index) in headings" :key="index">
        <button
          type="button"
          class="doc-outline__item"
          :class="`is-level-${heading.level}`"
          :style="{ paddingLeft: `${8 + (heading.level - 1) * LEVEL_INDENT_PX}px` }"
          :title="heading.text"
          @mousedown.prevent
          @click="emit('select', heading.element)"
        >
          <span class="doc-outline__text">{{ heading.text }}</span>
          <span v-if="heading.page !== null" class="doc-outline__page">{{ heading.page }}</span>
        </button>
      </li>
    </ol>
    <p v-else class="doc-outline__empty">{{ t('editor.outline.empty') }}</p>
  </nav>
</template>

<style scoped>
.doc-outline {
  position: absolute;
  z-index: 5;
  top: 0;
  bottom: 0;
  left: 0;
  display: flex;
  width: min(260px, 80%);
  box-sizing: border-box;
  flex-direction: column;
  border-right: 1px solid var(--nuvra-border);
  background: var(--nuvra-bg);
  box-shadow: var(--nuvra-shadow);
  color: var(--nuvra-text);
  font-size: 13px;
}

.doc-outline__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 6px 6px 12px;
  border-bottom: 1px solid var(--nuvra-border);
  color: var(--nuvra-text-strong);
  font-weight: 600;
}

.doc-outline__list {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  padding: 6px;
  overflow: auto;
  list-style: none;
}

.doc-outline__item {
  display: flex;
  width: 100%;
  align-items: baseline;
  gap: 8px;
  padding: 5px 8px;
  border: 0;
  border-radius: 6px;
  color: inherit;
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.doc-outline__item:hover,
.doc-outline__item:focus-visible {
  background: var(--nuvra-fill);
  outline: none;
}

.doc-outline__item.is-level-1 {
  font-weight: 600;
}

.doc-outline__text {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-outline__page {
  color: var(--nuvra-text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.doc-outline__empty {
  margin: 0;
  padding: 16px 12px;
  color: var(--nuvra-text-muted);
}
</style>
