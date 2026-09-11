<script setup lang="ts">
import { type Component, computed, ref } from 'vue';
import {
  Bold,
  CalendarDays,
  ChevronDown,
  Code,
  Ellipsis,
  FileCode,
  FileDown,
  FileSliders,
  FileType,
  Grid3x3,
  ImagePlus,
  Italic,
  Languages,
  Link,
  List,
  ListIndentDecrease,
  ListIndentIncrease,
  ListOrdered,
  ListTodo,
  Maximize2,
  Minimize2,
  Omega,
  PilcrowLeft,
  PilcrowRight,
  Plus,
  Printer,
  Quote,
  Redo2,
  RemoveFormatting,
  Search,
  SeparatorHorizontal,
  SquareCode,
  SquareSplitVertical,
  Strikethrough,
  Subscript,
  Superscript,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  Underline,
  Undo2,
  UnfoldVertical,
  Upload
} from '@lucide/vue';
import {
  type CheckboxValueType,
  ElButton,
  ElCheckbox,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElInput,
  ElPopover,
  type InputInstance
} from 'element-plus';

import type { HeadingTag, TextAlign, TextDirection } from '../core/engine/blocks';
import type { DocumentEngine } from '../core/engine/engine';
import type { MarkName } from '../core/engine/marks';
import { type EditorLabelKey, formatShortcut, t, withShortcut } from '../core/labels';
import type { PageSettings } from '../core/page';
import type { DocumentMenuAction } from '../core/types';
import { type EditorUiState, normalizeFontFamily } from '../core/ui-state';
import EditorColorPicker from './editor-color-picker.vue';
import EditorPageSetup from './editor-page-setup.vue';
import EditorTablePicker from './editor-table-picker.vue';

/**
 * Compact single-row toolbar: history, text style, font, marks, colours, paragraph layout, lists, insertions, search,
 * page setup and the document menu. Reads a flat state snapshot and calls engine commands directly.
 */
defineOptions({ name: 'EditorToolbar' });

interface Props {
  /** Read-only document: every editing control is disabled. */
  disabled: boolean | undefined;
  /** Engine that receives the commands. */
  engine: DocumentEngine;
  /** Whether the find bar is open, shown as the search button state. */
  findOpen: boolean;
  /** Whether the editor is in fullscreen, used for the menu item label. */
  fullscreen: boolean;
  /** Current page settings, edited in the page setup popover. */
  page: PageSettings;
  /** Whether the HTML source is shown; formatting controls are disabled meanwhile. */
  sourceMode: boolean;
  /** Formatting at the caret, used for active states and labels. */
  state: EditorUiState;
  /** Whether images are being uploaded, shown on the upload button. */
  uploading: boolean;
}

const props = defineProps<Props>();

interface Emits {
  /** The search button was pressed. */
  find: [];
  /** Image files were picked from the computer; the editor validates and uploads them. */
  insertImages: [files: File[]];
  /** An action was chosen in the document menu. */
  menu: [action: DocumentMenuAction];
  /** New page settings were chosen in the page setup popover. */
  'update:page': [page: PageSettings];
}

const emit = defineEmits<Emits>();

/** Keys of the state snapshot that hold on/off values. */
type BooleanStateKey = {
  [K in keyof EditorUiState]: EditorUiState[K] extends boolean ? K : never;
}[keyof EditorUiState];

/** A toolbar button that toggles formatting and shows whether it is active. */
interface ToggleButton {
  /** State flag that marks the button as active. */
  key: BooleanStateKey;
  icon: Component;
  label: EditorLabelKey;
  /** Shortcut shown in the tooltip, written with `Mod` for Ctrl/⌘. */
  shortcut: string;
  /** Applies the formatting. */
  toggle: (engine: DocumentEngine) => void;
}

/** Rows, columns and header choice from the table picker. */
interface TableSize {
  rows: number;
  cols: number;
  withHeaderRow: boolean;
}

/** Dropdown command that removes an explicit value and falls back to the document default. */
const DEFAULT_COMMAND = 'default';
/** Font the document uses when no font is applied. */
const DEFAULT_FONT = 'Times New Roman';
/** Font size, in points, the document uses when no size is applied. */
const DEFAULT_FONT_SIZE = 12;
/** Points per CSS pixel. */
const POINTS_PER_PIXEL = 0.75;

const FONT_FAMILIES = [
  { label: 'Times New Roman', value: "'Times New Roman', Times, serif" },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Calibri', value: 'Calibri, Carlito, sans-serif' },
  { label: 'Cambria', value: 'Cambria, Caladea, serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Tahoma', value: 'Tahoma, Verdana, sans-serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Courier New', value: "'Courier New', Courier, monospace" }
].map(font => ({ ...font, normalized: normalizeFontFamily(font.value) }));

/** Point sizes, as in office suites. */
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
const LINE_HEIGHTS = ['1', '1.15', '1.5', '2', '2.5', '3'];
/** Heading levels offered in the text style menu. */
const HEADING_LEVELS = 4;

const ALIGNMENTS = [
  { value: 'left', icon: TextAlignStart, label: 'editor.align.left', shortcut: 'Mod+Shift+L' },
  { value: 'center', icon: TextAlignCenter, label: 'editor.align.center', shortcut: 'Mod+Shift+E' },
  { value: 'right', icon: TextAlignEnd, label: 'editor.align.right', shortcut: 'Mod+Shift+R' },
  { value: 'justify', icon: TextAlignJustify, label: 'editor.align.justify', shortcut: 'Mod+Shift+J' }
] as const;

const DIRECTIONS = [
  { value: 'auto', icon: Languages, label: 'editor.direction.auto' },
  { value: 'ltr', icon: PilcrowRight, label: 'editor.direction.ltr' },
  { value: 'rtl', icon: PilcrowLeft, label: 'editor.direction.rtl' }
] as const;

const MARK_BUTTONS: ToggleButton[] = [
  { key: 'bold', icon: Bold, label: 'editor.bold', shortcut: 'Mod+B', toggle: engine => engine.toggleMark('bold') },
  {
    key: 'italic',
    icon: Italic,
    label: 'editor.italic',
    shortcut: 'Mod+I',
    toggle: engine => engine.toggleMark('italic')
  },
  {
    key: 'underline',
    icon: Underline,
    label: 'editor.underline',
    shortcut: 'Mod+U',
    toggle: engine => engine.toggleMark('underline')
  }
];

const LIST_BUTTONS: ToggleButton[] = [
  {
    key: 'bulletList',
    icon: List,
    label: 'editor.bulletList',
    shortcut: 'Mod+Shift+8',
    toggle: engine => engine.toggleList('bulletList')
  },
  {
    key: 'orderedList',
    icon: ListOrdered,
    label: 'editor.orderedList',
    shortcut: 'Mod+Shift+7',
    toggle: engine => engine.toggleList('orderedList')
  },
  {
    key: 'taskList',
    icon: ListTodo,
    label: 'editor.taskList',
    shortcut: 'Mod+Shift+9',
    toggle: engine => engine.toggleList('taskList')
  }
];

/** Marks offered in the "more formatting" menu; any other command of that menu clears formatting. */
const TEXT_MARKS: MarkName[] = ['strike', 'subscript', 'superscript', 'code'];

// biome-ignore format: compact character table.
const SPECIAL_CHARACTERS = [
  '«', '»', '„', '“', '”', '‘', '’', '—', '–', '…', '№', '§', '©', '®', '™', '°', '±', '×',
  '÷', '≈', '≠', '≤', '≥', '∞', '€', '$', '£', '¥', '←', '→', '↑', '↓', '•', '✓', '✗', '¶'
];

/** URLs used as they are: web and mail links, phone numbers, absolute paths and anchors. */
const LINK_WITH_SCHEME = /^(https?:|mailto:|tel:|\/|#)/i;
const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Image URLs accepted from the image form: web addresses and absolute paths. */
const IMAGE_URL = /^(https?:\/\/|\/)/i;

/** Whether the link popover is open. */
const linkVisible = ref(false);
const linkInput = ref<InputInstance>();
const linkUrl = ref('');
/** Text for a new link inserted at a collapsed caret. */
const linkText = ref('');
const linkNewTab = ref(false);
/** Whether the link form asks for link text, because there is neither a selection nor an existing link. */
const linkNeedsText = ref(false);
/** Whether the image popover is open. */
const imageVisible = ref(false);
const imageUrl = ref('');
const fileInput = ref<HTMLInputElement>();
/** Whether the table picker popover is open. */
const tableVisible = ref(false);
/** Whether the special characters popover is open. */
const charactersVisible = ref(false);

/** Formatting controls are unavailable for read-only documents and while the HTML source is shown. */
const locked = computed(() => props.disabled || props.sourceMode);

/** Name of the block type at the caret, shown on the text style dropdown. */
const blockLabel = computed(() => {
  if (props.state.headingLevel) return t('editor.heading', { level: props.state.headingLevel });
  if (props.state.codeBlock) return t('editor.codeBlock');
  if (props.state.blockquote) return t('editor.quote');
  return t('editor.paragraph');
});

/** Font name at the caret; unknown fonts show the first family of their stack. */
const fontLabel = computed(() => {
  const family = props.state.fontFamily;
  if (!family) return DEFAULT_FONT;
  const known = FONT_FAMILIES.find(font => font.normalized === family);
  return known?.label ?? (family.split(',')[0] ?? family).trim();
});

/** Font size at the caret in points, rounded to half points; pixel sizes from pasted content are converted. */
const fontSizeLabel = computed(() => {
  const size = Number.parseFloat(props.state.fontSize);
  if (!Number.isFinite(size)) return String(DEFAULT_FONT_SIZE);
  const points = props.state.fontSize.endsWith('px') ? size * POINTS_PER_PIXEL : size;
  return String(Math.round(points * 2) / 2);
});

/** Icon of the alignment at the caret. */
const alignIcon = computed(
  () => ALIGNMENTS.find(alignment => alignment.value === props.state.align)?.icon ?? TextAlignStart
);

/** Icon of the text direction at the caret. */
const directionIcon = computed(
  () => DIRECTIONS.find(direction => direction.value === props.state.direction)?.icon ?? Languages
);

/** Applies a choice from the text style menu: paragraph, heading level, quote or code block. */
const setBlock = (command: unknown) => {
  switch (command) {
    case 'paragraph':
      props.engine.setBlockType('P');
      break;
    case 'blockquote':
      props.engine.toggleBlockquote();
      break;
    case 'codeBlock':
      props.engine.toggleCodeBlock();
      break;
    default:
      props.engine.setBlockType(`H${Number(command)}` as HeadingTag);
  }
};

/** Applies a font family, or removes it for the default entry. */
const setFontFamily = (command: unknown) => {
  const family = String(command);
  props.engine.setTextStyle('fontFamily', family === DEFAULT_COMMAND ? null : family);
};

/** Applies a font size in points, or removes it for the default entry. */
const setFontSize = (command: unknown) => {
  const size = String(command);
  props.engine.setTextStyle('fontSize', size === DEFAULT_COMMAND ? null : `${size}pt`);
};

/** Applies a paragraph line height, or removes it for the default entry. */
const setLineHeight = (command: unknown) => {
  const lineHeight = String(command);
  props.engine.setLineHeight(lineHeight === DEFAULT_COMMAND ? null : lineHeight);
};

/** Aligns the selected paragraphs. */
const setAlign = (command: unknown) => props.engine.setTextAlign(String(command) as TextAlign);

/** Sets the writing direction of the selected paragraphs. */
const setDirection = (command: unknown) => props.engine.setTextDirection(String(command) as TextDirection);

/** Toggles a mark from the "more formatting" menu, or clears all formatting. */
const runTextCommand = (command: unknown) => {
  if (TEXT_MARKS.includes(command as MarkName)) props.engine.toggleMark(command as MarkName);
  else props.engine.clearFormatting();
};

/** Today's date as `dd.mm.yyyy`, the format used in Uzbek documents. */
const formatToday = () => {
  const today = new Date();
  const twoDigits = (value: number) => String(value).padStart(2, '0');
  return `${twoDigits(today.getDate())}.${twoDigits(today.getMonth() + 1)}.${today.getFullYear()}`;
};

/** Inserts an element from the insert menu: page break, today's date or a horizontal rule. */
const insertBlock = (command: unknown) => {
  switch (command) {
    case 'pageBreak':
      props.engine.insertPageBreak();
      break;
    case 'date':
      props.engine.insertText(formatToday());
      break;
    default:
      props.engine.insertHorizontalRule();
  }
};

/** Forwards a document menu choice to the editor. */
const onMenuCommand = (command: unknown) => emit('menu', command as DocumentMenuAction);

/** Fills the link form from the link under the caret before the popover opens. */
const prepareLink = () => {
  const link = props.engine.getActiveLink();
  linkUrl.value = link?.getAttribute('href') ?? '';
  linkNewTab.value = link?.getAttribute('target') === '_blank';
  linkNeedsText.value = !link && !props.engine.getSelectedText();
  linkText.value = '';
};

/** Opens the link popover; used by the Mod+K shortcut and the link bubble menu. */
const openLink = () => {
  if (!locked.value) linkVisible.value = true;
};

/** Completes what users usually type: bare domains get `https://`, e-mail addresses get `mailto:`. */
const normalizeUrl = (value: string) => {
  const url = value.trim();
  if (!url || LINK_WITH_SCHEME.test(url)) return url;
  if (EMAIL_ADDRESS.test(url)) return `mailto:${url}`;
  return `https://${url}`;
};

/** Mirrors the "open in new tab" checkbox into the form state. */
const onLinkNewTabChange = (value: CheckboxValueType) => {
  linkNewTab.value = Boolean(value);
};

/** Removes the link under the caret and closes the form. */
const removeLink = () => {
  linkVisible.value = false;
  props.engine.unsetLink();
};

/** Creates or updates the link; an empty address removes it. */
const applyLink = () => {
  const href = normalizeUrl(linkUrl.value);
  if (!href) return removeLink();
  linkVisible.value = false;
  props.engine.setLink(
    href,
    linkNewTab.value ? '_blank' : null,
    linkNeedsText.value ? linkText.value.trim() : undefined
  );
};

/** Opens the file dialog for images. */
const pickImages = () => {
  imageVisible.value = false;
  fileInput.value?.click();
};

/** Passes the picked files to the editor and resets the input so the same file can be picked again. */
const onFilesPicked = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (files.length) emit('insertImages', files);
};

/** Inserts an image from the typed address when it is a web address or an absolute path. */
const insertImageUrl = () => {
  const src = imageUrl.value.trim();
  if (!IMAGE_URL.test(src)) return;
  imageVisible.value = false;
  imageUrl.value = '';
  props.engine.insertImage(src);
};

/** Inserts a table of the size chosen in the picker. */
const insertTable = (table: TableSize) => {
  tableVisible.value = false;
  props.engine.insertTable(table.rows, table.cols, table.withHeaderRow);
};

/** Types a special character at the caret. */
const insertCharacter = (character: string) => {
  charactersVisible.value = false;
  props.engine.insertText(character);
};

defineExpose({
  /** Opens the link popover. */
  openLink
});
</script>

<template>
  <div class="doc-toolbar" role="toolbar" :aria-label="t('editor.toolbar')">
    <div class="doc-toolbar__group">
      <button
        type="button"
        class="doc-tb-button"
        :aria-label="t('editor.undo')"
        :disabled="locked || !state.canUndo"
        :title="withShortcut('editor.undo', 'Mod+Z')"
        @mousedown.prevent
        @click="engine.undo()"
      >
        <Undo2 :size="16" />
      </button>
      <button
        type="button"
        class="doc-tb-button"
        :aria-label="t('editor.redo')"
        :disabled="locked || !state.canRedo"
        :title="withShortcut('editor.redo', 'Mod+Y')"
        @mousedown.prevent
        @click="engine.redo()"
      >
        <Redo2 :size="16" />
      </button>
    </div>

    <span class="doc-toolbar__divider" />

    <div class="doc-toolbar__group">
      <el-dropdown popper-class="doc-editor-popper" trigger="click" :disabled="locked" @command="setBlock">
        <button
          type="button"
          class="doc-tb-button doc-tb-button--select doc-toolbar__block"
          :disabled="locked"
          :title="t('editor.textStyle')"
          @mousedown.prevent
        >
          <span class="doc-tb-button__label">{{ blockLabel }}</span>
          <ChevronDown :size="12" />
        </button>
        <template #dropdown>
          <el-dropdown-menu class="doc-menu">
            <el-dropdown-item
              command="paragraph"
              :class="{ 'is-selected': !state.headingLevel && !state.codeBlock && !state.blockquote }"
            >
              {{ t('editor.paragraph') }}
              <span class="doc-menu__hint">{{ formatShortcut('Mod+Alt+0') }}</span>
            </el-dropdown-item>
            <el-dropdown-item
              v-for="level in HEADING_LEVELS"
              :key="level"
              :class="{ 'is-selected': state.headingLevel === level }"
              :command="level"
            >
              <span :class="`doc-menu__h${level}`">{{ t('editor.heading', { level }) }}</span>
              <span class="doc-menu__hint">{{ formatShortcut(`Mod+Alt+${level}`) }}</span>
            </el-dropdown-item>
            <el-dropdown-item command="blockquote" divided :class="{ 'is-selected': state.blockquote }">
              <Quote :size="14" />
              {{ t('editor.quote') }}
            </el-dropdown-item>
            <el-dropdown-item command="codeBlock" :class="{ 'is-selected': state.codeBlock }">
              <SquareCode :size="14" />
              {{ t('editor.codeBlock') }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>

      <el-dropdown
        max-height="320px"
        popper-class="doc-editor-popper"
        trigger="click"
        :disabled="locked"
        @command="setFontFamily"
      >
        <button
          type="button"
          class="doc-tb-button doc-tb-button--select doc-toolbar__font"
          :disabled="locked"
          :title="t('editor.fontFamily')"
          @mousedown.prevent
        >
          <span class="doc-tb-button__label">{{ fontLabel }}</span>
          <ChevronDown :size="12" />
        </button>
        <template #dropdown>
          <el-dropdown-menu class="doc-menu">
            <el-dropdown-item :class="{ 'is-selected': !state.fontFamily }" :command="DEFAULT_COMMAND">
              {{ t('editor.defaultFont') }}
            </el-dropdown-item>
            <el-dropdown-item
              v-for="font in FONT_FAMILIES"
              :key="font.value"
              :class="{ 'is-selected': state.fontFamily === font.normalized }"
              :command="font.value"
              :style="{ fontFamily: font.value }"
            >
              {{ font.label }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>

      <el-dropdown
        max-height="320px"
        popper-class="doc-editor-popper"
        trigger="click"
        :disabled="locked"
        @command="setFontSize"
      >
        <button
          type="button"
          class="doc-tb-button doc-tb-button--select doc-toolbar__size"
          :disabled="locked"
          :title="t('editor.fontSize')"
          @mousedown.prevent
        >
          <span class="doc-tb-button__label">{{ fontSizeLabel }}</span>
          <ChevronDown :size="12" />
        </button>
        <template #dropdown>
          <el-dropdown-menu class="doc-menu doc-toolbar__size-menu">
            <el-dropdown-item :class="{ 'is-selected': !state.fontSize }" :command="DEFAULT_COMMAND">
              {{ t('editor.defaultSize') }}
            </el-dropdown-item>
            <el-dropdown-item
              v-for="size in FONT_SIZES"
              :key="size"
              :class="{ 'is-selected': state.fontSize === `${size}pt` }"
              :command="size"
            >
              {{ size }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <span class="doc-toolbar__divider" />

    <div class="doc-toolbar__group">
      <button
        v-for="button in MARK_BUTTONS"
        :key="button.key"
        type="button"
        class="doc-tb-button"
        :class="{ 'is-active': state[button.key] }"
        :aria-label="t(button.label)"
        :aria-pressed="state[button.key]"
        :disabled="locked"
        :title="withShortcut(button.label, button.shortcut)"
        @mousedown.prevent
        @click="button.toggle(engine)"
      >
        <component :is="button.icon" :size="16" />
      </button>
      <el-dropdown popper-class="doc-editor-popper" trigger="click" :disabled="locked" @command="runTextCommand">
        <button
          type="button"
          class="doc-tb-button doc-tb-button--caret"
          :class="{ 'is-active': state.strike || state.subscript || state.superscript || state.code }"
          :aria-label="t('editor.moreFormatting')"
          :disabled="locked"
          :title="t('editor.moreFormatting')"
          @mousedown.prevent
        >
          <ChevronDown :size="12" />
        </button>
        <template #dropdown>
          <el-dropdown-menu class="doc-menu">
            <el-dropdown-item command="strike" :class="{ 'is-selected': state.strike }">
              <Strikethrough :size="14" />
              {{ t('editor.strike') }}
              <span class="doc-menu__hint">{{ formatShortcut('Mod+Shift+S') }}</span>
            </el-dropdown-item>
            <el-dropdown-item command="subscript" :class="{ 'is-selected': state.subscript }">
              <Subscript :size="14" />
              {{ t('editor.subscript') }}
              <span class="doc-menu__hint">{{ formatShortcut('Mod+,') }}</span>
            </el-dropdown-item>
            <el-dropdown-item command="superscript" :class="{ 'is-selected': state.superscript }">
              <Superscript :size="14" />
              {{ t('editor.superscript') }}
              <span class="doc-menu__hint">{{ formatShortcut('Mod+.') }}</span>
            </el-dropdown-item>
            <el-dropdown-item command="code" :class="{ 'is-selected': state.code }">
              <Code :size="14" />
              {{ t('editor.inlineCode') }}
              <span class="doc-menu__hint">{{ formatShortcut('Mod+E') }}</span>
            </el-dropdown-item>
            <el-dropdown-item command="clear" divided>
              <RemoveFormatting :size="14" />
              {{ t('editor.clearFormatting') }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <EditorColorPicker
        mode="text"
        :current="state.color"
        :disabled="locked"
        @select="engine.setTextStyle('color', $event)"
      />
      <EditorColorPicker
        mode="highlight"
        :current="state.highlight"
        :disabled="locked"
        @select="engine.setHighlight($event)"
      />
    </div>

    <span class="doc-toolbar__divider" />

    <div class="doc-toolbar__group">
      <el-dropdown popper-class="doc-editor-popper" trigger="click" :disabled="locked" @command="setAlign">
        <button
          type="button"
          class="doc-tb-button doc-tb-button--select"
          :aria-label="t('editor.align')"
          :disabled="locked"
          :title="t('editor.align')"
          @mousedown.prevent
        >
          <component :is="alignIcon" :size="16" />
          <ChevronDown :size="12" />
        </button>
        <template #dropdown>
          <el-dropdown-menu class="doc-menu">
            <el-dropdown-item
              v-for="alignment in ALIGNMENTS"
              :key="alignment.value"
              :class="{ 'is-selected': state.align === alignment.value }"
              :command="alignment.value"
            >
              <component :is="alignment.icon" :size="14" />
              {{ t(alignment.label) }}
              <span class="doc-menu__hint">{{ formatShortcut(alignment.shortcut) }}</span>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>

      <el-dropdown popper-class="doc-editor-popper" trigger="click" :disabled="locked" @command="setLineHeight">
        <button
          type="button"
          class="doc-tb-button doc-tb-button--select"
          :aria-label="t('editor.lineHeight')"
          :disabled="locked"
          :title="t('editor.lineHeight')"
          @mousedown.prevent
        >
          <UnfoldVertical :size="16" />
          <ChevronDown :size="12" />
        </button>
        <template #dropdown>
          <el-dropdown-menu class="doc-menu">
            <el-dropdown-item :class="{ 'is-selected': !state.lineHeight }" :command="DEFAULT_COMMAND">
              {{ t('editor.defaultLineHeight') }}
            </el-dropdown-item>
            <el-dropdown-item
              v-for="lineHeight in LINE_HEIGHTS"
              :key="lineHeight"
              :class="{ 'is-selected': state.lineHeight === lineHeight }"
              :command="lineHeight"
            >
              {{ lineHeight }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>

      <el-dropdown popper-class="doc-editor-popper" trigger="click" :disabled="locked" @command="setDirection">
        <button
          type="button"
          class="doc-tb-button doc-tb-button--select"
          :aria-label="t('editor.textDirection')"
          :disabled="locked"
          :title="t('editor.textDirection')"
          @mousedown.prevent
        >
          <component :is="directionIcon" :size="16" />
          <ChevronDown :size="12" />
        </button>
        <template #dropdown>
          <el-dropdown-menu class="doc-menu">
            <el-dropdown-item
              v-for="direction in DIRECTIONS"
              :key="direction.value"
              :class="{ 'is-selected': state.direction === direction.value }"
              :command="direction.value"
            >
              <component :is="direction.icon" :size="14" />
              {{ t(direction.label) }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>

      <button
        v-for="button in LIST_BUTTONS"
        :key="button.key"
        type="button"
        class="doc-tb-button"
        :class="{ 'is-active': state[button.key] }"
        :aria-label="t(button.label)"
        :aria-pressed="state[button.key]"
        :disabled="locked"
        :title="withShortcut(button.label, button.shortcut)"
        @mousedown.prevent
        @click="button.toggle(engine)"
      >
        <component :is="button.icon" :size="16" />
      </button>
      <button
        type="button"
        class="doc-tb-button"
        :aria-label="t('editor.outdent')"
        :disabled="locked"
        :title="withShortcut('editor.outdent', 'Shift+Tab')"
        @mousedown.prevent
        @click="engine.indent(-1)"
      >
        <ListIndentDecrease :size="16" />
      </button>
      <button
        type="button"
        class="doc-tb-button"
        :aria-label="t('editor.indent')"
        :disabled="locked"
        :title="withShortcut('editor.indent', 'Tab')"
        @mousedown.prevent
        @click="engine.indent(1)"
      >
        <ListIndentIncrease :size="16" />
      </button>
    </div>

    <span class="doc-toolbar__divider" />

    <div class="doc-toolbar__group">
      <el-popover
        v-model:visible="linkVisible"
        placement="bottom-start"
        popper-class="doc-editor-popper"
        trigger="click"
        :disabled="locked"
        :width="300"
        @after-enter="linkInput?.focus()"
        @before-enter="prepareLink"
      >
        <template #reference>
          <button
            type="button"
            class="doc-tb-button"
            :class="{ 'is-active': state.link }"
            :aria-label="t('editor.link')"
            :disabled="locked"
            :title="withShortcut('editor.link', 'Mod+K')"
            @mousedown.prevent
          >
            <Link :size="16" />
          </button>
        </template>
        <form class="doc-toolbar__form" @submit.prevent="applyLink">
          <label v-if="linkNeedsText">
            {{ t('editor.linkText') }}
            <el-input v-model="linkText" size="small" />
          </label>
          <label>
            {{ t('editor.linkUrl') }}
            <el-input ref="linkInput" v-model="linkUrl" placeholder="https://" size="small" />
          </label>
          <el-checkbox size="small" :model-value="linkNewTab" @change="onLinkNewTabChange">
            {{ t('editor.linkNewTab') }}
          </el-checkbox>
          <div class="doc-toolbar__form-actions">
            <el-button v-if="state.link" size="small" text type="danger" @click="removeLink">
              {{ t('editor.unlink') }}
            </el-button>
            <el-button native-type="submit" size="small" type="primary">{{ t('editor.apply') }}</el-button>
          </div>
        </form>
      </el-popover>

      <el-popover
        v-model:visible="imageVisible"
        placement="bottom-start"
        popper-class="doc-editor-popper"
        trigger="click"
        :disabled="locked"
        :width="300"
      >
        <template #reference>
          <button
            type="button"
            class="doc-tb-button"
            :aria-label="t('editor.image')"
            :disabled="locked"
            :title="t('editor.image')"
            @mousedown.prevent
          >
            <ImagePlus :size="16" />
          </button>
        </template>
        <div class="doc-toolbar__form">
          <el-button size="small" :icon="Upload" :loading="uploading" @click="pickImages">
            {{ t('editor.uploadImage') }}
          </el-button>
          <span class="doc-toolbar__caption">{{ t('editor.or') }}</span>
          <form class="doc-toolbar__inline-form" @submit.prevent="insertImageUrl">
            <el-input
              v-model="imageUrl"
              placeholder="https://example.com/image.png"
              size="small"
              :ariaLabel="t('editor.image')"
            />
            <el-button native-type="submit" size="small" type="primary" :disabled="!imageUrl.trim()">
              {{ t('editor.insert') }}
            </el-button>
          </form>
        </div>
      </el-popover>
      <input ref="fileInput" type="file" accept="image/*" hidden multiple @change="onFilesPicked" />

      <el-popover
        v-model:visible="tableVisible"
        placement="bottom-start"
        popper-class="doc-editor-popper"
        trigger="click"
        :disabled="locked"
        :width="212"
      >
        <template #reference>
          <button
            type="button"
            class="doc-tb-button"
            :aria-label="t('editor.table.insert')"
            :disabled="locked"
            :title="t('editor.table.insert')"
            @mousedown.prevent
          >
            <Grid3x3 :size="16" />
          </button>
        </template>
        <EditorTablePicker v-if="tableVisible" @select="insertTable" />
      </el-popover>

      <el-popover
        v-model:visible="charactersVisible"
        placement="bottom-start"
        popper-class="doc-editor-popper"
        trigger="click"
        :disabled="locked"
        :width="258"
      >
        <template #reference>
          <button
            type="button"
            class="doc-tb-button"
            :aria-label="t('editor.specialCharacters')"
            :disabled="locked"
            :title="t('editor.specialCharacters')"
            @mousedown.prevent
          >
            <Omega :size="16" />
          </button>
        </template>
        <div class="doc-toolbar__characters">
          <button
            v-for="character in SPECIAL_CHARACTERS"
            :key="character"
            type="button"
            :title="character"
            @mousedown.prevent
            @click="insertCharacter(character)"
          >
            {{ character }}
          </button>
        </div>
      </el-popover>

      <el-dropdown popper-class="doc-editor-popper" trigger="click" :disabled="locked" @command="insertBlock">
        <button
          type="button"
          class="doc-tb-button doc-tb-button--select"
          :aria-label="t('editor.insertMore')"
          :disabled="locked"
          :title="t('editor.insertMore')"
          @mousedown.prevent
        >
          <Plus :size="16" />
          <ChevronDown :size="12" />
        </button>
        <template #dropdown>
          <el-dropdown-menu class="doc-menu">
            <el-dropdown-item command="pageBreak">
              <SquareSplitVertical :size="14" />
              {{ t('editor.pageBreak') }}
              <span class="doc-menu__hint">{{ formatShortcut('Mod+Enter') }}</span>
            </el-dropdown-item>
            <el-dropdown-item command="horizontalRule">
              <SeparatorHorizontal :size="14" />
              {{ t('editor.horizontalRule') }}
            </el-dropdown-item>
            <el-dropdown-item command="date">
              <CalendarDays :size="14" />
              {{ t('editor.insertDate') }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <span class="doc-toolbar__spacer" />

    <div class="doc-toolbar__group">
      <button
        type="button"
        class="doc-tb-button"
        :class="{ 'is-active': findOpen }"
        :aria-label="t('editor.search.title')"
        :disabled="sourceMode"
        :title="withShortcut('editor.search.title', 'Mod+F')"
        @mousedown.prevent
        @click="emit('find')"
      >
        <Search :size="16" />
      </button>

      <el-popover placement="bottom-end" popper-class="doc-editor-popper" trigger="click" :width="316">
        <template #reference>
          <button
            type="button"
            class="doc-tb-button"
            :aria-label="t('editor.page.setup')"
            :title="t('editor.page.setup')"
            @mousedown.prevent
          >
            <FileSliders :size="16" />
          </button>
        </template>
        <EditorPageSetup :page="page" @change="emit('update:page', $event)" />
      </el-popover>

      <el-dropdown placement="bottom-end" popper-class="doc-editor-popper" trigger="click" @command="onMenuCommand">
        <button
          type="button"
          class="doc-tb-button"
          :aria-label="t('editor.more')"
          :title="t('editor.more')"
          @mousedown.prevent
        >
          <Ellipsis :size="16" />
        </button>
        <template #dropdown>
          <el-dropdown-menu class="doc-menu">
            <el-dropdown-item command="print">
              <Printer :size="14" />
              {{ t('editor.print') }}
              <span class="doc-menu__hint">{{ formatShortcut('Mod+P') }}</span>
            </el-dropdown-item>
            <el-dropdown-item command="exportWord">
              <FileType :size="14" />
              {{ t('editor.exportWord') }}
            </el-dropdown-item>
            <el-dropdown-item command="exportHtml">
              <FileDown :size="14" />
              {{ t('editor.exportHtml') }}
            </el-dropdown-item>
            <el-dropdown-item command="source" divided :class="{ 'is-selected': sourceMode }">
              <FileCode :size="14" />
              {{ t('editor.source') }}
            </el-dropdown-item>
            <el-dropdown-item command="fullscreen">
              <component :is="fullscreen ? Minimize2 : Maximize2" :size="14" />
              {{ t(fullscreen ? 'editor.exitFullscreen' : 'editor.enterFullscreen') }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </div>
</template>

<style scoped>
/* Toolbar layout */
.doc-toolbar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
  box-sizing: border-box;
  min-height: 40px;
  padding: 5px 8px;
  overflow-x: auto;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
  scrollbar-width: thin;
}

.doc-toolbar__group {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 1px;
}

.doc-toolbar__divider {
  flex: 0 0 1px;
  align-self: stretch;
  margin: 4px 5px;
  background: var(--el-border-color-lighter);
}

.doc-toolbar__spacer {
  flex: 1 1 auto;
  min-width: 8px;
}

/* Dropdown triggers with a value label */
.doc-toolbar__block {
  width: 108px;
}

.doc-toolbar__font {
  width: 118px;
}

.doc-toolbar__size {
  width: 50px;
}

.doc-toolbar__size-menu :deep(.el-dropdown-menu__item) {
  min-width: 96px;
}

/* Popover forms (link and image) */
.doc-toolbar__form {
  display: grid;
  gap: 8px;
}

.doc-toolbar__form label {
  display: grid;
  gap: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.doc-toolbar__form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.doc-toolbar__caption {
  color: var(--el-text-color-secondary);
  font-size: 11px;
  text-align: center;
}

.doc-toolbar__inline-form {
  display: flex;
  gap: 6px;
}

/* Special characters grid */
.doc-toolbar__characters {
  display: grid;
  grid-template-columns: repeat(9, minmax(0, 1fr));
  gap: 2px;
}

.doc-toolbar__characters button {
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  color: inherit;
  background: transparent;
  font-size: 15px;
  cursor: pointer;
}

.doc-toolbar__characters button:hover {
  background: var(--el-fill-color-light);
}
</style>
