<script setup lang="ts">
import { ICONS, type IconName } from '../core/icons';

/** Inline SVG icon from the editor's icon set, drawn in the current text colour. */
defineOptions({ name: 'EditorIcon' });

interface Props {
  /** Icon to draw. */
  name: IconName;
  /** Width and height in pixels. */
  size?: number;
}

withDefaults(defineProps<Props>(), { size: 24 });
</script>

<template>
  <svg
    class="doc-icon"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    :width="size"
    :height="size"
  >
    <component :is="tag" v-for="([tag, attributes], index) in ICONS[name]" :key="index" v-bind="attributes" />
  </svg>
</template>

<style scoped>
.doc-icon {
  flex: 0 0 auto;
}
</style>
