// lib/import/csv-parser.js
// Minimal RFC-4180-compatible CSV parser with no external dependencies.
// Handles quoted fields, escaped quotes, CRLF + LF line endings.

/**
 * Parse a CSV string into an array of row arrays.
 * Empty lines are skipped.
 *
 * @param {string} text  Raw CSV string
 * @returns {string[][]}  Array of rows, each row is an array of string values
 */
function parseCSV(text) {
  // Normalize line endings
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < normalized.length) {
    const ch = normalized[i];

    if (inQuotes) {
      if (ch === '"') {
        // Peek ahead: "" is an escaped quote
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        field += ch;
        i++;
        continue;
      }
    }

    // Not in quotes
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (ch === ',') {
      row.push(field.trim());
      field = '';
      i++;
      continue;
    }

    if (ch === '\n') {
      row.push(field.trim());
      field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  // Flush final field + row
  row.push(field.trim());
  if (row.some(v => v !== '')) rows.push(row);

  return rows;
}

/**
 * Convert CSV rows (array of arrays) into array of objects using first row as headers.
 * Header names are normalized to lowercase with spaces → underscores.
 *
 * @param {string[][]} rows
 * @returns {{ headers: string[], records: object[] }}
 */
function rowsToObjects(rows) {
  if (!rows || rows.length < 2) return { headers: [], records: [] };
  const rawHeaders = rows[0];
  const headers = rawHeaders.map(h => h.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''));
  const records = rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = (row[i] || '').trim();
    });
    return obj;
  });
  return { headers, records };
}

module.exports = { parseCSV, rowsToObjects };
