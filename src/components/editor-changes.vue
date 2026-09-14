<script setup lang="ts">
import { formatShortDate } from '../core/dates';
import type { TrackedChange } from '../core/engine/engine';
import { useEditorLabels } from '../core/labels';
import EditorIcon from './editor-icon.vue';

/** Panel of tracked changes: every insertion and deletion with its author, to accept or reject one by one or all. */
defineOptions({ name: 'EditorChanges' });

const { t } = useEditorLabels();

interface Props {
  /** Tracked changes in document order. */
  changes: readonly TrackedChange[];
  /** Read-only document: changes can be reviewed but not accepted or rejected. */
  readonly: boolean | undefined;
}

interface Emits {
  /** The panel's close button was pressed. */
  close: [];
  /** A change, or every change without an id, was accepted (`true`) or rejected. */
  resolve: [accept: boolean, id?: string];
  /** A change was chosen: its text is selected in the document. */
  select: [id: string];
}

defineProps<Props>();
const emit = defineEmits<Emits>();

/** Longest part of a change's text shown in its card. */
const PREVIEW_LENGTH = 120;

const preview = (text: string) => (text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text);

/** Date and time of a change in the short form of documents. */
const formatTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${formatShortDate(date)} ${time}`;
};
</script>

<template>
  <aside class="doc-changes" :aria-label="t('editor.changes')">
    <header class="doc-changes__header">
      <span>{{ t('editor.changes') }}</span>
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

    <div v-if="changes.length && !readonly" class="doc-changes__all">
      <button type="button" class="doc-btn" @click="emit('resolve', true)">{{ t('editor.changes.acceptAll') }}</button>
      <button type="button" class="doc-btn doc-btn--danger-text" @click="emit('resolve', false)">
        {{ t('editor.changes.rejectAll') }}
      </button>
    </div>

    <div class="doc-changes__list">
      <article
        v-for="change in changes"
        :key="`${change.type}:${change.id}`"
        class="doc-changes__card"
        :class="`is-${change.type}`"
        @click="emit('select', change.id)"
      >
        <div class="doc-changes__meta">
          <strong>{{ t(change.type === 'insert' ? 'editor.changes.inserted' : 'editor.changes.deleted') }}</strong>
          <span v-if="change.author">{{ change.author }}</span>
          <span>{{ formatTime(change.time) }}</span>
        </div>
        <p class="doc-changes__text">{{ preview(change.text) }}</p>
        <div v-if="!readonly" class="doc-changes__tools" @click.stop>
          <button type="button" class="doc-tb-button" @click="emit('resolve', true, change.id)">
            <EditorIcon name="check" :size="14" />
            {{ t('editor.changes.accept') }}
          </button>
          <button type="button" class="doc-tb-button" @click="emit('resolve', false, change.id)">
            <EditorIcon name="x" :size="14" />
            {{ t('editor.changes.reject') }}
          </button>
        </div>
      </article>
      <p v-if="!changes.length" class="doc-changes__empty">{{ t('editor.changes.empty') }}</p>
    </div>
  </aside>
</template>

<style scoped>
.doc-changes {
  position: absolute;
  z-index: 5;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  width: min(300px, 85%);
  box-sizing: border-box;
  flex-direction: column;
  border-left: 1px solid var(--nuvra-border);
  background: var(--nuvra-bg);
  box-shadow: var(--nuvra-shadow);
  color: var(--nuvra-text);
  font-size: 13px;
}

.doc-changes__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 6px 6px 12px;
  border-bottom: 1px solid var(--nuvra-border);
  color: var(--nuvra-text-strong);
  font-weight: 600;
}

.doc-changes__all {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid var(--nuvra-border-lighter);
}

.doc-changes__list {
  display: grid;
  flex: 1 1 auto;
  min-height: 0;
  align-content: start;
  gap: 8px;
  padding: 8px;
  overflow: auto;
}

.doc-changes__card {
  display: grid;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--nuvra-border-light);
  border-left-width: 3px;
  border-radius: 8px;
  cursor: pointer;
}

.doc-changes__card.is-insert {
  border-left-color: #22c55e;
}

.doc-changes__card.is-delete {
  border-left-color: #ef4444;
}

.doc-changes__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  color: var(--nuvra-text-muted);
  font-size: 11px;
}

.doc-changes__meta strong {
  color: var(--nuvra-text-strong);
  font-size: 12px;
}

.doc-changes__text {
  margin: 0;
  color: var(--nuvra-text-strong);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.doc-changes__card.is-delete .doc-changes__text {
  text-decoration: line-through;
}

.doc-changes__tools {
  display: flex;
  gap: 2px;
  margin: 2px -4px -2px;
  cursor: default;
}

.doc-changes__tools .doc-tb-button {
  height: 24px;
  font-size: 12px;
}

.doc-changes__empty {
  margin: 0;
  padding: 8px 4px;
  color: var(--nuvra-text-muted);
}
</style>
