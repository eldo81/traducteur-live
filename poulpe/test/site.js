// Mini-site de test : liste paginée, pagination JavaScript, défilement infini, fiches, API JSON, robots.txt.
import http from 'node:http';

const page = (body, title = 'Test') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>.card{border:1px solid #ccc;margin:4px;padding:4px}</style></head><body><nav><a href="/">Accueil</a><a href="/list">Liste</a><a href="/scroll">Défilement</a></nav>${body}</body></html>`;

const card = (id) => `<div class="card"><h2 class="title"><a href="/item/${id}">Article ${id}</a></h2>
<span class="price">${(1000 + id * 0.5).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</span>
<span class="date">${String((id % 28) + 1).padStart(2, '0')}/11/2026</span><p class="desc">Courte description de l'article numéro ${id} pour le test.</p></div>`;

export function startSite(port = 0) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, body, type = 'text/html; charset=utf-8') => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
    if (u.pathname === '/robots.txt') return send(200, 'User-agent: *\nDisallow: /private\n', 'text/plain');
    if (u.pathname === '/private') return send(200, page('<p>secret</p>'));
    if (u.pathname === '/list') {
      const p = Number(u.searchParams.get('page') || 1);
      const items = Array.from({ length: 5 }, (_, i) => card((p - 1) * 5 + i + 1)).join('');
      const next = p < 3 ? `<a class="next" href="/list?page=${p + 1}">Suivant</a>` : '<span class="next disabled">Suivant</span>';
      return send(200, page(`<h1>Liste</h1><div class="results">${items}</div><div class="pager">${next}</div>`));
    }
    if (u.pathname === '/js-list') {
      return send(200, page(`<div id="res" class="results"></div><button id="nx" class="btn-next">Suivant</button>
<script>
let p = 1;
const all = ${JSON.stringify(Array.from({ length: 12 }, (_, i) => i + 1))};
function draw(){ document.getElementById('res').innerHTML = all.slice((p-1)*4, p*4).map(i => '<div class="row"><b class="name">Ligne '+i+'</b><i class="val">'+(i*10)+'</i><span class="pad">texte de remplissage suffisamment long</span></div>').join('');
  document.getElementById('nx').disabled = p >= 3; }
document.getElementById('nx').addEventListener('click', () => { setTimeout(() => { p++; draw(); }, 200); });
draw();
</script>`));
    }
    if (u.pathname === '/scroll') {
      return send(200, page(`<div id="feed"></div><script>
let n = 0;
function more(){ if (n >= 15) return; let h=''; for (let i=0;i<5;i++){ n++; h += '<article class="post"><h3 class="t">Post '+n+'</h3><p class="b">Contenu du post numéro '+n+' assez long pour compter.</p></article>'; }
  document.getElementById('feed').insertAdjacentHTML('beforeend', h); document.body.style.minHeight = (n*400)+'px'; }
more();
window.addEventListener('scroll', () => { if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 50) setTimeout(more, 150); });
</script>`));
    }
    const m = u.pathname.match(/^\/item\/(\d+)$/);
    if (m) return send(200, page(`<h1 class="name">Article ${m[1]}</h1><div class="long">Description complète de l'article ${m[1]}.</div><a class="pdf" href="/doc/${m[1]}.pdf">PDF</a><span class="ref">REF-${m[1]}</span>`));
    if (u.pathname === '/api') {
      const p = Number(u.searchParams.get('page') || 1);
      const items = p <= 2 ? Array.from({ length: 3 }, (_, i) => ({ id: (p - 1) * 3 + i + 1, title: { fra: 'Avis ' + ((p - 1) * 3 + i + 1), eng: 'Notice' }, buyer: { name: 'Acheteur' }, tags: ['a', 'b'] })) : [];
      return send(200, JSON.stringify({ data: { items } }), 'application/json');
    }
    if (u.pathname === '/api-post' && req.method === 'POST') {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => {
        const body = JSON.parse(b);
        send(200, JSON.stringify({ notices: body.page <= 1 ? [{ n: 'X-' + body.page, typeOfPage: typeof body.page }] : [] }), 'application/json');
      });
      return;
    }
    send(200, page('<h1>Accueil</h1>'));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}
