<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';

import type { DocumentEngine, TableCommand } from '../core/engine/engine';
import type { IconName } from '../core/icons';
import { type EditorLabelKey, formatShortcut, t } from '../core/labels';
import { SUPPORTS_POPOVER, clearOpenPopover, setOpenPopover } from '../core/popover';
import EditorIcon from './editor-icon.vue';

/**
 * Menu opened with the right mouse button inside the document. Its entries follow what was clicked: the clipboard
 * actions are always there, links, images and table cells add their own.
 */
defineOptions({ name: 'EditorContextMenu' });

interface Props {
  /** A read-only document only offers copying and selecting. */
  disabled: boolean | undefined;
  /** Engine the entries act on. */
  engine: DocumentEngine;
}

const props = defineProps<Props>();

interface Emits {
  /** The user asked to add or edit a link; the toolbar opens its link form. */
  editLink: [];
}

const emit = defineEmits<Emits>();

/** One entry of the menu. */
interface MenuEntry {
  /** Identifies the entry in the rendered list. */
  key: string;
  label: string;
  icon: IconName;
  /** Shortcut shown at the right of the entry, written with `Mod` for Ctrl/⌘. */
  shortcut?: string;
  /** Draws a separator above the entry. */
  divided?: boolean;
  /** Destructive entries are shown in the danger colour. */
  danger?: boolean;
  /** Entries that cannot run right now, e.g. cutting without a selection. */
  disabled?: boolean;
  /** Keeps focus where the action left it, for entries that open a form of their own. */
  keepFocus?: boolean;
  run: () => void;
}

/** Distance kept between the menu and the edges of the viewport, in pixels. */
const VIEWPORT_MARGIN = 8;

const menuRef = ref<HTMLElement>();
const open = ref(false);
const position = ref({ left: 0, top: 0 });
const entries = shallowRef<MenuEntry[]>([]);

/** Table actions offered for the cell that was clicked, in the order of the table bubble menu. */
const TABLE_ACTIONS = [
  { command: 'addRowBefore', icon: 'between-horizontal-start', label: 'editor.table.addRowBefore' },
  { command: 'addRowAfter', icon: 'between-horizontal-end', label: 'editor.table.addRowAfter' },
  { command: 'addColumnBefore', icon: 'between-vertical-start', label: 'editor.table.addColumnBefore' },
  { command: 'addColumnAfter', icon: 'between-vertical-end', label: 'editor.table.addColumnAfter' }
] as const satisfies ReadonlyArray<{ command: TableCommand; icon: IconName; label: EditorLabelKey }>;

/** Clipboard entries, which every context offers. */
const clipboardEntries = (editable: boolean, hasSelection: boolean): MenuEntry[] => {
  const { engine } = props;
  const list: MenuEntry[] = [];
  if (editable) {
    list.push({
      key: 'cut',
      icon: 'scissors',
      label: t('editor.cut'),
      shortcut: 'Mod+X',
      disabled: !hasSelection,
      run: () => void engine.cutSelection()
    });
  }
  list.push({
    key: 'copy',
    icon: 'copy',
    label: t('editor.copy'),
    shortcut: 'Mod+C',
    disabled: !hasSelection,
    run: () => void engine.copySelection()
  });
  if (editable) {
    list.push({
      key: 'paste',
      icon: 'clipboard',
      label: t('editor.paste'),
      shortcut: 'Mod+V',
      run: () => void engine.pasteFromClipboard()
    });
  }
  return list;
};

/** Link entries for a link under the pointer, or the entry that turns the selection into one. */
const linkEntries = (editable: boolean, hasSelection: boolean): MenuEntry[] => {
  const link = props.engine.getActiveLink();
  if (!link) {
    if (!editable || !hasSelection) return [];
    return [
      {
        key: 'link',
        icon: 'link',
        label: t('editor.link'),
        shortcut: 'Mod+K',
        divided: true,
        keepFocus: true,
        run: () => emit('editLink')
      }
    ];
  }
  const list: MenuEntry[] = [
    {
      key: 'openLink',
      icon: 'external-link',
      label: t('editor.openLink'),
      divided: true,
      run: () => window.open(link.href, '_blank', 'noopener,noreferrer')
    }
  ];
  if (editable) {
    list.push(
      { key: 'editLink', icon: 'link', label: t('editor.editLink'), keepFocus: true, run: () => emit('editLink') },
      { key: 'unlink', icon: 'unlink', label: t('editor.unlink'), run: () => props.engine.unsetLink() }
    );
  }
  return list;
};

/** Table entries for the cell the pointer is in. */
const tableEntries = (): MenuEntry[] => {
  const { engine } = props;
  if (!engine.getActiveCell()) return [];
  const command = (key: TableCommand, icon: IconName, label: EditorLabelKey, extra: Partial<MenuEntry> = {}) => ({
    key,
    icon,
    label: t(label),
    run: () => engine.tableCommand(key),
    ...extra
  });
  const list: MenuEntry[] = TABLE_ACTIONS.map((action, index) =>
    command(action.command, action.icon, action.label, index === 0 ? { divided: true } : {})
  );
  if (engine.canMergeCells()) {
    list.push(command('mergeCells', 'table-cells-merge', 'editor.table.mergeCells', { divided: true }));
  }
  if (engine.canSplitCell()) {
    list.push(command('splitCell', 'table-cells-split', 'editor.table.splitCell', { divided: !list.at(-1)?.divided }));
  }
  list.push(
    command('deleteRow', 'rows-2', 'editor.table.deleteRow', { divided: true, danger: true }),
    command('deleteColumn', 'columns-2', 'editor.table.deleteColumn', { danger: true }),
    command('deleteTable', 'grid-2x2-x', 'editor.table.delete', { danger: true })
  );
  return list;
};

/** Builds the entries for the element that was right-clicked. */
const buildEntries = (target: HTMLElement): MenuEntry[] => {
  const { engine } = props;
  const editable = !props.disabled;
  const image = target.closest('img');
  const hasSelection = image !== null || engine.getSelectedText() !== '';
  const list = [...clipboardEntries(editable, hasSelection), ...linkEntries(editable, hasSelection)];

  if (image && editable) {
    list.push({
      key: 'deleteImage',
      icon: 'trash',
      label: t('editor.delete'),
      divided: true,
      danger: true,
      run: () => engine.removeImage(image)
    });
  }
  if (editable) list.push(...tableEntries());
  if (editable) {
    list.push({
      key: 'clearFormatting',
      icon: 'remove-formatting',
      label: t('editor.clearFormatting'),
      divided: true,
      disabled: !hasSelection,
      run: () => engine.clearFormatting()
    });
  }
  list.push({
    key: 'selectAll',
    icon: 'text-cursor-input',
    label: t('editor.selectAll'),
    shortcut: 'Mod+A',
    divided: !list.at(-1)?.divided,
    run: () => engine.selectAll()
  });
  return list;
};

/** Places the menu at the pointer, moved just enough to stay inside the viewport. */
const place = (x: number, y: number) => {
  const menu = menuRef.value;
  if (!menu) return;
  const { clientWidth: viewportWidth, clientHeight: viewportHeight } = document.documentElement;
  const { offsetWidth: width, offsetHeight: height } = menu;
  position.value = {
    left: Math.max(VIEWPORT_MARGIN, Math.min(x, viewportWidth - width - VIEWPORT_MARGIN)),
    top: Math.max(VIEWPORT_MARGIN, Math.min(y, viewportHeight - height - VIEWPORT_MARGIN))
  };
};

/** Closes the menu and stops following presses, keys, scrolling and resizing. */
const close = () => {
  if (!open.value) return;
  open.value = false;
  clearOpenPopover(close);
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  document.removeEventListener('keydown', onDocumentKeydown, true);
  document.removeEventListener('scroll', close, true);
  window.removeEventListener('resize', close);
  const menu = menuRef.value;
  if (SUPPORTS_POPOVER && menu?.matches(':popover-open')) menu.hidePopover();
};

/** A press outside the menu closes it; the press itself reaches the document as usual. */
function onDocumentPointerDown(event: PointerEvent) {
  const { target } = event;
  if (target instanceof Node && menuRef.value?.contains(target)) return;
  close();
}

/** Escape closes the menu before the editor or a surrounding dialog sees it. */
function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  close();
  props.engine.focus();
}

/** Shows the menu in the top layer and starts the listeners that close it again. */
const show = () => {
  const menu = menuRef.value;
  if (!menu) return;
  if (SUPPORTS_POPOVER && !menu.matches(':popover-open')) menu.showPopover();
  setOpenPopover(close);
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  document.addEventListener('keydown', onDocumentKeydown, true);
  document.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);
};

/** Opens the menu at the pointer with the entries of what was clicked. */
const onContextMenu = async (event: MouseEvent) => {
  const target = event.target as Node | null;
  if (!target || !props.engine.root.contains(target)) return;
  event.preventDefault();
  entries.value = buildEntries(target instanceof HTMLElement ? target : (target.parentElement as HTMLElement));
  position.value = { left: event.clientX, top: event.clientY };
  open.value = true;
  await nextTick();
  show();
  place(event.clientX, event.clientY);
};

/** Runs an entry and returns focus to the document, unless the entry opened a form of its own. */
const run = (entry: MenuEntry) => {
  if (entry.disabled) return;
  close();
  entry.run();
  if (!entry.keepFocus) props.engine.focus();
};

onMounted(() => props.engine.root.addEventListener('contextmenu', onContextMenu));

onBeforeUnmount(() => {
  props.engine.root.removeEventListener('contextmenu', onContextMenu);
  close();
});
</script>

<template>
  <div
    ref="menuRef"
    class="doc-context-menu doc-menu"
    popover="manual"
    role="menu"
    :class="{ 'is-open': open }"
    :style="{ left: `${position.left}px`, top: `${position.top}px` }"
  >
    <div class="doc-menu__items">
      <template v-for="entry in entries" :key="entry.key">
        <div v-if="entry.divided" class="doc-menu__divider" role="separator" />
        <button
          type="button"
          role="menuitem"
          class="doc-menu__item"
          :class="{ 'is-danger': entry.danger }"
          :disabled="entry.disabled"
          @mousedown.prevent
          @click="run(entry)"
        >
          <EditorIcon :name="entry.icon" :size="14" />
          {{ entry.label }}
          <span v-if="entry.shortcut" class="doc-menu__hint">{{ formatShortcut(entry.shortcut) }}</span>
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* Floating panel at the pointer: in the top layer where the Popover API exists, a fixed element otherwise. */
.doc-context-menu {
  position: fixed;
  z-index: 3000;
  inset: auto;
  box-sizing: border-box;
  max-height: 80vh;
  margin: 0;
  padding: var(--doc-popover-padding, 4px);
  overflow: auto;
  border: 1px solid var(--nuvra-border-light);
  border-radius: 10px;
  color: var(--nuvra-text);
  background: var(--nuvra-bg-overlay);
  box-shadow: var(--nuvra-shadow);
  font-size: 14px;
  line-height: 1.4;
  text-align: left;
}

.doc-context-menu:not(.is-open) {
  display: none;
}
</style>
