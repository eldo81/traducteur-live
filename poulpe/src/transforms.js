// Nettoyage des valeurs extraites et filtres sur les lignes.
import crypto from 'node:crypto';

const MONTHS = {
  jan: 1, janv: 1, janvier: 1, january: 1, feb: 2, fev: 2, 'fév': 2, fevr: 2, 'févr': 2, fevrier: 2, 'février': 2, february: 2,
  mar: 3, mars: 3, march: 3, apr: 4, avr: 4, avril: 4, april: 4, may: 5, mai: 5, jun: 6, juin: 6, june: 6,
  jul: 7, juil: 7, juillet: 7, july: 7, aug: 8, aou: 8, 'aoû': 8, aout: 8, 'août': 8, august: 8,
  sep: 9, sept: 9, septembre: 9, september: 9, oct: 10, octobre: 10, october: 10,
  nov: 11, novembre: 11, november: 11, dec: 12, 'déc': 12, decembre: 12, 'décembre': 12, december: 12,
};

const pad = (n) => String(n).padStart(2, '0');

/** "1 234,56 €" → 1234.56 ; "$2,500.00" → 2500 ; "7.40-8.20 USD" → 7.4 */
export function toNumber(v) {
  if (v == null) return null;
  let s = String(v).replace(/[  \s]/g, '');
  const m = s.match(/-?[\d.,']+/);
  if (!m) return null;
  s = m[0].replace(/'/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    const dec = s.length - lastComma - 1;
    s = (dec === 3 && (s.match(/,/g) || []).length >= 1 && !/^-?0,/.test(s)) ? s.replace(/,/g, '') : s.replace(/,/g, '.');
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Dates FR/EN courantes → AAAA-MM-JJ (heure conservée si présente). */
export function toISODate(v) {
  if (!v) return '';
  const s = String(v).trim();
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}` + (m[4] ? ` ${pad(m[4])}:${m[5]}` : '');
  m = s.match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})(?:\s+(\d{1,2})[:h](\d{2}))?/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${pad(m[2])}-${pad(m[1])}` + (m[4] ? ` ${pad(m[4])}:${m[5]}` : '');
  }
  m = s.match(/(\d{1,2})(?:er)?[\s\-]+([A-Za-zéûô]+)\.?[\s\-,]+(\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}`;
  m = s.match(/([A-Za-zéûô]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(m[2])}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
}

/**
 * Applique la chaîne de nettoyage d'un champ.
 * transform : "trim" | "number" | "date" | "lower" | "upper" | "absUrl" | "email" | "phone" | liste de ces valeurs
 * regex     : expression ; le 1er groupe capturé (ou la correspondance entière) est gardé
 * replace   : [[motif, remplacement], ...]
 * default   : valeur si vide
 */
export function applyField(value, field, baseUrl) {
  let v = value == null ? '' : String(value);
  if (field.regex) {
    try {
      const m = v.match(new RegExp(field.regex, field.regexFlags || 'i'));
      v = m ? (m[1] !== undefined ? m[1] : m[0]) : '';
    } catch { /* regex invalide : valeur inchangée */ }
  }
  for (const [pat, rep] of field.replace || []) {
    try { v = v.replace(new RegExp(pat, 'g'), rep); } catch { /* ignore */ }
  }
  const ts = Array.isArray(field.transform) ? field.transform : field.transform ? [field.transform] : [];
  let out = v.trim();
  for (const t of ts) {
    if (t === 'trim') out = String(out).trim();
    else if (t === 'number') out = toNumber(out);
    else if (t === 'date') out = toISODate(out);
    else if (t === 'lower') out = String(out).toLowerCase();
    else if (t === 'upper') out = String(out).toUpperCase();
    else if (t === 'absUrl' && out) { try { out = new URL(out, baseUrl).href; } catch { /* ignore */ } }
    else if (t === 'email') out = (String(out).match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [''])[0].toLowerCase();
    else if (t === 'phone') out = (String(out).match(/\+?[\d][\d\s().-]{6,}\d/) || [''])[0].replace(/[^\d+]/g, '');
  }
  if ((out === '' || out == null) && field.default !== undefined) out = field.default;
  return out;
}

export function cleanRow(raw, fields, baseUrl) {
  const row = {};
  const byName = new Map((fields || []).map((f) => [f.name, f]));
  for (const [k, v] of Object.entries(raw)) row[k] = byName.has(k) ? applyField(v, byName.get(k), baseUrl) : v;
  return row;
}

/** Filtres : [{field, op, value}] ; op = contains|notContains|equals|regex|notRegex|gt|gte|lt|lte|notEmpty|empty|after|before */
export function passFilters(row, filters) {
  for (const f of filters || []) {
    const raw = row[f.field];
    const s = raw == null ? '' : String(raw);
    const val = f.value;
    let ok = true;
    switch (f.op) {
      case 'contains': ok = s.toLowerCase().includes(String(val).toLowerCase()); break;
      case 'notContains': ok = !s.toLowerCase().includes(String(val).toLowerCase()); break;
      case 'containsAny': ok = (Array.isArray(val) ? val : String(val).split(',')).some((w) => s.toLowerCase().includes(String(w).trim().toLowerCase())); break;
      case 'equals': ok = s === String(val); break;
      case 'regex': try { ok = new RegExp(val, 'i').test(s); } catch { ok = false; } break;
      case 'notRegex': try { ok = !new RegExp(val, 'i').test(s); } catch { ok = true; } break;
      case 'gt': ok = toNumber(raw) > Number(val); break;
      case 'gte': ok = toNumber(raw) >= Number(val); break;
      case 'lt': ok = toNumber(raw) < Number(val); break;
      case 'lte': ok = toNumber(raw) <= Number(val); break;
      case 'notEmpty': ok = s.trim() !== ''; break;
      case 'empty': ok = s.trim() === ''; break;
      case 'after': ok = toISODate(s) >= resolveDate(val); break;
      case 'before': ok = toISODate(s) <= resolveDate(val); break;
      default: ok = true;
    }
    if (!ok) return false;
  }
  return true;
}

/** "today", "today+7", "today-30" ou une date. */
export function resolveDate(v) {
  const m = String(v).match(/^today([+-]\d+)?$/);
  if (m) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + Number(m[1] || 0));
    return d.toISOString().slice(0, 10);
  }
  return toISODate(v);
}

export function rowKey(row, keys) {
  const parts = keys && keys.length ? keys.map((k) => row[k] ?? '') : Object.keys(row).filter((k) => !k.startsWith('_')).sort().map((k) => row[k]);
  return crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}
