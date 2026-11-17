// Respect de robots.txt (activé par défaut, désactivable par tâche).
const cache = new Map();

function parse(txt) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!cur) continue;
      if (key === 'disallow' || key === 'allow') cur.rules.push({ allow: key === 'allow', path: val });
      if (key === 'crawl-delay') cur.delay = Number(val) * 1000;
    }
  }
  return groups;
}

function toRegex(pathPattern) {
  const anchored = pathPattern.endsWith('$');
  const body = (anchored ? pathPattern.slice(0, -1) : pathPattern)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

export async function robotsCheck(url, agent = 'poulpe') {
  const u = new URL(url);
  const origin = u.origin;
  if (!cache.has(origin)) {
    let groups = [];
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(origin + '/robots.txt', { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) groups = parse(await res.text());
    } catch { /* robots.txt injoignable : autorisé */ }
    cache.set(origin, groups);
  }
  const groups = cache.get(origin);
  const g = groups.find((x) => x.agents.some((a) => a !== '*' && agent.toLowerCase().includes(a)))
    || groups.find((x) => x.agents.includes('*'));
  if (!g) return { allowed: true, delay: 0 };
  const target = u.pathname + u.search;
  let best = null;
  for (const r of g.rules) {
    if (!r.path) continue;
    if (toRegex(r.path).test(target) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return { allowed: !best || best.allow, delay: g.delay || 0 };
}
