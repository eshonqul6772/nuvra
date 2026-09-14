<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';

import type { DocumentComment } from '../core/comments';
import { formatShortDate } from '../core/dates';
import { useEditorLabels } from '../core/labels';
import EditorIcon from './editor-icon.vue';

/**
 * Comments panel: the comments of the document in the order of their anchors, each with its replies, and the form of a
 * new comment for the selected text. It only reports what the user did; the editor changes the document and the
 * comment list.
 */
defineOptions({ name: 'EditorComments' });

const { t } = useEditorLabels();

interface Props {
  /** Comments in document order. */
  comments: ReadonlyArray<DocumentComment>;
  /** Ids of the comments whose text is still in the document. */
  anchored: ReadonlySet<string>;
  /** Comment at the caret, highlighted in the list. */
  activeId: string | null;
  /** Whether the form of a new comment is shown. */
  drafting: boolean;
  /** Read-only document: comments can be read but not changed. */
  readonly: boolean | undefined;
}

interface Emits {
  /** The panel's close button was pressed. */
  close: [];
  /** A new comment was written for the selected text. */
  add: [text: string];
  /** The new comment was abandoned. */
  cancelDraft: [];
  /** A reply was written. */
  reply: [id: string, text: string];
  /** A comment was resolved or reopened. */
  resolve: [id: string, resolved: boolean];
  /** A comment was deleted together with its anchor. */
  remove: [id: string];
  /** A comment was chosen: its text is selected in the document. */
  select: [id: string];
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const draft = ref('');
const draftRef = ref<HTMLTextAreaElement>();
/** Comment whose reply form is open, and the reply being written. */
const replyTo = ref<string | null>(null);
const replyText = ref('');
const listRef = ref<HTMLElement>();

/** Date and time of a comment in the short form of documents. */
const formatTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${formatShortDate(date)} ${time}`;
};

/** Saves the new comment; empty text is ignored. */
const submitDraft = () => {
  const text = draft.value.trim();
  if (!text) return;
  emit('add', text);
  draft.value = '';
};

const cancelDraft = () => {
  draft.value = '';
  emit('cancelDraft');
};

const openReply = async (id: string) => {
  replyTo.value = id;
  replyText.value = '';
  await nextTick();
  listRef.value?.querySelector<HTMLTextAreaElement>('.doc-comments__reply textarea')?.focus();
};

const submitReply = () => {
  const text = replyText.value.trim();
  if (!text || !replyTo.value) return;
  emit('reply', replyTo.value, text);
  replyTo.value = null;
  replyText.value = '';
};

/** Ctrl/⌘+Enter saves the form, Escape leaves it. */
const onFormKeydown = (event: KeyboardEvent, submit: () => void, cancel: () => void) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    submit();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    cancel();
  }
};

/** The new comment form takes focus as soon as it opens. */
watch(
  () => props.drafting,
  async drafting => {
    if (!drafting) return;
    await nextTick();
    draftRef.value?.focus();
  },
  { immediate: true }
);

/** The active comment scrolls into view when the caret moves into its text. */
watch(
  () => props.activeId,
  async id => {
    if (!id) return;
    await nextTick();
    listRef.value?.querySelector(`[data-comment-card="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }
);
</script>

<template>
  <aside class="doc-comments" :aria-label="t('editor.comments')">
    <header class="doc-comments__header">
      <span>{{ t('editor.comments') }}</span>
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

    <div ref="listRef" class="doc-comments__list">
      <form v-if="drafting && !readonly" class="doc-comments__card is-draft" @submit.prevent="submitDraft">
        <textarea
          ref="draftRef"
          v-model="draft"
          class="doc-comments__textarea"
          rows="3"
          :placeholder="t('editor.comment.placeholder')"
          @keydown="onFormKeydown($event, submitDraft, cancelDraft)"
        />
        <div class="doc-comments__actions">
          <button type="button" class="doc-btn" @click="cancelDraft">{{ t('editor.comment.cancel') }}</button>
          <button type="submit" class="doc-btn doc-btn--primary" :disabled="!draft.trim()">
            {{ t('editor.comment.save') }}
          </button>
        </div>
      </form>

      <article
        v-for="comment in comments"
        :key="comment.id"
        class="doc-comments__card"
        :class="{
          'is-active': comment.id === activeId,
          'is-resolved': comment.resolved,
          'is-detached': !anchored.has(comment.id)
        }"
        :data-comment-card="comment.id"
        @click="anchored.has(comment.id) && emit('select', comment.id)"
      >
        <div class="doc-comments__meta">
          <strong v-if="comment.author">{{ comment.author }}</strong>
          <span>{{ formatTime(comment.createdAt) }}</span>
          <span v-if="comment.resolved" class="doc-comments__badge">{{ t('editor.comment.resolved') }}</span>
        </div>
        <p class="doc-comments__text">{{ comment.text }}</p>
        <p v-if="!anchored.has(comment.id)" class="doc-comments__note">{{ t('editor.comment.detached') }}</p>

        <div v-for="reply in comment.replies ?? []" :key="reply.id" class="doc-comments__reply-item">
          <div class="doc-comments__meta">
            <strong v-if="reply.author">{{ reply.author }}</strong>
            <span>{{ formatTime(reply.createdAt) }}</span>
          </div>
          <p class="doc-comments__text">{{ reply.text }}</p>
        </div>

        <form
          v-if="replyTo === comment.id"
          class="doc-comments__reply"
          @click.stop
          @submit.prevent="submitReply"
        >
          <textarea
            v-model="replyText"
            class="doc-comments__textarea"
            rows="2"
            :placeholder="t('editor.comment.replyPlaceholder')"
            @keydown="onFormKeydown($event, submitReply, () => (replyTo = null))"
          />
          <div class="doc-comments__actions">
            <button type="button" class="doc-btn" @click="replyTo = null">{{ t('editor.comment.cancel') }}</button>
            <button type="submit" class="doc-btn doc-btn--primary" :disabled="!replyText.trim()">
              {{ t('editor.comment.save') }}
            </button>
          </div>
        </form>

        <div v-else-if="!readonly" class="doc-comments__tools" @click.stop>
          <button type="button" class="doc-tb-button" @click="openReply(comment.id)">
            <EditorIcon name="reply" :size="14" />
            {{ t('editor.comment.reply') }}
          </button>
          <button
            type="button"
            class="doc-tb-button"
            :title="t(comment.resolved ? 'editor.comment.reopen' : 'editor.comment.resolve')"
            @click="emit('resolve', comment.id, !comment.resolved)"
          >
            <EditorIcon :name="comment.resolved ? 'undo-2' : 'check'" :size="14" />
            {{ t(comment.resolved ? 'editor.comment.reopen' : 'editor.comment.resolve') }}
          </button>
          <button
            type="button"
            class="doc-tb-button doc-comments__delete"
            :aria-label="t('editor.delete')"
            :title="t('editor.delete')"
            @click="emit('remove', comment.id)"
          >
            <EditorIcon name="trash" :size="14" />
          </button>
        </div>
      </article>

      <p v-if="!comments.length && !drafting" class="doc-comments__empty">{{ t('editor.comments.empty') }}</p>
    </div>
  </aside>
</template>

<style scoped>
.doc-comments {
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

.doc-comments__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 6px 6px 12px;
  border-bottom: 1px solid var(--nuvra-border);
  color: var(--nuvra-text-strong);
  font-weight: 600;
}

.doc-comments__list {
  display: grid;
  flex: 1 1 auto;
  min-height: 0;
  align-content: start;
  gap: 8px;
  padding: 8px;
  overflow: auto;
}

.doc-comments__card {
  display: grid;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--nuvra-border-light);
  border-radius: 8px;
  background: var(--nuvra-bg);
  cursor: pointer;
}

.doc-comments__card.is-active,
.doc-comments__card.is-draft {
  border-color: var(--nuvra-color-primary-border);
  box-shadow: 0 0 0 2px var(--nuvra-color-primary-soft);
}

.doc-comments__card.is-draft,
.doc-comments__card.is-detached {
  cursor: default;
}

.doc-comments__card.is-resolved {
  opacity: 70%;
}

.doc-comments__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  color: var(--nuvra-text-muted);
  font-size: 11px;
}

.doc-comments__meta strong {
  color: var(--nuvra-text-strong);
  font-size: 12px;
}

.doc-comments__badge {
  padding: 0 6px;
  border-radius: 999px;
  color: var(--nuvra-color-primary);
  background: var(--nuvra-color-primary-soft);
}

.doc-comments__text {
  margin: 0;
  color: var(--nuvra-text-strong);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.doc-comments__note {
  margin: 0;
  color: var(--nuvra-color-danger);
  font-size: 11px;
}

.doc-comments__reply-item {
  display: grid;
  gap: 2px;
  margin-left: 8px;
  padding-left: 8px;
  border-left: 2px solid var(--nuvra-border-light);
}

.doc-comments__textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--nuvra-border);
  border-radius: 6px;
  outline: none;
  color: var(--nuvra-text-strong);
  background: var(--nuvra-bg);
  font: inherit;
  resize: vertical;
}

.doc-comments__textarea:focus {
  border-color: var(--nuvra-color-primary);
}

.doc-comments__reply {
  display: grid;
  gap: 6px;
  margin-top: 4px;
  cursor: default;
}

.doc-comments__actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.doc-comments__tools {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  margin: 2px -4px -2px;
  cursor: default;
}

.doc-comments__tools .doc-tb-button {
  height: 24px;
  font-size: 12px;
}

.doc-comments__delete {
  margin-left: auto;
}

.doc-comments__delete:hover:not(:disabled) {
  color: var(--nuvra-color-danger);
}

.doc-comments__empty {
  margin: 0;
  padding: 8px 4px;
  color: var(--nuvra-text-muted);
}
</style>
