#!/usr/bin/env node
// Ligne de commande Poulpe.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

const [cmd, ...args] = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf('--' + name); return i > -1 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def; };

const HELP = `Poulpe — extraction web

  node src/cli.js serve                       Interface web (http://127.0.0.1:8787)
  node src/cli.js list                        Liste des tâches enregistrées
  node src/cli.js run <id|fichier.json>       Exécute une tâche
        --out resultats.csv|.xlsx|.json       Écrit le résultat (toutes les lignes de l'exécution)
        --pages N  --rows N                   Limites (test rapide)
  node src/cli.js import <fichier.json>       Enregistre une tâche ou un modèle
  node src/cli.js login <id> <url>            Ouvre un vrai navigateur pour vous connecter à la main
                                              (CAPTCHA, double authentification) ; la session est gardée
  node src/cli.js templates                   Liste les modèles fournis
`;

async function main() {
  if (!cmd || cmd === 'help' || cmd === '--help') { console.log(HELP); return; }
  if (cmd === 'serve') return startServer();
  const store = await import('./store.js');
  if (cmd === 'list') {
    for (const t of store.listTasks()) console.log(`${t.id.padEnd(36)} ${t.name}  [${store.readResults(t.id).length} lignes]${t.schedule?.enabled ? '  cron ' + t.schedule.cron : ''}`);
    return;
  }
  if (cmd === 'templates') {
    const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'templates');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) console.log(`${f.padEnd(34)} ${JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).title}`);
    return;
  }
  if (cmd === 'import') {
    const raw = JSON.parse(fs.readFileSync(args[0], 'utf8'));
    const t = store.saveTask({ ...(raw.task || raw), id: undefined });
    console.log(`Tâche enregistrée : ${t.id}`);
    return;
  }
  if (cmd === 'run') {
    const ref = args[0];
    if (!ref) throw new Error('Indiquez un identifiant de tâche ou un fichier .json');
    let task;
    if (fs.existsSync(ref)) {
      const raw = JSON.parse(fs.readFileSync(ref, 'utf8'));
      // Un fichier = une tâche stable (même identifiant à chaque lancement, donc dédoublonnage conservé).
      const fileId = 'f-' + store.slugify(path.basename(ref, '.json'));
      task = store.saveTask({ ...(raw.task || raw), id: (raw.task ? null : raw.id) || fileId });
    } else task = store.getTask(ref);
    if (!task) throw new Error('Tâche introuvable : ' + ref);
    const { startRun } = await import('./runner.js');
    const run = startRun(task.id, { trigger: 'cli', maxPages: flag('pages') ? Number(flag('pages')) : undefined, maxRows: flag('rows') ? Number(flag('rows')) : undefined });
    await run.done;
    const out = flag('out');
    if (out) {
      const { toCSV, toXLSX, toJSON } = await import('./export.js');
      const rows = store.readResults(task.id).filter((r) => r._last_seen >= run.startedAt);
      const ext = path.extname(out).toLowerCase();
      fs.writeFileSync(out, ext === '.xlsx' ? await toXLSX(rows, task.name) : ext === '.json' ? toJSON(rows) : toCSV(rows));
      console.log(`→ ${rows.length} ligne(s) écrites dans ${out}`);
    }
    console.log(`Statut : ${run.status} · ${run.rows} extraites · ${run.newRows} nouvelles · ${run.total} au total`);
    process.exitCode = run.status === 'failed' ? 1 : 0;
    return;
  }
  if (cmd === 'login') {
    const [id, url] = args;
    const task = store.getTask(id);
    if (!task || !url) throw new Error('Usage : login <id-tâche> <url>');
    const { launch } = await import('./engine.js');
    const h = await launch({ ...task, browser: { ...(task.browser || {}), blockResources: false } }, { headless: false });
    const page = await h.context.newPage();
    await page.goto(url);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await rl.question('Connectez-vous dans la fenêtre, puis appuyez sur Entrée ici… ');
    rl.close();
    await h.context.storageState({ path: store.sessionFile(task.id) });
    await h.browser.close();
    console.log('Session enregistrée : elle sera utilisée aux prochaines exécutions.');
    return;
  }
  console.log(HELP);
  process.exitCode = 1;
}

async function startServer() {
  const { createApp } = await import('./server.js');
  const runner = await import('./runner.js');
  const { aiAvailable, AI_MODEL } = await import('./ai.js');
  const PORT = Number(process.env.PORT || 8787);
  const HOST = process.env.HOST || '127.0.0.1';
  const n = runner.scheduleAll();
  createApp().listen(PORT, HOST, () => {
    console.log(`Poulpe prêt : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} · ${n} tâche(s) planifiée(s) · IA : ${aiAvailable() ? AI_MODEL : 'désactivée'}`);
  });
}

main().catch((e) => { console.error('Erreur : ' + e.message); process.exit(1); });
