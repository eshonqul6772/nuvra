<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';

import { SUPPORTS_POPOVER, clearOpenPopover, setOpenPopover } from '../core/popover';

/**
 * Click-to-open panel anchored to its reference slot, used for the toolbar's forms, pickers and menus. The panel stays
 * in the editor's DOM, so it inherits the theme variables and keeps working inside dialogs; with the Popover API it is
 * shown in the top layer, above the fullscreen editor and modals. A press outside or Escape closes it.
 */
defineOptions({ name: 'EditorPopover' });

interface Props {
  /** Prevents opening and closes an open panel. */
  disabled?: boolean;
  /** Largest height of the panel in pixels; taller content scrolls. */
  maxHeight?: number;
  /** Extra class of the panel element. */
  panelClass?: string;
  /** Edge of the reference the panel is aligned with. */
  placement?: 'bottom-start' | 'bottom-end';
  /** ARIA role of the panel. */
  role?: 'dialog' | 'menu';
  /** Width of the panel in pixels; the content decides when omitted. */
  width?: number;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  maxHeight: undefined,
  panelClass: undefined,
  placement: 'bottom-start',
  role: 'dialog',
  width: undefined
});

interface Emits {
  /** The panel is about to open; its content can be prepared. */
  show: [];
  /** The panel is open and positioned; its content can take focus. */
  shown: [];
}

const emit = defineEmits<Emits>();

/** Whether the panel is open. */
const open = defineModel<boolean>('open', { default: false });

/** Space between the reference and the panel, in pixels. */
const OFFSET = 4;
/** Smallest distance between the panel and the viewport edges, in pixels. */
const VIEWPORT_MARGIN = 8;

const referenceRef = ref<HTMLElement>();
const panelRef = ref<HTMLElement>();

const close = () => {
  open.value = false;
};

/** Opens or closes the panel from a click on the reference. */
const toggle = () => {
  if (!props.disabled) open.value = !open.value;
};

/** Offset of the panel from the top-left corner of its reference, fixed when the panel is placed. */
const offsetFromReference = { left: 0, top: 0 };

/**
 * Writes the panel position from its reference. A panel in the top layer is positioned absolutely against the
 * document, so it scrolls with the page on its own; the fallback panel is fixed to the viewport.
 */
const applyPosition = (reference: HTMLElement, panel: HTMLElement) => {
  const anchor = reference.getBoundingClientRect();
  const inTopLayer = SUPPORTS_POPOVER && panel.matches(':popover-open');
  panel.style.position = inTopLayer ? 'absolute' : '';
  panel.style.left = `${anchor.left + offsetFromReference.left + (inTopLayer ? window.scrollX : 0)}px`;
  panel.style.top = `${anchor.top + offsetFromReference.top + (inTopLayer ? window.scrollY : 0)}px`;
};

/**
 * Places the panel below its reference, or above it when only there it fits, inside the viewport. The resulting
 * offset from the reference is kept until the panel is placed again, so scrolling moves the panel with the toolbar.
 */
const updatePosition = () => {
  const reference = referenceRef.value;
  const panel = panelRef.value;
  if (!reference || !panel) return;
  const { clientWidth: viewportWidth, clientHeight: viewportHeight } = document.documentElement;
  const availableHeight = viewportHeight - VIEWPORT_MARGIN * 2;
  panel.style.maxHeight = `${Math.min(props.maxHeight ?? availableHeight, availableHeight)}px`;
  const anchor = reference.getBoundingClientRect();
  const { offsetWidth: width, offsetHeight: height } = panel;
  let top = anchor.bottom + OFFSET;
  if (top + height > viewportHeight - VIEWPORT_MARGIN && anchor.top - OFFSET - height >= VIEWPORT_MARGIN) {
    top = anchor.top - OFFSET - height;
  }
  top = Math.max(VIEWPORT_MARGIN, Math.min(top, viewportHeight - VIEWPORT_MARGIN - height));
  const preferredLeft = props.placement === 'bottom-end' ? anchor.right - width : anchor.left;
  const left = Math.min(
    Math.max(preferredLeft, VIEWPORT_MARGIN),
    Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN)
  );
  offsetFromReference.left = left - anchor.left;
  offsetFromReference.top = top - anchor.top;
  applyPosition(reference, panel);
};

/** Keeps the panel next to its reference while the page or a container around the editor scrolls. */
const followReference = () => {
  if (referenceRef.value && panelRef.value) applyPosition(referenceRef.value, panelRef.value);
};

/** A press outside the panel and its reference closes the panel. */
const onDocumentPointerDown = (event: PointerEvent) => {
  const { target } = event;
  if (target instanceof Node && (panelRef.value?.contains(target) || referenceRef.value?.contains(target))) return;
  close();
};

/** Escape closes the panel before the editor or a surrounding dialog sees it, and returns focus to the reference. */
const onDocumentKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  const hadFocus = panelRef.value?.contains(document.activeElement) ?? false;
  close();
  if (hadFocus) referenceRef.value?.querySelector<HTMLElement>('button:not(:disabled), [tabindex]')?.focus();
};

/** Shows and positions the panel, then follows outside presses, Escape, scrolling and resizing while it is open. */
const showPanel = () => {
  const panel = panelRef.value;
  if (!panel) return;
  if (SUPPORTS_POPOVER && !panel.matches(':popover-open')) panel.showPopover();
  updatePosition();
  setOpenPopover(close);
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  document.addEventListener('keydown', onDocumentKeydown, true);
  window.addEventListener('resize', updatePosition);
  window.addEventListener('scroll', followReference, true);
  emit('shown');
};

/** Hides the panel and stops the listeners started by `showPanel`. */
const hidePanel = () => {
  clearOpenPopover(close);
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  document.removeEventListener('keydown', onDocumentKeydown, true);
  window.removeEventListener('resize', updatePosition);
  window.removeEventListener('scroll', followReference, true);
  const panel = panelRef.value;
  if (SUPPORTS_POPOVER && panel?.matches(':popover-open')) panel.hidePopover();
};

/** Lets the parent prepare the content before the panel renders open. */
watch(open, value => {
  if (value) emit('show');
});

/** Shows the panel once the DOM is updated, so it is measured with its current content. */
watch(open, value => (value ? showPanel() : hidePanel()), { flush: 'post' });

watch(
  () => props.disabled,
  disabled => {
    if (disabled) close();
  }
);

onBeforeUnmount(hidePanel);
</script>

<template>
  <span class="doc-popover">
    <span ref="referenceRef" class="doc-popover__reference" @click="toggle">
      <slot name="reference" />
    </span>
    <div
      ref="panelRef"
      class="doc-popover__panel"
      popover="manual"
      :class="[panelClass, { 'is-open': open }]"
      :role="role"
      :style="{ width: width ? `${width}px` : undefined }"
    >
      <slot />
    </div>
  </span>
</template>

<style scoped>
.doc-popover,
.doc-popover__reference {
  display: inline-flex;
  align-items: center;
}

/*
 * Floating panel: a fixed element above the page, or in the top layer when the Popover API is available. There the
 * script positions it absolutely against the document instead, so it scrolls together with the toolbar.
 */
.doc-popover__panel {
  position: fixed;
  z-index: 3000;
  inset: auto;
  box-sizing: border-box;
  margin: 0;
  padding: var(--doc-popover-padding, 10px);
  overflow: auto;
  border: 1px solid var(--nuvra-border-light);
  border-radius: 10px;
  color: var(--nuvra-text);
  background: var(--nuvra-bg-overlay);
  box-shadow: var(--nuvra-shadow);
  font-size: 14px;
  line-height: 1.4;
  text-align: left;
}

/*
 * A closed panel is hidden by a class rather than v-show: the class is patched during render, so the panel is already
 * displayed when the post-flush watcher measures and positions it.
 */
.doc-popover__panel:not(.is-open) {
  display: none;
}
</style>
