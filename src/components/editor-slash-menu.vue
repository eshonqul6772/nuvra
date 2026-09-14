<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import type { DocumentEngine } from '../core/engine/engine';
import { useEditorLabels } from '../core/labels';
import { type SlashCommand, filterSlashCommands, readSlashQuery } from '../core/slash-commands';
import EditorIcon from './editor-icon.vue';

/**
 * The `/` command menu: typing `/` at the start of a line or after a space lists blocks and actions under the caret,
 * the letters typed next filter them, and Enter or a click runs one after removing what was typed.
 */
defineOptions({ name: 'EditorSlashMenu' });

const { t } = useEditorLabels();

interface Props {
  /** Engine the commands run on. */
  engine: DocumentEngine;
  /** Every command the menu offers. */
  commands: readonly SlashCommand[];
  /** Element the menu is positioned in; it must be positioned itself. */
  container: HTMLElement;
}

const props = defineProps<Props>();

/** Gap between the caret line and the menu, in pixels. */
const MENU_GAP = 6;
/** Largest height of the menu, in pixels. */
const MENU_MAX_HEIGHT = 280;
/** Width of the menu, in pixels. */
const MENU_WIDTH = 260;

/** Filter typed after `/`, or `null` while the menu is closed. */
const query = ref<string | null>(null);
const activeIndex = ref(0);
const position = ref({ left: 0, top: 0 });
const listRef = ref<HTMLElement>();
/** Text before the caret when the user closed the menu with Escape; it stays closed until that text changes. */
let dismissedText: string | null = null;

const results = computed(() => (query.value === null ? [] : filterSlashCommands(props.commands, query.value)));
const open = computed(() => query.value !== null && results.value.length > 0);

/** Places the menu under the caret, or above it when there is no room below. */
const place = () => {
  const selection = document.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  const container = props.container.getBoundingClientRect();
  const caret =
    range.getClientRects()[0] ??
    (range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement
    )?.getBoundingClientRect();
  if (!caret) return;
  const below = caret.bottom + MENU_GAP - container.top;
  const top =
    below + MENU_MAX_HEIGHT > container.height ? caret.top - MENU_GAP - MENU_MAX_HEIGHT - container.top : below;
  const left = Math.min(Math.max(caret.left - container.left, MENU_GAP), container.width - MENU_WIDTH - MENU_GAP);
  position.value = { left: Math.max(MENU_GAP, left), top: Math.max(MENU_GAP, top) };
};

const close = () => {
  query.value = null;
};

/** Opens, filters or closes the menu after the document or the caret changed. */
const sync = (typed: boolean) => {
  const text = props.engine.isEditable ? props.engine.getTextBeforeCaret() : null;
  const next = readSlashQuery(text);
  if (next === null || text === dismissedText) {
    close();
    return;
  }
  dismissedText = null;
  // Moving the caret into an old `/word` does not open the menu; typing it does.
  if (query.value === null && !typed) return;
  if (next !== query.value) activeIndex.value = 0;
  query.value = next;
  void nextTick(place);
};

/** Removes the typed `/filter` and runs the command. */
const run = (command: SlashCommand | undefined) => {
  if (!command || query.value === null) return;
  const length = query.value.length + 1;
  close();
  props.engine.focus();
  props.engine.deleteBeforeCaret(length);
  command.run(props.engine);
};

/** Arrow keys, Enter, Tab and Escape drive the open menu before the document sees them. */
const onKeydown = (event: KeyboardEvent) => {
  if (!open.value) return;
  const count = results.value.length;
  switch (event.key) {
    case 'ArrowDown':
      activeIndex.value = (activeIndex.value + 1) % count;
      break;
    case 'ArrowUp':
      activeIndex.value = (activeIndex.value - 1 + count) % count;
      break;
    case 'Enter':
    case 'Tab':
      run(results.value[activeIndex.value]);
      break;
    case 'Escape':
      dismissedText = props.engine.getTextBeforeCaret();
      close();
      break;
    default:
      return;
  }
  event.preventDefault();
  // The engine listens on the same element, so only an immediate stop keeps it from handling the key too.
  event.stopImmediatePropagation();
};

watch(activeIndex, async () => {
  await nextTick();
  listRef.value?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
});

const disposers: Array<() => void> = [];

onMounted(() => {
  const root = props.engine.root;
  root.addEventListener('keydown', onKeydown, true);
  disposers.push(
    () => root.removeEventListener('keydown', onKeydown, true),
    props.engine.on('update', () => sync(true)),
    props.engine.on('selection', () => sync(false)),
    props.engine.on('blur', close)
  );
});

onBeforeUnmount(() => {
  for (const dispose of disposers) dispose();
});
</script>

<template>
  <div
    v-if="open"
    ref="listRef"
    class="doc-slash-menu doc-menu__items"
    role="listbox"
    :aria-label="t('editor.slash.title')"
    :style="{ left: `${position.left}px`, top: `${position.top}px`, width: `${MENU_WIDTH}px`, maxHeight: `${MENU_MAX_HEIGHT}px` }"
  >
    <button
      v-for="(command, index) in results"
      :key="command.id"
      type="button"
      role="option"
      class="doc-menu__item"
      :class="{ 'is-active': index === activeIndex }"
      :aria-selected="index === activeIndex"
      @mousedown.prevent
      @mouseenter="activeIndex = index"
      @click="run(command)"
    >
      <EditorIcon :name="command.icon ?? 'plus'" :size="14" />
      <span class="doc-slash-menu__label">{{ command.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.doc-slash-menu {
  position: absolute;
  z-index: 6;
  box-sizing: border-box;
  align-content: start;
  padding: 4px;
  overflow: auto;
  border: 1px solid var(--nuvra-border-light);
  border-radius: 8px;
  background: var(--nuvra-bg-overlay);
  box-shadow: var(--nuvra-shadow);
}

.doc-slash-menu .doc-menu__item.is-active {
  color: var(--nuvra-color-primary);
  background: var(--nuvra-color-primary-soft);
}

.doc-slash-menu__label {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
