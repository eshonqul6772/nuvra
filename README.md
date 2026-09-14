# nuvra

Word-style document editor for Vue 3. A real page view with paper sizes and margins, a lighter web view for
forms, tables, images, lists, find & replace, HTML source mode, printing and export to HTML or Word (`.doc`).

**[Documentation and live demo →](https://nuvra-docs.vercel.app)**

- No editor framework underneath: its own small editing engine with a sanitizing schema.
- No UI framework either: native HTML controls, built-in SVG icons and plain CSS variables. Vue is the only
  dependency.
- Pagination in the page view (A4, A5, Letter, …, portrait or landscape).
- Tables with merge / split, images with resize and alignment, task lists, links, colors, fonts.
- Undo / redo, keyboard shortcuts that work with non-Latin keyboard layouts, Markdown-like input rules.
- Office tools: format painter, letter case, paragraph spacing, formatting marks, a right-click menu and
  Ctrl + wheel zoom.
- Headers and footers with page number, page count, date and title tokens; printing breaks the pages exactly where
  the editor shows them, and the Word export uses Word's own header, footer and page fields.
- A ruler above the page for the margins and for the first line, left and right indents of a paragraph.
- A page watermark such as DRAFT or COPY, drawn behind the text of every page and carried into print, HTML and Word.

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
| `v-model:page`    | `PageSettings`                    | A4       | Paper size, orientation and margins.                                       |
| `autofocus`       | `boolean`                         | `false`  | Places the caret at the end of the document once ready.                    |
| `canvasPadding`   | `number \| string`                | `50`     | Gray space around the page or web sheet.                                   |
| `defaultViewMode` | `'page' \| 'web'`                 | `'page'` | View shown first.                                                          |
| `disabled`        | `boolean`                         | `false`  | Read-only document, disabled controls.                                     |
| `height`          | `number \| string`                | `760`    | Height of the editor, or `'auto'` to grow between `minHeight`/`maxHeight`. |
| `locale`          | `EditorLocale \| 'uz' \| 'en' \| 'ru'` | —   | Interface language; defaults to the app-wide language (Uzbek).             |
| `minHeight`       | `number \| string`                | `240`    | Smallest height of an auto-height editor.                                  |
| `maxHeight`       | `number \| string`                | `600`    | Largest height of an auto-height editor.                                   |
| `maxImageSizeMb`  | `number`                          | `10`     | Largest accepted image file.                                               |
| `maxLength`       | `number`                          | `0`      | Character limit; `0` means unlimited.                                      |
| `placeholder`     | `string`                          | `''`     | Text shown while the document is empty.                                    |
| `title`           | `string`                          | `''`     | Print title and exported file name.                                        |
| `uploadImage`     | `(file: File) => Promise<string>` | —        | Uploads an image and resolves with its URL.                                |

`Editor` accepts the same props except `v-model:page`, `defaultViewMode`, `height` and `title`.

Numbers are pixels; strings are used as CSS lengths (`'100%'`, `'50vh'`).

### Events

| Event         | Payload          | Description                                       |
| ------------- | ---------------- | ------------------------------------------------- |
| `focus`       | —                | The document received focus.                      |
| `blur`        | —                | The document lost focus; the model is up to date. |
| `uploadError` | `error: unknown` | An image was rejected or its upload failed.       |

### Exposed methods (`DocumentEditor` ref)

| Method         | Description                                                      |
| -------------- | ---------------------------------------------------------------- |
| `focus()`      | Moves keyboard focus into the document.                          |
| `getHTML()`    | Returns the document HTML, including edits not yet in the model. |
| `print()`      | Opens the browser print dialog.                                  |
| `exportHtml()` | Downloads the document as an HTML page.                          |
| `exportWord()` | Downloads the document as a Word-compatible `.doc` file.         |
| `engine`       | The editing engine, for advanced integrations.                   |

### Keyboard shortcuts

`Ctrl/⌘+B`, `I`, `U` — bold, italic, underline · `Ctrl/⌘+Shift+H` — highlight · `Ctrl/⌘+Z`, `Ctrl/⌘+Shift+Z` — undo,
redo · `Ctrl/⌘+F` — find · `Ctrl/⌘+H` — replace · `Ctrl/⌘+K` — link · `Ctrl/⌘+P` — print.

The full list, with Markdown-like input rules, is in the
[keyboard shortcuts guide](https://nuvra-docs.vercel.app/docs/keyboard-shortcuts).

## Languages

The interface ships in Uzbek (`uz`, the default), English (`en`) and Russian (`ru`). The translations are part of
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
