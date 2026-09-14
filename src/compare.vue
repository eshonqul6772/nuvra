<script setup lang="ts">
import { computed } from 'vue';

import { compareDocuments } from './core/diff';
import { type EditorLocaleInput, useEditorLabels } from './core/labels';

import './styles/document-content.css';
import './styles/editor-ui.css';

/**
 * Read-only comparison of two versions of a document: the new version with inserted words underlined in green and
 * deleted ones struck through in red, and the number of changes above it.
 */
defineOptions({ name: 'DocumentCompare' });

interface Props {
  /** HTML of the earlier version. */
  before: string;
  /** HTML of the later version. */
  after: string;
  /** Interface language: a built-in locale or its code; defaults to the app-wide language. */
  locale?: EditorLocaleInput;
  /** Height of the component, in pixels or any CSS length; `'auto'` grows with the document. */
  height?: number | string;
}

const props = withDefaults(defineProps<Props>(), { locale: undefined, height: 'auto' });

const { t } = useEditorLabels(() => props.locale);

const comparison = computed(() => compareDocuments(props.before, props.after));

const style = computed(() => ({
  height: typeof props.height === 'number' ? `${props.height}px` : props.height
}));
</script>

<template>
  <section class="document-compare" :style="style">
    <header class="document-compare__summary" role="status">
      <template v-if="comparison.insertions || comparison.deletions">
        <span class="document-compare__count is-ins">{{ t('editor.compare.insertions', { count: comparison.insertions }) }}</span>
        <span class="document-compare__count is-del">{{ t('editor.compare.deletions', { count: comparison.deletions }) }}</span>
      </template>
      <span v-else>{{ t('editor.compare.same') }}</span>
    </header>
    <div class="document-compare__scroll">
      <!-- The comparison is built from sanitised blocks and escaped text. -->
      <article class="doc-content document-compare__sheet" v-html="comparison.html" />
    </div>
  </section>
</template>

<style scoped>
.document-compare {
  display: flex;
  box-sizing: border-box;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--nuvra-border, #dcdfe6);
  border-radius: 10px;
  background: #e9ebef;
}

.document-compare__summary {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--nuvra-border, #dcdfe6);
  color: #606266;
  background: #fff;
  font: 13px/1.4 system-ui, sans-serif;
}

.document-compare__count.is-ins {
  color: #15803d;
}

.document-compare__count.is-del {
  color: #b91c1c;
}

.document-compare__scroll {
  flex: 1 1 auto;
  min-height: 0;
  padding: 24px;
  overflow: auto;
}

.document-compare__sheet {
  box-sizing: border-box;
  max-width: 794px;
  margin: 0 auto;
  padding: 48px 56px;
  background: #fff;
  box-shadow:
    0 0 0 1px rgb(16 24 40 / 6%),
    0 2px 8px rgb(16 24 40 / 10%);
}

.document-compare__sheet :deep(ins.doc-diff-ins) {
  color: #166534;
  background: #dcfce7;
  text-decoration: underline;
}

.document-compare__sheet :deep(del.doc-diff-del) {
  color: #991b1b;
  background: #fee2e2;
  text-decoration: line-through;
}

.document-compare__sheet :deep(.doc-diff-block--ins) {
  margin: 0 -8px;
  padding: 0 6px;
  border-left: 3px solid #22c55e;
  background: #f0fdf4;
}

.document-compare__sheet :deep(.doc-diff-block--del) {
  margin: 0 -8px;
  padding: 0 6px;
  border-left: 3px solid #ef4444;
  background: #fef2f2;
  text-decoration: line-through;
  opacity: 80%;
}

@media (max-width: 640px) {
  .document-compare__scroll {
    padding: 8px;
  }

  .document-compare__sheet {
    padding: 20px 16px;
  }
}
</style>
