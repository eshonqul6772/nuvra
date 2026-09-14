<script setup lang="ts">
import { useEditorLabels } from '../core/labels';
import type { OutlineHeading, OutlineView } from '../core/outline';
import type { PageMetrics } from '../core/page';
import type { SheetGeometry } from '../core/pagination';
import EditorIcon from './editor-icon.vue';

/**
 * Navigation panel: the headings of the document, indented by level, or small pictures of its pages. Either one
 * jumps to its place in the document.
 */
defineOptions({ name: 'EditorOutline' });

const { t } = useEditorLabels();

interface Props {
  /** Headings of the document with the page each starts on, `null` outside the page view. */
  headings: ReadonlyArray<OutlineHeading & { page: number | null }>;
  /** Clean HTML of every sheet, shown as page thumbnails; empty outside the page view. */
  pages: readonly string[];
  /** Page geometry the thumbnails are scaled from. */
  metrics: PageMetrics;
  /** Size of every sheet; a sheet turned by a section break gets a turned thumbnail. */
  sheets: readonly SheetGeometry[];
  /** Number printed on the first sheet. */
  firstPageNumber: number;
}

interface Emits {
  /** The panel's close button was pressed. */
  close: [];
  /** A heading was chosen. */
  select: [heading: HTMLElement];
  /** A page thumbnail was chosen, counted from 0. */
  selectPage: [index: number];
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

/** Which list is shown; the editor reads it to lay out thumbnails only while they are visible. */
const view = defineModel<OutlineView>('view', { default: 'headings' });

/** Indentation of one heading level, in pixels. */
const LEVEL_INDENT_PX = 12;
/** Width of a page thumbnail, in pixels. */
const THUMBNAIL_WIDTH = 150;

/** Size of the thumbnail of a sheet and of the page box drawn at full size inside it. */
const thumbnail = (index: number) => {
  const { marginTop, marginRight, marginBottom, marginLeft } = props.metrics;
  const width = props.sheets[index]?.width ?? props.metrics.width;
  const height = props.sheets[index]?.height ?? props.metrics.height;
  // Every thumbnail is scaled like a sheet of the document's own width, so turned sheets look turned.
  const scale = THUMBNAIL_WIDTH / Math.max(props.metrics.width, props.metrics.height);
  return {
    frame: { width: `${Math.round(width * scale)}px`, height: `${Math.round(height * scale)}px` },
    sheet: {
      width: `${width}px`,
      height: `${height}px`,
      padding: `${marginTop}px ${marginRight}px ${marginBottom}px ${marginLeft}px`,
      transform: `scale(${scale})`
    }
  };
};
</script>

<template>
  <nav class="doc-outline" :aria-label="t('editor.outline')">
    <header class="doc-outline__header">
      <span>{{ t('editor.outline') }}</span>
      <button
        type="button"
        class="doc-tb-button"
        :aria-label="t('editor.close')"
        :title="t('editor.close')"
        @click="emit('close')"
      >
        <EditorIcon name="x" :size="14" />
      </button>
    </header>

    <div class="doc-outline__tabs" role="tablist">
      <button
        type="button"
        role="tab"
        class="doc-outline__tab"
        :class="{ 'is-active': view === 'headings' }"
        :aria-selected="view === 'headings'"
        @click="view = 'headings'"
      >
        {{ t('editor.outline.headings') }}
      </button>
      <button
        type="button"
        role="tab"
        class="doc-outline__tab"
        :class="{ 'is-active': view === 'pages' }"
        :aria-selected="view === 'pages'"
        @click="view = 'pages'"
      >
        {{ t('editor.outline.pages') }}
      </button>
    </div>

    <template v-if="view === 'headings'">
      <ol v-if="headings.length" class="doc-outline__list">
        <li v-for="(heading, index) in headings" :key="index">
          <button
            type="button"
            class="doc-outline__item"
            :class="`is-level-${heading.level}`"
            :style="{ paddingLeft: `${8 + (heading.level - 1) * LEVEL_INDENT_PX}px` }"
            :title="heading.text"
            @mousedown.prevent
            @click="emit('select', heading.element)"
          >
            <span class="doc-outline__text">{{ heading.text }}</span>
            <span v-if="heading.page !== null" class="doc-outline__page">{{ heading.page }}</span>
          </button>
        </li>
      </ol>
      <p v-else class="doc-outline__empty">{{ t('editor.outline.empty') }}</p>
    </template>

    <template v-else>
      <ol v-if="pages.length" class="doc-outline__list doc-outline__pages">
        <li v-for="(page, index) in pages" :key="index">
          <button
            type="button"
            class="doc-outline__thumbnail"
            :aria-label="t('editor.outline.page', { page: firstPageNumber + index })"
            @mousedown.prevent
            @click="emit('selectPage', index)"
          >
            <span class="doc-outline__frame" :style="thumbnail(index).frame" aria-hidden="true">
              <!-- The sheets hold clean, serialized document HTML. -->
              <span class="doc-outline__sheet doc-content" :style="thumbnail(index).sheet" v-html="page" />
            </span>
            <span class="doc-outline__page">{{ firstPageNumber + index }}</span>
          </button>
        </li>
      </ol>
      <p v-else class="doc-outline__empty">{{ t('editor.outline.noPages') }}</p>
    </template>
  </nav>
</template>

<style scoped>
.doc-outline {
  position: absolute;
  z-index: 5;
  top: 0;
  bottom: 0;
  left: 0;
  display: flex;
  width: min(260px, 80%);
  box-sizing: border-box;
  flex-direction: column;
  border-right: 1px solid var(--nuvra-border);
  background: var(--nuvra-bg);
  box-shadow: var(--nuvra-shadow);
  color: var(--nuvra-text);
  font-size: 13px;
}

.doc-outline__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 6px 6px 12px;
  border-bottom: 1px solid var(--nuvra-border);
  color: var(--nuvra-text-strong);
  font-weight: 600;
}

.doc-outline__tabs {
  display: flex;
  gap: 4px;
  padding: 6px 6px 0;
  border-bottom: 1px solid var(--nuvra-border-lighter);
}

.doc-outline__tab {
  padding: 4px 10px 6px;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--nuvra-text-muted);
  background: none;
  font: inherit;
  cursor: pointer;
}

.doc-outline__tab.is-active {
  border-bottom-color: var(--nuvra-color-primary);
  color: var(--nuvra-text-strong);
}

.doc-outline__list {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  padding: 6px;
  overflow: auto;
  list-style: none;
}

.doc-outline__item {
  display: flex;
  width: 100%;
  align-items: baseline;
  gap: 8px;
  padding: 5px 8px;
  border: 0;
  border-radius: 6px;
  color: inherit;
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.doc-outline__item:hover,
.doc-outline__item:focus-visible {
  background: var(--nuvra-fill);
  outline: none;
}

.doc-outline__item.is-level-1 {
  font-weight: 600;
}

.doc-outline__text {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-outline__page {
  color: var(--nuvra-text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

/* Page thumbnails: each sheet is laid out at full size and scaled down, so it looks like the page. */
.doc-outline__pages {
  display: grid;
  align-content: start;
  justify-items: center;
  gap: 10px;
  padding: 10px 6px;
}

.doc-outline__thumbnail {
  display: grid;
  justify-items: center;
  gap: 4px;
  padding: 4px;
  border: 0;
  border-radius: 6px;
  background: none;
  cursor: pointer;
}

.doc-outline__thumbnail:hover .doc-outline__frame,
.doc-outline__thumbnail:focus-visible .doc-outline__frame {
  outline: 2px solid var(--nuvra-color-primary);
}

.doc-outline__thumbnail:focus-visible {
  outline: none;
}

.doc-outline__frame {
  position: relative;
  display: block;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 0 0 1px rgb(16 24 40 / 12%);
  pointer-events: none;
}

.doc-outline__sheet {
  position: absolute;
  top: 0;
  left: 0;
  display: block;
  box-sizing: border-box;
  overflow: hidden;
  text-align: left;
  transform-origin: 0 0;
}

.doc-outline__empty {
  margin: 0;
  padding: 16px 12px;
  color: var(--nuvra-text-muted);
}
</style>
