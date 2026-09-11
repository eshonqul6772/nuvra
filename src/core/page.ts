/** Supported paper formats. */
export type PageSizeKey = 'a3' | 'a4' | 'a5' | 'letter' | 'legal';
/** Paper orientation. */
export type PageOrientation = 'portrait' | 'landscape';
/** `page` shows sheets like a word processor, `web` a continuous surface. */
export type DocumentViewMode = 'page' | 'web';

/** Page margins in millimetres. */
export interface PageMargins {
  /** Top margin. */
  top: number;
  /** Right margin. */
  right: number;
  /** Bottom margin. */
  bottom: number;
  /** Left margin. */
  left: number;
}

/** Page setup chosen by the user; the host can persist it with `v-model:page`. */
export interface PageSettings {
  /** Paper format. */
  size: PageSizeKey;
  /** Paper orientation. */
  orientation: PageOrientation;
  /** Margins in millimetres. */
  margins: PageMargins;
}

/** Page geometry in CSS pixels, ready for layout. */
export interface PageMetrics {
  /** Sheet width. */
  width: number;
  /** Sheet height. */
  height: number;
  /** Grey space between two sheets. */
  gap: number;
  /** Top margin. */
  marginTop: number;
  /** Right margin. */
  marginRight: number;
  /** Bottom margin. */
  marginBottom: number;
  /** Left margin. */
  marginLeft: number;
}

/** Portrait dimensions of a paper format in millimetres. */
interface PaperSize {
  /** Name shown in the page setup. */
  label: string;
  /** Portrait width. */
  width: number;
  /** Portrait height. */
  height: number;
}

/** Paper sizes in millimetres (portrait). */
export const PAGE_SIZES: Record<PageSizeKey, PaperSize> = {
  a3: { label: 'A3', width: 297, height: 420 },
  a4: { label: 'A4', width: 210, height: 297 },
  a5: { label: 'A5', width: 148, height: 210 },
  letter: { label: 'Letter', width: 215.9, height: 279.4 },
  legal: { label: 'Legal', width: 215.9, height: 355.6 }
};

/** Margin presets offered by the page setup, in millimetres; the key doubles as the label suffix. */
export const MARGIN_PRESETS = [
  { key: 'normal', margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 } },
  { key: 'narrow', margins: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 } },
  { key: 'moderate', margins: { top: 25.4, right: 19.1, bottom: 25.4, left: 19.1 } },
  { key: 'wide', margins: { top: 25.4, right: 50.8, bottom: 25.4, left: 50.8 } },
  /** O‘zDSt 1.14 requisites for official documents. */
  { key: 'official', margins: { top: 20, right: 15, bottom: 20, left: 30 } }
] as const satisfies ReadonlyArray<{ key: string; margins: PageMargins }>;

/** Smallest zoom in percent; low enough for an A4 sheet to fit a phone screen. */
export const ZOOM_MIN = 30;
/** Largest zoom in percent. */
export const ZOOM_MAX = 200;
/** Zoom change per step of the zoom buttons and slider, in percent. */
export const ZOOM_STEP = 10;

/** Grey space between two sheets in page view, in CSS pixels. */
const PAGE_GAP = 20;
/** CSS pixels per millimetre at 96 DPI. */
const PX_PER_MM = 96 / 25.4;
/** Margin differences below this many millimetres count as equal (rounding of unit conversions). */
const MARGIN_TOLERANCE_MM = 0.05;

/** Converts millimetres to CSS pixels. */
const mmToPx = (value: number): number => value * PX_PER_MM;

/** Default page setup: portrait A4 with normal margins. */
export const createPageSettings = (): PageSettings => ({
  size: 'a4',
  orientation: 'portrait',
  margins: { ...MARGIN_PRESETS[0].margins }
});

/** Converts page settings into pixel geometry; an unknown paper size falls back to A4. */
export const getPageMetrics = ({ size, orientation, margins }: PageSettings): PageMetrics => {
  const paper = PAGE_SIZES[size] ?? PAGE_SIZES.a4;
  const portrait = orientation === 'portrait';
  return {
    width: mmToPx(portrait ? paper.width : paper.height),
    height: mmToPx(portrait ? paper.height : paper.width),
    gap: PAGE_GAP,
    marginTop: mmToPx(margins.top),
    marginRight: mmToPx(margins.right),
    marginBottom: mmToPx(margins.bottom),
    marginLeft: mmToPx(margins.left)
  };
};

/** Whether two margin sets are equal, used to highlight the matching preset. */
export const isSameMargins = (a: PageMargins, b: PageMargins): boolean =>
  (Object.keys(a) as Array<keyof PageMargins>).every(side => Math.abs(a[side] - b[side]) < MARGIN_TOLERANCE_MM);
