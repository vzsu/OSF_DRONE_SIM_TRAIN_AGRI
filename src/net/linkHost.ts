// Simulator side of the phone/tablet screen link (no WebRTC — plain HTTP through the training server,
// which works on phone hotspots and networks that block peer-to-peer traffic):
//   • telemetry JSON → POST /live/<token>/tel at 10 Hz → server → viewers (Server-Sent Events)
//   • drone camera JPEG frames → POST /live/<token>/frame at ~12 fps → server → MJPEG <img> on the phone
//   • commands from the phone ← SSE /live/<token>/events?role=host → GcsHost.command → ack
// Pairing: QR code with an unguessable token (shown in the pause menu).
import type { GcsHost, GcsCmd } from '../gcs/host';

export class LinkHost {
  token = '';
  urls: string[] = [];
  qr = '';
  viewers = 0;
  /** the drone-camera picture (also used by the local camera ground-station) */
  aux = document.createElement('canvas');
  private es: EventSource | null = null;
  private telBusy = false; private frameBusy = false;
  private lastTel = 0; private lastFrame = 0; private lastWorld = 0; private worldKey = '';
  private overlay: HTMLElement | null = null;

  constructor(private gcs: GcsHost, private toast: (t: string, bad?: boolean) => void) {
    this.aux.width = 640; this.aux.height = 360;
  }

  async start(): Promise<boolean> {
    if (this.token) return true;
    try {
      const r = await fetch('/live/new', { method: 'POST' });
      const j = (await r.json()) as { token: string; urls: string[]; qr: string };
      this.token = j.token; this.urls = j.urls; this.qr = j.qr;
    } catch { this.toast('Training server unreachable', true); return false; }
    this.es = new EventSource(`/live/${this.token}/events?role=host`);
    this.es.addEventListener('cmd', (ev) => {
      try {
        const m = JSON.parse((ev as MessageEvent).data) as { id: number; c: GcsCmd };
        const err = this.gcs.command(m.c);
        void fetch(`/live/${this.token}/ack`, { method: 'POST', body: JSON.stringify({ id: m.id, err }) });
      } catch { /* ignore malformed */ }
    });
    this.es.addEventListener('viewers', (ev) => {
      const n = +(ev as MessageEvent).data;
      if (n > this.viewers) this.toast(`Phone / tablet screen connected (${n})`);
      this.viewers = n; this.worldKey = '';
      const el = document.getElementById('lk-n'); if (el) el.textContent = String(n);
    });
    return true;
  }

  async showPairing() {
    if (!(await this.start())) return;
    this.overlay?.remove();
    const o = document.createElement('div'); o.className = 'pause'; o.style.zIndex = '70';
    o.innerHTML = `<div class="card nb-pair">
      <h2>Phone / tablet screen</h2>
      <div class="row" style="align-items:flex-start;gap:20px;flex-wrap:wrap">
        <div class="qr">${this.qr || '<p>No network address found</p>'}</div>
        <div style="flex:1;min-width:220px">
          <p><b>1.</b> Connect the phone to the <b>same Wi-Fi / hotspot</b> as this PC.</p>
          <p><b>2.</b> Scan the QR code with the phone camera, or type:</p>
          ${this.urls.map((u) => `<p class="mono" style="word-break:break-all">${u}</p>`).join('')}
          <p><b>3.</b> The phone shows the ground station and the drone camera, live.</p>
          <p class="small">Connected screens: <b id="lk-n">${this.viewers}</b></p>
          <p class="small muted">Not opening? Run <span class="mono">start-sim.cmd -SetupFirewall</span> once on this PC (the phone hotspot counts as a "Public" network, the rule now covers it).</p>
        </div>
      </div>
      <button class="primary" id="lk-ok">Done</button></div>`;
    document.body.appendChild(o);
    this.overlay = o;
    o.querySelector<HTMLButtonElement>('#lk-ok')!.onclick = () => { o.remove(); this.overlay = null; };
  }

  /** Called every frame. `auxFresh` = the aux canvas was redrawn this frame. */
  tick(now: number) {
    if (!this.token || this.viewers <= 0) return;
    if (!this.telBusy && now - this.lastTel >= 100) {
      this.lastTel = now; this.telBusy = true;
      const key = this.gcs.worldGeo().key;
      const withWorld = key !== this.worldKey || now - this.lastWorld > 3000;
      if (withWorld) { this.worldKey = key; this.lastWorld = now; }
      const tel = this.gcs.telemetry(withWorld, true);
      void fetch(`/live/${this.token}/tel`, { method: 'POST', body: JSON.stringify(tel) }).catch(() => {}).finally(() => (this.telBusy = false));
    }
    if (!this.frameBusy && now - this.lastFrame >= 80) {
      this.lastFrame = now; this.frameBusy = true;
      this.aux.toBlob((b) => {
        if (!b) { this.frameBusy = false; return; }
        void fetch(`/live/${this.token}/frame`, { method: 'POST', body: b, headers: { 'content-type': 'image/jpeg' } }).catch(() => {}).finally(() => (this.frameBusy = false));
      }, 'image/jpeg', 0.62);
    }
  }
}
