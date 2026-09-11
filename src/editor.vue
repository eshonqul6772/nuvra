<script setup lang="ts">
import DocumentEditor from './components/document-editor.vue';
import type { DocumentImageUploadHandler } from './core/types';

/**
 * Rich text field for forms: a wrapper around the document editor in the web view, growing with its content
 * between `minHeight` and `maxHeight`.
 */
defineOptions({ name: 'RichTextEditor' });

interface Props {
  /** Places the caret at the end of the content once the editor is ready. */
  autofocus?: boolean;
  /** Gray space around the sheet, in pixels or any CSS length. */
  canvasPadding?: number | string;
  /** Makes the content read-only and disables the toolbar. */
  disabled?: boolean;
  /** Height at which the field stops growing and starts scrolling. */
  maxHeight?: number | string;
  /** Largest accepted image file, in megabytes. */
  maxImageSizeMb?: number;
  /** Character limit; 0 means unlimited. */
  maxLength?: number;
  /** Smallest height of the field, including the gray space around the sheet. */
  minHeight?: number | string;
  /** Text shown while the field is empty. */
  placeholder?: string;
  /** Uploads an image and resolves with its URL; without it images are embedded as data URLs. */
  uploadImage?: DocumentImageUploadHandler;
}

interface Emits {
  /** The editable area lost focus. */
  blur: [];
  /** The editable area received focus. */
  focus: [];
  /** An image was rejected or could not be uploaded. */
  uploadError: [error: unknown];
}

withDefaults(defineProps<Props>(), {
  autofocus: false,
  canvasPadding: 50,
  disabled: false,
  maxHeight: 600,
  maxImageSizeMb: 10,
  maxLength: 0,
  minHeight: 240,
  placeholder: '',
  uploadImage: undefined
});

const emit = defineEmits<Emits>();
/** Field value as sanitized HTML; an empty document is an empty string. */
const model = defineModel<string>({ default: '' });
</script>

<template>
  <DocumentEditor
    v-model="model"
    class="rich-text-editor"
    default-view-mode="web"
    height="auto"
    :autofocus="autofocus"
    :canvas-padding="canvasPadding"
    :disabled="disabled"
    :max-height="maxHeight"
    :max-image-size-mb="maxImageSizeMb"
    :max-length="maxLength"
    :min-height="minHeight"
    :placeholder="placeholder"
    :upload-image="uploadImage"
    @blur="emit('blur')"
    @focus="emit('focus')"
    @upload-error="emit('uploadError', $event)"
  />
</template>
