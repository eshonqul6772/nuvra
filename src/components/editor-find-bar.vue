<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { CaseSensitive, ChevronDown, ChevronRight, ChevronUp, WholeWord, X } from '@lucide/vue';
import { ElInput, type InputInstance } from 'element-plus';

import type { DocumentEngine } from '../core/engine/engine';
import { formatShortcut, t } from '../core/labels';

/**
 * Floating find and replace panel. Drives the engine's search controller, mirrors its match counter, and offers
 * replace actions that the engine records as undo steps.
 */
defineOptions({ name: 'EditorFindBar' });

interface Props {
  /** Engine whose document is searched. */
  engine: DocumentEngine;
  /** Hides the replacement row when the document cannot be edited. */
  readonly: boolean | undefined;
}

interface Emits {
  /** The user asked to close the panel (close button). */
  close: [];
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
/** Whether the replacement row is expanded; kept by the parent so Ctrl+H can open it directly. */
const showReplace = defineModel<boolean>('replace', { default: false });

/** The longest selection that is copied into the search field when the panel opens. */
const MAX_PREFILL_LENGTH = 120;

const searchInput = ref<InputInstance>();
const searchTerm = ref('');
const replaceTerm = ref('');
const caseSensitive = ref(false);
const wholeWord = ref(false);
/** Current match number and total, as reported by the engine. */
const status = ref(props.engine.search.state);

let stopListening: (() => void) | undefined;

/** Focuses the search field and selects its text, so typing replaces the previous term. */
const focus = () => {
  searchInput.value?.focus();
  searchInput.value?.select();
};

/** Re-runs the search with the current term and options. */
const runSearch = () =>
  props.engine.search.setQuery(searchTerm.value, {
    caseSensitive: caseSensitive.value,
    wholeWord: wholeWord.value
  });

/** Returns the Enter key press of an input event, or null for any other key. */
const asEnterKey = (event: Event | KeyboardEvent): KeyboardEvent | null =>
  event instanceof KeyboardEvent && event.key === 'Enter' ? event : null;

/** Enter jumps to the next match, Shift+Enter to the previous one. */
const onSearchKeydown = (event: Event | KeyboardEvent) => {
  const enter = asEnterKey(event);
  if (!enter) return;
  enter.preventDefault();
  if (enter.shiftKey) props.engine.search.previous();
  else props.engine.search.next();
};

/** Enter in the replace field replaces the current match. */
const onReplaceKeydown = (event: Event | KeyboardEvent) => {
  const enter = asEnterKey(event);
  if (!enter) return;
  enter.preventDefault();
  props.engine.replaceMatch(replaceTerm.value);
};

watch([searchTerm, caseSensitive, wholeWord], runSearch);

onMounted(async () => {
  stopListening = props.engine.on('search', state => {
    status.value = state;
  });
  // Like Word, start with the selected text as the search term, selected so that typing replaces it.
  const selected = props.engine.getSelectedText();
  if (selected && selected.length <= MAX_PREFILL_LENGTH && !selected.includes('\n')) searchTerm.value = selected;
  // select() has to run after v-model has written the prefilled value into the input.
  await nextTick();
  focus();
});

onBeforeUnmount(() => {
  stopListening?.();
  props.engine.search.clear();
});

defineExpose({ focus });
</script>

<template>
  <div class="find-bar" role="search" :aria-label="t('editor.search.title')">
    <button
      v-if="!readonly"
      type="button"
      class="doc-tb-button"
      :class="{ 'is-active': showReplace }"
      :title="t('editor.replace.toggle')"
      :aria-label="t('editor.replace.toggle')"
      :aria-expanded="showReplace"
      @click="showReplace = !showReplace"
    >
      <ChevronRight class="find-bar__chevron" :size="14" />
    </button>

    <div class="find-bar__rows">
      <div class="find-bar__row">
        <el-input
          ref="searchInput"
          v-model="searchTerm"
          class="find-bar__input"
          size="small"
          :placeholder="t('editor.search.placeholder')"
          :ariaLabel="t('editor.search.placeholder')"
          @keydown="onSearchKeydown"
        >
          <template #suffix>
            <span class="find-bar__count">{{ status.current }}/{{ status.total }}</span>
          </template>
        </el-input>
        <button
          type="button"
          class="doc-tb-button"
          :class="{ 'is-active': caseSensitive }"
          :title="t('editor.search.caseSensitive')"
          :aria-label="t('editor.search.caseSensitive')"
          :aria-pressed="caseSensitive"
          @click="caseSensitive = !caseSensitive"
        >
          <CaseSensitive :size="16" />
        </button>
        <button
          type="button"
          class="doc-tb-button"
          :class="{ 'is-active': wholeWord }"
          :title="t('editor.search.wholeWord')"
          :aria-label="t('editor.search.wholeWord')"
          :aria-pressed="wholeWord"
          @click="wholeWord = !wholeWord"
        >
          <WholeWord :size="16" />
        </button>
        <button
          type="button"
          class="doc-tb-button"
          :disabled="!status.total"
          :title="`${t('editor.search.previous')} (${formatShortcut('Shift+Enter')})`"
          :aria-label="t('editor.search.previous')"
          @click="engine.search.previous()"
        >
          <ChevronUp :size="16" />
        </button>
        <button
          type="button"
          class="doc-tb-button"
          :disabled="!status.total"
          :title="`${t('editor.search.next')} (Enter)`"
          :aria-label="t('editor.search.next')"
          @click="engine.search.next()"
        >
          <ChevronDown :size="16" />
        </button>
        <button
          type="button"
          class="doc-tb-button"
          :title="`${t('editor.close')} (Esc)`"
          :aria-label="t('editor.close')"
          @click="emit('close')"
        >
          <X :size="16" />
        </button>
      </div>

      <div v-if="showReplace && !readonly" class="find-bar__row">
        <el-input
          v-model="replaceTerm"
          class="find-bar__input"
          size="small"
          :placeholder="t('editor.replace.placeholder')"
          :ariaLabel="t('editor.replace.placeholder')"
          @keydown="onReplaceKeydown"
        />
        <button
          type="button"
          class="doc-tb-button find-bar__text-button"
          :disabled="!status.total"
          @click="engine.replaceMatch(replaceTerm)"
        >
          {{ t('editor.replace.one') }}
        </button>
        <button
          type="button"
          class="doc-tb-button find-bar__text-button"
          :disabled="!status.total"
          @click="engine.replaceAllMatches(replaceTerm)"
        >
          {{ t('editor.replace.all') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Panel floating over the top-right corner of the canvas. */
.find-bar {
  position: absolute;
  z-index: 5;
  top: 8px;
  right: 20px;
  display: flex;
  align-items: flex-start;
  gap: 2px;
  padding: 5px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  background: var(--el-bg-color-overlay);
  box-shadow: var(--el-box-shadow-light);
}

.find-bar__rows {
  display: grid;
  gap: 5px;
}

.find-bar__row {
  display: flex;
  align-items: center;
  gap: 1px;
}

.find-bar__input {
  width: 220px;
  margin-right: 4px;
}

.find-bar__count {
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

/* The chevron points down while the replace row is open. */
.find-bar__chevron {
  transition: transform 150ms ease;
}

.is-active > .find-bar__chevron {
  transform: rotate(90deg);
}

.find-bar__text-button {
  padding: 0 8px;
  font-size: 12px;
}

/* Narrow editors: the panel spans the canvas width and the inputs shrink. */
@container (max-width: 560px) {
  .find-bar {
    right: 8px;
    left: 8px;
  }

  .find-bar__rows {
    flex: 1 1 auto;
    min-width: 0;
  }

  .find-bar__input {
    width: auto;
    flex: 1 1 auto;
  }
}
</style>
