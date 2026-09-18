# nuvra

Word-style document editor for Vue 3. A real page view with paper sizes and margins, a lighter web view for
forms, tables, images, lists, find & replace, comments, HTML source mode, printing, PDF download, export to HTML and Word
files (`.docx`) you can open again.

**[Documentation and live demo →](https://nuvra-docs.vercel.app)**

- No editor framework underneath: its own small editing engine with a sanitizing schema.
- No UI framework either: native HTML controls, built-in SVG icons and plain CSS variables. Vue is the only
  dependency.
- Pagination in the page view (A4, A5, Letter, …, portrait or landscape), with section breaks for landscape pages inside a
  portrait document.
- Tables with merge / split, images with resize and alignment, task lists, links, colors, fonts.
- Undo / redo, keyboard shortcuts that work with non-Latin keyboard layouts, Markdown-like input rules.
- Office tools: format painter, letter case, paragraph spacing, formatting marks, a right-click menu and
  Ctrl + wheel zoom.
- Headers and footers with page number, page count, date and title tokens; printing breaks the pages exactly where
  the editor shows them, and the Word export uses Word's own header, footer and page fields.
- A ruler above the page for the margins and for the first line, left and right indents of a paragraph.
- A page watermark such as DRAFT or COPY, drawn behind the text of every page and carried into print, HTML and Word.
- Real `.docx` export and import, PDF download without the print dialog, multilevel (1.1.1) numbering, a table of
  contents and a navigation pane with headings and page thumbnails.
- Footnotes at the bottom of their page, carried into print and Word.
- Comments with replies, tracked changes that round-trip with Word, a comparison of two versions, and templates
  filled in as a form.
- Hooks for editing together: other people's carets and selections, your selection as character positions.
- A `/` command menu and a toolbar slot for your own commands and buttons.

## Installation

```sh
pnpm add nuvra
# or
npm install nuvra
```

`vue` (3.5+) is the only peer dependency.

Import the styles once, for example in `main.ts`:

```ts
import 'nuvra/style.css';
```

## Usage

### Document editor

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { DocumentEditor, type PageSettings, createPageSettings } from 'nuvra';

const html = ref('');
const page = ref<PageSettings>(createPageSettings());
</script>

<template>
  <DocumentEditor v-model="html" v-model:page="page" height="100%" title="Contract" />
</template>
```

### Form field

`Editor` is the same editor in the web view, growing with its content between `minHeight` and `maxHeight`:

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { Editor } from 'nuvra';

const description = ref('');
</script>

<template>
  <Editor v-model="description" placeholder="Description" :max-length="2000" />
</template>
```

### Image upload

Without an upload handler images are embedded as data URLs. Pass `uploadImage` to store them on your server:

```ts
import type { DocumentImageUploadHandler } from 'nuvra';

const uploadImage: DocumentImageUploadHandler = async file => {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch('/api/files', { method: 'POST', body });
  return (await response.json()).url;
};
```

## API

### `DocumentEditor` props

| Prop              | Type                              | Default  | Description                                                                |
| ----------------- | --------------------------------- | -------- | -------------------------------------------------------------------------- |
| `v-model`         | `string`                          | `''`     | Document HTML; an empty document is an empty string.                       |
| `v-model:page`    | `PageSettings`                    | A4       | Paper size, orientation, margins, headers, footers, watermark, numbering.  |
| `v-model:comments`| `DocumentComment[]`               | —        | Comments; binding it turns the comment tools on.                           |
| `v-model:trackChanges` | `boolean`                    | `false`  | Records edits as tracked changes.                                          |
| `author`          | `string`                          | `''`     | Name written on new comments, replies and tracked changes.                 |
| `autofocus`       | `boolean`                         | `false`  | Places the caret at the end of the document once ready.                    |
| `canvasPadding`   | `number \| string`                | `50`     | Gray space around the page or web sheet.                                   |
| `collaborators`   | `Collaborator[]`                  | `[]`     | Other people editing the document; their carets and selections are drawn.  |
| `defaultViewMode` | `'page' \| 'web'`                 | `'page'` | View shown first.                                                          |
| `disabled`        | `boolean`                         | `false`  | Read-only document, disabled controls.                                     |
| `height`          | `number \| string`                | `760`    | Height of the editor, or `'auto'` to grow between `minHeight`/`maxHeight`. |
| `locale`          | `EditorLocale \| 'uz' \| 'en' \| 'ru'` | —   | Interface language; defaults to the app-wide language (Uzbek).             |
| `minHeight`       | `number \| string`                | `240`    | Smallest height of an auto-height editor.                                  |
| `maxHeight`       | `number \| string`                | `600`    | Largest height of an auto-height editor.                                   |
| `maxImageSizeMb`  | `number`                          | `10`     | Largest accepted image file.                                               |
| `maxLength`       | `number`                          | `0`      | Character limit; `0` means unlimited.                                      |
| `placeholder`     | `string`                          | `''`     | Text shown while the document is empty.                                    |
| `ruler`           | `boolean`                         | `true`   | Shows the ruler in the page view.                                          |
| `slashCommands`   | `SlashCommand[]`                  | `[]`     | Your own commands, listed first in the `/` menu.                           |
| `title`           | `string`                          | `''`     | Print title and exported file name.                                        |
| `tools`           | `ToolbarTool[]`                   | all      | Toolbar tools to show; see [Choosing the toolbar tools](#choosing-the-toolbar-tools). |
| `uploadImage`     | `(file: File) => Promise<string>` | —        | Uploads an image and resolves with its URL.                                |
| `variables`       | `TemplateVariable[]`              | `[]`     | Template variables the user can insert.                                    |

`Editor` accepts the same props except `v-model:page`, `v-model:comments`, `v-model:trackChanges`, `author`,
`collaborators`, `defaultViewMode`, `height`, `ruler`, `slashCommands` and `title`.

Numbers are pixels; strings are used as CSS lengths (`'100%'`, `'50vh'`).

### Events

| Event             | Payload                             | Description                                                    |
| ----------------- | ----------------------------------- | -------------------------------------------------------------- |
| `focus`           | —                                   | The document received focus.                                   |
| `blur`            | —                                   | The document lost focus; the model is up to date.              |
| `uploadError`     | `error: unknown`                    | An image was rejected or its upload failed.                    |
| `importError`     | `error: unknown`                    | A Word file could not be read.                                 |
| `exportError`     | `error: unknown`                    | The PDF could not be drawn; no file is downloaded.             |
| `selectionChange` | `selection: SelectionOffsets \| null` | The caret or selection moved; `null` when it left the document. |

### Exposed methods (`DocumentEditor` ref)

| Method                    | Description                                                      |
| ------------------------- | ---------------------------------------------------------------- |
| `focus()`                 | Moves keyboard focus into the document.                          |
| `getHTML()`               | Returns the document HTML, including edits not yet in the model. |
| `insertVariable(name)`    | Inserts a template variable at the selection.                    |
| `updateTableOfContents()` | Inserts or refreshes the table of contents.                      |
| `importWord(file)`        | Replaces the document with the content of a `.docx` file.        |
| `print()`                 | Opens the browser print dialog.                                  |
| `exportHtml()`            | Downloads the document as an HTML page.                          |
| `exportWord()`            | Downloads the document as a Word file (`.docx`).                 |
| `exportPdf()`             | Downloads the document as a PDF drawn from its pages.            |
| `engine`                  | The editing engine (`DocumentEngine`), for advanced integrations. |

### Keyboard shortcuts

`Ctrl/⌘+B`, `I`, `U` — bold, italic, underline · `Ctrl/⌘+Shift+H` — highlight · `Ctrl/⌘+Z`, `Ctrl/⌘+Shift+Z` — undo,
redo · `Ctrl/⌘+F` — find · `Ctrl/⌘+H` — replace · `Ctrl/⌘+K` — link · `Ctrl/⌘+Alt+M` — comment · `Ctrl/⌘+P` — print.

The full list, with Markdown-like input rules, is in the
[keyboard shortcuts guide](https://nuvra-docs.vercel.app/docs/keyboard-shortcuts).

## Templates and signatures

Pass `variables` to let users insert template variables with the toolbar's **{ }** menu or by typing `{{name}}`.
They are saved as `<span data-variable="name">{{name}}</span>`; `fillTemplate` replaces them with escaped values,
in the browser or on a Node server:

```ts
import { type TemplateVariable, fillTemplate } from 'nuvra';

const variables: TemplateVariable[] = [
  { name: 'full_name', label: 'Full name' },
  { name: 'letter_date', label: 'Letter date' }
];

const letter = fillTemplate(template, { full_name: 'Aziz Karimov', letter_date: '14.09.2026' });
```

The pen button inserts a signature block in the editor's language: a signature line, an “Approved” or “Agreed”
block, or the signatures of both parties of a contract. It is a borderless table, so it prints and exports to Word
without lines.

The document button inserts ready-made templates (official letter, order, application, certificate, act), and the
toolbar writes amounts in words (`15 000 000 (o‘n besh million)`), inserts long dates (`2026-yil 14-sentabr`) and
converts Uzbek text between the Latin and Cyrillic alphabets. The same helpers are exported: `getDocumentTemplate`,
`numberToWords`, `formatAmountInWords`, `parseAmount`, `formatLongDate` and `transliterate`.

### Filling a template as a form

`DocumentForm` shows a saved template as it will be printed, with an input in place of every variable. Fields of the
same variable share one value:

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { DocumentForm } from 'nuvra';

const values = ref<Record<string, string>>({});
const form = ref<InstanceType<typeof DocumentForm>>();

const submit = () => {
  if (form.value?.validate().length) return; // empty fields are marked and focused
  const html = form.value?.getHTML(); // filled with fillTemplate
};
</script>

<template>
  <DocumentForm ref="form" v-model="values" :template="template" :variables="variables" />
</template>
```

## Word files and long documents

"Download as Word (.docx)" in the "More" menu writes a real Office Open XML file with the page setup, headers and
footers with page fields, the watermark, lists, tables with merged cells, images, footnotes and tracked changes as
Word revisions. "Open Word file (.docx)" (or `importWord(file)`) loads one into the editor, footnotes and revisions
included; a file that cannot be read emits `importError`. `buildDocx` and `readDocx` do the same in your own code. A
document with several sections takes the page setup of its first section, and every further section starts with a
section break; the content of a different first page header is not imported.

Tables longer than a page break between their rows in the page view, in print and in the PDF, as in Word: the rows
that do not fit continue at the top of the next page, and rows joined by a merged cell stay together.

### PDF download

"Download as PDF" in the "More" menu, or `exportPdf()`, saves a PDF without the print dialog. Every sheet is drawn into a
picture (SVG `foreignObject` → canvas → JPEG) and written into the PDF, so it looks like the printout, but its text
cannot be selected or searched. Images from servers without CORS are left out, and in the web view the editor switches to
the page view for the moment of the export. A PDF that cannot be drawn emits `exportError`; printing with "Save as PDF"
still gives a PDF with real text.

### Pages in different orientations

"Section break: landscape pages" and "Section break: portrait pages" in the insert menu and the `/` menu (or
`engine.insertSectionBreak('landscape')`) turn the pages after the break; paper size and margins stay, and the break
starts a new page. It is saved as `<div data-type="section-break" data-orientation="landscape"></div>`. The page view
draws sheets of different sizes and gives the blocks of a turned section their sheet's text width; printing uses a named
`@page` for turned sheets, the PDF has turned pages, and the Word export writes every section as a Word section with its
own orientation.

### Footnotes

"Footnote" in the insert menu or the `/` menu adds a numbered reference and opens a small form for the note; clicking
a reference edits or deletes it. A footnote is saved in the reference, `<sup data-footnote="note text">1</sup>`, and
renumbered in document order. The page view draws the notes at the bottom of the sheet the reference is on, the web
view after the document; printing follows the sheets, and the Word export writes Word footnotes. Notes are plain text.
From code: `engine.insertFootnote(text)`, `setFootnoteText(element, text)`, `removeFootnote(element)`,
`getFootnotes()`.

For long documents the toolbar offers multilevel numbering (1., 1.1., 1.1.1., saved as `<ol data-numbering="legal">`),
a table of contents of the headings with page numbers (saved as `<table data-type="toc">`, refreshed with
`updateTableOfContents()`), and a navigation pane. `PageSettings` has `differentFirstPage` to hide the header, footer
and page number on the first page, and `firstPageNumber` for the number printed on it. The navigation pane lists the
headings or shows page thumbnails; clicking one scrolls to it.

## Comments, tracked changes and comparison

Bind `v-model:comments` to turn comments on. The HTML keeps only the anchors, `<span data-comment="id">`; the
comments are plain data you store next to the document:

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { DocumentEditor, type DocumentComment } from 'nuvra';

const html = ref('');
const comments = ref<DocumentComment[]>([]);

const save = () =>
  fetch('/api/documents/42', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html: html.value, comments: comments.value })
  });
</script>

<template>
  <DocumentEditor v-model="html" v-model:comments="comments" author="Aziz Karimov" @blur="save" />
</template>
```

The comment and change tools are in the **Review** menu of the toolbar. Users select text and choose "Add comment"
(`Ctrl/⌘+Alt+M`); the "Comments" panel replies, resolves, reopens and deletes them, and flags comments whose text was
deleted.

### Tracked changes

Bind `v-model:trackChanges` (or choose "Track changes" in the Review menu) to record typing, deleting, cut and paste as tracked changes
by `author`. They are part of the HTML, `<ins data-change="id" data-author="…" data-time="…">` and `<del …>`, shown
and printed green-underlined and red-struck. The "Changes" panel accepts or rejects them one by one or all at once;
from code use `engine.getChanges()`, `engine.resolveChanges(accept, id?)` and `engine.selectChange(id)`. Formatting,
block changes (headings, lists, tables), Enter and joining paragraphs are not tracked. The Word export writes them as
revisions and the import reads Word revisions back.

```vue
<DocumentEditor v-model="html" v-model:track-changes="tracking" author="Aziz Karimov" />
```

`DocumentCompare` shows what changed between two versions: inserted words in green, deleted words struck through in
red. Unchanged blocks stay as they are, changed paragraphs are compared word by word, and added or removed blocks are
shown whole. `compareDocuments(before, after)` returns the same HTML and counts for your own view.

```vue
<DocumentCompare :before="previousVersion" :after="html" :height="600" />
```

## Editing together

The editor has hooks for several people on one document; the transport (WebSocket, WebRTC, …) is up to your app.
`selectionChange` reports your caret or selection as character positions, `collaborators` draws other people's carets
(with names) and selections, and a new `v-model` value from outside keeps your caret at the same character position.
The engine also offers `getSelectionOffsets()`, `getOffsetRects(offsets)` and `setContent(html, { keepSelection })`;
`collaboratorColor` gives the colour a collaborator is drawn in.

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { type Collaborator, DocumentEditor, type SelectionOffsets } from 'nuvra';

const html = ref('');
const collaborators = ref<Collaborator[]>([]); // filled from your socket messages

const sendSelection = (selection: SelectionOffsets | null) =>
  socket.send(JSON.stringify({ type: 'selection', id: me.id, name: me.name, selection }));
</script>

<template>
  <DocumentEditor v-model="html" :collaborators="collaborators" @selection-change="sendSelection" />
</template>
```

This is not a CRDT: the document travels as a whole, so when two people type at the same time the document sent last
wins, and because positions are character offsets, a remote edit before your caret shifts it. A library such as Yjs
can carry the document and the selections (awareness), but edits are still not merged character by character. See the
[guide](https://nuvra-docs.vercel.app/docs/collaboration).

## Commands and toolbar buttons

Typing `/` at the start of a line or after a space opens a command menu: headings, lists, table, page and section breaks, footnote,
table of contents, dates, signature blocks and your variables. `slashCommands` adds your own commands at the top, and the
`toolbar` slot adds your own buttons:

```vue
<script setup lang="ts">
import { DocumentEditor, type SlashCommand } from 'nuvra';

const slashCommands: SlashCommand[] = [
  { id: 'director', label: 'Director’s name', icon: 'pencil', run: engine => engine.insertText('A. Karimov') }
];
</script>

<template>
  <DocumentEditor v-model="html" :slash-commands="slashCommands">
    <template #toolbar="{ engine, disabled }">
      <button type="button" class="doc-tb-button" :disabled="disabled" @mousedown.prevent @click="engine.insertText('✓')">
        ✓
      </button>
    </template>
  </DocumentEditor>
</template>
```

### Choosing the toolbar tools

The `tools` prop shows only the toolbar tools you list, in their usual order; without it every tool is shown. Groups left
without a tool disappear together with their dividers, and the `toolbar` slot is always shown. Keyboard shortcuts, the
`/` menu and the right-click menu are not affected.

```vue
<DocumentEditor v-model="html" :tools="['history', 'blockStyle', 'marks', 'lists', 'link', 'table']" />
```

The tools are `history` (undo, redo), `formatPainter`, `blockStyle`, `fontFamily`, `fontSize`, `marks` (bold, italic,
underline and more), `textCase`, `color`, `highlight`, `align`, `lineHeight`, `direction`, `lists`, `indent`, `link`,
`image`, `table`, `specialCharacters`, `variables`, `signature`, `insert`, `review`, `search`, `templates`,
`headerFooter`, `pageSetup` and `more`. `TOOLBAR_TOOLS` lists them all, and `Editor` takes the same prop.

## Languages

The interface ships in Uzbek (`uz`, the default), Uzbek Cyrillic (`uzCyrl`), English (`en`) and Russian (`ru`). The translations are part of
the package and cannot be changed from outside; an app only picks the language.

For one editor, pass the locale (or just its code) to the `locale` prop:

```vue
<script setup lang="ts">
import { DocumentEditor, ru } from 'nuvra';
</script>

<template>
  <DocumentEditor v-model="html" :locale="ru" />
</template>
```

For the whole app, call `setEditorLocale` once, for example in `main.ts`. It is reactive, so calling it again from a
language switcher updates editors already on the page:

```ts
import { en, setEditorLocale } from 'nuvra';

setEditorLocale(en);
```

The `locale` prop wins over `setEditorLocale`; without either the editor is in Uzbek. `editorLocales` lists every
built-in locale with its name, for language pickers.

## Theming

Colors come from CSS variables declared on `.document-editor` with zero specificity, so any rule that targets
`.document-editor` overrides them, whatever order the stylesheets load in. Set them on the editor element itself:
values on an ancestor such as `body` do not apply, because the editor declares its own.

```css
.document-editor {
  --nuvra-color-primary: #7c3aed;
  --nuvra-color-primary-hover: #8b5cf6;
  --nuvra-color-primary-border: #c4b5fd;
  --nuvra-color-primary-muted: #ddd6fe;
  --nuvra-color-primary-soft: #f5f3ff;
}
```

| Variable                        | Used for                                             |
| ------------------------------- | ---------------------------------------------------- |
| `--nuvra-color-primary`         | Active buttons, focus, primary buttons, selection    |
| `--nuvra-color-primary-hover`   | Hovered primary buttons                              |
| `--nuvra-color-primary-border`  | Focused editor frame, disabled primary buttons       |
| `--nuvra-color-primary-muted`   | Table size preview, hovered button borders           |
| `--nuvra-color-primary-soft`    | Active button and menu item backgrounds              |
| `--nuvra-color-on-primary`      | Text on primary buttons                              |
| `--nuvra-color-danger`          | Destructive actions, character limit reached         |
| `--nuvra-color-danger-soft`     | Hovered destructive actions                          |
| `--nuvra-text-strong`           | Headings in forms                                    |
| `--nuvra-text`                  | Regular text and icons                               |
| `--nuvra-text-muted`            | Labels, captions, status bar                         |
| `--nuvra-text-placeholder`      | Placeholders, shortcut hints                         |
| `--nuvra-text-disabled`         | Disabled buttons                                     |
| `--nuvra-border`                | Editor frame, inputs                                 |
| `--nuvra-border-hover`          | Hovered inputs                                       |
| `--nuvra-border-light`          | Popovers and floating panels                         |
| `--nuvra-border-lighter`        | Dividers                                             |
| `--nuvra-fill`                  | Hovered buttons, segmented controls                  |
| `--nuvra-bg`                    | Toolbar, status bar, inputs                          |
| `--nuvra-bg-overlay`            | Popovers, menus, find bar                            |
| `--nuvra-shadow`                | Popovers and floating panels                         |
| `--nuvra-fullscreen-z-index`    | Stacking order of the fullscreen editor (`2000`)     |

A dark palette is applied when an ancestor (usually `<html>`) has the `dark` class or `data-theme="dark"`. To change
dark values separately, target `.dark .document-editor`.

To follow an Element Plus theme, map the variables to its own:

```css
.document-editor {
  --nuvra-color-primary: var(--el-color-primary);
  --nuvra-color-primary-soft: var(--el-color-primary-light-9);
  --nuvra-text: var(--el-text-color-regular);
  --nuvra-border: var(--el-border-color);
  --nuvra-bg: var(--el-bg-color);
}
```

## Browser support

Popovers, menus and bubble toolbars use the [Popover API](https://developer.mozilla.org/docs/Web/API/Popover_API)
(Chrome/Edge 114+, Safari 17+, Firefox 125+), which keeps them above dialogs and the fullscreen editor. Older browsers
show them as fixed elements instead. Search highlighting uses the CSS Custom Highlight API.

## License

[MIT](./LICENSE). Icon shapes come from [Lucide](https://lucide.dev) (ISC).
