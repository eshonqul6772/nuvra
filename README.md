# nuvra

Word-style document editor for Vue 3. A real page view with paper sizes and margins, a lighter web view for
forms, tables, images, lists, find & replace, HTML source mode, printing and export to HTML or Word (`.doc`).

- No editor framework underneath: its own small editing engine with a sanitizing schema.
- Pagination in the page view (A4, A5, Letter, …, portrait or landscape).
- Tables with merge / split, images with resize and alignment, task lists, links, colors, fonts.
- Undo / redo, keyboard shortcuts that work with non-Latin keyboard layouts, Markdown-like input rules.
- Built on [Element Plus](https://element-plus.org) controls and [Lucide](https://lucide.dev) icons.

## Installation

```sh
pnpm add nuvra element-plus
# or
npm install nuvra element-plus
```

`vue` (3.5+) and `element-plus` (2.9+) are peer dependencies.

Import the styles once, next to the Element Plus styles:

```ts
import 'element-plus/dist/index.css';
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

| Prop              | Type                                    | Default  | Description                                                              |
| ----------------- | --------------------------------------- | -------- | ------------------------------------------------------------------------ |
| `v-model`         | `string`                                | `''`     | Document HTML; an empty document is an empty string.                     |
| `v-model:page`    | `PageSettings`                          | A4       | Paper size, orientation and margins.                                     |
| `autofocus`       | `boolean`                               | `false`  | Places the caret at the end of the document once ready.                  |
| `canvasPadding`   | `number \| string`                      | `50`     | Gray space around the page or web sheet.                                 |
| `defaultViewMode` | `'page' \| 'web'`                       | `'page'` | View shown first.                                                        |
| `disabled`        | `boolean`                               | `false`  | Read-only document, disabled controls.                                   |
| `height`          | `number \| string`                      | `760`    | Height of the editor, or `'auto'` to grow between `minHeight`/`maxHeight`. |
| `minHeight`       | `number \| string`                      | `240`    | Smallest height of an auto-height editor.                                |
| `maxHeight`       | `number \| string`                      | `600`    | Largest height of an auto-height editor.                                 |
| `maxImageSizeMb`  | `number`                                | `10`     | Largest accepted image file.                                             |
| `maxLength`       | `number`                                | `0`      | Character limit; `0` means unlimited.                                    |
| `placeholder`     | `string`                                | `''`     | Text shown while the document is empty.                                  |
| `title`           | `string`                                | `''`     | Print title and exported file name.                                      |
| `uploadImage`     | `(file: File) => Promise<string>`       | —        | Uploads an image and resolves with its URL.                              |

`Editor` accepts the same props except `v-model:page`, `defaultViewMode`, `height` and `title`.

Numbers are pixels; strings are used as CSS lengths (`'100%'`, `'50vh'`).

### Events

| Event         | Payload          | Description                                   |
| ------------- | ---------------- | --------------------------------------------- |
| `focus`       | —                | The document received focus.                  |
| `blur`        | —                | The document lost focus; the model is up to date. |
| `uploadError` | `error: unknown` | An image was rejected or its upload failed.   |

### Exposed methods (`DocumentEditor` ref)

| Method         | Description                                                    |
| -------------- | -------------------------------------------------------------- |
| `focus()`      | Moves keyboard focus into the document.                        |
| `getHTML()`    | Returns the document HTML, including edits not yet in the model. |
| `print()`      | Opens the browser print dialog.                                |
| `exportHtml()` | Downloads the document as an HTML page.                        |
| `exportWord()` | Downloads the document as a Word-compatible `.doc` file.       |
| `engine`       | The editing engine, for advanced integrations.                 |

### Keyboard shortcuts

`Ctrl/⌘+B`, `I`, `U` — bold, italic, underline · `Ctrl/⌘+Z`, `Ctrl/⌘+Shift+Z` — undo, redo ·
`Ctrl/⌘+F` — find · `Ctrl/⌘+H` — replace · `Ctrl/⌘+K` — link · `Ctrl/⌘+P` — print.

## Translations

Built-in labels are in Uzbek. Every label has a key such as `editor.bold`; the full list with default texts is
exported as `editorMessages`. Register a translator once, before the app mounts. Returning `undefined` keeps the
built-in text for that key.

```ts
import { setEditorTranslator } from 'nuvra';

const en: Record<string, string> = {
  'editor.bold': 'Bold',
  'editor.status.words': '{count} words'
};

setEditorTranslator((key, named) =>
  en[key]?.replace(/\{(\w+)\}/g, (_, name) => String(named?.[name] ?? ''))
);
```

With `vue-i18n`, labels follow the active locale:

```ts
import { setEditorTranslator } from 'nuvra';
import { i18n } from './i18n';

setEditorTranslator((key, named) => (i18n.global.te(key) ? i18n.global.t(key, named ?? {}) : undefined));
```

## Theming

The editor uses Element Plus CSS variables (`--el-color-primary`, `--el-border-color`, `--el-bg-color`, …), so it
follows your Element Plus theme and dark mode.

## License

[MIT](./LICENSE)
