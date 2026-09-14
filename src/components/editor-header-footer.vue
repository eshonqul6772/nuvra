<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';

import { type EditorLabelKey, useEditorLabels } from '../core/labels';
import {
  HEADER_FOOTER_TOKENS,
  type HeaderFooterToken,
  type PageHeaderFooter,
  type PageSettings,
  createHeaderFooter,
  hasHeaderFooterText
} from '../core/page';

/**
 * Header and footer form shown in a toolbar popover: three aligned parts for each, plus the tokens that become the
 * page number, the number of pages, the date or the document title on every page.
 */
defineOptions({ name: 'EditorHeaderFooter' });

const { t } = useEditorLabels();

interface Props {
  /** Settings currently applied to the document. */
  page: PageSettings;
}

interface Emits {
  /** Emitted with the full updated settings after any change. */
  change: [page: PageSettings];
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

/** The running text at the top and at the bottom of a page. */
type RunningArea = 'header' | 'footer';

/** Both running texts with their headings. */
const AREAS = [
  { key: 'header', label: 'editor.header' },
  { key: 'footer', label: 'editor.footer' }
] as const satisfies ReadonlyArray<{ key: RunningArea; label: EditorLabelKey }>;

/** Tokens offered as buttons under the fields; aliased so the template sees a value, not a type. */
const TOKENS = HEADER_FOOTER_TOKENS;

/** The three aligned parts of a running text. */
const PARTS = [
  { key: 'left', label: 'editor.headerFooter.left' },
  { key: 'center', label: 'editor.headerFooter.center' },
  { key: 'right', label: 'editor.headerFooter.right' }
] as const satisfies ReadonlyArray<{ key: keyof PageHeaderFooter; label: EditorLabelKey }>;

/** Field a token is written into: the one that had focus last. */
const activeField = ref<{ area: RunningArea; part: keyof PageHeaderFooter }>({ area: 'header', part: 'center' });
/** The inputs by `area.part`, so a token can be inserted at the caret. */
const inputs = ref<Record<string, HTMLInputElement | undefined>>({});

/** Whether the document has any running text at all. */
const hasAny = computed(() => hasHeaderFooterText(props.page.header) || hasHeaderFooterText(props.page.footer));

/** Current text of one part. */
const partText = (area: RunningArea, part: keyof PageHeaderFooter) => props.page[area]?.[part] ?? '';

/** Writes one part of a running text; a header or footer left empty is dropped from the settings. */
const setPart = (area: RunningArea, part: keyof PageHeaderFooter, text: string) => {
  const next: PageHeaderFooter = { ...createHeaderFooter(), ...props.page[area], [part]: text };
  emit('change', { ...props.page, [area]: hasHeaderFooterText(next) ? next : undefined });
};

/** Applies what the user typed into one field. */
const onInput = (area: RunningArea, part: keyof PageHeaderFooter, event: Event) => {
  setPart(area, part, (event.target as HTMLInputElement).value);
};

/** Inserts a token at the caret of the field that was focused last, and puts the caret after it. */
const insertToken = async (token: HeaderFooterToken) => {
  const { area, part } = activeField.value;
  const input = inputs.value[`${area}.${part}`];
  const text = partText(area, part);
  const start = input?.selectionStart ?? text.length;
  const end = input?.selectionEnd ?? start;
  const placeholder = `{${token}}`;
  setPart(area, part, `${text.slice(0, start)}${placeholder}${text.slice(end)}`);
  await nextTick();
  input?.focus();
  input?.setSelectionRange(start + placeholder.length, start + placeholder.length);
};

/** Removes both running texts. */
const clear = () => emit('change', { ...props.page, header: undefined, footer: undefined });
</script>

<template>
  <div class="header-footer">
    <section v-for="area in AREAS" :key="area.key" class="header-footer__section">
      <h4>{{ t(area.label) }}</h4>
      <div class="header-footer__grid">
        <label v-for="part in PARTS" :key="part.key" class="header-footer__field">
          <span>{{ t(part.label) }}</span>
          <input
            :ref="element => { inputs[`${area.key}.${part.key}`] = element as HTMLInputElement }"
            class="doc-input"
            type="text"
            :value="partText(area.key, part.key)"
            @focus="activeField = { area: area.key, part: part.key }"
            @input="onInput(area.key, part.key, $event)"
          />
        </label>
      </div>
    </section>

    <div class="header-footer__tokens">
      <span class="header-footer__caption">{{ t('editor.headerFooter.tokens') }}</span>
      <button
        v-for="token in TOKENS"
        :key="token"
        type="button"
        class="doc-btn"
        @mousedown.prevent
        @click="insertToken(token)"
      >
        {{ t(`editor.headerFooter.token.${token}`) }}
      </button>
    </div>

    <div class="header-footer__actions">
      <span class="header-footer__caption">{{ t('editor.headerFooter.hint') }}</span>
      <button type="button" class="doc-btn doc-btn--danger-text" :disabled="!hasAny" @click="clear">
        {{ t('editor.headerFooter.clear') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.header-footer {
  display: grid;
  gap: 12px;
  color: var(--nuvra-text);
}

.header-footer__section {
  display: grid;
  gap: 6px;
}

.header-footer__section h4 {
  margin: 0;
  color: var(--nuvra-text-strong);
  font-size: 12px;
  font-weight: 600;
}

.header-footer__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.header-footer__field {
  display: grid;
  gap: 3px;
  color: var(--nuvra-text-muted);
  font-size: 11px;
}

/* Token buttons and the hint below them. */
.header-footer__tokens {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.header-footer__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.header-footer__caption {
  color: var(--nuvra-text-muted);
  font-size: 11px;
}
</style>
