<script setup lang="ts">
import { RectangleHorizontal, RectangleVertical } from '@lucide/vue';
import { ElInputNumber } from 'element-plus';

import { t } from '../core/labels';
import {
  MARGIN_PRESETS,
  PAGE_SIZES,
  type PageMargins,
  type PageOrientation,
  type PageSettings,
  type PageSizeKey,
  isSameMargins
} from '../core/page';

/**
 * Page setup form shown in the toolbar popover: paper size, orientation, margin presets and exact margins.
 * Every change emits a complete new settings object.
 */
defineOptions({ name: 'EditorPageSetup' });

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
  { value: 'portrait', icon: RectangleVertical, label: 'editor.page.portrait' },
  { value: 'landscape', icon: RectangleHorizontal, label: 'editor.page.landscape' }
] as const;
/** Exact margin inputs, one per page side. */
const MARGIN_FIELDS = [
  { side: 'top', label: 'editor.page.marginTop' },
  { side: 'bottom', label: 'editor.page.marginBottom' },
  { side: 'left', label: 'editor.page.marginLeft' },
  { side: 'right', label: 'editor.page.marginRight' }
] as const;
/** Limits of the exact margin inputs, in millimetres. */
const MARGIN_INPUT = { min: 0, max: 100, step: 1, precision: 1 } as const;

/** Emits the current settings with `patch` applied. */
const update = (patch: Partial<PageSettings>) => emit('change', { ...props.page, ...patch });

/** Switches the paper size. */
const setSize = (size: PageSizeKey) => update({ size });

/** Switches between portrait and landscape. */
const setOrientation = (orientation: PageOrientation) => update({ orientation });

/** Applies a margin preset; the preset object is copied so it can never be mutated. */
const setMargins = (margins: PageMargins) => update({ margins: { ...margins } });

/** Changes one margin; a cleared input counts as zero. */
const setMargin = (side: keyof PageMargins, value: number | undefined) =>
  update({ margins: { ...props.page.margins, [side]: value ?? 0 } });

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
          <component :is="orientation.icon" :size="16" />
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
          <el-input-number
            size="small"
            controls-position="right"
            :model-value="page.margins[field.side]"
            :min="MARGIN_INPUT.min"
            :max="MARGIN_INPUT.max"
            :step="MARGIN_INPUT.step"
            :precision="MARGIN_INPUT.precision"
            @change="value => setMargin(field.side, value)"
          />
        </label>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page-setup {
  display: grid;
  gap: 12px;
  color: var(--el-text-color-regular);
}

.page-setup__section {
  display: grid;
  gap: 6px;
}

.page-setup__section h4 {
  margin: 0;
  color: var(--el-text-color-primary);
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
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  color: inherit;
  background: transparent;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.page-setup__chip:hover {
  border-color: var(--el-color-primary-light-5);
}

.page-setup__chip.is-active {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.page-setup__chip--row {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

.page-setup__chip small {
  color: var(--el-text-color-secondary);
  font-size: 10px;
  white-space: nowrap;
}

/* Exact margin inputs. */
.page-setup__caption {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.page-setup__field {
  display: grid;
  gap: 3px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.page-setup__field :deep(.el-input-number) {
  width: 100%;
}
</style>
