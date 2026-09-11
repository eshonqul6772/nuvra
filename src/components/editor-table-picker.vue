<script setup lang="ts">
import { computed, ref } from 'vue';

import { t } from '../core/labels';

/**
 * Word-style table size grid: hovering or focusing a cell previews the size, clicking it inserts a table of
 * that size, optionally with a header row.
 */
defineOptions({ name: 'EditorTablePicker' });

/** Table requested by the user. */
interface TableSelection {
  /** Number of rows, header row included. */
  rows: number;
  /** Number of columns. */
  cols: number;
  /** Whether the first row is made of header cells. */
  withHeaderRow: boolean;
}

/** Size currently previewed in the grid; zero rows means nothing is previewed. */
interface GridSize {
  /** Previewed row count. */
  rows: number;
  /** Previewed column count. */
  cols: number;
}

interface Emits {
  /** A grid cell was clicked. */
  select: [table: TableSelection];
}

const emit = defineEmits<Emits>();

/** Rows offered by the grid. */
const ROWS = 8;
/** Columns offered by the grid; the grid CSS uses the same count. */
const COLS = 10;
/** Preview state when no cell is hovered. */
const NO_PREVIEW: GridSize = { rows: 0, cols: 0 };

const preview = ref<GridSize>(NO_PREVIEW);
const withHeaderRow = ref(false);

/** "cols × rows" of the previewed size, or a hint while nothing is previewed. */
const sizeLabel = computed(() =>
  preview.value.rows ? `${preview.value.cols} × ${preview.value.rows}` : t('editor.table.pickSize')
);

/** Previews a table that ends at the given cell. */
const showPreview = (rows: number, cols: number) => {
  preview.value = { rows, cols };
};

/** Clears the preview when the pointer leaves the grid. */
const clearPreview = () => {
  preview.value = NO_PREVIEW;
};

/** Whether a cell lies inside the previewed table. */
const isInPreview = (row: number, col: number) => row <= preview.value.rows && col <= preview.value.cols;
</script>

<template>
  <div class="table-picker">
    <div class="table-picker__grid" @mouseleave="clearPreview">
      <template v-for="row in ROWS" :key="row">
        <button
          v-for="col in COLS"
          :key="`${row}-${col}`"
          type="button"
          class="table-picker__cell"
          :class="{ 'is-active': isInPreview(row, col) }"
          :aria-label="`${t('editor.table.insert')}: ${col} × ${row}`"
          @mouseenter="showPreview(row, col)"
          @focus="showPreview(row, col)"
          @click="emit('select', { rows: row, cols: col, withHeaderRow })"
        />
      </template>
    </div>
    <strong class="table-picker__size">{{ sizeLabel }}</strong>
    <label class="doc-checkbox">
      <input v-model="withHeaderRow" type="checkbox" />
      {{ t('editor.table.headerRow') }}
    </label>
  </div>
</template>

<style scoped>
.table-picker {
  display: grid;
  gap: 6px;
}

/* Ten columns, matching COLS. */
.table-picker__grid {
  display: grid;
  grid-template-columns: repeat(10, 16px);
  gap: 3px;
}

.table-picker__cell {
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid var(--nuvra-border);
  border-radius: 2px;
  background: var(--nuvra-bg);
  cursor: pointer;
}

/* Cells inside the previewed table. */
.table-picker__cell.is-active {
  border-color: var(--nuvra-color-primary);
  background: var(--nuvra-color-primary-muted);
}

.table-picker__size {
  color: var(--nuvra-text);
  font-size: 12px;
  text-align: center;
}
</style>
