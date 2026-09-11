/**
 * SVG icons of the editor on a 24×24 grid, drawn with a 2px round stroke in the current text colour. The shapes come
 * from Lucide 1.44.0 (https://lucide.dev, ISC license, see LICENSE); the data is generated, not edited by hand.
 */

/** Name of an icon in the editor's set. */
export type IconName =
  | 'between-horizontal-end'
  | 'between-horizontal-start'
  | 'between-vertical-end'
  | 'between-vertical-start'
  | 'bold'
  | 'calendar-days'
  | 'case-sensitive'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-up'
  | 'code'
  | 'columns-2'
  | 'ellipsis'
  | 'external-link'
  | 'file-code'
  | 'file-down'
  | 'file-sliders'
  | 'file-text'
  | 'file-type'
  | 'grid-2x2-x'
  | 'grid-3x3'
  | 'highlighter'
  | 'image-plus'
  | 'italic'
  | 'languages'
  | 'link'
  | 'list'
  | 'list-indent-decrease'
  | 'list-indent-increase'
  | 'list-ordered'
  | 'list-todo'
  | 'loader-circle'
  | 'maximize-2'
  | 'minimize-2'
  | 'minus'
  | 'move-horizontal'
  | 'omega'
  | 'panel-top'
  | 'pencil'
  | 'pilcrow-left'
  | 'pilcrow-right'
  | 'plus'
  | 'printer'
  | 'quote'
  | 'rectangle-horizontal'
  | 'rectangle-vertical'
  | 'redo-2'
  | 'remove-formatting'
  | 'rows-2'
  | 'scroll-text'
  | 'search'
  | 'separator-horizontal'
  | 'square-code'
  | 'square-split-vertical'
  | 'strikethrough'
  | 'subscript'
  | 'superscript'
  | 'table-cells-merge'
  | 'table-cells-split'
  | 'text-align-center'
  | 'text-align-end'
  | 'text-align-justify'
  | 'text-align-start'
  | 'text-cursor-input'
  | 'trash'
  | 'underline'
  | 'undo-2'
  | 'unfold-vertical'
  | 'unlink'
  | 'upload'
  | 'whole-word'
  | 'x';

/** One SVG element of an icon: its tag and attributes. */
export type IconElement = readonly [tag: string, attributes: Readonly<Record<string, string | number>>];

/** Elements of every icon, by name. */
export const ICONS: Readonly<Record<IconName, readonly IconElement[]>> = {
  'between-horizontal-end': [
    ['rect', { width: '13', height: '7', x: '3', y: '3', rx: '1' }],
    ['path', { d: 'm22 15-3-3 3-3' }],
    ['rect', { width: '13', height: '7', x: '3', y: '14', rx: '1' }]
  ],
  'between-horizontal-start': [
    ['rect', { width: '13', height: '7', x: '8', y: '3', rx: '1' }],
    ['path', { d: 'm2 9 3 3-3 3' }],
    ['rect', { width: '13', height: '7', x: '8', y: '14', rx: '1' }]
  ],
  'between-vertical-end': [
    ['rect', { width: '7', height: '13', x: '3', y: '3', rx: '1' }],
    ['path', { d: 'm9 22 3-3 3 3' }],
    ['rect', { width: '7', height: '13', x: '14', y: '3', rx: '1' }]
  ],
  'between-vertical-start': [
    ['rect', { width: '7', height: '13', x: '3', y: '8', rx: '1' }],
    ['path', { d: 'm15 2-3 3-3-3' }],
    ['rect', { width: '7', height: '13', x: '14', y: '8', rx: '1' }]
  ],
  bold: [['path', { d: 'M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8' }]],
  'calendar-days': [
    ['path', { d: 'M8 2v3' }],
    ['path', { d: 'M16 2v3' }],
    ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }],
    ['path', { d: 'M3 9h18' }],
    ['path', { d: 'M8 13h.01' }],
    ['path', { d: 'M12 13h.01' }],
    ['path', { d: 'M16 13h.01' }],
    ['path', { d: 'M8 17h.01' }],
    ['path', { d: 'M12 17h.01' }],
    ['path', { d: 'M16 17h.01' }]
  ],
  'case-sensitive': [
    ['path', { d: 'm2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16' }],
    ['path', { d: 'M22 9v7' }],
    ['path', { d: 'M3.304 13h6.392' }],
    ['circle', { cx: '18.5', cy: '12.5', r: '3.5' }]
  ],
  'chevron-down': [['path', { d: 'm6 9 6 6 6-6' }]],
  'chevron-right': [['path', { d: 'm9 18 6-6-6-6' }]],
  'chevron-up': [['path', { d: 'm18 15-6-6-6 6' }]],
  code: [
    ['path', { d: 'm16 18 6-6-6-6' }],
    ['path', { d: 'm8 6-6 6 6 6' }]
  ],
  'columns-2': [
    ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
    ['path', { d: 'M12 3v18' }]
  ],
  ellipsis: [
    ['circle', { cx: '12', cy: '12', r: '1' }],
    ['circle', { cx: '19', cy: '12', r: '1' }],
    ['circle', { cx: '5', cy: '12', r: '1' }]
  ],
  'external-link': [
    ['path', { d: 'M15 3h6v6' }],
    ['path', { d: 'M10 14 21 3' }],
    ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }]
  ],
  'file-code': [
    [
      'path',
      {
        d: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z'
      }
    ],
    ['path', { d: 'M14 2v5a1 1 0 0 0 1 1h5' }],
    ['path', { d: 'M10 12.5 8 15l2 2.5' }],
    ['path', { d: 'm14 12.5 2 2.5-2 2.5' }]
  ],
  'file-down': [
    [
      'path',
      {
        d: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z'
      }
    ],
    ['path', { d: 'M14 2v5a1 1 0 0 0 1 1h5' }],
    ['path', { d: 'M12 18v-6' }],
    ['path', { d: 'm9 15 3 3 3-3' }]
  ],
  'file-sliders': [
    [
      'path',
      {
        d: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z'
      }
    ],
    ['path', { d: 'M14 2v5a1 1 0 0 0 1 1h5' }],
    ['path', { d: 'M8 12h8' }],
    ['path', { d: 'M10 11v2' }],
    ['path', { d: 'M8 17h8' }],
    ['path', { d: 'M14 16v2' }]
  ],
  'file-text': [
    [
      'path',
      {
        d: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z'
      }
    ],
    ['path', { d: 'M14 2v5a1 1 0 0 0 1 1h5' }],
    ['path', { d: 'M10 9H8' }],
    ['path', { d: 'M16 13H8' }],
    ['path', { d: 'M16 17H8' }]
  ],
  'file-type': [
    [
      'path',
      {
        d: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z'
      }
    ],
    ['path', { d: 'M14 2v5a1 1 0 0 0 1 1h5' }],
    ['path', { d: 'M11 18h2' }],
    ['path', { d: 'M12 12v6' }],
    ['path', { d: 'M9 13v-.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v.5' }]
  ],
  'grid-2x2-x': [
    ['path', { d: 'M12 3v17a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1H3' }],
    ['path', { d: 'm16.5 16.5 5 5' }],
    ['path', { d: 'm16.5 21.5 5-5' }]
  ],
  'grid-3x3': [
    ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
    ['path', { d: 'M3 9h18' }],
    ['path', { d: 'M3 15h18' }],
    ['path', { d: 'M9 3v18' }],
    ['path', { d: 'M15 3v18' }]
  ],
  highlighter: [
    ['path', { d: 'm9 11-6 6v3h9l3-3' }],
    ['path', { d: 'm22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4' }]
  ],
  'image-plus': [
    ['path', { d: 'M16 5h6' }],
    ['path', { d: 'M19 2v6' }],
    ['path', { d: 'M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5' }],
    ['path', { d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' }],
    ['circle', { cx: '9', cy: '9', r: '2' }]
  ],
  italic: [
    ['line', { x1: '19', x2: '10', y1: '4', y2: '4' }],
    ['line', { x1: '14', x2: '5', y1: '20', y2: '20' }],
    ['line', { x1: '15', x2: '9', y1: '4', y2: '20' }]
  ],
  languages: [
    ['path', { d: 'm5 8 6 6' }],
    ['path', { d: 'm4 14 6-6 2-3' }],
    ['path', { d: 'M2 5h12' }],
    ['path', { d: 'M7 2h1' }],
    ['path', { d: 'm22 22-5-10-5 10' }],
    ['path', { d: 'M14 18h6' }]
  ],
  link: [
    ['path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }],
    ['path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }]
  ],
  list: [
    ['path', { d: 'M3 5h.01' }],
    ['path', { d: 'M3 12h.01' }],
    ['path', { d: 'M3 19h.01' }],
    ['path', { d: 'M8 5h13' }],
    ['path', { d: 'M8 12h13' }],
    ['path', { d: 'M8 19h13' }]
  ],
  'list-indent-decrease': [
    ['path', { d: 'M21 5H11' }],
    ['path', { d: 'M21 12H11' }],
    ['path', { d: 'M21 19H11' }],
    ['path', { d: 'm7 8-4 4 4 4' }]
  ],
  'list-indent-increase': [
    ['path', { d: 'M21 5H11' }],
    ['path', { d: 'M21 12H11' }],
    ['path', { d: 'M21 19H11' }],
    ['path', { d: 'm3 8 4 4-4 4' }]
  ],
  'list-ordered': [
    ['path', { d: 'M11 5h10' }],
    ['path', { d: 'M11 12h10' }],
    ['path', { d: 'M11 19h10' }],
    ['path', { d: 'M4 4h1v5' }],
    ['path', { d: 'M4 9h2' }],
    ['path', { d: 'M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02' }]
  ],
  'list-todo': [
    ['path', { d: 'M13 5h8' }],
    ['path', { d: 'M13 12h8' }],
    ['path', { d: 'M13 19h8' }],
    ['path', { d: 'm3 17 2 2 4-4' }],
    ['rect', { x: '3', y: '4', width: '6', height: '6', rx: '1' }]
  ],
  'loader-circle': [['path', { d: 'M21 12a9 9 0 1 1-6.219-8.56' }]],
  'maximize-2': [
    ['path', { d: 'M15 3h6v6' }],
    ['path', { d: 'm21 3-7 7' }],
    ['path', { d: 'm3 21 7-7' }],
    ['path', { d: 'M9 21H3v-6' }]
  ],
  'minimize-2': [
    ['path', { d: 'm14 10 7-7' }],
    ['path', { d: 'M20 10h-6V4' }],
    ['path', { d: 'm3 21 7-7' }],
    ['path', { d: 'M4 14h6v6' }]
  ],
  minus: [['path', { d: 'M5 12h14' }]],
  'move-horizontal': [
    ['path', { d: 'm18 8 4 4-4 4' }],
    ['path', { d: 'M2 12h20' }],
    ['path', { d: 'm6 8-4 4 4 4' }]
  ],
  omega: [
    [
      'path',
      {
        d: 'M3 20h4.5a.5.5 0 0 0 .5-.5v-.282a.52.52 0 0 0-.247-.437 8 8 0 1 1 8.494-.001.52.52 0 0 0-.247.438v.282a.5.5 0 0 0 .5.5H21'
      }
    ]
  ],
  'panel-top': [
    ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
    ['path', { d: 'M3 9h18' }]
  ],
  pencil: [
    [
      'path',
      {
        d: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'
      }
    ],
    ['path', { d: 'm15 5 4 4' }]
  ],
  'pilcrow-left': [
    ['path', { d: 'M14 3v11' }],
    ['path', { d: 'M14 9h-3a3 3 0 0 1 0-6h9' }],
    ['path', { d: 'M18 3v11' }],
    ['path', { d: 'M22 18H2l4-4' }],
    ['path', { d: 'm6 22-4-4' }]
  ],
  'pilcrow-right': [
    ['path', { d: 'M10 3v11' }],
    ['path', { d: 'M10 9H7a1 1 0 0 1 0-6h8' }],
    ['path', { d: 'M14 3v11' }],
    ['path', { d: 'm18 14 4 4H2' }],
    ['path', { d: 'm22 18-4 4' }]
  ],
  plus: [
    ['path', { d: 'M5 12h14' }],
    ['path', { d: 'M12 5v14' }]
  ],
  printer: [
    ['path', { d: 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2' }],
    ['path', { d: 'M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6' }],
    ['rect', { x: '6', y: '14', width: '12', height: '8', rx: '1' }]
  ],
  quote: [
    [
      'path',
      {
        d: 'M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z'
      }
    ],
    [
      'path',
      {
        d: 'M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z'
      }
    ]
  ],
  'rectangle-horizontal': [['rect', { width: '20', height: '12', x: '2', y: '6', rx: '2' }]],
  'rectangle-vertical': [['rect', { width: '12', height: '20', x: '6', y: '2', rx: '2' }]],
  'redo-2': [
    ['path', { d: 'm15 14 5-5-5-5' }],
    ['path', { d: 'M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13' }]
  ],
  'remove-formatting': [
    ['path', { d: 'M4 7V4h16v3' }],
    ['path', { d: 'M5 20h6' }],
    ['path', { d: 'M13 4 8 20' }],
    ['path', { d: 'm15 15 5 5' }],
    ['path', { d: 'm20 15-5 5' }]
  ],
  'rows-2': [
    ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
    ['path', { d: 'M3 12h18' }]
  ],
  'scroll-text': [
    ['path', { d: 'M15 12h-5' }],
    ['path', { d: 'M15 8h-5' }],
    ['path', { d: 'M19 17V5a2 2 0 0 0-2-2H4' }],
    [
      'path',
      {
        d: 'M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3'
      }
    ]
  ],
  search: [
    ['path', { d: 'm21 21-4.34-4.34' }],
    ['circle', { cx: '11', cy: '11', r: '8' }]
  ],
  'separator-horizontal': [
    ['path', { d: 'm16 16-4 4-4-4' }],
    ['path', { d: 'M3 12h18' }],
    ['path', { d: 'm8 8 4-4 4 4' }]
  ],
  'square-code': [
    ['path', { d: 'm10 9-3 3 3 3' }],
    ['path', { d: 'm14 15 3-3-3-3' }],
    ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }]
  ],
  'square-split-vertical': [
    ['path', { d: 'M2 12h20' }],
    ['path', { d: 'M21 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3' }],
    ['path', { d: 'M3 8V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3' }]
  ],
  strikethrough: [
    ['path', { d: 'M16 4H9a3 3 0 0 0-2.83 4' }],
    ['path', { d: 'M14 12a4 4 0 0 1 0 8H6' }],
    ['line', { x1: '4', x2: '20', y1: '12', y2: '12' }]
  ],
  subscript: [
    ['path', { d: 'm4 5 8 8' }],
    ['path', { d: 'm12 5-8 8' }],
    [
      'path',
      {
        d: 'M20 19h-4c0-1.5.44-2 1.5-2.5S20 15.33 20 14c0-.47-.17-.93-.48-1.29a2.11 2.11 0 0 0-2.62-.44c-.42.24-.74.62-.9 1.07'
      }
    ]
  ],
  superscript: [
    ['path', { d: 'm4 19 8-8' }],
    ['path', { d: 'm12 19-8-8' }],
    [
      'path',
      {
        d: 'M20 12h-4c0-1.5.442-2 1.5-2.5S20 8.334 20 7.002c0-.472-.17-.93-.484-1.29a2.105 2.105 0 0 0-2.617-.436c-.42.239-.738.614-.899 1.06'
      }
    ]
  ],
  'table-cells-merge': [
    ['path', { d: 'M12 21v-6' }],
    ['path', { d: 'M12 9V3' }],
    ['path', { d: 'M3 15h18' }],
    ['path', { d: 'M3 9h18' }],
    ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }]
  ],
  'table-cells-split': [
    ['path', { d: 'M12 15V9' }],
    ['path', { d: 'M3 15h18' }],
    ['path', { d: 'M3 9h18' }],
    ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }]
  ],
  'text-align-center': [
    ['path', { d: 'M21 5H3' }],
    ['path', { d: 'M17 12H7' }],
    ['path', { d: 'M19 19H5' }]
  ],
  'text-align-end': [
    ['path', { d: 'M21 5H3' }],
    ['path', { d: 'M21 12H9' }],
    ['path', { d: 'M21 19H7' }]
  ],
  'text-align-justify': [
    ['path', { d: 'M3 5h18' }],
    ['path', { d: 'M3 12h18' }],
    ['path', { d: 'M3 19h18' }]
  ],
  'text-align-start': [
    ['path', { d: 'M21 5H3' }],
    ['path', { d: 'M15 12H3' }],
    ['path', { d: 'M17 19H3' }]
  ],
  'text-cursor-input': [
    ['path', { d: 'M12 20h-1a2 2 0 0 1-2-2 2 2 0 0 1-2 2H6' }],
    ['path', { d: 'M13 8h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-7' }],
    ['path', { d: 'M5 16H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h1' }],
    ['path', { d: 'M6 4h1a2 2 0 0 1 2 2 2 2 0 0 1 2-2h1' }],
    ['path', { d: 'M9 6v12' }]
  ],
  trash: [
    ['path', { d: 'M10 11v6' }],
    ['path', { d: 'M14 11v6' }],
    ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }],
    ['path', { d: 'M3 6h18' }],
    ['path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }]
  ],
  underline: [
    ['path', { d: 'M6 4v6a6 6 0 0 0 12 0V4' }],
    ['line', { x1: '4', x2: '20', y1: '20', y2: '20' }]
  ],
  'undo-2': [
    ['path', { d: 'M9 14 4 9l5-5' }],
    ['path', { d: 'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11' }]
  ],
  'unfold-vertical': [
    ['path', { d: 'M12 22v-6' }],
    ['path', { d: 'M12 8V2' }],
    ['path', { d: 'M4 12H2' }],
    ['path', { d: 'M10 12H8' }],
    ['path', { d: 'M16 12h-2' }],
    ['path', { d: 'M22 12h-2' }],
    ['path', { d: 'm15 19-3 3-3-3' }],
    ['path', { d: 'm15 5-3-3-3 3' }]
  ],
  unlink: [
    ['path', { d: 'm18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71' }],
    ['path', { d: 'm5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71' }],
    ['line', { x1: '8', x2: '8', y1: '2', y2: '5' }],
    ['line', { x1: '2', x2: '5', y1: '8', y2: '8' }],
    ['line', { x1: '16', x2: '16', y1: '19', y2: '22' }],
    ['line', { x1: '19', x2: '22', y1: '16', y2: '16' }]
  ],
  upload: [
    ['path', { d: 'M12 3v12' }],
    ['path', { d: 'm17 8-5-5-5 5' }],
    ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }]
  ],
  'whole-word': [
    ['circle', { cx: '7', cy: '12', r: '3' }],
    ['path', { d: 'M10 9v6' }],
    ['circle', { cx: '17', cy: '12', r: '3' }],
    ['path', { d: 'M14 7v8' }],
    ['path', { d: 'M22 17v1c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1v-1' }]
  ],
  x: [
    ['path', { d: 'M18 6 6 18' }],
    ['path', { d: 'm6 6 12 12' }]
  ]
};
