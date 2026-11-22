// Simulator side of the LAN screen link. A phone/tablet opens https://<server>:3443/remote,
// enters the 6-digit code, and gets over WebRTC (direct, LAN only):
//   • video track: the drone camera (gimbal camera on DJI, nose FPV on agri), 640×360 @ 15 fps
//   • data channel "gcs": telemetry 8 Hz + ground geometry; commands back (plan, start, RTH, batteries…)
// Signalling goes through the training server mailbox (/api/link/<code>) by polling — no extra packages.
import type { Engine } from '../sim/engine';
import type { World3D } from '../render/world3d';
import type { GcsHost, GcsCmd } from '../gcs/host';

interface Peer { id: string; pc: RTCPeerConnection; dc: RTCDataChannel | null; worldKey: string; lastTel: number; lastCov?: string }

export class LinkHost {
  code = '';
  urls: string[] = [];
  private since = 0;
  private peers = new Map<string, Peer>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private aux = document.createElement('canvas');
  private stream: MediaStream | null = null;
  private overlay: HTMLElement | null = null;

  constructor(private engine: Engine, private world: World3D, private gcs: GcsHost, private toast: (t: string, bad?: boolean) => void) {
    this.aux.width = 640; this.aux.height = 360;
  }

  get connected() { return [...this.peers.values()].filter((p) => p.dc?.readyState === 'open').length; }

  async start(): Promise<boolean> {
    if (this.code) return true;
    try {
      const r = await fetch('/api/link', { method: 'POST' });
      if (!r.ok) { this.toast('Sign in on this PC to share screens to other devices', true); return false; }
      const j = (await r.json()) as { code: string; urls: string[] };
      this.code = j.code; this.urls = j.urls; this.since = 0;
      this.pollTimer = setInterval(() => void this.poll(), 700);
      return true;
    } catch { this.toast('Training server unreachable', true); return false; }
  }

  /** Overlay with the pairing code and the address to open on the phone/tablet. */
  async showPairing() {
    if (!(await this.start())) return;
    this.overlay?.remove();
    const o = document.createElement('div'); o.className = 'pause'; o.style.zIndex = '70';
    const url = this.urls[0] ? `${this.urls[0]}/remote?code=${this.code}` : `/remote?code=${this.code}`;
    o.innerHTML = `<div class="card" style="max-width:520px"><h2>Phone / tablet as RC screen</h2>
      <p>On the device (same Wi-Fi) open:</p><p style="font:600 16px var(--mono,monospace);word-break:break-all">${url}</p>
      ${this.urls.slice(1).map((u) => `<p class="small muted">or ${u}/remote</p>`).join('')}
      <p>Pairing code:</p><div style="font:800 44px var(--mono,monospace);letter-spacing:8px">${this.code}</div>
      <p class="small muted">Accept the certificate warning once on the device. It shows the <b>ground-station tablet</b> (plan area, slide to start, batteries) and the <b>drone camera</b>. Connected devices: <b id="lk-n">${this.connected}</b></p>
      <button class="primary" id="lk-ok">Done</button></div>`;
    document.body.appendChild(o);
    this.overlay = o;
    o.querySelector<HTMLButtonElement>('#lk-ok')!.onclick = () => { o.remove(); this.overlay = null; };
  }

  worldChanged() { for (const p of this.peers.values()) p.worldKey = ''; }

  private async post(to: string, data: unknown) {
    await fetch(`/api/link/${this.code}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: 'host', to, data }) }).catch(() => {});
  }

  private async poll() {
    if (!this.code) return;
    let msgs: { n: number; from: string; data: { type: string; sdp?: RTCSessionDescriptionInit } }[] = [];
    try {
      const r = await fetch(`/api/link/${this.code}?me=host&since=${this.since}`, { cache: 'no-store' });
      if (r.status === 404) { this.code = ''; if (this.pollTimer) clearInterval(this.pollTimer); return; }
      msgs = await r.json();
    } catch { return; }
    for (const m of msgs) {
      this.since = Math.max(this.since, m.n);
      if (m.data?.type === 'join') void this.connect(m.from);
      else if (m.data?.type === 'answer' && m.data.sdp) await this.peers.get(m.from)?.pc.setRemoteDescription(m.data.sdp).catch(() => {});
    }
  }

  private async connect(id: string) {
    this.peers.get(id)?.pc.close();
    const pc = new RTCPeerConnection({ iceServers: [] }); // LAN: host candidates only
    const peer: Peer = { id, pc, dc: null, worldKey: '', lastTel: 0 };
    this.peers.set(id, peer);
    if (!this.stream) this.stream = this.aux.captureStream(15);
    for (const tr of this.stream.getVideoTracks()) pc.addTrack(tr, this.stream);
    const dc = pc.createDataChannel('gcs');
    peer.dc = dc;
    dc.onopen = () => { this.toast(`Remote screen connected (${this.connected})`); const n = document.getElementById('lk-n'); if (n) n.textContent = String(this.connected); };
    dc.onclose = () => { this.peers.delete(id); this.toast('Remote screen disconnected'); };
    dc.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data as string) as { type: string; id: number; c: GcsCmd };
        if (m.type === 'cmd') { const err = this.gcs.command(m.c); dc.send(JSON.stringify({ type: 'ack', id: m.id, err })); }
      } catch { /* ignore malformed */ }
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.peers.delete(id); };
    await pc.setLocalDescription(await pc.createOffer());
    await waitIce(pc);
    await this.post(id, { type: 'offer', sdp: pc.localDescription });
  }

  /** Called every frame from the main loop. */
  tick(now: number) {
    if (!this.peers.size) { this.world.auxCtx = null; return; }
    this.world.auxCtx = this.aux.getContext('2d');
    for (const p of this.peers.values()) {
      if (p.dc?.readyState !== 'open' || now - p.lastTel < 125) continue;
      p.lastTel = now;
      const key = `${this.engine.drone.id}`;
      const needWorld = p.worldKey !== this.gcs.worldGeo().key + key;
      const tel = this.gcs.telemetry(needWorld, true);
      if (needWorld) p.worldKey = this.gcs.worldGeo().key + key;
      // the coverage image only travels when it changed
      if (tel.cov.img === p.lastCov) delete tel.cov.img; else p.lastCov = tel.cov.img;
      if (p.dc.bufferedAmount < 256_000) p.dc.send(JSON.stringify({ type: 'tel', tel }));
    }
  }
}

export function waitIce(pc: RTCPeerConnection): Promise<void> {
  return new Promise((res) => {
    if (pc.iceGatheringState === 'complete') return res();
    const t = setTimeout(res, 2500);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
  });
}
