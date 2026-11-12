/* =====================================================================
 * Interprète Live — script injecté dans la page (Meet, Teams, Zoom web)
 *
 * • Micro : Meet reçoit un micro « proxy ». Interprète arrêté → votre vraie
 *   voix passe telle quelle. Mode Parle/Auto → seule la traduction anglaise
 *   passe : l'interlocuteur n'entend jamais votre français.
 * • Son de l'appel : les pistes audio reçues par la visio sont captées et
 *   traduites en français (voix dans vos écouteurs + sous-titres). La voix
 *   originale est baissée (volume réglable).
 * • Aucune clé ici : les appels à OpenAI passent par l'extension (background).
 *
 * Le bloc /*@@PROMPTS@@*\/ est remplacé à la construction par prompts.js.
 * ===================================================================== */
(() => {
  'use strict';
  if (window.__interpreteLive) return;
  window.__interpreteLive = true;

  /*@@PROMPTS@@*/

  const NativePC = window.RTCPeerConnection;
  const md = navigator.mediaDevices;
  if (!NativePC || !md || !md.getUserMedia) return;
  const nativeGUM = md.getUserMedia.bind(md);

  /* ---------------------------------------------------------------
   * Pont vers l'extension (clé API et requêtes OpenAI côté extension)
   * ------------------------------------------------------------- */
  let reqId = 0;
  const pending = new Map();
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__il !== 'res') return;
    const cb = pending.get(e.data.id);
    if (cb) { pending.delete(e.data.id); cb(e.data.res || {}); }
  });
  const ask = (payload) => new Promise((resolve) => {
    const id = ++reqId;
    pending.set(id, resolve);
    window.postMessage({ __il: 'req', id, payload }, '*');
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ ok: false, error: 'Extension injoignable : rechargez la page.' }); } }, 20000);
  });

  /* ---------------------------------------------------------------
   * Audio : un seul AudioContext, relancé au premier clic (autoplay)
   * ------------------------------------------------------------- */
  let ctx = null;
  const audio = () => {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  };
  ['pointerdown', 'keydown'].forEach((t) => window.addEventListener(t, () => {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }, true));

  /* Micro proxy : vraie voix (gain 1) OU traduction anglaise (gain 1), jamais les deux */
  const mic = { dest: null, realGain: null, enGain: null, realSrc: null, realTrack: null };
  function micBus() {
    const c = audio();
    if (!mic.dest) {
      mic.dest = c.createMediaStreamDestination();
      mic.realGain = c.createGain();
      mic.enGain = c.createGain();
      mic.realGain.connect(mic.dest);
      mic.enGain.connect(mic.dest);
      mic.enGain.gain.value = 0;
    }
    return mic;
  }
  function routeMic(translate) {
    micBus();
    mic.realGain.gain.value = translate ? 0 : 1;
    mic.enGain.gain.value = translate ? 1 : 0;
  }

  /* Son de l'appel : toutes les pistes audio reçues, mixées */
  const call = { dest: null };
  const seen = new WeakSet();
  function callBus() {
    if (!call.dest) call.dest = audio().createMediaStreamDestination();
    return call;
  }
  function captureRemote(track) {
    if (!track || track.kind !== 'audio' || seen.has(track)) return;
    seen.add(track);
    const src = audio().createMediaStreamSource(new MediaStream([track]));
    src.connect(callBus().dest);
    track.addEventListener('ended', () => { try { src.disconnect(); } catch {} });
  }

  /* ---------------------------------------------------------------
   * Interception : getUserMedia (micro) et RTCPeerConnection (son reçu)
   * ------------------------------------------------------------- */
  md.getUserMedia = async function (constraints) {
    const stream = await nativeGUM(constraints);
    const real = constraints && constraints.audio ? stream.getAudioTracks()[0] : null;
    if (!real) return stream;
    micBus();
    if (mic.realSrc) { try { mic.realSrc.disconnect(); } catch {} }
    mic.realTrack = real;
    mic.realSrc = audio().createMediaStreamSource(new MediaStream([real]));
    mic.realSrc.connect(mic.realGain);
    if (channels.speak) channels.speak.swapInput(real);

    // Piste rendue à la visio : copie du proxy qui se comporte comme le vrai micro
    const proxy = mic.dest.stream.getAudioTracks()[0].clone();
    Object.defineProperty(proxy, 'label', { get: () => real.label });
    proxy.getSettings = () => real.getSettings();
    proxy.getCapabilities = () => (real.getCapabilities ? real.getCapabilities() : {});
    proxy.getConstraints = () => real.getConstraints();
    proxy.applyConstraints = (c) => real.applyConstraints(c);
    const nativeStop = proxy.stop.bind(proxy);
    proxy.stop = () => { nativeStop(); if (mic.realTrack === real && !channels.speak) real.stop(); };
    return new MediaStream([...stream.getVideoTracks(), proxy]);
  };

  function PatchedPC(...args) {
    const pc = new NativePC(...args);
    pc.addEventListener('track', (e) => captureRemote(e.track));
    return pc;
  }
  PatchedPC.prototype = NativePC.prototype;
  Object.setPrototypeOf(PatchedPC, NativePC);
  window.RTCPeerConnection = PatchedPC;
  if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = PatchedPC;

  /* ---------------------------------------------------------------
   * Sessions OpenAI Realtime : 'listen' (appel → FR) et 'speak' (vous → EN)
   * ------------------------------------------------------------- */
  let settings = null;
  const channels = {};
  let mode = 'off';

  function buildSession(dir) {
    const s = settings;
    const voiceOut = dir === 'speak' || s.hearFr;
    const sess = {
      type: 'realtime',
      model: s.model,
      instructions: BASE_INSTRUCTIONS + '\n' + MODE_INSTRUCTIONS[dir] +
        (dir === 'speak' ? '\nThe listener hears you through a video call.' + (ACCENTS[s.accent] || '') : ''),
      output_modalities: voiceOut ? ['audio'] : ['text'],
      audio: {
        input: {
          transcription: { model: s.transcribe, language: dir === 'listen' ? 'en' : 'fr', keywords: TRADE_KEYWORDS },
          turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 250, silence_duration_ms: 400, create_response: true, interrupt_response: false },
        },
        output: { voice: s.voice },
      },
    };
    if (dir === 'speak') sess.audio.input.noise_reduction = { type: 'near_field' };
    if (/^gpt-realtime-2/.test(s.model)) sess.reasoning = { effort: 'minimal' };
    return sess;
  }

  async function openChannel(dir) {
    const ch = { dir, pc: null, dc: null, el: null, sender: null, resp: new Map(), closed: false };
    channels[dir] = ch;

    let input;
    if (dir === 'listen') input = callBus().dest.stream.getAudioTracks()[0];
    else {
      if (!mic.realTrack || mic.realTrack.readyState === 'ended') {
        const st = await nativeGUM({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        mic.realTrack = st.getAudioTracks()[0];
      }
      input = mic.realTrack;
    }

    const pc = new NativePC();
    ch.pc = pc;
    ch.sender = pc.addTrack(input, new MediaStream([input]));
    ch.swapInput = (t) => { try { ch.sender.replaceTrack(t); } catch {} };
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      ch.el = new Audio();
      ch.el.__ilOwn = true;
      ch.el.srcObject = stream;
      if (dir === 'speak') {
        // Chrome : une piste WebRTC distante n'alimente WebAudio que si un élément la lit
        ch.el.muted = true;
        const src = audio().createMediaStreamSource(stream);
        src.connect(micBus().enGain);
        ch.src = src;
      }
      ch.el.play().catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && channels[dir] === ch) {
        status('err', 'Connexion perdue (' + label(dir) + ')');
        closeChannel(dir);
      }
    };
    const dc = pc.createDataChannel('oai-events');
    ch.dc = dc;
    dc.onmessage = (e) => { try { onEvent(ch, JSON.parse(e.data)); } catch {} };

    await pc.setLocalDescription(await pc.createOffer());
    const res = await ask({ type: 'connect', session: buildSession(dir), sdp: pc.localDescription.sdp });
    if (ch.closed) return;
    if (!res.ok) { closeChannel(dir); throw new Error(res.error || 'Connexion OpenAI impossible'); }
    await pc.setRemoteDescription({ type: 'answer', sdp: res.sdp });
  }

  function closeChannel(dir) {
    const ch = channels[dir];
    if (!ch) return;
    ch.closed = true;
    delete channels[dir];
    try { ch.dc && ch.dc.close(); } catch {}
    try { ch.pc && ch.pc.close(); } catch {}
    if (ch.src) { try { ch.src.disconnect(); } catch {} }
    if (ch.el) { ch.el.srcObject = null; }
  }

  const send = (ch, o) => { if (ch.dc && ch.dc.readyState === 'open') ch.dc.send(JSON.stringify(o)); };

  function onEvent(ch, ev) {
    switch (ev.type) {
      case 'response.created':
        ch.resp.set(ev.response.id, '');
        break;
      case 'response.output_text.delta':
      case 'response.output_audio_transcript.delta': {
        const t = (ch.resp.get(ev.response_id) || '') + (ev.delta || '');
        ch.resp.set(ev.response_id, t);
        if (t.trim().startsWith(SILENT_MARK)) { send(ch, { type: 'response.cancel', response_id: ev.response_id }); ch.resp.set(ev.response_id, SILENT_MARK); break; }
        subtitle(ch.dir, t, false);
        break;
      }
      case 'response.done': {
        const t = (ch.resp.get(ev.response && ev.response.id) || '').trim();
        ch.resp.delete(ev.response && ev.response.id);
        if (t && !t.startsWith(SILENT_MARK)) subtitle(ch.dir, t, true);
        break;
      }
      case 'error': {
        const m = (ev.error && ev.error.message) || '';
        if (/no active response|cancel/i.test(m)) break;
        status('err', 'OpenAI : ' + m);
        break;
      }
    }
  }

  /* ---------------------------------------------------------------
   * Modes : off · auto (2 sens) · listen (Écoute) · speak (Parle)
   * ------------------------------------------------------------- */
  let volTimer = 0;
  async function setMode(next) {
    if (next === mode) return;
    mode = next;
    render();
    const want = next === 'auto' ? ['listen', 'speak'] : next === 'off' ? [] : [next];
    Object.keys(channels).forEach((d) => { if (!want.includes(d)) closeChannel(d); });
    routeMic(want.includes('speak'));
    duckOriginal(want.includes('listen'));
    if (!want.length) { status('', 'Arrêté — micro normal'); return; }

    const r = await ask({ type: 'settings' });
    if (!r.ok || !r.hasKey) {
      status('err', 'Clé API manquante : cliquez sur l’icône de l’extension.');
      ask({ type: 'openOptions' });
      mode = 'off'; routeMic(false); duckOriginal(false); render();
      return;
    }
    settings = r.settings;
    status('wait', 'Connexion…');
    try {
      // Les deux sens se connectent en parallèle : démarrage plus rapide
      await Promise.all(want.filter((d) => !channels[d]).map((d) => openChannel(d)));
      if (mode === next) status('on', label(next) + (want.length === 2 ? ' — 2 sens' : ''));
    } catch (e) {
      status('err', e.message);
      mode = 'off'; Object.keys(channels).forEach(closeChannel); routeMic(false); duckOriginal(false); render();
    }
  }

  /** Baisse la voix originale de l'interlocuteur pendant la traduction. */
  function duckOriginal(on) {
    clearInterval(volTimer);
    const apply = (v) => document.querySelectorAll('audio, video').forEach((m) => { if (!m.__ilOwn) m.volume = v; });
    if (!on) { apply(1); return; }
    const v = settings ? settings.originalVolume : 0.2;
    apply(v);
    volTimer = setInterval(() => apply(settings ? settings.originalVolume : 0.2), 1000);
  }

  const label = (m) => ({ auto: 'Auto', listen: 'Écoute', speak: 'Parle', off: 'Arrêt' }[m] || m);

  /* ---------------------------------------------------------------
   * Panneau flottant (Shadow DOM : n'interfère pas avec la page)
   * ------------------------------------------------------------- */
  let ui = null;
  const log = [];
  function buildUI() {
    if (ui || !document.body) return;
    const host = document.createElement('div');
    host.id = 'interprete-live';
    host.style.cssText = 'position:fixed;left:16px;bottom:96px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .p { font: 13px/1.35 system-ui, sans-serif; color: #e9eef5; background: #131a22ee; border: 1px solid #243041;
             border-radius: 14px; width: 320px; max-width: calc(100vw - 32px); box-shadow: 0 8px 30px #0008; }
        .h { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer; }
        .d { width: 10px; height: 10px; border-radius: 50%; background: #4a5566; flex: none; }
        .d.on { background: #2bb673; } .d.wait { background: #f5c542; } .d.err { background: #ff4d5e; }
        .t { font-weight: 700; } .s { color: #8a97a8; font-size: 12px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .b { padding: 0 10px 10px; display: grid; gap: 8px; }
        .row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
        button { font: 600 13px system-ui, sans-serif; color: #e9eef5; background: #1a2330; border: 1px solid #243041;
                 border-radius: 9px; padding: 8px 4px; cursor: pointer; }
        button.a { border-color: #3fa7ff; background: #12324d; }
        button.off.a { border-color: #ff4d5e; background: #3a1d22; }
        .sub { background: #0b0f14; border-radius: 9px; padding: 8px; min-height: 18px; }
        .sub small { display: block; color: #8a97a8; font-size: 11px; margin-bottom: 2px; }
        .fr { font-size: 16px; font-weight: 600; } .en { color: #ffb37a; }
        .foot { display: flex; gap: 6px; } .foot button { flex: 1; font-weight: 500; font-size: 12px; padding: 6px; }
        .min .b { display: none; }
      </style>
      <div class="p">
        <div class="h" title="Réduire / agrandir"><span class="d"></span><span class="t">Interprète</span><span class="s">Arrêté — micro normal</span></div>
        <div class="b">
          <div class="row">
            <button data-m="auto">Auto</button><button data-m="listen">Écoute</button>
            <button data-m="speak">Parle</button><button data-m="off" class="off">Arrêt</button>
          </div>
          <div class="sub"><small>Il dit (traduit en français)</small><div class="fr">—</div></div>
          <div class="sub"><small>Vous dites (envoyé en anglais)</small><div class="en">—</div></div>
          <div class="foot"><button data-a="copy">Copier la transcription</button><button data-a="opt">Réglages</button></div>
        </div>
      </div>`;
    document.body.appendChild(host);
    ui = {
      root, dot: root.querySelector('.d'), st: root.querySelector('.s'),
      fr: root.querySelector('.fr'), en: root.querySelector('.en'), panel: root.querySelector('.p'),
    };
    root.querySelector('.h').addEventListener('click', () => ui.panel.classList.toggle('min'));
    root.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.m)));
    root.querySelector('[data-a="opt"]').addEventListener('click', () => ask({ type: 'openOptions' }));
    root.querySelector('[data-a="copy"]').addEventListener('click', async () => {
      const txt = log.map((l) => `[${l.t}] ${l.dir === 'listen' ? 'EN→FR' : 'FR→EN'} : ${l.text}`).join('\n') || '(vide)';
      try { await navigator.clipboard.writeText(txt); status(mode === 'off' ? '' : 'on', 'Transcription copiée'); } catch { status('err', 'Copie refusée'); }
    });
    render();
  }
  function render() {
    if (!ui) return;
    ui.root.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('a', b.dataset.m === mode));
  }
  function status(state, text) {
    if (!ui) return;
    ui.dot.className = 'd' + (state ? ' ' + state : '');
    ui.st.textContent = text;
  }
  function subtitle(dir, text, done) {
    if (!ui) return;
    (dir === 'listen' ? ui.fr : ui.en).textContent = text;
    if (done) log.push({ t: new Date().toLocaleTimeString('fr-FR'), dir, text });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUI);
  else buildUI();

  // Accès pour les tests automatisés
  window.__interpreteLiveDebug = { setMode, channels, mic, call, get mode() { return mode; } };
})();
