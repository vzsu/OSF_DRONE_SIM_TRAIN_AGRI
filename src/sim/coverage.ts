// Spray coverage on a 1 m grid. Each spray "pass" (continuous run in one direction) adds at most
// one layer per cell, so overlap = cells sprayed by 2+ passes. Droplets drift with the wind:
// fall time ≈ height / settling speed, drift ≈ wind × fall time (fine droplets drift further).
import { pointInPoly, type Pt } from './mission';

export const GRID = { x0: -80, y0: -50, w: 160, h: 190 }; // metres, 1 m cells

export interface CoverageStats { targetM2: number; coveredPct: number; overlapPct: number; offTargetM2: number; sprayedM2: number }

const SETTLE = 2.5; // m/s, medium droplets in the rotor downwash

export class Coverage {
  count = new Uint8Array(GRID.w * GRID.h);
  lastPass = new Uint16Array(GRID.w * GRID.h);
  mask = new Uint8Array(GRID.w * GRID.h);
  pass = 1;
  dirty = true;
  private lastHeading = NaN;
  private wasSpraying = false;
  private lastPos: Pt | null = null;

  setTarget(poly: Pt[]) {
    this.mask.fill(0);
    for (let j = 0; j < GRID.h; j++) for (let i = 0; i < GRID.w; i++) {
      if (pointInPoly(GRID.x0 + i + 0.5, GRID.y0 + j + 0.5, poly)) this.mask[j * GRID.w + i] = 1;
    }
    this.dirty = true;
  }
  reset() { this.count.fill(0); this.lastPass.fill(0); this.pass = 1; this.lastHeading = NaN; this.wasSpraying = false; this.lastPos = null; this.dirty = true; }

  /** Call every frame. x,y drone position, agl height, wind at drone, swath width. */
  update(spraying: boolean, x: number, y: number, agl: number, windX: number, windY: number, swath: number) {
    if (!spraying) { this.wasSpraying = false; this.lastPos = null; return; }
    if (this.lastPos && Math.hypot(x - this.lastPos[0], y - this.lastPos[1]) < 0.5) return;
    if (this.lastPos) {
      const hd = Math.atan2(y - this.lastPos[1], x - this.lastPos[0]);
      if (!Number.isNaN(this.lastHeading)) {
        let d = Math.abs(hd - this.lastHeading); if (d > Math.PI) d = 2 * Math.PI - d;
        if (d > 1.0) this.pass++; // turned > ~60° → new pass
      }
      this.lastHeading = hd;
    }
    if (!this.wasSpraying) this.pass++;
    this.wasSpraying = true;
    this.lastPos = [x, y];
    // swath widens a little with height, drift moves it downwind
    const fall = Math.max(agl, 0.5) / SETTLE;
    const cx = x + windX * fall * 0.6, cy = y + windY * fall * 0.6;
    const r = swath / 2 * Math.min(1.3, 0.8 + agl * 0.08);
    const pass = this.pass & 0xffff;
    for (let j = Math.floor(cy - r - GRID.y0); j <= Math.ceil(cy + r - GRID.y0); j++) {
      if (j < 0 || j >= GRID.h) continue;
      for (let i = Math.floor(cx - r - GRID.x0); i <= Math.ceil(cx + r - GRID.x0); i++) {
        if (i < 0 || i >= GRID.w) continue;
        const dx = GRID.x0 + i + 0.5 - cx, dy = GRID.y0 + j + 0.5 - cy;
        if (dx * dx + dy * dy > r * r) continue;
        const k = j * GRID.w + i;
        if (this.lastPass[k] !== pass) { this.lastPass[k] = pass; if (this.count[k] < 255) this.count[k]++; this.dirty = true; }
      }
    }
  }

  stats(): CoverageStats {
    let target = 0, cov = 0, over = 0, off = 0, sprayed = 0;
    for (let k = 0; k < this.count.length; k++) {
      const c = this.count[k];
      if (c) sprayed++;
      if (this.mask[k]) { target++; if (c >= 1) cov++; if (c >= 2) over++; }
      else if (c) off++;
    }
    return { targetM2: target, coveredPct: target ? cov / target * 100 : 0, overlapPct: target ? over / target * 100 : 0, offTargetM2: off, sprayedM2: sprayed };
  }

  /** RGBA image, 1 px per cell, north up (row 0 = north edge). */
  image(): ImageData {
    const img = new ImageData(GRID.w, GRID.h);
    const d = img.data;
    for (let j = 0; j < GRID.h; j++) for (let i = 0; i < GRID.w; i++) {
      const k = j * GRID.w + i, o = ((GRID.h - 1 - j) * GRID.w + i) * 4;
      const c = this.count[k], m = this.mask[k];
      if (c === 0) { if (m) { d[o] = 255; d[o + 1] = 255; d[o + 2] = 255; d[o + 3] = 28; } continue; }
      if (!m) { d[o] = 255; d[o + 1] = 70; d[o + 2] = 60; d[o + 3] = 190; }           // off-target (drift / outside)
      else if (c === 1) { d[o] = 70; d[o + 1] = 170; d[o + 2] = 255; d[o + 3] = 170; } // covered once
      else { d[o] = 255; d[o + 1] = 190; d[o + 2] = 40; d[o + 3] = 200; }               // overlap (double dose)
    }
    return img;
  }
}
