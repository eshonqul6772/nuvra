<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { HeadingTag, TextAlign, TextDirection } from '../core/engine/blocks';
import type { DocumentEngine } from '../core/engine/engine';
import type { MarkName, TextCase } from '../core/engine/marks';
import type { IconName } from '../core/icons';
import { type EditorLabelKey, formatShortcut, t, withShortcut } from '../core/labels';
import { type PageSettings, hasHeaderFooterText } from '../core/page';
import type { DocumentMenuAction } from '../core/types';
import { type EditorUiState, normalizeFontFamily } from '../core/ui-state';
import EditorColorPicker from './editor-color-picker.vue';
import EditorDropdown from './editor-dropdown.vue';
import EditorDropdownItem from './editor-dropdown-item.vue';
import EditorHeaderFooter from './editor-header-footer.vue';
import EditorIcon from './editor-icon.vue';
import EditorPageSetup from './editor-page-setup.vue';
import EditorPopover from './editor-popover.vue';
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
  /** Whether the formatting marks (pilcrows) are shown in the document. */
  marksVisible: boolean;
  /** Current page settings, edited in the page setup popover. */
  page: PageSettings;
  /** Whether the ruler is shown above the sheet. */
  rulerVisible: boolean;
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
  icon: IconName;
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
/** Smallest font size that can be typed into the size field, in points. */
const FONT_SIZE_MIN = 1;
/** Largest font size that can be typed into the size field, in points. */
const FONT_SIZE_MAX = 400;
/** Space the paragraph spacing entries add before or after a paragraph, in points. */
const PARAGRAPH_SPACING = 12;
/** Points per CSS pixel. */
const POINTS_PER_PIXEL = 0.75;
/** Largest height of the long font menus, in pixels. */
const LONG_MENU_HEIGHT = 320;

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

/** Letter case entries of the case menu, in the order office suites list them. */
const TEXT_CASES = [
  { value: 'sentence', label: 'editor.case.sentence' },
  { value: 'lower', label: 'editor.case.lower' },
  { value: 'upper', label: 'editor.case.upper' },
  { value: 'title', label: 'editor.case.title' },
  { value: 'toggle', label: 'editor.case.toggle' }
] as const satisfies ReadonlyArray<{ value: TextCase; label: EditorLabelKey }>;

const ALIGNMENTS = [
  { value: 'left', icon: 'text-align-start', label: 'editor.align.left', shortcut: 'Mod+Shift+L' },
  { value: 'center', icon: 'text-align-center', label: 'editor.align.center', shortcut: 'Mod+Shift+E' },
  { value: 'right', icon: 'text-align-end', label: 'editor.align.right', shortcut: 'Mod+Shift+R' },
  { value: 'justify', icon: 'text-align-justify', label: 'editor.align.justify', shortcut: 'Mod+Shift+J' }
] as const;

const DIRECTIONS = [
  { value: 'auto', icon: 'languages', label: 'editor.direction.auto' },
  { value: 'ltr', icon: 'pilcrow-right', label: 'editor.direction.ltr' },
  { value: 'rtl', icon: 'pilcrow-left', label: 'editor.direction.rtl' }
] as const;

const MARK_BUTTONS: ToggleButton[] = [
  { key: 'bold', icon: 'bold', label: 'editor.bold', shortcut: 'Mod+B', toggle: engine => engine.toggleMark('bold') },
  {
    key: 'italic',
    icon: 'italic',
    label: 'editor.italic',
    shortcut: 'Mod+I',
    toggle: engine => engine.toggleMark('italic')
  },
  {
    key: 'underline',
    icon: 'underline',
    label: 'editor.underline',
    shortcut: 'Mod+U',
    toggle: engine => engine.toggleMark('underline')
  }
];

const LIST_BUTTONS: ToggleButton[] = [
  {
    key: 'bulletList',
    icon: 'list',
    label: 'editor.bulletList',
    shortcut: 'Mod+Shift+8',
    toggle: engine => engine.toggleList('bulletList')
  },
  {
    key: 'orderedList',
    icon: 'list-ordered',
    label: 'editor.orderedList',
    shortcut: 'Mod+Shift+7',
    toggle: engine => engine.toggleList('orderedList')
  },
  {
    key: 'taskList',
    icon: 'list-todo',
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
const linkInput = ref<HTMLInputElement>();
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

/** Whether the document has a header or a footer, which marks the running text button as active. */
const hasRunningText = computed(() => hasHeaderFooterText(props.page.header) || hasHeaderFooterText(props.page.footer));

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

/** Size shown in the font size field; it follows the caret while the user is not typing into it. */
const fontSizeInput = ref(fontSizeLabel.value);

watch(fontSizeLabel, size => {
  fontSizeInput.value = size;
});

/** Applies a size typed into the font size field; values outside the supported range are ignored. */
const applyFontSize = (input: HTMLInputElement) => {
  const size = Number.parseFloat(input.value.replace(',', '.'));
  if (Number.isFinite(size) && size >= FONT_SIZE_MIN && size <= FONT_SIZE_MAX) {
    props.engine.setTextStyle('fontSize', `${Math.round(size * 2) / 2}pt`);
  }
  fontSizeInput.value = fontSizeLabel.value;
};

/** Enter applies the typed size and hands focus back to the document. */
const onFontSizeEnter = (event: KeyboardEvent) => {
  const input = event.target as HTMLInputElement;
  applyFontSize(input);
  input.blur();
};

/** Leaving the field applies the typed size, as in office suites. */
const onFontSizeBlur = (event: FocusEvent) => applyFontSize(event.target as HTMLInputElement);

/** Grows or shrinks the font to the next size of the list, like the A↑ and A↓ buttons of office suites. */
const stepFontSize = (direction: 1 | -1) => {
  const current = Number.parseFloat(fontSizeLabel.value) || DEFAULT_FONT_SIZE;
  const larger = FONT_SIZES.find(size => size > current) ?? Math.min(FONT_SIZE_MAX, Math.ceil(current) + 1);
  const smaller = FONT_SIZES.filter(size => size < current).at(-1) ?? Math.max(FONT_SIZE_MIN, Math.floor(current) - 1);
  props.engine.setTextStyle('fontSize', `${direction > 0 ? larger : smaller}pt`);
};

/** Changes the letter case of the selected text. */
const setTextCase = (command: unknown) => props.engine.changeTextCase(command as TextCase);

/** Picks up the formatting at the caret, or drops it again when the painter is already carrying one. */
const toggleFormatPainter = () => {
  if (props.state.formatPainter) props.engine.cancelFormatPainter();
  else props.engine.copyFormat();
};

/** Icon of the alignment at the caret. */
const alignIcon = computed<IconName>(
  () => ALIGNMENTS.find(alignment => alignment.value === props.state.align)?.icon ?? 'text-align-start'
);

/** Icon of the text direction at the caret. */
const directionIcon = computed<IconName>(
  () => DIRECTIONS.find(direction => direction.value === props.state.direction)?.icon ?? 'languages'
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

/** Applies a line height, or one of the paragraph spacing entries of the same menu. */
const setLineHeight = (command: unknown) => {
  if (command === 'spaceBefore' || command === 'spaceAfter') {
    const side = command === 'spaceBefore' ? 'before' : 'after';
    const current = side === 'before' ? props.state.spaceBefore : props.state.spaceAfter;
    props.engine.setParagraphSpacing(side, current ? null : PARAGRAPH_SPACING);
    return;
  }
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
        <EditorIcon name="undo-2" :size="16" />
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
        <EditorIcon name="redo-2" :size="16" />
      </button>
      <button
        type="button"
        class="doc-tb-button"
        :class="{ 'is-active': state.formatPainter }"
        :aria-label="t('editor.formatPainter')"
        :aria-pressed="state.formatPainter"
        :disabled="locked"
        :title="t('editor.formatPainter')"
        @mousedown.prevent
        @click="toggleFormatPainter"
      >
        <EditorIcon name="paintbrush" :size="16" />
      </button>
    </div>

    <span class="doc-toolbar__divider" />

    <div class="doc-toolbar__group">
      <EditorDropdown :disabled="locked" @command="setBlock">
        <button
          type="button"
          class="doc-tb-button doc-tb-button--select doc-toolbar__block"
          :disabled="locked"
          :title="t('editor.textStyle')"
          @mousedown.prevent
        >
          <span class="doc-tb-button__label">{{ blockLabel }}</span>
          <EditorIcon name="chevron-down" :size="12" />
        </button>
        <template #menu>
          <EditorDropdownItem
            command="paragraph"
            :class="{ 'is-selected': !state.headingLevel && !state.codeBlock && !state.blockquote }"
          >
            {{ t('editor.paragraph') }}
            <span class="doc-menu__hint">{{ formatShortcut('Mod+Alt+0') }}</span>
          </EditorDropdownItem>
          <EditorDropdownItem
            v-for="level in HEADING_LEVELS"
            :key="level"
            :class="{ 'is-selected': state.headingLevel === level }"
            :command="level"
          >
            <span :class="`doc-menu__h${level}`">{{ t('editor.heading', { level }) }}</span>
            <span class="doc-menu__hint">{{ formatShortcut(`Mod+Alt+${level}`) }}</span>
          </EditorDropdownItem>
          <EditorDropdownItem command="blockquote" divided :class="{ 'is-selected': state.blockquote }">
            <EditorIcon name="quote" :size="14" />
            {{ t('editor.quote') }}
          </EditorDropdownItem>
          <EditorDropdownItem command="codeBlock" :class="{ 'is-selected': state.codeBlock }">
            <EditorIcon name="square-code" :size="14" />
            {{ t('editor.codeBlock') }}
          </EditorDropdownItem>
        </template>
      </EditorDropdown>

      <EditorDropdown :disabled="locked" :max-height="LONG_MENU_HEIGHT" @command="setFontFamily">
        <button
          type="button"
          class="doc-tb-button doc-tb-button--select doc-toolbar__font"
          :disabled="locked"
          :title="t('editor.fontFamily')"
          @mousedown.prevent
        >
          <span class="doc-tb-button__label">{{ fontLabel }}</span>
          <EditorIcon name="chevron-down" :size="12" />
        </button>
        <template #menu>
          <EditorDropdownItem :class="{ 'is-selected': !state.fontFamily }" :command="DEFAULT_COMMAND">
            {{ t('editor.defaultFont') }}
          </EditorDropdownItem>
          <EditorDropdownItem
            v-for="font in FONT_FAMILIES"
            :key="font.value"
            :class="{ 'is-selected': state.fontFamily === font.normalized }"
            :command="font.value"
            :style="{ fontFamily: font.value }"
          >
            {{ font.label }}
          </EditorDropdownItem>
        </template>
      </EditorDropdown>

      <input
        v-model="fontSizeInput"
        class="doc-input doc-toolbar__size"
        type="text"
        inputmode="decimal"
        :aria-label="t('editor.fontSize')"
        :disabled="locked"
        :title="t('editor.fontSize')"
        @keydown.enter.prevent="onFontSizeEnter"
        @blur="onFontSizeBlur"
      />
      <EditorDropdown
        menu-class="doc-toolbar__size-menu"
        :disabled="locked"
        :max-height="LONG_MENU_HEIGHT"
        @command="setFontSize"
      >
        <button
          type="button"
          class="doc-tb-button doc-tb-button--caret"
          :aria-label="t('editor.fontSize')"
          :disabled="locked"
          :title="t('editor.fontSize')"
          @mousedown.prevent
        >
          <EditorIcon name="chevron-down" :size="12" />
        </button>
        <template #menu>
          <EditorDropdownItem :class="{ 'is-selected': !state.fontSize }" :command="DEFAULT_COMMAND">
            {{ t('editor.defaultSize') }}
          </EditorDropdownItem>
          <EditorDropdownItem
            v-for="size in FONT_SIZES"
            :key="size"
            :class="{ 'is-selected': state.fontSize === `${size}pt` }"
            :command="size"
          >
            {{ size }}
          </EditorDropdownItem>
        </template>
      </EditorDropdown>
      <button
        type="button"
        class="doc-tb-button"
        :aria-label="t('editor.increaseFontSize')"
        :disabled="locked"
        :title="t('editor.increaseFontSize')"
        @mousedown.prevent
        @click="stepFontSize(1)"
      >
        <EditorIcon name="a-arrow-up" :size="16" />
      </button>
      <button
        type="button"
        class="doc-tb-button"
        :aria-label="t('editor.decreaseFontSize')"
        :disabled="locked"
        :title="t('editor.decreaseFontSize')"
        @mousedown.prevent
        @click="stepFontSize(-1)"
      >
        <EditorIcon name="a-arrow-down" :size="16" />
      </button>
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
        <EditorIcon :name="button.icon" :size="16" />
      </button>
      <EditorDropdown :disabled="locked" @command="runTextCommand">
        <button
          type="button"
          class="doc-tb-button doc-tb-button--caret"
          :class="{ 'is-active': state.strike || state.subscript || state.superscript || state.code }"
          :aria-label="t('editor.moreFormatting')"
          :disabled="locked"
          :title="t('editor.moreFormatting')"
          @mousedown.prevent
        >
          <EditorIcon name="chevron-down" :size="12" />
        </button>
        <template #menu>
          <EditorDropdownItem command="strike" :class="{ 'is-selected': state.strike }">
            <EditorIcon name="strikethrough" :size="14" />
            {{ t('editor.strike') }}
            <span class="doc-menu__hint">{{ formatShortcut('Mod+Shift+S') }}</span>
          </EditorDropdownItem>
          <EditorDropdownItem command="subscript" :class="{ 'is-selected': state.subscript }">
            <EditorIcon name="subscript" :size="14" />
            {{ t('editor.subscript') }}
            <span class="doc-menu__hint">{{ formatShortcut('Mod+,') }}</span>
          </EditorDropdownItem>
          <EditorDropdownItem command="superscript" :class="{ 'is-selected': state.superscript }">
            <EditorIcon name="superscript" :size="14" />
            {{ t('editor.superscript') }}
            <span class="doc-menu__hint">{{ formatShortcut('Mod+.') }}</span>
          </EditorDropdownItem>
          <EditorDropdownItem command="code" :class="{ 'is-selected': state.code }">
            <EditorIcon name="code" :size="14" />
            {{ t('editor.inlineCode') }}
            <span class="doc-menu__hint">{{ formatShortcut('Mod+E') }}</span>
          </EditorDropdownItem>
          <EditorDropdownItem command="clear" divided>
            <EditorIcon name="remove-formatting" :size="14" />
            {{ t('editor.clearFormatting') }}
          </EditorDropdownItem>
        </template>
      </EditorDropdown>
      <EditorDropdown :disabled="locked" @command="setTextCase">
        <button
          type="button"
          class="doc-tb-button doc-tb-button--select"
          :aria-label="t('editor.changeCase')"
          :disabled="locked"
          :title="t('editor.changeCase')"
          @mousedown.prevent
        >
          <EditorIcon name="case-sensitive" :size="16" />
          <EditorIcon name="chevron-down" :size="12" />
        </button>
        <template #menu>
          <EditorDropdownItem v-for="option in TEXT_CASES" :key="option.value" :command="option.value">
            {{ t(option.label) }}
          </EditorDropdownItem>
        </template>
      </EditorDropdown>
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
      <EditorDropdown :disabled="locked" @command="setAlign">
        <button
          type="button"
          class="doc-tb-button doc-tb-button--select"
          :aria-label="t('editor.align')"
          :disabled="locked"
          :title="t('editor.align')"
          @mousedown.prevent
        >
          <EditorIcon :name="alignIcon" :size="16" />
          <EditorIcon name="chevron-down" :size="12" />
        </button>
        <template #menu>
          <EditorDropdownItem
            v-for="alignment in ALIGNMENTS"
            :key="alignment.value"
            :class="{ 'is-selected': state.align === alignment.value }"
            :command="alignment.value"
          >
            <EditorIcon :name="alignment.icon" :size="14" />
            {{ t(alignment.label) }}
            <span class="doc-menu__hint">{{ formatShortcut(alignment.shortcut) }}</span>
          </EditorDropdownItem>
        </template>
      </EditorDropdown>

      <EditorDropdown :disabled="locked" @command="setLineHeight">
        <button
          type="button"
          class="doc-tb-button doc-tb-button--select"
          :aria-label="t('editor.lineHeight')"
          :disabled="locked"
          :title="t('editor.lineHeight')"
          @mousedown.prevent
        >
          <EditorIcon name="unfold-vertical" :size="16" />
          <EditorIcon name="chevron-down" :size="12" />
        </button>
        <template #menu>
          <EditorDropdownItem :class="{ 'is-selected': !state.lineHeight }" :command="DEFAULT_COMMAND">
            {{ t('editor.defaultLineHeight') }}
          </EditorDropdownItem>
          <EditorDropdownItem
            v-for="lineHeight in LINE_HEIGHTS"
            :key="lineHeight"
            :class="{ 'is-selected': state.lineHeight === lineHeight }"
            :command="lineHeight"
          >
            {{ lineHeight }}
          </EditorDropdownItem>
          <EditorDropdownItem command="spaceBefore" divided>
            {{ t(state.spaceBefore ? 'editor.spacing.removeBefore' : 'editor.spacing.addBefore') }}
          </EditorDropdownItem>
          <EditorDropdownItem command="spaceAfter">
            {{ t(state.spaceAfter ? 'editor.spacing.removeAfter' : 'editor.spacing.addAfter') }}
          </EditorDropdownItem>
        </template>
      </EditorDropdown>

      <EditorDropdown :disabled="locked" @command="setDirection">
        <button
          type="button"
          class="doc-tb-button doc-tb-button--select"
          :aria-label="t('editor.textDirection')"
          :disabled="locked"
          :title="t('editor.textDirection')"
          @mousedown.prevent
        >
          <EditorIcon :name="directionIcon" :size="16" />
          <EditorIcon name="chevron-down" :size="12" />
        </button>
        <template #menu>
          <EditorDropdownItem
            v-for="direction in DIRECTIONS"
            :key="direction.value"
            :class="{ 'is-selected': state.direction === direction.value }"
            :command="direction.value"
          >
            <EditorIcon :name="direction.icon" :size="14" />
            {{ t(direction.label) }}
          </EditorDropdownItem>
        </template>
      </EditorDropdown>

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
        <EditorIcon :name="button.icon" :size="16" />
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
        <EditorIcon name="list-indent-decrease" :size="16" />
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
        <EditorIcon name="list-indent-increase" :size="16" />
      </button>
    </div>

    <span class="doc-toolbar__divider" />

    <div class="doc-toolbar__group">
      <EditorPopover
        v-model:open="linkVisible"
        :disabled="locked"
        :width="300"
        @show="prepareLink"
        @shown="linkInput?.focus()"
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
            <EditorIcon name="link" :size="16" />
          </button>
        </template>
        <form class="doc-toolbar__form" @submit.prevent="applyLink">
          <label v-if="linkNeedsText" class="doc-toolbar__field">
            {{ t('editor.linkText') }}
            <input v-model="linkText" class="doc-input" type="text" />
          </label>
          <label class="doc-toolbar__field">
            {{ t('editor.linkUrl') }}
            <input ref="linkInput" v-model="linkUrl" class="doc-input" type="text" placeholder="https://" />
          </label>
          <label class="doc-checkbox">
            <input v-model="linkNewTab" type="checkbox" />
            {{ t('editor.linkNewTab') }}
          </label>
          <div class="doc-toolbar__form-actions">
            <button v-if="state.link" type="button" class="doc-btn doc-btn--danger-text" @click="removeLink">
              {{ t('editor.unlink') }}
            </button>
            <button type="submit" class="doc-btn doc-btn--primary">{{ t('editor.apply') }}</button>
          </div>
        </form>
      </EditorPopover>

      <EditorPopover v-model:open="imageVisible" :disabled="locked" :width="300">
        <template #reference>
          <button
            type="button"
            class="doc-tb-button"
            :aria-label="t('editor.image')"
            :disabled="locked"
            :title="t('editor.image')"
            @mousedown.prevent
          >
            <EditorIcon name="image-plus" :size="16" />
          </button>
        </template>
        <div class="doc-toolbar__form">
          <button type="button" class="doc-btn" :disabled="uploading" @click="pickImages">
            <EditorIcon :class="{ 'doc-spin': uploading }" :name="uploading ? 'loader-circle' : 'upload'" :size="14" />
            {{ t('editor.uploadImage') }}
          </button>
          <span class="doc-toolbar__caption">{{ t('editor.or') }}</span>
          <form class="doc-toolbar__inline-form" @submit.prevent="insertImageUrl">
            <input
              v-model="imageUrl"
              class="doc-input"
              type="text"
              placeholder="https://example.com/image.png"
              :aria-label="t('editor.image')"
            />
            <button type="submit" class="doc-btn doc-btn--primary" :disabled="!imageUrl.trim()">
              {{ t('editor.insert') }}
            </button>
          </form>
        </div>
      </EditorPopover>
      <input ref="fileInput" type="file" accept="image/*" hidden multiple @change="onFilesPicked" />

      <EditorPopover v-model:open="tableVisible" :disabled="locked" :width="212">
        <template #reference>
          <button
            type="button"
            class="doc-tb-button"
            :aria-label="t('editor.table.insert')"
            :disabled="locked"
            :title="t('editor.table.insert')"
            @mousedown.prevent
          >
            <EditorIcon name="grid-3x3" :size="16" />
          </button>
        </template>
        <EditorTablePicker v-if="tableVisible" @select="insertTable" />
      </EditorPopover>

      <EditorPopover v-model:open="charactersVisible" :disabled="locked" :width="258">
        <template #reference>
          <button
            type="button"
            class="doc-tb-button"
            :aria-label="t('editor.specialCharacters')"
            :disabled="locked"
            :title="t('editor.specialCharacters')"
            @mousedown.prevent
          >
            <EditorIcon name="omega" :size="16" />
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
      </EditorPopover>

      <EditorDropdown :disabled="locked" @command="insertBlock">
        <button
          type="button"
          class="doc-tb-button doc-tb-button--select"
          :aria-label="t('editor.insertMore')"
          :disabled="locked"
          :title="t('editor.insertMore')"
          @mousedown.prevent
        >
          <EditorIcon name="plus" :size="16" />
          <EditorIcon name="chevron-down" :size="12" />
        </button>
        <template #menu>
          <EditorDropdownItem command="pageBreak">
            <EditorIcon name="square-split-vertical" :size="14" />
            {{ t('editor.pageBreak') }}
            <span class="doc-menu__hint">{{ formatShortcut('Mod+Enter') }}</span>
          </EditorDropdownItem>
          <EditorDropdownItem command="horizontalRule">
            <EditorIcon name="separator-horizontal" :size="14" />
            {{ t('editor.horizontalRule') }}
          </EditorDropdownItem>
          <EditorDropdownItem command="date">
            <EditorIcon name="calendar-days" :size="14" />
            {{ t('editor.insertDate') }}
          </EditorDropdownItem>
        </template>
      </EditorDropdown>
    </div>

    <span class="doc-toolbar__spacer" />

    <div class="doc-toolbar__group doc-toolbar__group--end">
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
        <EditorIcon name="search" :size="16" />
      </button>

      <EditorPopover placement="bottom-end" :width="340">
        <template #reference>
          <button
            type="button"
            class="doc-tb-button"
            :class="{ 'is-active': hasRunningText }"
            :aria-label="t('editor.headerFooter')"
            :title="t('editor.headerFooter')"
            @mousedown.prevent
          >
            <EditorIcon name="panel-top-dashed" :size="16" />
          </button>
        </template>
        <EditorHeaderFooter :page="page" @change="emit('update:page', $event)" />
      </EditorPopover>

      <EditorPopover placement="bottom-end" :width="316">
        <template #reference>
          <button
            type="button"
            class="doc-tb-button"
            :aria-label="t('editor.page.setup')"
            :title="t('editor.page.setup')"
            @mousedown.prevent
          >
            <EditorIcon name="file-sliders" :size="16" />
          </button>
        </template>
        <EditorPageSetup :page="page" @change="emit('update:page', $event)" />
      </EditorPopover>

      <EditorDropdown placement="bottom-end" @command="onMenuCommand">
        <button
          type="button"
          class="doc-tb-button"
          :aria-label="t('editor.more')"
          :title="t('editor.more')"
          @mousedown.prevent
        >
          <EditorIcon name="ellipsis" :size="16" />
        </button>
        <template #menu>
          <EditorDropdownItem command="print">
            <EditorIcon name="printer" :size="14" />
            {{ t('editor.print') }}
            <span class="doc-menu__hint">{{ formatShortcut('Mod+P') }}</span>
          </EditorDropdownItem>
          <EditorDropdownItem command="exportWord">
            <EditorIcon name="file-type" :size="14" />
            {{ t('editor.exportWord') }}
          </EditorDropdownItem>
          <EditorDropdownItem command="exportHtml">
            <EditorIcon name="file-down" :size="14" />
            {{ t('editor.exportHtml') }}
          </EditorDropdownItem>
          <EditorDropdownItem command="ruler" divided :class="{ 'is-selected': rulerVisible }">
            <EditorIcon name="ruler" :size="14" />
            {{ t('editor.ruler') }}
          </EditorDropdownItem>
          <EditorDropdownItem command="formattingMarks" :class="{ 'is-selected': marksVisible }">
            <EditorIcon name="pilcrow" :size="14" />
            {{ t('editor.formattingMarks') }}
          </EditorDropdownItem>
          <EditorDropdownItem command="source" :class="{ 'is-selected': sourceMode }">
            <EditorIcon name="file-code" :size="14" />
            {{ t('editor.source') }}
          </EditorDropdownItem>
          <EditorDropdownItem command="fullscreen">
            <EditorIcon :name="fullscreen ? 'minimize-2' : 'maximize-2'" :size="14" />
            {{ t(fullscreen ? 'editor.exitFullscreen' : 'editor.enterFullscreen') }}
          </EditorDropdownItem>
        </template>
      </EditorDropdown>
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
  border-bottom: 1px solid var(--nuvra-border-lighter);
  background: var(--nuvra-bg);
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
  background: var(--nuvra-border-lighter);
}

.doc-toolbar__spacer {
  flex: 1 1 auto;
  min-width: 8px;
}

/* Search, page setup and the document menu stay at the right edge while the formatting groups scroll behind them. */
.doc-toolbar__group--end {
  position: sticky;
  right: 0;
  padding-left: 6px;
  background: var(--nuvra-bg);
}

/* Dropdown triggers with a value label */
.doc-toolbar__block {
  width: 108px;
}

.doc-toolbar__font {
  width: 118px;
}

/* Font size field: a small editable input with the size list on its own caret button. */
.doc-toolbar__size {
  width: 44px;
  height: 28px;
  padding: 0 4px;
  text-align: center;
}

/* Menus stay inside the toolbar's DOM, so the deep selector reaches the size menu rendered by the dropdown. */
.doc-toolbar :deep(.doc-toolbar__size-menu) {
  min-width: 96px;
}

/* Popover forms (link and image) */
.doc-toolbar__form {
  display: grid;
  gap: 8px;
}

.doc-toolbar__field {
  display: grid;
  gap: 4px;
  color: var(--nuvra-text-muted);
  font-size: 12px;
}

.doc-toolbar__form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.doc-toolbar__caption {
  color: var(--nuvra-text-muted);
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
  background: var(--nuvra-fill);
}
</style>
