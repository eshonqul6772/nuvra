<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';

import { useEditorLabels } from '../core/labels';

/** Small form under a footnote reference that edits the text of its note. */
defineOptions({ name: 'EditorFootnoteForm' });

const { t } = useEditorLabels();

interface Props {
  /** The footnote reference being edited. */
  reference: HTMLElement;
  /** Element the form is positioned in; it must be positioned itself. */
  container: HTMLElement;
  /** Read-only document: the note is shown but cannot be changed. */
  readonly: boolean | undefined;
}

interface Emits {
  /** The text was saved. */
  save: [text: string];
  /** The form was left without saving. */
  cancel: [];
  /** The footnote was deleted. */
  remove: [];
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

/** Width of the form, in pixels. */
const FORM_WIDTH = 300;
/** Gap between the reference and the form, in pixels. */
const FORM_GAP = 6;

const text = ref(props.reference.getAttribute('data-footnote') ?? '');
const position = ref({ left: 0, top: 0 });
const textareaRef = ref<HTMLTextAreaElement>();

/** Ctrl/⌘+Enter saves, Escape leaves the form. */
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    emit('save', text.value.trim());
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    emit('cancel');
  }
};

onMounted(async () => {
  const anchor = props.reference.getBoundingClientRect();
  const container = props.container.getBoundingClientRect();
  const left = Math.min(anchor.left - container.left, container.width - FORM_WIDTH - FORM_GAP);
  position.value = {
    left: Math.max(FORM_GAP, left),
    top: Math.max(FORM_GAP, anchor.bottom - container.top + FORM_GAP)
  };
  await nextTick();
  textareaRef.value?.focus();
});
</script>

<template>
  <form
    class="doc-footnote-form"
    :style="{ left: `${position.left}px`, top: `${position.top}px`, width: `${FORM_WIDTH}px` }"
    @submit.prevent="emit('save', text.trim())"
  >
    <label class="doc-footnote-form__label">
      {{ t('editor.footnote') }}
      <textarea
        ref="textareaRef"
        v-model="text"
        class="doc-footnote-form__text"
        rows="3"
        :placeholder="t('editor.footnote.placeholder')"
        :readonly="readonly"
        @keydown="onKeydown"
      />
    </label>
    <div class="doc-footnote-form__actions">
      <button
        v-if="!readonly"
        type="button"
        class="doc-btn doc-btn--danger-text doc-footnote-form__remove"
        @click="emit('remove')"
      >
        {{ t('editor.delete') }}
      </button>
      <button type="button" class="doc-btn" @click="emit('cancel')">{{ t('editor.comment.cancel') }}</button>
      <button v-if="!readonly" type="submit" class="doc-btn doc-btn--primary" :disabled="!text.trim()">
        {{ t('editor.comment.save') }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.doc-footnote-form {
  position: absolute;
  z-index: 6;
  display: grid;
  box-sizing: border-box;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--nuvra-border-light);
  border-radius: 8px;
  background: var(--nuvra-bg-overlay);
  box-shadow: var(--nuvra-shadow);
  color: var(--nuvra-text);
  font-size: 12px;
}

.doc-footnote-form__label {
  display: grid;
  gap: 4px;
  color: var(--nuvra-text-strong);
  font-weight: 600;
}

.doc-footnote-form__text {
  box-sizing: border-box;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--nuvra-border);
  border-radius: 6px;
  outline: none;
  color: var(--nuvra-text-strong);
  background: var(--nuvra-bg);
  font: inherit;
  font-weight: 400;
  resize: vertical;
}

.doc-footnote-form__text:focus {
  border-color: var(--nuvra-color-primary);
}

.doc-footnote-form__actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.doc-footnote-form__remove {
  margin-right: auto;
}
</style>
