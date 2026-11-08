/* =====================================================================
 * Traducteur Live — Mode Écouteurs + PC (discret, sans haut-parleur)
 *
 * Deux canaux Realtime indépendants qui tournent en même temps :
 *   • canal ÉCOUTE : son de l'appel (câble virtuel) → traduction FR → vos écouteurs
 *   • canal PARLE  : votre micro → traduction EN → câble virtuel → l'appel
 * L'interlocuteur n'entend que l'anglais. Pas de haut-parleur, donc pas d'écho :
 * le micro n'est jamais coupé et les deux sens peuvent parler en même temps.
 *
 * Nécessite Chrome / Edge sur ordinateur (choix de la sortie audio : setSinkId).
 * S'appuie sur les fonctions communes d'app.js (session, historique, rendu).
 * ===================================================================== */
'use strict';

const Headset = (() => {
  const channels = {};      // 'listen' | 'speak' → canal actif
  let monitorEl = null;     // voix originale de l'interlocuteur en fond
  let meterCtx = null, meterRaf = 0;

  const supported = () =>
    typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype &&
    !!(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices);

  /* ---------------------------------------------------------------
   * Périphériques audio
   * ------------------------------------------------------------- */
  async function listDevices(unlock) {
    if (unlock) {
      // Les noms des périphériques ne sont visibles qu'après une autorisation micro
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
      tmp.getTracks().forEach((t) => t.stop());
    }
    const all = await navigator.mediaDevices.enumerateDevices();
    return {
      inputs: all.filter((d) => d.kind === 'audioinput'),
      outputs: all.filter((d) => d.kind === 'audiooutput'),
    };
  }

  /** Remplit les 4 listes des Réglages ; `guess` présélectionne les câbles virtuels. */
  async function populate(unlock) {
    const info = document.getElementById('hsSupport');
    if (!supported()) {
      info.textContent = '⚠️ Ce navigateur ne permet pas de choisir la sortie audio. Utilisez Chrome ou Edge sur un ordinateur.';
      return;
    }
    let d;
    try { d = await listDevices(unlock); }
    catch (e) { info.textContent = '❌ Accès au micro refusé : ' + e.message; return; }
    const named = d.inputs.concat(d.outputs).some((x) => x.label);
    info.textContent = named
      ? `${d.inputs.length} entrée(s), ${d.outputs.length} sortie(s) détectée(s).`
      : 'Touchez « Détecter les périphériques audio » pour afficher leurs noms.';

    const s = S.settings;
    const isCable = (l) => /cable|blackhole|voicemeeter|virtual|loopback/i.test(l);
    fill('setHsCallIn', d.inputs, s.hsCallIn, (l) => /cable output(?!.*-a)|cable output$|blackhole 2ch/i.test(l));
    fill('setHsMicIn', d.inputs, s.hsMicIn, (l) => !isCable(l));
    fill('setHsEarOut', d.outputs, s.hsEarOut, (l) => !isCable(l));
    fill('setHsCallOut', d.outputs, s.hsCallOut, (l) => /cable-a input|blackhole 16ch/i.test(l));
  }

  function fill(id, devices, saved, guess) {
    const sel = document.getElementById(id);
    sel.innerHTML = '';
    devices.forEach((dv, i) => {
      const o = document.createElement('option');
      o.value = dv.deviceId;
      o.textContent = dv.label || (dv.deviceId === 'default' ? 'Par défaut' : `Périphérique ${i + 1}`);
      sel.appendChild(o);
    });
    if (saved && devices.some((dv) => dv.deviceId === saved)) sel.value = saved;
    else {
      const g = devices.find((dv) => dv.label && guess(dv.label));
      if (g) sel.value = g.deviceId;
    }
  }

  /* ---------------------------------------------------------------
   * Démarrage / arrêt selon le mode choisi
   *   Auto = les deux canaux · Écoute = canal écoute · Parle = canal parle
   * ------------------------------------------------------------- */
  async function start(mode) {
    if (!supported()) {
      toast('Mode Écouteurs : utilisez Chrome ou Edge sur ordinateur (Réglages → Sortie audio).', true);
      return;
    }
    const s = S.settings;
    if (!s.hsCallIn || !s.hsMicIn || !s.hsCallOut) {
      openSettings();
      toast('Choisissez les périphériques du mode Écouteurs, puis Enregistrer.', true);
      return;
    }
    if (!getKey()) { openSettings(); toast('Saisissez votre clé API OpenAI.', true); return; }

    const want = mode === 'auto' ? ['listen', 'speak'] : [mode];
    S.mode = mode;
    renderModeButtons();
    el.stop.disabled = false;
    el.liveDir.textContent = mode === 'auto' ? 'Écouteurs — deux sens simultanés' : (mode === 'listen' ? 'Anglais → Français (écouteurs)' : 'Français → Anglais (vers l’appel)');

    // Ferme les canaux qui ne servent plus, ouvre ceux qui manquent
    Object.keys(channels).forEach((k) => { if (!want.includes(k)) closeChannel(k); });
    setStatus('connecting', 'Écouteurs — connexion…');
    try {
      for (const dir of want) if (!channels[dir]) await openChannel(dir);
      if (S.mode !== mode) return; // Stop pressé pendant la connexion
      startMonitor();
      startMeter();
      await requestWakeLock();
      if (!S.usage.startedAt) S.usage.startedAt = Date.now();
      setStatus('on', 'Écouteurs — ' + labelMode(mode) + (want.length === 2 ? ' (2 sens)' : ''));
    } catch (err) {
      if (err.aborted) return;
      console.error(err);
      toast(err.message || String(err), true);
      stopAll(true);
    }
  }

  function stop() {
    Object.keys(channels).forEach(closeChannel);
    if (monitorEl) { monitorEl.srcObject = null; monitorEl.remove(); monitorEl = null; }
    stopMeter();
  }

  const isActive = () => Object.keys(channels).length > 0;

  /* ---------------------------------------------------------------
   * Un canal = une session Realtime avec son entrée et sa sortie
   * ------------------------------------------------------------- */
  async function openChannel(dir) {
    const s = S.settings;
    const ch = {
      dir, pc: null, dc: null, stream: null, audio: null,
      entries: new Map(), respToEntry: new Map(), pending: [], serverItems: [],
      silenced: new Set(), gen: S.gen,
    };
    channels[dir] = ch;
    const alive = () => {
      if (channels[dir] === ch && ch.gen === S.gen) return;
      throw Object.assign(new Error('aborted'), { aborted: true });
    };

    // Entrée : son de l'appel (numérique, pas de traitement) ou votre micro (traité)
    const fromCall = dir === 'listen';
    ch.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: fromCall ? s.hsCallIn : s.hsMicIn },
        echoCancellation: !fromCall, noiseSuppression: !fromCall, autoGainControl: !fromCall, channelCount: 1,
      },
    });
    try { alive(); } catch (e) { ch.stream.getTracks().forEach((t) => t.stop()); throw e; }

    // Sortie : vos écouteurs (FR) ou le câble vers l'appel (EN)
    ch.audio = new Audio();
    ch.audio.autoplay = true;
    const sink = fromCall ? s.hsEarOut : s.hsCallOut;
    if (sink) { try { await ch.audio.setSinkId(sink); } catch (e) { console.warn('setSinkId', e); toast('Sortie audio introuvable : vérifiez les Réglages.', true); } }

    const pc = new RTCPeerConnection();
    ch.pc = pc;
    pc.ontrack = (e) => { ch.audio.srcObject = e.streams[0]; ch.audio.play().catch(() => {}); };
    pc.addTrack(ch.stream.getAudioTracks()[0], ch.stream);
    pc.onconnectionstatechange = () => {
      if (channels[dir] !== ch) return;
      if (pc.connectionState === 'failed') {
        toast('Écouteurs : canal « ' + labelMode(dir) + ' » perdu — reconnexion…', true);
        closeChannel(dir);
        if (S.mode) setTimeout(() => { if (S.mode && !channels[dir]) openChannel(dir).catch((e) => toast(e.message, true)); }, 800);
      }
    };
    const dc = pc.createDataChannel('oai-events');
    ch.dc = dc;
    dc.onmessage = (e) => { try { onEvent(ch, JSON.parse(e.data)); } catch (err) { console.warn(err); } };
    const dcOpen = new Promise((res) => { dc.onopen = res; });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    alive();

    const session = channelSession(dir);
    let ek;
    try { ek = await createClientSecret(getKey(), session); }
    catch (err) {
      if (err.status === 400 && /reasoning/i.test(err.message) && session.reasoning) {
        REASONING_REJECTED = true;
        ek = await createClientSecret(getKey(), channelSession(dir));
      } else throw err;
    }
    alive();
    const answer = await postSdp(offer.sdp, ek);
    alive();
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    await Promise.race([dcOpen, new Promise((_, rej) => setTimeout(() => rej(new Error('Délai dépassé (canal ' + dir + ').')), 10000))]);
    alive();
  }

  /** Session d'un canal : direction fixe, pas d'anti-écho nécessaire. */
  function channelSession(dir) {
    const base = buildSession(dir);
    const s = S.settings;
    if (dir === 'listen') {
      base.output_modalities = s.hsHearFr ? ['audio'] : ['text'];
      base.instructions = BASE_INSTRUCTIONS + '\n' + MODE_INSTRUCTIONS.listen;
      delete base.audio.input.noise_reduction; // signal numérique propre venant du câble : pas de filtrage
    } else {
      base.output_modalities = ['audio'];
      base.instructions = BASE_INSTRUCTIONS + '\n' + MODE_INSTRUCTIONS.speak +
        '\nThe listener hears you through a phone or video call.' + (ACCENTS[s.accent] || '');
      base.audio.input.noise_reduction = { type: 'near_field' }; // micro proche de la bouche
    }
    return base;
  }

  function closeChannel(dir) {
    const ch = channels[dir];
    if (!ch) return;
    delete channels[dir];
    try { ch.dc && ch.dc.close(); } catch {}
    try { ch.pc && ch.pc.close(); } catch {}
    if (ch.stream) ch.stream.getTracks().forEach((t) => t.stop());
    if (ch.audio) { ch.audio.srcObject = null; }
  }

  const sendTo = (ch, obj) => { if (ch.dc && ch.dc.readyState === 'open') ch.dc.send(JSON.stringify(obj)); };

  /* ---------------------------------------------------------------
   * Événements d'un canal → historique commun
   * ------------------------------------------------------------- */
  function entryOf(ch, itemId) {
    let e = ch.entries.get(itemId);
    if (!e) {
      e = { id: ch.dir[0] + '_' + itemId, t: Date.now(), mode: ch.dir, src: '', dst: '', dir: ch.dir === 'listen' ? 'EN→FR' : 'FR→EN' };
      ch.entries.set(itemId, e);
    }
    return e;
  }
  const entryForResp = (ch, rid) => { const it = ch.respToEntry.get(rid); return it ? ch.entries.get(it) : null; };

  function onEvent(ch, ev) {
    switch (ev.type) {
      case 'input_audio_buffer.committed':
        ch.pending.push(ev.item_id);
        entryOf(ch, ev.item_id);
        break;

      case 'conversation.item.added':
      case 'conversation.item.created':
        if (ev.item && ev.item.id && !ch.serverItems.includes(ev.item.id)) {
          ch.serverItems.push(ev.item.id);
          while (ch.serverItems.length > MAX_CONTEXT_ITEMS) {
            const id = ch.serverItems.shift();
            sendTo(ch, { type: 'conversation.item.delete', item_id: id, event_id: 'del_' + id.slice(-20) });
          }
        }
        break;

      case 'conversation.item.input_audio_transcription.delta':
      case 'conversation.item.input_audio_transcription.completed': {
        if (ch.silenced.has(ev.item_id)) break;
        const e = entryOf(ch, ev.item_id);
        e.src = ev.type.endsWith('completed') ? (ev.transcript || e.src || '').trim() : e.src + (ev.delta || '');
        if (e.dst && !isSilent(e.dst)) { renderEntry(e); if (ev.type.endsWith('completed')) persistEntry(e); }
        break;
      }

      case 'response.created': {
        const rid = ev.response && ev.response.id;
        const itemId = ch.pending.shift() || ('r_' + rid);
        ch.respToEntry.set(rid, itemId);
        entryOf(ch, itemId).dst = '';
        break;
      }

      case 'response.output_text.delta':
      case 'response.output_audio_transcript.delta': {
        const e = entryForResp(ch, ev.response_id);
        if (!e || e.suppressed) break;
        e.dst += ev.delta || '';
        if (e.dst.trim().startsWith(SILENT_MARK)) {
          // Rien à traduire : on annule pour que rien ne parte vers l'appel / les écouteurs
          e.suppressed = true;
          sendTo(ch, { type: 'response.cancel', response_id: ev.response_id });
          break;
        }
        renderLive(e); renderEntry(e);
        break;
      }

      case 'response.output_text.done':
      case 'response.output_audio_transcript.done': {
        const e = entryForResp(ch, ev.response_id);
        if (!e || e.suppressed) break;
        e.dst = (ev.text || ev.transcript || e.dst || '').trim();
        renderLive(e); renderEntry(e);
        break;
      }

      case 'response.done': {
        const r = ev.response || {};
        if (r.usage) { S.usage.input += r.usage.input_tokens || 0; S.usage.output += r.usage.output_tokens || 0; renderUsage(); }
        const e = entryForResp(ch, r.id);
        ch.respToEntry.delete(r.id);
        if (!e) break;
        const itemId = [...ch.entries].find(([, v]) => v === e);
        if (e.suppressed || isSilent(e.dst)) {
          removeEntryDom(e);
          if (itemId) { ch.silenced.add(itemId[0]); ch.entries.delete(itemId[0]); }
        } else { persistEntry(e); renderEntry(e); }
        break;
      }

      case 'error': {
        const er = ev.error || {};
        if ((er.event_id || '').startsWith('del_')) break;
        if (er.code === 'response_cancel_not_active' || /no active response/i.test(er.message || '')) break;
        toast('OpenAI (' + labelMode(ch.dir) + ') : ' + (er.message || 'erreur'), true);
        break;
      }
    }
  }

  /* ---------------------------------------------------------------
   * Voix originale en fond (volume 20 %) dans les écouteurs
   * ------------------------------------------------------------- */
  function startMonitor() {
    const ch = channels.listen;
    if (!S.settings.hsMonitor || !ch || monitorEl) return;
    monitorEl = new Audio();
    monitorEl.volume = 0.2;
    if (S.settings.hsEarOut) monitorEl.setSinkId(S.settings.hsEarOut).catch(() => {});
    monitorEl.srcObject = ch.stream;
    monitorEl.play().catch(() => {});
  }

  /* ---------------------------------------------------------------
   * Jauge : niveau du son de l'appel et de votre micro (le plus fort)
   * ------------------------------------------------------------- */
  function startMeter() {
    stopMeter();
    try {
      meterCtx = new (window.AudioContext || window.webkitAudioContext)();
      meterCtx.resume().catch(() => {});
      const analysers = Object.values(channels).map((ch) => {
        const a = meterCtx.createAnalyser(); a.fftSize = 512;
        meterCtx.createMediaStreamSource(ch.stream).connect(a);
        return a;
      });
      const buf = new Uint8Array(512);
      el.mic.classList.add('active');
      const tick = () => {
        let peak = 0;
        analysers.forEach((a) => {
          a.getByteTimeDomainData(buf);
          let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
          peak = Math.max(peak, Math.sqrt(sum / buf.length));
        });
        el.micLevel.style.width = Math.min(100, peak * 400) + '%';
        meterRaf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) { console.warn('Jauge écouteurs', e); }
  }
  function stopMeter() {
    cancelAnimationFrame(meterRaf);
    if (meterCtx) meterCtx.close().catch(() => {});
    meterCtx = null;
  }

  return { supported, populate, start, stop, isActive, _channels: channels, _onEvent: onEvent };
})();
