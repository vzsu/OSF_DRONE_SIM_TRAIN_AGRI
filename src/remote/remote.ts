// Phone / tablet screen: opened from the QR code (…/remote?t=<token>). Live telemetry arrives over
// Server-Sent Events, the drone camera as an MJPEG stream; commands go back with plain POSTs.
// Shows the same ground-station UI as the simulator (agri spray app or camera-drone app).
import { GcsUI } from '../gcs/ui';
import type { Telemetry, WorldGeo, GcsCmd } from '../gcs/host';

let started = false;

export function startRemote(root: HTMLElement) {
  if (started) return; started = true;
  const t = new URLSearchParams(location.search).get('t') ?? '';
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(t)) {
    root.innerHTML = `<div class="screen"><div class="wrap" style="max-width:460px"><h1>Drone screen</h1>
      <div class="card"><p>Scan the QR code shown on the simulator:<br><b>Esc → Phone / tablet screen</b>.</p></div></div></div>`;
    return;
  }
  let tel: Telemetry | null = null, world: WorldGeo | null = null, lastMsg = 0;
  const pending = new Map<number, (e: string) => void>(); let nextId = 1;
  const es = new EventSource(`/live/${t}/events?role=view`);
  es.addEventListener('tel', (ev) => {
    const x = JSON.parse((ev as MessageEvent).data) as Telemetry;
    if (x.world) world = x.world;
    if (!x.cov.img && tel?.cov.img) x.cov.img = tel.cov.img;
    tel = x; lastMsg = performance.now();
  });
  es.addEventListener('ack', (ev) => { const a = JSON.parse((ev as MessageEvent).data) as { id: number; err: string }; pending.get(a.id)?.(a.err ?? ''); pending.delete(a.id); });

  const video = document.createElement('img'); video.className = 'remote-video'; video.alt = 'drone camera';
  video.src = `/live/${t}/video`;
  video.onerror = () => setTimeout(() => (video.src = `/live/${t}/video?r=${Date.now()}`), 1500); // reconnect

  root.innerHTML = '';
  const top = document.createElement('div'); top.className = 'remote-top';
  top.innerHTML = `<b>OSF</b><button data-v="gcs" class="on">Ground station</button><button data-v="cam">Camera</button><span id="osd" class="mono" style="margin-left:auto;font-size:12px"></span><button id="fs">⤢</button>`;
  root.appendChild(top);
  const box = document.createElement('div'); root.appendChild(box);
  const ui = new GcsUI({
    tel: () => tel, world: () => world, video: () => video,
    send: (c: GcsCmd) => new Promise<string>((res) => {
      const id = nextId++; pending.set(id, res);
      fetch(`/live/${t}/cmd`, { method: 'POST', body: JSON.stringify({ id, c }) })
        .then(async (r) => { if (!r.ok) { pending.delete(id); res(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Not delivered'); } })
        .catch(() => { pending.delete(id); res('Server unreachable'); });
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); res('No answer from the simulator'); } }, 4000);
    }),
  }, box, false);
  ui.root.style.top = '44px';
  const camView = document.createElement('div'); camView.style.display = 'none'; root.appendChild(camView);
  camView.appendChild(video);
  top.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) => (b.onclick = () => {
    const cam = b.dataset.v === 'cam';
    if (cam) camView.appendChild(video); // the camera ground-station may have borrowed it
    camView.style.display = cam ? 'block' : 'none'; ui.root.style.display = cam ? 'none' : 'block';
    top.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  top.querySelector<HTMLButtonElement>('#fs')!.onclick = () => void document.documentElement.requestFullscreen?.().catch(() => {});
  setInterval(() => {
    const osd = top.querySelector('#osd')!;
    if (!tel || performance.now() - lastMsg > 3000) { osd.textContent = tel ? 'waiting for simulator…' : 'connecting…'; return; }
    osd.textContent = `${tel.modeName} · H ${tel.agl.toFixed(1)} m · ${tel.gs.toFixed(1)} m/s · ${(tel.soc * 100).toFixed(0)}% · ${tel.sats.toFixed(0)}★`;
  }, 250);
}
