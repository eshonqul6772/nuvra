<script setup lang="ts">
import { provide, ref } from 'vue';

import { DROPDOWN_SELECT, type DropdownCommand } from './dropdown-context';
// biome-ignore lint/style/useImportType: Component is rendered in the template.
import EditorPopover from './editor-popover.vue';

/**
 * Menu opened from its trigger slot. Items (`EditorDropdownItem`) report their command through `command` and close
 * the menu; arrow keys, Home and End move between items.
 */
defineOptions({ name: 'EditorDropdown' });

interface Props {
  /** Prevents opening the menu. */
  disabled?: boolean;
  /** Largest height of the menu in pixels; longer menus scroll. */
  maxHeight?: number;
  /** Extra class of the element that holds the items. */
  menuClass?: string;
  /** Edge of the trigger the menu is aligned with. */
  placement?: 'bottom-start' | 'bottom-end';
}

withDefaults(defineProps<Props>(), {
  disabled: false,
  maxHeight: undefined,
  menuClass: undefined,
  placement: 'bottom-start'
});

interface Emits {
  /** An item was chosen. */
  command: [command: DropdownCommand];
}

const emit = defineEmits<Emits>();

const popoverRef = ref<InstanceType<typeof EditorPopover>>();
const itemsRef = ref<HTMLElement>();
const open = ref(false);

/** Enabled items in their visual order. */
const getItems = () =>
  Array.from(itemsRef.value?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);

/** Moves focus into a menu opened from the keyboard; a mouse click leaves focus, and the selection, in the document. */
const onShown = () => {
  const root: HTMLElement | undefined = popoverRef.value?.$el;
  const active = document.activeElement;
  if (!root?.contains(active) || itemsRef.value?.contains(active)) return;
  const items = getItems();
  (items.find(item => item.classList.contains('is-selected')) ?? items[0])?.focus();
};

/** Closes the menu, returns keyboard focus to the trigger and reports the chosen command. */
const select = (command: DropdownCommand) => {
  const hadFocus = itemsRef.value?.contains(document.activeElement) ?? false;
  open.value = false;
  if (hadFocus) (popoverRef.value?.$el as HTMLElement | undefined)?.querySelector<HTMLElement>('button')?.focus();
  emit('command', command);
};

/** Arrow keys, Home and End move focus between the items. */
const onKeydown = (event: KeyboardEvent) => {
  const items = getItems();
  if (!items.length) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  let next: number;
  switch (event.key) {
    case 'ArrowDown':
      next = (index + 1) % items.length;
      break;
    case 'ArrowUp':
      next = index <= 0 ? items.length - 1 : index - 1;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = items.length - 1;
      break;
    default:
      return;
  }
  event.preventDefault();
  items[next]?.focus();
};

provide(DROPDOWN_SELECT, select);
</script>

<template>
  <EditorPopover
    ref="popoverRef"
    v-model:open="open"
    panel-class="doc-menu"
    role="menu"
    :disabled="disabled"
    :max-height="maxHeight"
    :placement="placement"
    @shown="onShown"
  >
    <template #reference>
      <slot />
    </template>
    <div ref="itemsRef" class="doc-menu__items" :class="menuClass" @keydown="onKeydown">
      <slot name="menu" />
    </div>
  </EditorPopover>
</template>
