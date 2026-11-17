// Fonctions IA (Claude) : extraction sans sélecteur, assistant de configuration, enrichissement des lignes.
import Anthropic from '@anthropic-ai/sdk';

export const AI_MODEL = process.env.POULPE_MODEL || 'claude-opus-5-5';
// Effort bas par défaut : l'extraction est une tâche simple et répétée ; montez à "medium"/"high" si besoin.
const EFFORT = process.env.POULPE_EFFORT || 'low';
// Au-delà, le texte de page est découpé en morceaux traités séparément (aucune troncature silencieuse).
const CHUNK_CHARS = Number(process.env.POULPE_AI_CHUNK || 300000);

let client = null;
let savedKey = '';
export function setClient(c) { client = c; }

/** Clé saisie dans l'interface (Réglages) : prioritaire sur la variable d'environnement. */
export function setApiKey(key) {
  savedKey = String(key || '').trim();
  client = null;
}
function currentKey() { return savedKey || process.env.ANTHROPIC_API_KEY || ''; }
export function keySource() { return savedKey ? 'reglages' : process.env.ANTHROPIC_API_KEY ? 'environnement' : process.env.ANTHROPIC_AUTH_TOKEN ? 'jeton' : ''; }

function getClient() {
  if (!client) client = currentKey() ? new Anthropic({ apiKey: currentKey(), maxRetries: 3 }) : new Anthropic({ maxRetries: 3 });
  return client;
}

export function aiAvailable() {
  return Boolean(client || currentKey() || process.env.ANTHROPIC_AUTH_TOKEN);
}

/** Vérifie la clé sans consommer de tokens (lecture de la fiche du modèle). */
export async function testKey(key) {
  const c = new Anthropic({ apiKey: key || currentKey(), maxRetries: 1 });
  const m = await c.models.retrieve(AI_MODEL);
  return { ok: true, model: m.id, name: m.display_name };
}

const usage = { input: 0, output: 0, calls: 0 };
export function aiUsage() { return { ...usage }; }

/** Appel Claude avec sortie JSON garantie par schéma. */
async function askJSON({ system, user, schema, maxTokens = 16000 }) {
  const params = {
    model: AI_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema } },
  };
  // Repli serveur si le modèle décline la requête (opus-5-5, sonnet-5-5, fable).
  if (/^claude-(opus-5|sonnet-5-5|fable)/.test(AI_MODEL)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  const stream = getClient().beta.messages.stream(params);
  const msg = await stream.finalMessage();
  usage.calls++;
  usage.input += msg.usage?.input_tokens || 0;
  usage.output += msg.usage?.output_tokens || 0;
  if (msg.stop_reason === 'refusal') throw new Error('Claude a décliné la requête (' + (msg.stop_details?.category || 'refus') + ').');
  if (msg.stop_reason === 'max_tokens') throw new Error('Réponse IA tronquée (max_tokens). Réduisez la page ou augmentez la limite.');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

const TYPE_MAP = { text: 'string', number: 'number', date: 'string', url: 'string', boolean: 'boolean', list: 'array' };

function itemSchema(fields) {
  const properties = {};
  for (const f of fields) {
    const t = TYPE_MAP[f.type || 'text'] || 'string';
    const prop = t === 'array' ? { type: 'array', items: { type: 'string' } } : { anyOf: [{ type: t }, { type: 'null' }] };
    prop.description = (f.description || f.name) + (f.type === 'date' ? ' (format AAAA-MM-JJ)' : '');
    properties[f.name] = prop;
  }
  return { type: 'object', properties, required: fields.map((f) => f.name), additionalProperties: false };
}

function chunks(text) {
  if (text.length <= CHUNK_CHARS) return [text];
  const out = [];
  for (let i = 0; i < text.length; i += CHUNK_CHARS) out.push(text.slice(i, i + CHUNK_CHARS));
  return out;
}

/**
 * Extraction IA : renvoie un tableau d'objets à partir du texte d'une page.
 * cfg = { instructions, fields: [{name, type, description}], single: bool }
 */
export async function extractWithAI(pageText, cfg, url) {
  const fields = cfg.fields && cfg.fields.length ? cfg.fields : [{ name: 'contenu', description: 'Information utile' }];
  const schema = {
    type: 'object',
    properties: { items: { type: 'array', items: itemSchema(fields) } },
    required: ['items'],
    additionalProperties: false,
  };
  const system = 'Tu es un moteur d\'extraction de données web. Tu lis le texte d\'une page et tu renvoies '
    + 'uniquement les données qui y figurent réellement. Tu n\'inventes rien : une information absente vaut null. '
    + 'Les dates sont au format AAAA-MM-JJ, les nombres sans symbole ni séparateur de milliers. '
    + 'Les URL sont recopiées telles quelles.';
  const all = [];
  for (const [i, part] of chunks(pageText).entries()) {
    const user = `URL : ${url || 'inconnue'}${chunks(pageText).length > 1 ? ` (partie ${i + 1})` : ''}\n`
      + `Consigne : ${cfg.instructions || 'Extrais chaque élément de la liste principale de la page.'}\n`
      + (cfg.single ? 'La page décrit UN seul élément : renvoie un tableau items d\'une seule entrée.\n' : '')
      + `\n<page>\n${part}\n</page>`;
    const res = await askJSON({ system, user, schema, maxTokens: 32000 });
    all.push(...(res.items || []));
  }
  return all;
}

/**
 * Assistant de configuration : à partir d'un objectif en langage naturel et du squelette DOM,
 * propose sélecteur de liste, champs et pagination.
 */
export async function suggestConfig({ url, goal, outline, candidates }) {
  const fieldSchema = {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nom de colonne court, en snake_case français' },
      selector: { type: 'string', description: 'Sélecteur CSS RELATIF au bloc répété ("" = le bloc lui-même)' },
      attr: { type: 'string', enum: ['text', 'href', 'src', 'html', 'title', 'datetime', 'content', 'data-id'] },
      transform: { type: 'string', enum: ['none', 'trim', 'number', 'date', 'absUrl', 'email', 'phone'] },
    },
    required: ['name', 'selector', 'attr', 'transform'],
    additionalProperties: false,
  };
  const schema = {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['list', 'single', 'ai'], description: 'list = blocs répétés ; single = une seule fiche ; ai = sélecteurs impossibles' },
      listSelector: { type: 'string', description: 'Sélecteur CSS absolu qui renvoie chaque bloc répété (vide si single)' },
      fields: { type: 'array', items: fieldSchema },
      pagination: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['none', 'next', 'scroll', 'loadMore', 'url'] },
          selector: { type: 'string', description: 'Sélecteur du bouton suivant / charger plus (sinon vide)' },
        },
        required: ['type', 'selector'],
        additionalProperties: false,
      },
      aiFields: {
        type: 'array',
        description: 'Champs à demander à l\'IA si mode = ai',
        items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } }, required: ['name', 'description'], additionalProperties: false },
      },
      explication: { type: 'string', description: 'Une ou deux phrases en français' },
    },
    required: ['mode', 'listSelector', 'fields', 'pagination', 'aiFields', 'explication'],
    additionalProperties: false,
  };
  const system = 'Tu configures un robot d\'extraction web. Tu reçois le squelette DOM d\'une page (balise#id.classes "texte") '
    + 'et des listes détectées automatiquement. Choisis des sélecteurs CSS robustes : classes stables, pas d\'index si possible, '
    + 'jamais de classes générées aléatoirement. Les sélecteurs de champ sont relatifs au bloc répété.';
  const user = `URL : ${url}\nObjectif de l'utilisateur : ${goal}\n\n`
    + `Listes détectées automatiquement :\n${JSON.stringify(candidates || [], null, 1).slice(0, 20000)}\n\n`
    + `<squelette>\n${outline}\n</squelette>`;
  const out = await askJSON({ system, user, schema, maxTokens: 8000 });
  out.fields = (out.fields || []).map((f) => ({ ...f, transform: f.transform === 'none' ? undefined : f.transform }));
  return out;
}

/**
 * Enrichissement : ajoute des colonnes calculées par l'IA à chaque ligne (qualification, catégorie, résumé, traduction…).
 * cfg = { prompt, fields: [{name, type, description}], batchSize }
 */
export async function enrichRows(rows, cfg) {
  if (!rows.length) return rows;
  const size = cfg.batchSize || 25;
  const fields = cfg.fields || [];
  const schema = {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: { ...itemSchema(fields), properties: { _i: { type: 'integer' }, ...itemSchema(fields).properties }, required: ['_i', ...fields.map((f) => f.name)] },
      },
    },
    required: ['results'],
    additionalProperties: false,
  };
  const system = 'Tu enrichis des lignes de données. Pour chaque ligne (repérée par _i), renvoie les colonnes demandées. '
    + 'Appuie-toi uniquement sur le contenu de la ligne ; si l\'information manque, mets null.';
  const out = rows.map((r) => ({ ...r }));
  for (let i = 0; i < rows.length; i += size) {
    const batch = rows.slice(i, i + size).map((r, j) => {
      const clean = Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_')));
      return { _i: i + j, ...clean };
    });
    const user = `Consigne : ${cfg.prompt}\n\nLignes :\n${JSON.stringify(batch)}`;
    const res = await askJSON({ system, user, schema, maxTokens: 32000 });
    for (const r of res.results || []) {
      if (out[r._i]) for (const f of fields) out[r._i][f.name] = r[f.name];
    }
  }
  return out;
}
