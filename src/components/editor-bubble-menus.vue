<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

import type { DocumentEngine, TableCommand } from '../core/engine/engine';
import { useEditorLabels } from '../core/labels';
import { SUPPORTS_POPOVER } from '../core/popover';
import EditorIcon from './editor-icon.vue';

/**
 * Floating context toolbars: link actions under a link, image alignment and alt text above a selected image, and
 * row/column/cell actions above the active table. Shown in the top layer and positioned against the canvas viewport.
 */
defineOptions({ name: 'EditorBubbleMenus' });

const { t } = useEditorLabels();

interface Props {
  /** Engine whose selection decides which menu is shown. */
  engine: DocumentEngine;
  /** Canvas scroll container; menus follow its scrolling and hide when their target leaves it. */
  scrollTarget: HTMLElement;
}

const props = defineProps<Props>();

interface Emits {
  /** The user asked to edit the link under the caret; the toolbar opens its link form. */
  editLink: [];
}

const emit = defineEmits<Emits>();

type MenuKind = 'link' | 'image' | 'table';
type ImageAlign = 'left' | 'center' | 'right';

/** Menu to show and the element it is attached to. */
interface ResolvedMenu {
  kind: MenuKind;
  /** Element the menu is positioned against. */
  reference: HTMLElement;
  /** Side of the reference the menu prefers. */
  placement: 'above' | 'below';
}

const IMAGE_ALIGNMENTS = [
  { value: 'left', icon: 'text-align-start', label: 'editor.align.left' },
  { value: 'center', icon: 'text-align-center', label: 'editor.align.center' },
  { value: 'right', icon: 'text-align-end', label: 'editor.align.right' }
] as const;

/** Table actions in visual groups; `danger` actions are highlighted in red on hover. */
const TABLE_GROUPS = [
  [
    { command: 'addRowBefore', icon: 'between-horizontal-start', label: 'editor.table.addRowBefore' },
    { command: 'addRowAfter', icon: 'between-horizontal-end', label: 'editor.table.addRowAfter' },
    { command: 'deleteRow', icon: 'rows-2', label: 'editor.table.deleteRow', danger: true }
  ],
  [
    { command: 'addColumnBefore', icon: 'between-vertical-start', label: 'editor.table.addColumnBefore' },
    { command: 'addColumnAfter', icon: 'between-vertical-end', label: 'editor.table.addColumnAfter' },
    { command: 'deleteColumn', icon: 'columns-2', label: 'editor.table.deleteColumn', danger: true }
  ],
  [
    { command: 'mergeCells', icon: 'table-cells-merge', label: 'editor.table.mergeCells' },
    { command: 'splitCell', icon: 'table-cells-split', label: 'editor.table.splitCell' },
    { command: 'toggleHeaderRow', icon: 'panel-top', label: 'editor.table.headerRow' }
  ],
  [{ command: 'deleteTable', icon: 'grid-2x2-x', label: 'editor.table.delete', danger: true }]
] as const;

/** Distance between a menu and its reference or the canvas edges, in pixels. */
const MENU_GAP = 8;

/** Kind of the visible menu, or `null` when none is shown. */
const kind = ref<MenuKind | null>(null);
/** Viewport coordinates of the menu. */
const position = ref({ left: 0, top: 0 });
/** Whether the reference has scrolled out of the canvas. */
const hidden = ref(false);
const menuRef = ref<HTMLElement>();
const altInput = ref<HTMLInputElement>();
const linkHref = ref('');
const imageAlign = ref<ImageAlign>('center');
const imageAlt = ref('');
/** Whether the image menu shows the alt text form instead of its buttons. */
const altEditing = ref(false);
const canMerge = ref(false);
const canSplit = ref(false);

/** The menu currently shown with its reference element. */
let current: ResolvedMenu | null = null;
let updateFrame = 0;
/** Cleanup callbacks for DOM listeners and engine subscriptions. */
const disposers: Array<() => void> = [];

/** Accessible name of the visible menu. */
const menuLabel = computed(() => {
  if (kind.value === 'link') return t('editor.link');
  if (kind.value === 'image') return t('editor.image');
  return t('editor.table.title');
});

/** Whether keyboard focus is inside the editable document. */
const isEditorFocused = () => document.activeElement === props.engine.root;

/** Decides which menu the selection calls for: a selected image, a link under a collapsed caret, or a table. */
const resolveMenu = (): ResolvedMenu | null => {
  const { engine } = props;
  if (!engine.isEditable) return null;
  const image = engine.selectedImage;
  if (image) return { kind: 'image', reference: image, placement: 'above' };
  if (!isEditorFocused() && !engine.hasCellSelection) return null;
  const link = engine.getActiveLink();
  if (link && (document.getSelection()?.isCollapsed ?? true)) {
    return { kind: 'link', reference: link, placement: 'below' };
  }
  const table = engine.getActiveCell()?.closest('table');
  return table ? { kind: 'table', reference: table, placement: 'above' } : null;
};

/** Positions the menu next to its reference, kept inside the canvas and flipped when there is no room. */
const positionMenu = () => {
  const menu = menuRef.value;
  const reference = current?.reference;
  if (!menu || !reference?.isConnected) return;
  // The top layer keeps the menu above dialogs and the fullscreen editor; moving the editor DOM leaves it, so it is
  // shown again here.
  if (SUPPORTS_POPOVER && !menu.matches(':popover-open')) menu.showPopover();
  const anchor = reference.getBoundingClientRect();
  const bounds = props.scrollTarget.getBoundingClientRect();
  hidden.value = anchor.bottom < bounds.top || anchor.top > bounds.bottom;
  const { offsetWidth: width, offsetHeight: height } = menu;
  const below = current?.placement === 'below';
  let top = below ? anchor.bottom + MENU_GAP : anchor.top - height - MENU_GAP;
  if (below && top + height > bounds.bottom - MENU_GAP) top = anchor.top - height - MENU_GAP;
  // A menu above a tall table stays visible at the top of the canvas while the table is on screen.
  if (!below && top < bounds.top + MENU_GAP) top = bounds.top + MENU_GAP;
  const preferredLeft = below ? anchor.left : anchor.left + anchor.width / 2 - width / 2;
  const left = Math.min(
    Math.max(preferredLeft, bounds.left + MENU_GAP),
    Math.max(bounds.left + MENU_GAP, bounds.right - width - MENU_GAP)
  );
  position.value = { left, top };
};

/** Copies the values a menu displays from its reference element and the engine. */
const refreshValues = ({ kind: menu, reference }: ResolvedMenu) => {
  if (menu === 'link') linkHref.value = reference.getAttribute('href') ?? '';
  if (menu === 'image') {
    const align = reference.getAttribute('data-align');
    imageAlign.value = align === 'left' || align === 'right' ? align : 'center';
    if (!altEditing.value) imageAlt.value = reference.getAttribute('alt') ?? '';
  }
  if (menu === 'table') {
    canMerge.value = props.engine.canMergeCells();
    canSplit.value = props.engine.canSplitCell();
  }
};

/** Re-evaluates which menu to show, refreshes its values and repositions it. */
const update = () => {
  updateFrame = 0;
  // While the user types into the menu itself (alt text), keep it open where it is.
  if (menuRef.value?.contains(document.activeElement)) {
    positionMenu();
    return;
  }
  const resolved = resolveMenu();
  current = resolved;
  if (resolved?.kind !== 'image') altEditing.value = false;
  kind.value = resolved?.kind ?? null;
  if (!resolved) return;
  refreshValues(resolved);
  void nextTick(positionMenu);
};

/** Coalesces menu updates into one per animation frame. */
const scheduleUpdate = () => {
  if (!updateFrame) updateFrame = requestAnimationFrame(update);
};

/** Keeps the menu attached to its reference while the canvas scrolls. */
const onCanvasScroll = () => requestAnimationFrame(positionMenu);

/** Runs a table action and refreshes the menu, whose table may have changed. */
const runTableCommand = (command: TableCommand) => {
  props.engine.tableCommand(command);
  scheduleUpdate();
};

/** Aligns the selected image. */
const setImageAlign = (align: ImageAlign) => {
  const image = props.engine.selectedImage;
  if (image) props.engine.updateImage(image, { align });
  scheduleUpdate();
};

/** Shows the alt text form and focuses its input. */
const startAltEditing = async () => {
  altEditing.value = true;
  await nextTick();
  altInput.value?.focus();
};

/** Saves the alt text of the image the menu belongs to and returns focus to the document. */
const saveAlt = () => {
  const image = current?.kind === 'image' ? (current.reference as HTMLImageElement) : null;
  altEditing.value = false;
  if (image) props.engine.updateImage(image, { alt: imageAlt.value.trim() || null });
  props.engine.root.focus({ preventScroll: true });
  scheduleUpdate();
};

/** Deletes the selected image. */
const removeImage = () => {
  const image = props.engine.selectedImage;
  if (image) props.engine.removeImage(image);
};

/** Merge needs a multi-cell selection and split a merged cell. */
const isTableCommandDisabled = (command: TableCommand) =>
  (command === 'mergeCells' && !canMerge.value) || (command === 'splitCell' && !canSplit.value);

/** Follows engine changes, canvas scrolling, window resizing and focus moves. */
onMounted(() => {
  props.scrollTarget.addEventListener('scroll', onCanvasScroll, { passive: true });
  window.addEventListener('resize', scheduleUpdate);
  document.addEventListener('focusin', scheduleUpdate);
  document.addEventListener('focusout', scheduleUpdate);
  disposers.push(
    props.engine.on('selection', scheduleUpdate),
    props.engine.on('update', scheduleUpdate),
    props.engine.on('blur', scheduleUpdate),
    () => props.scrollTarget.removeEventListener('scroll', onCanvasScroll),
    () => window.removeEventListener('resize', scheduleUpdate),
    () => document.removeEventListener('focusin', scheduleUpdate),
    () => document.removeEventListener('focusout', scheduleUpdate)
  );
  scheduleUpdate();
});

/** Removes every listener and pending update. */
onBeforeUnmount(() => {
  for (const dispose of disposers) dispose();
  cancelAnimationFrame(updateFrame);
});
</script>

<template>
  <div
    v-if="kind"
    ref="menuRef"
    class="doc-bubble"
    popover="manual"
    role="toolbar"
    :class="{ 'is-hidden': hidden }"
    :aria-label="menuLabel"
    :style="{ left: `${position.left}px`, top: `${position.top}px` }"
  >
    <template v-if="kind === 'link'">
      <a class="doc-bubble__link" target="_blank" rel="noopener noreferrer" :href="linkHref" :title="linkHref">
        <EditorIcon name="external-link" :size="13" />
        <span>{{ linkHref }}</span>
      </a>
      <span class="doc-bubble__divider" />
      <button
        type="button"
        class="doc-tb-button"
        :aria-label="t('editor.editLink')"
        :title="t('editor.editLink')"
        @mousedown.prevent
        @click="emit('editLink')"
      >
        <EditorIcon name="pencil" :size="15" />
      </button>
      <button
        type="button"
        class="doc-tb-button"
        :aria-label="t('editor.unlink')"
        :title="t('editor.unlink')"
        @mousedown.prevent
        @click="engine.unsetLink()"
      >
        <EditorIcon name="unlink" :size="15" />
      </button>
    </template>

    <template v-else-if="kind === 'image'">
      <form v-if="altEditing" class="doc-bubble__form" @submit.prevent="saveAlt">
        <input
          ref="altInput"
          v-model="imageAlt"
          class="doc-input"
          type="text"
          :aria-label="t('editor.imageAlt')"
          :placeholder="t('editor.imageAlt')"
        />
        <button type="submit" class="doc-btn doc-btn--primary">{{ t('editor.apply') }}</button>
      </form>
      <template v-else>
        <button
          v-for="alignment in IMAGE_ALIGNMENTS"
          :key="alignment.value"
          type="button"
          class="doc-tb-button"
          :class="{ 'is-active': imageAlign === alignment.value }"
          :aria-label="t(alignment.label)"
          :title="t(alignment.label)"
          @mousedown.prevent
          @click="setImageAlign(alignment.value)"
        >
          <EditorIcon :name="alignment.icon" :size="15" />
        </button>
        <span class="doc-bubble__divider" />
        <button
          type="button"
          class="doc-tb-button"
          :aria-label="t('editor.imageAlt')"
          :title="t('editor.imageAlt')"
          @mousedown.prevent
          @click="startAltEditing"
        >
          <EditorIcon name="text-cursor-input" :size="15" />
        </button>
        <button
          type="button"
          class="doc-tb-button is-danger"
          :aria-label="t('editor.delete')"
          :title="t('editor.delete')"
          @mousedown.prevent
          @click="removeImage"
        >
          <EditorIcon name="trash" :size="15" />
        </button>
      </template>
    </template>

    <template v-else>
      <template v-for="(group, index) in TABLE_GROUPS" :key="index">
        <span v-if="index" class="doc-bubble__divider" />
        <button
          v-for="action in group"
          :key="action.command"
          type="button"
          class="doc-tb-button"
          :class="{ 'is-danger': 'danger' in action }"
          :aria-label="t(action.label)"
          :disabled="isTableCommandDisabled(action.command)"
          :title="t(action.label)"
          @mousedown.prevent
          @click="runTableCommand(action.command)"
        >
          <EditorIcon :name="action.icon" :size="15" />
        </button>
      </template>
    </template>
  </div>
</template>

<style scoped>
/* Menu surface: in the top layer when the Popover API is available, a fixed element above the page otherwise. */
.doc-bubble {
  position: fixed;
  z-index: 2100;
  inset: auto;
  display: flex;
  box-sizing: border-box;
  align-items: center;
  gap: 1px;
  margin: 0;
  padding: 3px;
  overflow: visible;
  border: 1px solid var(--nuvra-border-light);
  border-radius: 8px;
  color: var(--nuvra-text);
  background: var(--nuvra-bg-overlay);
  box-shadow: 0 6px 20px rgb(16 24 40 / 16%);
}

.doc-bubble.is-hidden {
  visibility: hidden;
}

.doc-bubble__divider {
  flex: 0 0 1px;
  align-self: stretch;
  margin: 3px 4px;
  background: var(--nuvra-border-lighter);
}

.doc-bubble .doc-tb-button.is-danger:hover:not(:disabled) {
  color: var(--nuvra-color-danger);
  background: var(--nuvra-color-danger-soft);
}

/* Link menu */
.doc-bubble__link {
  display: inline-flex;
  max-width: 260px;
  align-items: center;
  gap: 5px;
  padding: 0 6px;
  color: var(--nuvra-color-primary);
  font-size: 12px;
  text-decoration: none;
}

.doc-bubble__link span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Image alt text form */
.doc-bubble__form {
  display: flex;
  width: 280px;
  gap: 4px;
}
</style>
