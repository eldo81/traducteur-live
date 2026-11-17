// Exports : CSV (Excel FR compatible), Excel .xlsx, JSON, et envoi webhook (n8n, Make, Zapier, Google Apps Script).
import ExcelJS from 'exceljs';

const HIDDEN = new Set(['_key', '_last_seen']);

export function columns(rows) {
  const cols = [];
  const seen = new Set();
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k) && !HIDDEN.has(k)) { seen.add(k); cols.push(k); }
  // Colonnes techniques en fin de tableau.
  return [...cols.filter((c) => !c.startsWith('_')), ...cols.filter((c) => c.startsWith('_'))];
}

const fmt = (v) => (v == null ? '' : Array.isArray(v) ? v.join(' | ') : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** CSV UTF-8 avec BOM ; séparateur « ; » par défaut pour Excel en français. */
export function toCSV(rows, sep = ';') {
  const cols = columns(rows);
  const cell = (v) => {
    const s = fmt(v);
    return /["\n\r]/.test(s) || s.includes(sep) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + [cols.map(cell).join(sep), ...rows.map((r) => cols.map((c) => cell(r[c])).join(sep))].join('\r\n') + '\r\n';
}

export async function toXLSX(rows, sheetName = 'Données') {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Poulpe';
  const ws = wb.addWorksheet(sheetName.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  const cols = columns(rows);
  ws.columns = cols.map((c) => ({ header: c, key: c, width: Math.min(60, Math.max(10, c.length + 2, ...rows.slice(0, 200).map((r) => fmt(r[c]).length * 0.9))) }));
  for (const r of rows) {
    const o = {};
    for (const c of cols) {
      const v = r[c];
      o[c] = typeof v === 'number' ? v : (typeof v === 'string' && /^https?:\/\//.test(v) && v.length < 2000) ? { text: v, hyperlink: v } : fmt(v);
    }
    ws.addRow(o);
  }
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B4F6C' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  if (cols.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toJSON(rows) {
  return JSON.stringify(rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !HIDDEN.has(k)))), null, 2);
}

/** Envoie les lignes à un webhook par paquets de 500. */
export async function sendWebhook(url, payload, rows, log) {
  const size = 500;
  const batches = Math.max(1, Math.ceil(rows.length / size));
  for (let i = 0; i < batches; i++) {
    const body = { ...payload, batch: i + 1, batches, rows: rows.slice(i * size, (i + 1) * size).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !HIDDEN.has(k)))) };
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        ok = true;
      } catch (e) {
        log?.('warn', `Webhook (paquet ${i + 1}, essai ${attempt}) : ${e.message}`);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    if (!ok) throw new Error('Webhook injoignable après 3 essais.');
  }
}
