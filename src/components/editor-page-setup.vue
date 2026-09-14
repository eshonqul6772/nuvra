<script setup lang="ts">
import { computed } from 'vue';

import { useEditorLabels } from '../core/labels';
import {
  MARGIN_PRESETS,
  PAGE_SIZES,
  type PageMargins,
  type PageOrientation,
  type PageSettings,
  type PageSizeKey,
  type PageWatermark,
  createWatermark,
  hasWatermarkText,
  isSameMargins
} from '../core/page';
import EditorIcon from './editor-icon.vue';

/**
 * Page setup form shown in the toolbar popover: paper size, orientation, margin presets and exact margins.
 * Every change emits a complete new settings object.
 */
defineOptions({ name: 'EditorPageSetup' });

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

/** Paper sizes in the order they are declared. */
const SIZE_KEYS = Object.keys(PAGE_SIZES) as PageSizeKey[];
/** Orientation options with their icons and label keys. */
const ORIENTATIONS = [
  { value: 'portrait', icon: 'rectangle-vertical', label: 'editor.page.portrait' },
  { value: 'landscape', icon: 'rectangle-horizontal', label: 'editor.page.landscape' }
] as const;
/** Exact margin inputs, one per page side. */
const MARGIN_FIELDS = [
  { side: 'top', label: 'editor.page.marginTop' },
  { side: 'bottom', label: 'editor.page.marginBottom' },
  { side: 'left', label: 'editor.page.marginLeft' },
  { side: 'right', label: 'editor.page.marginRight' }
] as const;
/** Limits of the exact margin inputs, in millimetres, and the number of decimals kept. */
const MARGIN_INPUT = { min: 0, max: 100, step: 1, precision: 1 } as const;
const MARGIN_ROUNDING = 10 ** MARGIN_INPUT.precision;

/** Emits the current settings with `patch` applied. */
const update = (patch: Partial<PageSettings>) => emit('change', { ...props.page, ...patch });

/** Switches the paper size. */
const setSize = (size: PageSizeKey) => update({ size });

/** Switches between portrait and landscape. */
const setOrientation = (orientation: PageOrientation) => update({ orientation });

/** Applies a margin preset; the preset object is copied so it can never be mutated. */
const setMargins = (margins: PageMargins) => update({ margins: { ...margins } });

/** Keeps a typed margin within the input limits and rounds it; a cleared or invalid input counts as zero. */
const normalizeMargin = (value: number) => {
  if (!Number.isFinite(value)) return MARGIN_INPUT.min;
  const clamped = Math.min(MARGIN_INPUT.max, Math.max(MARGIN_INPUT.min, value));
  return Math.round(clamped * MARGIN_ROUNDING) / MARGIN_ROUNDING;
};

/** Applies a typed margin and shows the value that was actually applied. */
const onMarginChange = (side: keyof PageMargins, event: Event) => {
  const input = event.target as HTMLInputElement;
  const value = normalizeMargin(input.valueAsNumber);
  input.value = String(value);
  update({ margins: { ...props.page.margins, [side]: value } });
};

/** Watermark of the document, or an empty one while it has none. */
const watermark = computed(() => props.page.watermark ?? createWatermark());

/** Applies a watermark change; a watermark left without text is dropped from the settings. */
const updateWatermark = (patch: Partial<PageWatermark>) => {
  const next = { ...watermark.value, ...patch };
  update({ watermark: hasWatermarkText(next) ? next : undefined });
};

/** Tooltip listing the four margins of a preset in millimetres. */
const describeMargins = ({ top, bottom, left, right }: PageMargins) =>
  [
    `${t('editor.page.marginTop')} ${top}`,
    `${t('editor.page.marginBottom')} ${bottom}`,
    `${t('editor.page.marginLeft')} ${left}`,
    `${t('editor.page.marginRight')} ${right} mm`
  ].join(' · ');
</script>

<template>
  <div class="page-setup">
    <section class="page-setup__section">
      <h4>{{ t('editor.page.size') }}</h4>
      <div class="page-setup__grid page-setup__grid--sizes">
        <button
          v-for="key in SIZE_KEYS"
          :key="key"
          type="button"
          class="page-setup__chip"
          :class="{ 'is-active': page.size === key }"
          :aria-pressed="page.size === key"
          @click="setSize(key)"
        >
          <strong>{{ PAGE_SIZES[key].label }}</strong>
          <small>{{ PAGE_SIZES[key].width }}×{{ PAGE_SIZES[key].height }}</small>
        </button>
      </div>
    </section>

    <section class="page-setup__section">
      <h4>{{ t('editor.page.orientation') }}</h4>
      <div class="page-setup__grid">
        <button
          v-for="orientation in ORIENTATIONS"
          :key="orientation.value"
          type="button"
          class="page-setup__chip page-setup__chip--row"
          :class="{ 'is-active': page.orientation === orientation.value }"
          :aria-pressed="page.orientation === orientation.value"
          @click="setOrientation(orientation.value)"
        >
          <EditorIcon :name="orientation.icon" :size="16" />
          {{ t(orientation.label) }}
        </button>
      </div>
    </section>

    <section class="page-setup__section">
      <h4>{{ t('editor.page.margins') }}</h4>
      <div class="page-setup__grid page-setup__grid--presets">
        <button
          v-for="preset in MARGIN_PRESETS"
          :key="preset.key"
          type="button"
          class="page-setup__chip"
          :class="{ 'is-active': isSameMargins(preset.margins, page.margins) }"
          :title="describeMargins(preset.margins)"
          @click="setMargins(preset.margins)"
        >
          {{ t(`editor.page.margins.${preset.key}`) }}
        </button>
      </div>
      <span class="page-setup__caption">{{ t('editor.page.customMargins') }}</span>
      <div class="page-setup__grid">
        <label v-for="field in MARGIN_FIELDS" :key="field.side" class="page-setup__field">
          <span>{{ t(field.label) }}</span>
          <input
            class="doc-input"
            type="number"
            inputmode="decimal"
            :min="MARGIN_INPUT.min"
            :max="MARGIN_INPUT.max"
            :step="MARGIN_INPUT.step"
            :value="page.margins[field.side]"
            @change="onMarginChange(field.side, $event)"
          />
        </label>
      </div>
    </section>

    <section class="page-setup__section">
      <h4>{{ t('editor.page.watermark') }}</h4>
      <input
        class="doc-input"
        type="text"
        :placeholder="t('editor.page.watermarkText')"
        :aria-label="t('editor.page.watermarkText')"
        :value="watermark.text"
        @input="updateWatermark({ text: ($event.target as HTMLInputElement).value })"
      />
      <div class="page-setup__grid">
        <label class="page-setup__field">
          <span>{{ t('editor.page.watermarkColor') }}</span>
          <input
            class="doc-input page-setup__color"
            type="color"
            :value="watermark.color"
            @input="updateWatermark({ color: ($event.target as HTMLInputElement).value })"
          />
        </label>
        <label class="doc-checkbox page-setup__checkbox">
          <input
            type="checkbox"
            :checked="watermark.diagonal"
            @change="updateWatermark({ diagonal: ($event.target as HTMLInputElement).checked })"
          />
          {{ t('editor.page.watermarkDiagonal') }}
        </label>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page-setup {
  display: grid;
  gap: 12px;
  color: var(--nuvra-text);
}

.page-setup__section {
  display: grid;
  gap: 6px;
}

.page-setup__section h4 {
  margin: 0;
  color: var(--nuvra-text-strong);
  font-size: 12px;
  font-weight: 600;
}

/* Two columns by default; paper sizes and margin presets use three. */
.page-setup__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.page-setup__grid--sizes,
.page-setup__grid--presets {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

/* Selectable option buttons. */
.page-setup__chip {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 5px 8px;
  border: 1px solid var(--nuvra-border);
  border-radius: 6px;
  color: inherit;
  background: transparent;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.page-setup__chip:hover {
  border-color: var(--nuvra-color-primary-border);
}

.page-setup__chip.is-active {
  border-color: var(--nuvra-color-primary);
  color: var(--nuvra-color-primary);
  background: var(--nuvra-color-primary-soft);
}

.page-setup__chip--row {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

.page-setup__chip small {
  color: var(--nuvra-text-muted);
  font-size: 10px;
  white-space: nowrap;
}

/* Exact margin inputs. */
.page-setup__caption {
  margin-top: 4px;
  color: var(--nuvra-text-muted);
  font-size: 11px;
}

.page-setup__field {
  display: grid;
  gap: 3px;
  color: var(--nuvra-text-muted);
  font-size: 11px;
}

/* Watermark colour and its diagonal switch. */
.page-setup__color {
  height: 28px;
  padding: 2px;
}

.page-setup__checkbox {
  align-self: end;
  padding-bottom: 4px;
}
</style>
