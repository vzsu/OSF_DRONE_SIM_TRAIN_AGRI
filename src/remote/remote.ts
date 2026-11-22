// Remote device side: pair with the 6-digit code, receive the drone camera + ground-station data
// over WebRTC, and show either the camera (with OSD) or the full ground-station tablet UI.
import { GcsUI } from '../gcs/ui';
import type { Telemetry, WorldGeo, GcsCmd } from '../gcs/host';
import { waitIce } from '../net/linkHost';

let started = false;

export function startRemote(root: HTMLElement) {
  if (started) return; started = true;
  const qs = new URLSearchParams(location.search);
  root.innerHTML = `<div class="screen"><div class="wrap" style="max-width:420px">
    <h1>Drone screen</h1><p class="muted">Use this phone or tablet as the RC ground-station screen or as the drone camera monitor.</p>
    <div class="card"><div class="field"><label>Pairing code (shown on the simulator: pause menu → Phone / tablet screen)</label>
    <input id="rc" inputmode="numeric" maxlength="6" value="${(qs.get('code') ?? '').replace(/\D/g, '')}" style="font-size:28px;letter-spacing:6px"></div>
    <button class="primary" id="go">Connect</button><p class="small" id="st"></p></div></div></div>`;
  const st = root.querySelector<HTMLElement>('#st')!;
  root.querySelector<HTMLButtonElement>('#go')!.onclick = () => void connect(root.querySelector<HTMLInputElement>('#rc')!.value.trim(), root, st);
  if (qs.get('code')) void connect(qs.get('code')!, root, st);
}

async function connect(code: string, root: HTMLElement, st: HTMLElement) {
  if (!/^\d{6}$/.test(code)) { st.textContent = 'Enter the 6-digit code'; return; }
  const me = 'p' + Math.random().toString(36).slice(2, 10);
  st.textContent = 'Connecting…';
  const post = (data: unknown) => fetch(`/api/link/${code}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: me, to: 'host', data }) });
  const j = await post({ type: 'join' }).catch(() => null);
  if (!j || !j.ok) { st.textContent = 'Code not found — check the code on the simulator'; return; }
  const pc = new RTCPeerConnection({ iceServers: [] });
  let tel: Telemetry | null = null, world: WorldGeo | null = null;
  let dc: RTCDataChannel | null = null;
  const pending = new Map<number, (e: string) => void>(); let nextId = 1;
  const video = document.createElement('video'); video.className = 'remote-video'; video.autoplay = true; video.muted = true; video.playsInline = true;
  pc.ontrack = (ev) => { video.srcObject = ev.streams[0] ?? new MediaStream([ev.track]); void video.play().catch(() => {}); };
  pc.ondatachannel = (ev) => {
    dc = ev.channel;
    dc.onmessage = (m) => {
      const msg = JSON.parse(m.data as string);
      if (msg.type === 'tel') {
        const t = msg.tel as Telemetry;
        if (t.world) world = t.world;
        if (!t.cov.img && tel?.cov.img) t.cov.img = tel.cov.img;
        tel = t;
      } else if (msg.type === 'ack') { pending.get(msg.id)?.(msg.err ?? ''); pending.delete(msg.id); }
    };
    dc.onopen = () => show();
    dc.onclose = () => { st.textContent = 'Disconnected'; location.reload(); };
  };
  // wait for the simulator's offer
  let since = 0, answered = false;
  for (let i = 0; i < 40 && !answered; i++) {
    const r = await fetch(`/api/link/${code}?me=${me}&since=${since}`, { cache: 'no-store' }).catch(() => null);
    const msgs = r && r.ok ? ((await r.json()) as { n: number; data: { type: string; sdp: RTCSessionDescriptionInit } }[]) : [];
    for (const m of msgs) {
      since = Math.max(since, m.n);
      if (m.data?.type === 'offer') {
        await pc.setRemoteDescription(m.data.sdp);
        await pc.setLocalDescription(await pc.createAnswer());
        await waitIce(pc);
        await post({ type: 'answer', sdp: pc.localDescription });
        answered = true;
      }
    }
    if (!answered) await new Promise((r2) => setTimeout(r2, 600));
  }
  if (!answered) { st.textContent = 'The simulator did not answer — is a flight running?'; return; }

  function show() {
    root.innerHTML = '';
    const top = document.createElement('div'); top.className = 'remote-top';
    top.innerHTML = `<b>OSF</b><button data-v="gcs" class="on">Ground station</button><button data-v="cam">Camera</button><span id="osd" style="margin-left:auto;font:12px monospace"></span><button id="fs">Full screen</button>`;
    root.appendChild(top);
    const gcsBox = document.createElement('div'); root.appendChild(gcsBox);
    const ui = new GcsUI({
      tel: () => tel, world: () => world,
      send: (c: GcsCmd) => new Promise<string>((res) => {
        if (!dc || dc.readyState !== 'open') return res('Not connected');
        const id = nextId++; pending.set(id, res); dc.send(JSON.stringify({ type: 'cmd', id, c }));
        setTimeout(() => { if (pending.has(id)) { pending.delete(id); res('No answer from the simulator'); } }, 4000);
      }),
    }, gcsBox, false);
    ui.root.style.top = '44px';
    root.appendChild(video); video.style.display = 'none';
    top.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) => (b.onclick = () => {
      const cam = b.dataset.v === 'cam';
      video.style.display = cam ? 'block' : 'none'; ui.root.style.display = cam ? 'none' : 'block';
      top.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('on', x === b));
    }));
    top.querySelector<HTMLButtonElement>('#fs')!.onclick = () => void document.documentElement.requestFullscreen?.().catch(() => {});
    setInterval(() => {
      const t = tel; if (!t) return;
      top.querySelector('#osd')!.textContent = `${t.modeName} · H ${t.agl.toFixed(1)} m · ${t.gs.toFixed(1)} m/s · BAT ${(t.soc * 100).toFixed(0)}% · ${t.sats.toFixed(0)}★`;
    }, 250);
  }
}
