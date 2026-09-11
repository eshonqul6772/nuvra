<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Columns2,
  ExternalLink,
  Grid2x2X,
  PanelTop,
  Pencil,
  Rows2,
  TableCellsMerge,
  TableCellsSplit,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  TextCursorInput,
  Trash2,
  Unlink
} from '@lucide/vue';
import { ElButton, ElInput, type InputInstance, useZIndex } from 'element-plus';

import type { DocumentEngine, TableCommand } from '../core/engine/engine';
import { t } from '../core/labels';

/**
 * Floating context toolbars: link actions under a link, image alignment and alt text above a selected image, and
 * row/column/cell actions above the active table. Rendered in `body` and positioned against the canvas viewport.
 */
defineOptions({ name: 'EditorBubbleMenus' });

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
  { value: 'left', icon: TextAlignStart, label: 'editor.align.left' },
  { value: 'center', icon: TextAlignCenter, label: 'editor.align.center' },
  { value: 'right', icon: TextAlignEnd, label: 'editor.align.right' }
] as const;

/** Table actions in visual groups; `danger` actions are highlighted in red on hover. */
const TABLE_GROUPS = [
  [
    { command: 'addRowBefore', icon: BetweenHorizontalStart, label: 'editor.table.addRowBefore' },
    { command: 'addRowAfter', icon: BetweenHorizontalEnd, label: 'editor.table.addRowAfter' },
    { command: 'deleteRow', icon: Rows2, label: 'editor.table.deleteRow', danger: true }
  ],
  [
    { command: 'addColumnBefore', icon: BetweenVerticalStart, label: 'editor.table.addColumnBefore' },
    { command: 'addColumnAfter', icon: BetweenVerticalEnd, label: 'editor.table.addColumnAfter' },
    { command: 'deleteColumn', icon: Columns2, label: 'editor.table.deleteColumn', danger: true }
  ],
  [
    { command: 'mergeCells', icon: TableCellsMerge, label: 'editor.table.mergeCells' },
    { command: 'splitCell', icon: TableCellsSplit, label: 'editor.table.splitCell' },
    { command: 'toggleHeaderRow', icon: PanelTop, label: 'editor.table.headerRow' }
  ],
  [{ command: 'deleteTable', icon: Grid2x2X, label: 'editor.table.delete', danger: true }]
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
const altInput = ref<InputInstance>();
const linkHref = ref('');
const imageAlign = ref<ImageAlign>('center');
const imageAlt = ref('');
/** Whether the image menu shows the alt text form instead of its buttons. */
const altEditing = ref(false);
const canMerge = ref(false);
const canSplit = ref(false);
/** Stacking order taken from Element Plus whenever a menu appears. */
const zIndex = ref<number>();

const { nextZIndex } = useZIndex();

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
  // A fresh layer whenever a menu appears keeps it above dialogs and the fullscreen editor.
  if (resolved && !kind.value) zIndex.value = nextZIndex();
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
  <Teleport to="body">
    <div
      v-if="kind"
      ref="menuRef"
      class="doc-bubble-host doc-bubble"
      role="toolbar"
      :class="{ 'is-hidden': hidden }"
      :aria-label="menuLabel"
      :style="{ left: `${position.left}px`, top: `${position.top}px`, zIndex }"
    >
      <template v-if="kind === 'link'">
        <a class="doc-bubble__link" target="_blank" rel="noopener noreferrer" :href="linkHref" :title="linkHref">
          <ExternalLink :size="13" />
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
          <Pencil :size="15" />
        </button>
        <button
          type="button"
          class="doc-tb-button"
          :aria-label="t('editor.unlink')"
          :title="t('editor.unlink')"
          @mousedown.prevent
          @click="engine.unsetLink()"
        >
          <Unlink :size="15" />
        </button>
      </template>

      <template v-else-if="kind === 'image'">
        <form v-if="altEditing" class="doc-bubble__form" @submit.prevent="saveAlt">
          <el-input
            ref="altInput"
            v-model="imageAlt"
            size="small"
            :ariaLabel="t('editor.imageAlt')"
            :placeholder="t('editor.imageAlt')"
          />
          <el-button native-type="submit" size="small" type="primary">{{ t('editor.apply') }}</el-button>
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
            <component :is="alignment.icon" :size="15" />
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
            <TextCursorInput :size="15" />
          </button>
          <button
            type="button"
            class="doc-tb-button is-danger"
            :aria-label="t('editor.delete')"
            :title="t('editor.delete')"
            @mousedown.prevent
            @click="removeImage"
          >
            <Trash2 :size="15" />
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
            <component :is="action.icon" :size="15" />
          </button>
        </template>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
/* Menu surface */
.doc-bubble {
  position: fixed;
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 3px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  background: var(--el-bg-color-overlay);
  box-shadow: 0 6px 20px rgb(16 24 40 / 16%);
}

.doc-bubble.is-hidden {
  visibility: hidden;
}

.doc-bubble__divider {
  flex: 0 0 1px;
  align-self: stretch;
  margin: 3px 4px;
  background: var(--el-border-color-lighter);
}

.doc-bubble .doc-tb-button.is-danger:hover:not(:disabled) {
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
}

/* Link menu */
.doc-bubble__link {
  display: inline-flex;
  max-width: 260px;
  align-items: center;
  gap: 5px;
  padding: 0 6px;
  color: var(--el-color-primary);
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
