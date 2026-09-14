<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import { templateVariableLabel } from './core/document-templates';
import { VARIABLE_ATTRIBUTE, VARIABLE_SELECTOR } from './core/engine/dom';
import { cleanEditorArtifacts, sanitizeHtml } from './core/engine/schema';
import { type EditorLocaleInput, useEditorLabels } from './core/labels';
import { type FillTemplateOptions, type TemplateVariable, fillTemplate } from './core/templates';

import './styles/document-content.css';
import './styles/editor-ui.css';

/**
 * A template filled in like a form: the document is shown as it will be printed and only its variables are fields to
 * type into. Every field of the same variable shares one value, so a name used three times is typed once.
 */
defineOptions({ name: 'DocumentForm' });

interface Props {
  /** Template HTML as saved by the editor, with its variables. */
  template: string;
  /** Labels shown in empty fields; built-in template variables are labelled without it. */
  variables?: readonly TemplateVariable[];
  /** Interface language: a built-in locale or its code; defaults to the app-wide language. */
  locale?: EditorLocaleInput;
  /** Shows the values without letting them change. */
  readonly?: boolean;
}

const props = withDefaults(defineProps<Props>(), { variables: () => [], locale: undefined, readonly: false });

/** Values by variable name. */
const values = defineModel<Record<string, string>>({ default: () => ({}) });

const { locale } = useEditorLabels(() => props.locale);

const sheetRef = ref<HTMLElement>();
/** Variables whose field was left empty after the last validation. */
const invalid = ref<ReadonlySet<string>>(new Set());

/** Smallest width of a field, in characters, so an empty field still shows its label. */
const MIN_FIELD_CHARACTERS = 6;

/** Text shown in an empty field of a variable. */
const labelOf = (name: string) =>
  props.variables.find(variable => variable.name === name)?.label ?? templateVariableLabel(name, locale.value) ?? name;

/** Template HTML with every variable as an empty field element, sanitised like editor content. */
const sheetHtml = computed(() => {
  const container = document.createElement('div');
  container.append(sanitizeHtml(props.template));
  cleanEditorArtifacts(container, true);
  for (const chip of Array.from(container.querySelectorAll<HTMLElement>(VARIABLE_SELECTOR))) {
    chip.textContent = '';
    chip.className = 'doc-form-field';
  }
  return container.innerHTML;
});

/** Fits a field's width to its text. */
const fitWidth = (input: HTMLInputElement) => {
  const length = Math.max(MIN_FIELD_CHARACTERS, (input.value || input.placeholder).length + 1);
  input.style.width = `${length}ch`;
};

/** Writes the current values into every field and marks empty ones found by the last validation. */
const syncFields = () => {
  for (const input of Array.from(sheetRef.value?.querySelectorAll<HTMLInputElement>('input[data-field]') ?? [])) {
    const name = input.dataset.field ?? '';
    const value = values.value[name] ?? '';
    if (input.value !== value) input.value = value;
    input.readOnly = props.readonly;
    input.classList.toggle('is-invalid', invalid.value.has(name) && !value);
    fitWidth(input);
  }
};

/** Puts an input into every variable of the rendered template. */
const buildFields = () => {
  for (const holder of Array.from(sheetRef.value?.querySelectorAll<HTMLElement>('.doc-form-field') ?? [])) {
    const name = holder.getAttribute(VARIABLE_ATTRIBUTE) ?? '';
    const input = document.createElement('input');
    input.type = 'text';
    input.dataset.field = name;
    input.placeholder = labelOf(name);
    input.title = labelOf(name);
    input.setAttribute('aria-label', labelOf(name));
    input.addEventListener('input', () => {
      values.value = { ...values.value, [name]: input.value };
    });
    holder.replaceChildren(input);
  }
  syncFields();
};

watch(sheetHtml, async () => {
  await nextTick();
  buildFields();
});
watch([values, () => props.readonly, invalid], syncFields, { deep: true });
/** Field labels follow the variable list and the language. */
watch([() => props.variables, locale], buildFields, { deep: true });
onMounted(buildFields);

/** Names of the template's variables, each once, in document order. */
const fieldNames = () => [
  ...new Set(
    Array.from(sheetRef.value?.querySelectorAll<HTMLInputElement>('input[data-field]') ?? []).map(
      input => input.dataset.field ?? ''
    )
  )
];

defineExpose({
  /** The filled document HTML; variables without a value follow `options.missing`. */
  getHTML: (options?: FillTemplateOptions) => fillTemplate(props.template, values.value, options),
  /**
   * Marks the fields left empty and focuses the first of them.
   * @returns names of the variables without a value; an empty list when the form is complete.
   */
  validate: (): string[] => {
    const missing = fieldNames().filter(name => !values.value[name]?.trim());
    invalid.value = new Set(missing);
    const first = missing[0];
    if (first) sheetRef.value?.querySelector<HTMLInputElement>(`input[data-field="${CSS.escape(first)}"]`)?.focus();
    return missing;
  }
});
</script>

<template>
  <section class="document-form">
    <!-- The template is sanitised before it is rendered; fields are added as DOM inputs. -->
    <article ref="sheetRef" class="doc-content document-form__sheet" v-html="sheetHtml" />
  </section>
</template>

<style scoped>
.document-form {
  box-sizing: border-box;
  padding: 24px;
  overflow: auto;
  border: 1px solid var(--nuvra-border, #dcdfe6);
  border-radius: 10px;
  background: #e9ebef;
}

.document-form__sheet {
  box-sizing: border-box;
  max-width: 794px;
  margin: 0 auto;
  padding: 48px 56px;
  background: #fff;
  box-shadow:
    0 0 0 1px rgb(16 24 40 / 6%),
    0 2px 8px rgb(16 24 40 / 10%);
}

.document-form__sheet :deep(.doc-form-field input) {
  box-sizing: content-box;
  max-width: 100%;
  margin: 0 1px;
  padding: 0 3px;
  border: 0;
  border-bottom: 1px solid #409eff;
  border-radius: 2px 2px 0 0;
  outline: none;
  color: inherit;
  background: #ecf5ff;
  font: inherit;
  line-height: inherit;
}

.document-form__sheet :deep(.doc-form-field input:focus) {
  background: #d9ecff;
  box-shadow: 0 1px 0 #409eff;
}

.document-form__sheet :deep(.doc-form-field input::placeholder) {
  color: #79bbff;
}

.document-form__sheet :deep(.doc-form-field input.is-invalid) {
  border-bottom-color: #f56c6c;
  background: #fef0f0;
}

.document-form__sheet :deep(.doc-form-field input:read-only) {
  border-bottom-color: transparent;
  background: transparent;
}

@media (max-width: 640px) {
  .document-form {
    padding: 8px;
  }

  .document-form__sheet {
    padding: 20px 16px;
  }
}
</style>
