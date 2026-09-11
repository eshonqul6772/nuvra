<script setup lang="ts">
import { ref } from 'vue';
import { ChevronDown, Highlighter } from '@lucide/vue';
import { ElPopover } from 'element-plus';

import { t } from '../core/labels';

/**
 * Word-style split colour button: the main part re-applies the last used colour, the caret opens a palette with
 * a reset option and a custom colour input.
 */
defineOptions({ name: 'EditorColorPicker' });

interface Props {
  /** Colour applied under the caret, used to mark the selected swatch. */
  current: string;
  /** Disables both parts of the button. */
  disabled: boolean;
  /** Whether the picker sets the text colour or the highlight colour. */
  mode: 'text' | 'highlight';
}

interface Emits {
  /** A colour was picked; `null` removes the colour. */
  select: [color: string | null];
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

/** Swatches of the palette, ten per row like the grid. */
// biome-ignore format: one row per hue family keeps the swatch grid readable.
const PALETTE = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
  '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
  '#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd',
  '#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79',
  '#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#073763', '#20124d', '#4c1130'
];
/** Colours offered by the main button before anything was picked. */
const INITIAL_COLOR = { text: '#cc0000', highlight: '#ffff00' } as const;
/** Popover width that fits ten swatches per row. */
const POPOVER_WIDTH = 236;

const visible = ref(false);
/** Colour re-applied by the main button, like Word. */
const lastColor = ref<string>(INITIAL_COLOR[props.mode]);

/** Accessible name and tooltip of the picker. */
const label = t(props.mode === 'text' ? 'editor.textColor' : 'editor.highlight');

/** Closes the palette, remembers a picked colour and emits it. */
const apply = (color: string | null) => {
  if (color) lastColor.value = color;
  visible.value = false;
  emit('select', color);
};

/** Applies the value chosen in the native colour input. */
const onCustomColor = (event: Event) => apply((event.target as HTMLInputElement).value);
</script>

<template>
  <div class="color-picker">
    <button
      type="button"
      class="doc-tb-button color-picker__apply"
      :disabled="disabled"
      :title="label"
      :aria-label="label"
      @mousedown.prevent
      @click="apply(lastColor)"
    >
      <span v-if="mode === 'text'" class="color-picker__letter">A</span>
      <Highlighter v-else :size="15" />
      <span class="color-picker__bar" :style="{ background: lastColor }" />
    </button>
    <el-popover
      v-model:visible="visible"
      trigger="click"
      placement="bottom-start"
      popper-class="doc-editor-popper"
      :width="POPOVER_WIDTH"
      :disabled="disabled"
      :show-arrow="false"
    >
      <template #reference>
        <button
          type="button"
          class="doc-tb-button doc-tb-button--caret"
          :disabled="disabled"
          :aria-label="label"
          @mousedown.prevent
        >
          <ChevronDown :size="12" />
        </button>
      </template>

      <div class="palette">
        <button type="button" class="palette__reset" @click="apply(null)">
          <span class="palette__reset-swatch" :class="`is-${mode}`" />
          {{ t(mode === 'text' ? 'editor.colors.automatic' : 'editor.colors.none') }}
        </button>
        <div class="palette__grid">
          <button
            v-for="color in PALETTE"
            :key="color"
            type="button"
            class="palette__swatch"
            :class="{ 'is-selected': color === current.toLowerCase() }"
            :style="{ background: color }"
            :title="color"
            :aria-label="`${label}: ${color}`"
            @click="apply(color)"
          />
        </div>
        <label class="palette__custom">
          <input type="color" :value="lastColor" @change="onCustomColor" />
          {{ t('editor.colors.custom') }}
        </label>
      </div>
    </el-popover>
  </div>
</template>

<style scoped>
.color-picker {
  display: inline-flex;
  align-items: center;
}

/* Main button: letter or marker icon with a bar in the last used colour. */
.color-picker__apply {
  position: relative;
  min-width: 26px;
  padding-bottom: 3px;
}

.color-picker__letter {
  font-family: Georgia, serif;
  font-size: 15px;
  font-weight: 700;
}

.color-picker__bar {
  position: absolute;
  right: 6px;
  bottom: 4px;
  left: 6px;
  height: 3px;
  border-radius: 1px;
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 12%);
}

/* Palette popover. */
.palette {
  display: grid;
  gap: 8px;
}

.palette__reset,
.palette__custom {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  color: var(--el-text-color-regular);
  background: transparent;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.palette__reset:hover,
.palette__custom:hover {
  background: var(--el-fill-color-light);
}

.palette__reset-swatch {
  width: 16px;
  height: 16px;
  box-sizing: border-box;
  border: 1px solid var(--el-border-color);
  border-radius: 3px;
}

.palette__reset-swatch.is-text {
  background: #1f2328;
}

/* A struck-through swatch means "no highlight". */
.palette__reset-swatch.is-highlight {
  background: linear-gradient(to top right, #fff calc(50% - 1px), #e11d48 50%, #fff calc(50% + 1px));
}

.palette__grid {
  display: grid;
  grid-template-columns: repeat(10, 18px);
  justify-content: space-between;
  gap: 3px;
}

.palette__swatch {
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid rgb(0 0 0 / 12%);
  border-radius: 3px;
  cursor: pointer;
  transition: transform 100ms ease;
}

.palette__swatch:hover {
  transform: scale(1.15);
}

.palette__swatch.is-selected {
  box-shadow:
    0 0 0 2px #fff,
    0 0 0 3.5px var(--el-color-primary);
}

.palette__custom input {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}
</style>
