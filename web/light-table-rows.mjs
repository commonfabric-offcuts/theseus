// The rendered row supplies the pointer hit and the formatter supplies its
// exact source span. Keep Markdown offsets for quoting and visible cells for Copy.
import { tableSourceSpan } from './message-format.mjs';

export function tableRowAt(words, target) {
  const row = target?.closest?.('.md-table tr');
  const span = row && words.contains(row) && tableSourceSpan(row);
  return span && span.start < span.end ? { row, ...span } : null;
}

function rowsIn(words, { start, end }) {
  const rows = [];
  for (const table of words.querySelectorAll('.md-table')) {
    const span = tableSourceSpan(table);
    if (!span || span.end <= start || span.start >= end) continue;
    for (const row of table.rows) {
      const span = tableSourceSpan(row);
      if (span?.start >= end) break;
      if (span?.end > start) rows.push({ row, table, ...span });
    }
  }
  return rows;
}

// When a Shift gesture takes over a dragged selection, extend the selected
// edges out to their rows in the same way other edges extend to their passages.
export function rowAnchor(words, selection, passages) {
  const rows = rowsIn(words, selection);
  const first = rows[0], last = rows.at(-1);
  return {
    start: first?.start <= selection.start && first.end > selection.start ? first.start : passages.start,
    end: last?.start < selection.end && last.end >= selection.end ? last.end : passages.end,
  };
}

function cellWords(cell) {
  return [...cell.childNodes].map(node => {
    if (node.nodeType === 3) return node.data;
    if (node.matches?.('.sr-only,.struck-words')) return '';
    return cellWords(node);
  }).join('');
}

export class LightTableRows {
  rows = [];
  whole = false;

  paint(words, span) {
    const rows = rowsIn(words, span), current = new Set(rows.map(({ row }) => row));
    for (const { row } of this.rows) if (!current.has(row)) row.classList.remove('light-table-row');
    for (const { row } of rows) row.classList.add('light-table-row');
    this.rows = rows;
    const first = rows[0], last = rows.at(-1);
    this.whole = Boolean(first && first.start === span.start && last.end === span.end && first.table === last.table);
  }

  copied() {
    if (!this.whole) return null;
    return this.rows.map(({ row }) => [...row.cells].map(cell => cellWords(cell).trim()).join('\t')).join('\n');
  }

  clear() {
    for (const { row } of this.rows) row.classList.remove('light-table-row');
    this.rows = [];
    this.whole = false;
  }
}
