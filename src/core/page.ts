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

/** Text repeated in the top or bottom margin of every page, in three aligned parts as in office suites. */
export interface PageHeaderFooter {
  /** Left-aligned part. */
  left: string;
  /** Centred part. */
  center: string;
  /** Right-aligned part. */
  right: string;
}

/** Text drawn behind the content of every page, such as “DRAFT” or “COPY”. */
export interface PageWatermark {
  /** Text of the watermark; without it the page has none. */
  text: string;
  /** Colour of the text; it is drawn faintly, so a mid grey suits most documents. */
  color: string;
  /** Whether the text runs diagonally across the page instead of straight across it. */
  diagonal: boolean;
}

/** Page setup chosen by the user; the host can persist it with `v-model:page`. */
export interface PageSettings {
  /** Paper format. */
  size: PageSizeKey;
  /** Paper orientation. */
  orientation: PageOrientation;
  /** Margins in millimetres. */
  margins: PageMargins;
  /** Text repeated in the top margin of every page; omitted while the document has no header. */
  header?: PageHeaderFooter;
  /** Text repeated in the bottom margin of every page; omitted while the document has no footer. */
  footer?: PageHeaderFooter;
  /** Watermark drawn behind the text of every page; omitted while the document has none. */
  watermark?: PageWatermark;
  /** Whether the first page shows no header, footer or page number, as on title pages and letterheads. */
  differentFirstPage?: boolean;
  /** Number printed on the first page; the following pages count on from it. Defaults to 1. */
  firstPageNumber?: number;
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

/** An empty header or footer, used when the user opens the form for the first time. */
export const createHeaderFooter = (): PageHeaderFooter => ({ left: '', center: '', right: '' });

/** Whether a header or footer holds any text at all. */
export const hasHeaderFooterText = (value: PageHeaderFooter | undefined): boolean =>
  Boolean(value && (value.left || value.center || value.right));

/** Largest first page number the page setup accepts. */
export const MAX_FIRST_PAGE_NUMBER = 9999;

/** Number printed on a sheet, counted from 1 for the first sheet. */
export const pageNumberOf = (page: PageSettings, sheet: number): number => sheet + (page.firstPageNumber ?? 1) - 1;

/** Whether the header, footer and page number are drawn on a sheet, counted from 1 for the first sheet. */
export const showsRunningTexts = (page: PageSettings, sheet: number): boolean =>
  !(page.differentFirstPage && sheet === 1);

/** Tokens a header or footer text may contain, replaced when the text is drawn on a page. */
export const HEADER_FOOTER_TOKENS = ['page', 'pages', 'date', 'title'] as const;

/** One of the tokens a header or footer text may contain. */
export type HeaderFooterToken = (typeof HEADER_FOOTER_TOKENS)[number];

/** Values the tokens of a header or footer are replaced with. */
export interface HeaderFooterContext {
  /** Number printed on the page the text is drawn on. */
  page: number;
  /** Number of pages in the document, as Word counts them: every sheet, whatever number it prints. */
  pages: number;
  /** Document title. */
  title: string;
}

/** Pattern of the tokens, built from their names so both stay in step. */
const TOKEN_PATTERN = new RegExp(`\\{(${HEADER_FOOTER_TOKENS.join('|')})\\}`, 'g');

/** Today's date as `dd.mm.yyyy`, the format used in Uzbek documents. */
const today = (): string => {
  const now = new Date();
  const twoDigits = (value: number) => String(value).padStart(2, '0');
  return `${twoDigits(now.getDate())}.${twoDigits(now.getMonth() + 1)}.${now.getFullYear()}`;
};

/** Replaces the `{page}`, `{pages}`, `{date}` and `{title}` tokens of a header or footer text. */
export const renderHeaderFooter = (text: string, context: HeaderFooterContext): string =>
  text.replace(TOKEN_PATTERN, (_, token: string) => {
    if (token === 'page') return String(context.page);
    if (token === 'pages') return String(context.pages);
    if (token === 'title') return context.title;
    return today();
  });

/** An empty watermark in the default colour, used when the user opens the form for the first time. */
export const createWatermark = (): PageWatermark => ({ text: '', color: '#9ca3af', diagonal: true });

/** Whether a watermark has any text to draw. */
export const hasWatermarkText = (value: PageWatermark | undefined): boolean => Boolean(value?.text.trim());

/** How much of the paper the watermark text spans. */
const WATERMARK_FILL = 0.86;
/** Average width of a character relative to the font size, used to fit the text onto the paper. */
const AVERAGE_CHARACTER_WIDTH = 0.62;
/** Smallest watermark font size in pixels, so a short text is still large. */
const MIN_WATERMARK_SIZE = 24;
/** Largest watermark font size, as a share of the paper height. */
const MAX_WATERMARK_HEIGHT_SHARE = 0.4;
/** Angle the diagonal watermark is rotated by, in degrees. */
export const WATERMARK_ANGLE = -35;

/** Font size in pixels at which a watermark text spans the paper, straight across it or diagonally. */
export const watermarkFontSize = (width: number, height: number, text: string, diagonal: boolean): number => {
  const span = diagonal ? Math.sqrt(width * width + height * height) : width;
  const characters = Math.max(4, text.trim().length) * AVERAGE_CHARACTER_WIDTH;
  const size = (span * WATERMARK_FILL) / characters;
  return Math.round(Math.max(MIN_WATERMARK_SIZE, Math.min(size, height * MAX_WATERMARK_HEIGHT_SHARE)));
};

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
