<script setup lang="ts">
import { FileText, Maximize2, Minimize2, Minus, MoveHorizontal, Plus, ScrollText } from '@lucide/vue';

import { t } from '../core/labels';
import { type DocumentViewMode, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from '../core/page';

/**
 * Bottom bar of the editor: page position, word and character counts, view switch, zoom controls and
 * the fullscreen toggle.
 */
defineOptions({ name: 'EditorStatusBar' });

interface Props {
  /** Number of characters in the document. */
  characters: number;
  /** Page that contains the caret (page view only). */
  currentPage: number;
  /** Whether the editor currently covers the screen. */
  fullscreen: boolean;
  /** Character limit; 0 means unlimited and shows a plain counter. */
  maxLength: number | undefined;
  /** Number of pages the document occupies (page view only). */
  pageCount: number;
  /** Number of words in the document. */
  words: number;
}

interface Emits {
  /** Zoom so the page fills the canvas width. */
  fitWidth: [];
  /** Enter or leave fullscreen. */
  toggleFullscreen: [];
}

defineProps<Props>();
const emit = defineEmits<Emits>();
/** Zoom in percent; every change is snapped to the zoom step and clamped to the allowed range. */
const zoom = defineModel<number>('zoom', { required: true });
/** Page layout with sheets, or the continuous web layout. */
const viewMode = defineModel<DocumentViewMode>('viewMode', { required: true });

/** Zoom restored by clicking the percentage. */
const DEFAULT_ZOOM = 100;
/** Position of the default zoom mark along the slider, from 0 to 1. */
const DEFAULT_ZOOM_RATIO = (DEFAULT_ZOOM - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN);
/** Options of the view switch with their icons and label keys. */
const VIEW_MODES = [
  { value: 'page', icon: FileText, label: 'editor.view.page' },
  { value: 'web', icon: ScrollText, label: 'editor.view.web' }
] as const;

/** Publishes a zoom value snapped to the zoom step and kept within the allowed range. */
const setZoom = (value: number) => {
  zoom.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value / ZOOM_STEP) * ZOOM_STEP));
};

/** Applies the value of the zoom slider. */
const onSliderInput = (event: Event) => setZoom(Number((event.target as HTMLInputElement).value));
</script>

<template>
  <footer class="status-bar">
    <div class="status-bar__info" aria-live="polite">
      <span v-if="viewMode === 'page'">{{ t('editor.status.page', { current: currentPage, total: pageCount }) }}</span>
      <span>{{ t('editor.status.words', { count: words }) }}</span>
      <span v-if="maxLength" :class="{ 'is-limit': characters >= maxLength }">{{ characters }} / {{ maxLength }}</span>
      <span v-else>{{ t('editor.status.characters', { count: characters }) }}</span>
    </div>

    <div class="status-bar__controls">
      <div class="status-bar__segmented" role="radiogroup" :aria-label="t('editor.view.page')">
        <button
          v-for="mode in VIEW_MODES"
          :key="mode.value"
          type="button"
          class="doc-tb-button"
          role="radio"
          :class="{ 'is-active': viewMode === mode.value }"
          :title="t(mode.label)"
          :aria-label="t(mode.label)"
          :aria-checked="viewMode === mode.value"
          @click="viewMode = mode.value"
        >
          <component :is="mode.icon" :size="14" />
        </button>
      </div>

      <button
        type="button"
        class="doc-tb-button status-bar__zoom-step"
        :disabled="zoom <= ZOOM_MIN"
        :title="t('editor.zoomOut')"
        :aria-label="t('editor.zoomOut')"
        @click="setZoom(zoom - ZOOM_STEP)"
      >
        <Minus :size="12" />
      </button>
      <input
        class="status-bar__slider"
        type="range"
        :min="ZOOM_MIN"
        :max="ZOOM_MAX"
        :step="ZOOM_STEP"
        :value="zoom"
        :aria-label="t('editor.zoom')"
        @input="onSliderInput"
      />
      <button
        type="button"
        class="doc-tb-button status-bar__zoom-step"
        :disabled="zoom >= ZOOM_MAX"
        :title="t('editor.zoomIn')"
        :aria-label="t('editor.zoomIn')"
        @click="setZoom(zoom + ZOOM_STEP)"
      >
        <Plus :size="12" />
      </button>
      <button
        type="button"
        class="doc-tb-button status-bar__zoom"
        :title="t('editor.zoomReset')"
        :aria-label="t('editor.zoomReset')"
        @click="setZoom(DEFAULT_ZOOM)"
      >
        {{ zoom }}%
      </button>
      <button
        v-if="viewMode === 'page'"
        type="button"
        class="doc-tb-button"
        :title="t('editor.fitWidth')"
        :aria-label="t('editor.fitWidth')"
        @click="emit('fitWidth')"
      >
        <MoveHorizontal :size="14" />
      </button>
      <button
        type="button"
        class="doc-tb-button"
        :title="t(fullscreen ? 'editor.exitFullscreen' : 'editor.enterFullscreen')"
        :aria-label="t(fullscreen ? 'editor.exitFullscreen' : 'editor.enterFullscreen')"
        @click="emit('toggleFullscreen')"
      >
        <component :is="fullscreen ? Minimize2 : Maximize2" :size="14" />
      </button>
    </div>
  </footer>
</template>

<style scoped>
.status-bar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 32px;
  padding: 0 6px 0 12px;
  border-top: 1px solid var(--el-border-color-lighter);
  color: var(--el-text-color-secondary);
  background: var(--el-bg-color);
  font-size: 12px;
  user-select: none;
}

.status-bar__info {
  display: flex;
  min-width: 0;
  gap: 14px;
  overflow: hidden;
  white-space: nowrap;
}

/* Character counter at or over the limit. */
.is-limit {
  color: var(--el-color-danger);
  font-weight: 600;
}

.status-bar__controls {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 1px;
}

/* The bar uses smaller buttons than the toolbar. */
.status-bar .doc-tb-button {
  min-width: 24px;
  height: 24px;
  font-size: 12px;
}

/* Page / web view switch. */
.status-bar__segmented {
  display: flex;
  margin-right: 6px;
  padding: 2px;
  border-radius: 7px;
  background: var(--el-fill-color-light);
}

.status-bar__segmented .doc-tb-button {
  height: 20px;
}

.status-bar__segmented .doc-tb-button.is-active {
  background: var(--el-bg-color);
  box-shadow: 0 1px 2px rgb(16 24 40 / 12%);
}

/* Zoom slider in the office style: a hairline track with a mark at 100% and a narrow thumb. */
.status-bar__slider {
  --slider-line: var(--el-text-color-placeholder);
  --slider-thumb: var(--el-text-color-regular);

  width: 100px;
  height: 16px;
  margin: 0 2px;
  padding: 0;
  cursor: pointer;
  background:
    linear-gradient(var(--slider-line), var(--slider-line)) calc(2px + (100% - 4px) * v-bind(DEFAULT_ZOOM_RATIO)) 50% /
      1px 8px no-repeat,
    linear-gradient(var(--slider-line), var(--slider-line)) 0 50% / 100% 1px no-repeat;
  appearance: none;
}

.status-bar__slider:focus {
  outline: none;
}

.status-bar__slider::-webkit-slider-runnable-track {
  height: 16px;
  background: transparent;
}

.status-bar__slider::-moz-range-track {
  height: 16px;
  background: transparent;
}

.status-bar__slider::-webkit-slider-thumb {
  width: 4px;
  height: 12px;
  margin-top: 2px;
  border: none;
  border-radius: 1px;
  background: var(--slider-thumb);
  transition: background-color 0.15s;
  appearance: none;
}

.status-bar__slider::-moz-range-thumb {
  width: 4px;
  height: 12px;
  border: none;
  border-radius: 1px;
  background: var(--slider-thumb);
  transition: background-color 0.15s;
}

.status-bar__slider:hover,
.status-bar__slider:active {
  --slider-thumb: var(--el-color-primary);
}

.status-bar__slider:focus-visible::-webkit-slider-thumb {
  outline: 2px solid var(--el-color-primary-light-5);
  outline-offset: 1px;
}

.status-bar__slider:focus-visible::-moz-range-thumb {
  outline: 2px solid var(--el-color-primary-light-5);
  outline-offset: 1px;
}

/* Zoom in / out buttons are plain glyphs next to the slider. */
.status-bar .status-bar__zoom-step {
  min-width: 20px;
  height: 20px;
  padding: 0;
}

.status-bar__zoom {
  min-width: 40px;
  font-variant-numeric: tabular-nums;
}

/* Narrow editors keep only the zoom buttons. */
@container (max-width: 560px) {
  .status-bar__slider,
  .status-bar__segmented {
    display: none;
  }
}
</style>
