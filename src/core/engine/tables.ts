import { createElement, createParagraph, renameElement } from './dom';
import { SELECTED_CELL_CLASS } from './schema';

/** A `<td>` or `<th>` element. */
export type TableCell = HTMLTableCellElement;

/** Zero-based grid slot of a cell's top-left corner. */
interface CellPosition {
  row: number;
  col: number;
}

/** Grid model of a table that resolves `rowspan` and `colspan`. */
interface TableMap {
  /** Rows in document order. */
  rows: HTMLTableRowElement[];
  /** grid[row][column] is the cell covering that slot, including slots covered by spans. */
  grid: Array<Array<TableCell | undefined>>;
  /** Top-left slot of every cell. */
  positions: Map<TableCell, CellPosition>;
  /** Number of columns in the widest row. */
  width: number;
}

/** Rectangular block of grid slots, inclusive on every side. */
export interface CellRect {
  /** Table the rectangle belongs to. */
  table: HTMLTableElement;
  /** First row index. */
  top: number;
  /** First column index. */
  left: number;
  /** Last row index. */
  bottom: number;
  /** Last column index. */
  right: number;
}

/** Narrowest column a user can resize to, in CSS pixels. */
const MIN_COLUMN_WIDTH = 40;
/** Width given to a column inserted into a table whose columns already have pixel widths. */
const NEW_COLUMN_WIDTH = 80;

/** Reads a span attribute, treating missing or invalid values as 1. */
const spanOf = (value: number) => Math.max(1, value);

/** Rows of the table's own body (normalised tables always have exactly one `<tbody>`). */
const rowsOf = (table: HTMLTableElement): HTMLTableRowElement[] =>
  Array.from(table.querySelectorAll<HTMLTableRowElement>(':scope > tbody > tr'));

/** Builds the grid model of a table. */
const buildTableMap = (table: HTMLTableElement): TableMap => {
  const rows = rowsOf(table);
  const grid: Array<Array<TableCell | undefined>> = rows.map(() => []);
  const positions = new Map<TableCell, CellPosition>();
  rows.forEach((row, rowIndex) => {
    const slots = grid[rowIndex] ?? [];
    let col = 0;
    for (const cell of Array.from(row.cells)) {
      while (slots[col]) col += 1;
      positions.set(cell, { row: rowIndex, col });
      for (let rowOffset = 0; rowOffset < spanOf(cell.rowSpan) && rowIndex + rowOffset < rows.length; rowOffset += 1) {
        const target = grid[rowIndex + rowOffset];
        for (let colOffset = 0; colOffset < spanOf(cell.colSpan); colOffset += 1) {
          if (target) target[col + colOffset] = cell;
        }
      }
      col += spanOf(cell.colSpan);
    }
  });
  return { rows, grid, positions, width: Math.max(0, ...grid.map(slots => slots.length)) };
};

/** Writes a span attribute, omitting it when it is 1. */
const setSpan = (cell: TableCell, name: 'colspan' | 'rowspan', value: number) => {
  if (value > 1) cell.setAttribute(name, String(value));
  else cell.removeAttribute(name);
};

/** Creates an empty body or header cell containing one paragraph. */
const createCell = (tag: string): TableCell => createElement(tag === 'TH' ? 'th' : 'td', {}, [createParagraph()]);

/** Whether every cell in the row is a header cell. */
const isHeaderRow = (map: TableMap, row: number) =>
  (map.grid[row] ?? []).every(cell => cell === undefined || cell.tagName === 'TH');

/** Creates an empty table; with `withHeaderRow` the first row uses header cells. */
export const createTable = (rows: number, cols: number, withHeaderRow: boolean): HTMLTableElement => {
  const body = createElement('tbody');
  for (let row = 0; row < rows; row += 1) {
    const tr = createElement('tr');
    for (let col = 0; col < cols; col += 1) tr.append(createCell(withHeaderRow && row === 0 ? 'TH' : 'TD'));
    body.append(tr);
  }
  return createElement('table', {}, [body]);
};

/** The first cell that starts in `row` at or after `fromCol`, used as the insertion reference. */
const cellStartingAfter = (map: TableMap, row: number, fromCol: number, exclude?: TableCell): TableCell | null => {
  const tr = map.rows[row];
  for (let col = fromCol; col < map.width; col += 1) {
    const cell = map.grid[row]?.[col];
    if (cell && cell !== exclude && cell.parentElement === tr && map.positions.get(cell)?.col === col) return cell;
  }
  return null;
};

/**
 * Inserts a row above or below the cell's row span. Cells spanning across the insertion line grow instead of
 * getting a new cell; header columns stay header cells.
 */
export const addRow = (cell: TableCell, side: 'before' | 'after'): void => {
  const table = cell.closest('table');
  if (!table) return;
  const map = buildTableMap(table);
  const position = map.positions.get(cell);
  if (!position) return;

  const index = side === 'before' ? position.row : position.row + spanOf(cell.rowSpan);
  const tr = createElement('tr');
  const extended = new Set<TableCell>();
  for (let col = 0; col < map.width; col += 1) {
    const above = map.grid[index - 1]?.[col];
    const below = map.grid[index]?.[col];
    if (above && above === below) {
      if (!extended.has(above)) setSpan(above, 'rowspan', above.rowSpan + 1);
      extended.add(above);
      continue;
    }
    const reference = map.grid[position.row]?.[col];
    const headerColumn = reference?.tagName === 'TH' && !isHeaderRow(map, position.row);
    tr.append(createCell(headerColumn ? 'TH' : 'TD'));
  }

  const anchorRow = map.rows[side === 'before' ? position.row : index - 1];
  if (side === 'before') anchorRow?.before(tr);
  else anchorRow?.after(tr);
};

/** Removes one grid row, shrinking cells that span it and moving cells that start in it down one row. */
const deleteGridRow = (table: HTMLTableElement, rowIndex: number) => {
  const map = buildTableMap(table);
  const row = map.rows[rowIndex];
  if (!row) return;
  const handled = new Set<TableCell>();
  for (let col = 0; col < map.width; col += 1) {
    const cell = map.grid[rowIndex]?.[col];
    if (!cell || handled.has(cell)) continue;
    handled.add(cell);
    if (cell.rowSpan <= 1) continue;
    const position = map.positions.get(cell);
    setSpan(cell, 'rowspan', cell.rowSpan - 1);
    if (position?.row === rowIndex) {
      const nextRow = map.rows[rowIndex + 1];
      const reference = cellStartingAfter(map, rowIndex + 1, position.col + spanOf(cell.colSpan));
      nextRow?.insertBefore(cell, reference);
    }
  }
  row.remove();
};

/** Deletes every row the cell spans; an emptied table is removed. */
export const deleteRow = (cell: TableCell): void => {
  const table = cell.closest('table');
  const position = table ? buildTableMap(table).positions.get(cell) : undefined;
  if (!table || !position) return;
  for (let row = position.row + spanOf(cell.rowSpan) - 1; row >= position.row; row -= 1) deleteGridRow(table, row);
  if (!rowsOf(table).length) table.remove();
};

/**
 * Inserts a column left or right of the cell's column span. Cells spanning across the insertion line grow; an
 * existing `<colgroup>` gets a matching `<col>`.
 */
export const addColumn = (cell: TableCell, side: 'before' | 'after'): void => {
  const table = cell.closest('table');
  if (!table) return;
  const map = buildTableMap(table);
  const position = map.positions.get(cell);
  if (!position) return;

  const index = side === 'before' ? position.col : position.col + spanOf(cell.colSpan);
  const extended = new Set<TableCell>();
  map.rows.forEach((row, rowIndex) => {
    const left = map.grid[rowIndex]?.[index - 1];
    const right = map.grid[rowIndex]?.[index];
    if (left && left === right) {
      if (!extended.has(left)) setSpan(left, 'colspan', left.colSpan + 1);
      extended.add(left);
      return;
    }
    const reference = cellStartingAfter(map, rowIndex, index);
    row.insertBefore(createCell(isHeaderRow(map, rowIndex) ? 'TH' : 'TD'), reference);
  });

  const cols = table.querySelectorAll(':scope > colgroup > col');
  if (!cols.length) return;
  const col = createElement('col', { style: `width: ${NEW_COLUMN_WIDTH}px` });
  table.querySelector(':scope > colgroup')?.insertBefore(col, cols[index] ?? null);
};

/** Removes one grid column, shrinking spanning cells, its `<col>` and rows left without cells. */
const deleteGridColumn = (table: HTMLTableElement, colIndex: number) => {
  const map = buildTableMap(table);
  const handled = new Set<TableCell>();
  map.rows.forEach((_, rowIndex) => {
    const cell = map.grid[rowIndex]?.[colIndex];
    if (!cell || handled.has(cell)) return;
    handled.add(cell);
    if (cell.colSpan > 1) setSpan(cell, 'colspan', cell.colSpan - 1);
    else cell.remove();
  });
  table.querySelectorAll(':scope > colgroup > col')[colIndex]?.remove();
  for (const row of rowsOf(table)) if (!row.cells.length) row.remove();
};

/** Deletes every column the cell spans; an emptied table is removed. */
export const deleteColumn = (cell: TableCell): void => {
  const table = cell.closest('table');
  const position = table ? buildTableMap(table).positions.get(cell) : undefined;
  if (!table || !position) return;
  for (let col = position.col + spanOf(cell.colSpan) - 1; col >= position.col; col -= 1) {
    deleteGridColumn(table, col);
  }
  if (!table.querySelector('td, th')) table.remove();
};

/** Smallest rectangle containing both cells, grown until no span crosses its edge. */
export const rectBetween = (from: TableCell, to: TableCell): CellRect | null => {
  const table = from.closest('table');
  if (!table || to.closest('table') !== table) return null;
  const map = buildTableMap(table);
  const a = map.positions.get(from);
  const b = map.positions.get(to);
  if (!a || !b) return null;

  const rect = {
    table,
    top: Math.min(a.row, b.row),
    left: Math.min(a.col, b.col),
    bottom: Math.max(a.row + from.rowSpan - 1, b.row + to.rowSpan - 1),
    right: Math.max(a.col + from.colSpan - 1, b.col + to.colSpan - 1)
  };
  let grown = true;
  while (grown) {
    grown = false;
    for (let row = rect.top; row <= rect.bottom; row += 1) {
      for (let col = rect.left; col <= rect.right; col += 1) {
        const cell = map.grid[row]?.[col];
        const position = cell ? map.positions.get(cell) : undefined;
        if (!cell || !position) continue;
        const bottom = position.row + spanOf(cell.rowSpan) - 1;
        const right = position.col + spanOf(cell.colSpan) - 1;
        if (position.row < rect.top || position.col < rect.left || bottom > rect.bottom || right > rect.right) {
          rect.top = Math.min(rect.top, position.row);
          rect.left = Math.min(rect.left, position.col);
          rect.bottom = Math.max(rect.bottom, bottom);
          rect.right = Math.max(rect.right, right);
          grown = true;
        }
      }
    }
  }
  return rect;
};

/** Distinct cells covering the rectangle, in grid order. */
export const cellsInRect = (rect: CellRect): TableCell[] => {
  const map = buildTableMap(rect.table);
  const cells = new Set<TableCell>();
  for (let row = rect.top; row <= rect.bottom; row += 1) {
    for (let col = rect.left; col <= rect.right; col += 1) {
      const cell = map.grid[row]?.[col];
      if (cell) cells.add(cell);
    }
  }
  return [...cells];
};

/** Whether a cell selection covers more than one cell and can therefore be merged. */
export const canMergeRect = (rect: CellRect | null): boolean => rect !== null && cellsInRect(rect).length > 1;

/**
 * Merges the rectangle into its top-left cell, moving the non-empty content of the other cells into it and
 * removing rows that end up without cells.
 * @returns the merged cell, or `null` when there was nothing to merge.
 */
export const mergeCells = (rect: CellRect): TableCell | null => {
  const [target, ...others] = cellsInRect(rect);
  if (!target || !others.length) return null;
  for (const cell of others) {
    const blocks = Array.from(cell.childNodes).filter(
      node => !(node instanceof HTMLElement && node.tagName === 'P' && (node.textContent ?? '') === '')
    );
    target.append(...blocks);
    cell.remove();
  }
  setSpan(target, 'colspan', rect.right - rect.left + 1);
  setSpan(target, 'rowspan', rect.bottom - rect.top + 1);
  for (const row of rowsOf(rect.table)) {
    if (row.cells.length) continue;
    const map = buildTableMap(rect.table);
    const index = map.rows.indexOf(row);
    for (const cell of new Set(map.grid[index] ?? [])) if (cell) setSpan(cell, 'rowspan', cell.rowSpan - 1);
    row.remove();
  }
  return target;
};

/** Whether the cell spans several rows or columns and can therefore be split. */
export const canSplitCell = (cell: TableCell | null): boolean =>
  cell !== null && (cell.colSpan > 1 || cell.rowSpan > 1);

/** Splits a spanning cell back into single cells; the new cells are empty and use the same cell type. */
export const splitCell = (cell: TableCell): void => {
  const table = cell.closest('table');
  if (!table || !canSplitCell(cell)) return;
  const map = buildTableMap(table);
  const position = map.positions.get(cell);
  if (!position) return;
  const rows = spanOf(cell.rowSpan);
  const cols = spanOf(cell.colSpan);
  setSpan(cell, 'colspan', 1);
  setSpan(cell, 'rowspan', 1);
  for (let row = position.row; row < position.row + rows; row += 1) {
    const tr = map.rows[row];
    const reference = cellStartingAfter(map, row, position.col + cols, cell);
    for (let col = position.col; col < position.col + cols; col += 1) {
      if (row === position.row && col === position.col) continue;
      tr?.insertBefore(createCell(cell.tagName), reference);
    }
  }
};

/** Turns the first row into header cells, or back into body cells when it already is a header row. */
export const toggleHeaderRow = (table: HTMLTableElement): void => {
  const firstRow = rowsOf(table)[0];
  if (!firstRow) return;
  const cells = Array.from(firstRow.cells);
  const header = cells.every(cell => cell.tagName === 'TH');
  for (const cell of cells) renameElement(cell, header ? 'td' : 'th');
};

/** All cells of the table's own rows in document order. */
const cellsOf = (table: HTMLTableElement) =>
  Array.from(table.querySelectorAll<TableCell>(':scope > tbody > tr > td, :scope > tbody > tr > th'));

/** Tab order through cells; moving past the last cell appends a row. */
export const siblingCell = (cell: TableCell, direction: 1 | -1): TableCell | null => {
  const table = cell.closest('table');
  if (!table) return null;
  const cells = cellsOf(table);
  const next = cells[cells.indexOf(cell) + direction];
  if (next || direction < 0) return next ?? null;
  const lastRowCell = rowsOf(table).at(-1)?.cells[0];
  if (!lastRowCell) return null;
  addRow(lastRowCell, 'after');
  return rowsOf(table).at(-1)?.cells[0] ?? null;
};

/** Width of the first unspanned cell in a column, or `fallback` when every cell there spans columns. */
const renderedColumnWidth = (map: TableMap, index: number, fallback: number) => {
  const cell = map.grid.map(slots => slots[index]).find(candidate => candidate && candidate.colSpan === 1);
  return cell?.offsetWidth || fallback;
};

/** Makes sure a <colgroup> with pixel widths matches the columns, seeded from the rendered layout. */
const ensureColumnWidths = (table: HTMLTableElement): HTMLElement[] => {
  const map = buildTableMap(table);
  const existing = table.querySelector(':scope > colgroup');
  if (existing && existing.children.length === map.width) return Array.from(existing.children) as HTMLElement[];
  const fallback = table.offsetWidth / Math.max(1, map.width);
  const widths = Array.from({ length: map.width }, (_, col) => renderedColumnWidth(map, col, fallback));
  const colgroup = createElement(
    'colgroup',
    {},
    widths.map(width => createElement('col', { style: `width: ${Math.round(width)}px` }))
  );
  existing?.remove();
  table.prepend(colgroup);
  return Array.from(colgroup.children) as HTMLElement[];
};

/** Current width of a column, read without touching the markup. */
export const columnWidth = (table: HTMLTableElement, index: number): number => {
  const col = table.querySelectorAll<HTMLElement>(':scope > colgroup > col')[index];
  const declared = col ? Number.parseFloat(col.style.width) : 0;
  if (declared) return declared;
  const map = buildTableMap(table);
  const cell = map.grid.map(slots => slots[index]).find(candidate => candidate && candidate.colSpan === 1);
  return cell?.offsetWidth ?? table.offsetWidth / Math.max(1, map.width);
};

/** Sets a column's pixel width (clamped to the minimum) and makes the table as wide as its columns. */
export const setColumnWidth = (table: HTMLTableElement, index: number, width: number): void => {
  const cols = ensureColumnWidths(table);
  const col = cols[index];
  if (!col) return;
  col.style.width = `${Math.max(MIN_COLUMN_WIDTH, Math.round(width))}px`;
  const total = cols.reduce((sum, item) => sum + (Number.parseFloat(item.style.width) || 0), 0);
  table.style.width = `${total}px`;
};

/** Column whose right border is within `tolerance` of `clientX`, or null when the pointer is not near a border. */
export const columnBorderAt = (
  table: HTMLTableElement,
  cell: TableCell,
  clientX: number,
  tolerance: number
): number | null => {
  const rect = cell.getBoundingClientRect();
  const position = buildTableMap(table).positions.get(cell);
  if (!position) return null;
  if (Math.abs(clientX - rect.right) <= tolerance) return position.col + spanOf(cell.colSpan) - 1;
  if (Math.abs(clientX - rect.left) <= tolerance && position.col > 0) return position.col - 1;
  return null;
};

/** Replaces the highlighted cell selection inside `scope` with `cells` (an empty list clears it). */
export const markSelectedCells = (scope: HTMLElement, cells: TableCell[]): void => {
  for (const cell of Array.from(scope.querySelectorAll(`.${SELECTED_CELL_CLASS}`))) {
    cell.classList.remove(SELECTED_CELL_CLASS);
    if (!cell.classList.length) cell.removeAttribute('class');
  }
  for (const cell of cells) cell.classList.add(SELECTED_CELL_CLASS);
};
