<script setup lang="ts">
import { inject } from 'vue';

import { DROPDOWN_SELECT, type DropdownCommand } from './dropdown-context';

/**
 * Item of an `EditorDropdown`. Pressing it keeps focus where it was, so the document selection survives; `class` and
 * `style` apply to the item button.
 */
defineOptions({ name: 'EditorDropdownItem', inheritAttrs: false });

interface Props {
  /** Value reported to the dropdown when the item is chosen. */
  command: DropdownCommand;
  /** Draws a separator above the item. */
  divided?: boolean;
}

withDefaults(defineProps<Props>(), { divided: false });

const select = inject(DROPDOWN_SELECT, undefined);
</script>

<template>
  <div v-if="divided" class="doc-menu__divider" role="separator" />
  <button
    v-bind="$attrs"
    type="button"
    role="menuitem"
    class="doc-menu__item"
    @mousedown.prevent
    @click="select?.(command)"
  >
    <slot />
  </button>
</template>
