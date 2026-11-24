// Orbit / free-look camera for watching an AUTO spray mission (key O). Only allowed while a mission runs.
//  - idle: slowly circles the drone ("orbiting view")
//  - W/A/S/D: move the camera focus over the ground like a game (Shift = faster) → stops following the drone
//  - Q/E: rotate around the focus · mouse drag: rotate + tilt · wheel or Z/X: zoom
//  - Tab: follow the drone again
// Three.js coordinates (y up). The flight keys are disconnected from the sticks while this is on
// (see setKbFlightLock in input.ts), so W/A/S/D never move the aircraft.
import * as THREE from 'three';

export class OrbitCam {
  on = false;
  follow = true;
  focus = new THREE.Vector3();
  az = 0; el = 0.45; dist = 22;
  private idle = 0;
  private drag: { x: number; y: number } | null = null;

  start(dronePos: THREE.Vector3, camPos: THREE.Vector3) {
    this.on = true; this.follow = true; this.idle = 0;
    this.focus.copy(dronePos);
    const d = camPos.clone().sub(dronePos);
    this.az = Math.atan2(d.z, d.x);
    this.dist = THREE.MathUtils.clamp(Math.hypot(d.x, d.z, d.y), 12, 40);
    this.el = 0.45;
  }

  /** wire mouse drag + wheel on the canvas (only acts while on) */
  bind(el: HTMLElement) {
    el.addEventListener('pointerdown', (e) => { if (this.on && e.button === 0) { this.drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); } });
    el.addEventListener('pointermove', (e) => {
      if (!this.on || !this.drag) return;
      this.az += (e.clientX - this.drag.x) * 0.006;
      this.el = THREE.MathUtils.clamp(this.el + (e.clientY - this.drag.y) * 0.005, 0.05, 1.45);
      this.drag = { x: e.clientX, y: e.clientY }; this.idle = 0;
    });
    el.addEventListener('pointerup', () => (this.drag = null));
    el.addEventListener('wheel', (e) => { if (!this.on) return; e.preventDefault(); this.zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12); }, { passive: false });
  }
  zoom(f: number) { this.dist = THREE.MathUtils.clamp(this.dist * f, 4, 150); this.idle = 0; }

  /** held(code) → is that key down */
  update(c: THREE.PerspectiveCamera, dronePos: THREE.Vector3, dt: number, held: (code: string) => boolean) {
    const fast = held('ShiftLeft') || held('ShiftRight') ? 3 : 1;
    const fwd = (held('KeyW') ? 1 : 0) - (held('KeyS') ? 1 : 0);
    const side = (held('KeyD') ? 1 : 0) - (held('KeyA') ? 1 : 0);
    const rot = (held('KeyE') ? 1 : 0) - (held('KeyQ') ? 1 : 0);
    const zm = (held('KeyX') ? 1 : 0) - (held('KeyZ') ? 1 : 0);
    if (fwd || side) {
      this.follow = false;
      // forward = direction the camera looks, flattened onto the ground
      const f = new THREE.Vector3(-Math.cos(this.az), 0, -Math.sin(this.az));
      const r = new THREE.Vector3(-f.z, 0, f.x);
      const sp = Math.max(4, this.dist * 0.8) * fast * dt;
      this.focus.addScaledVector(f, fwd * sp).addScaledVector(r, side * sp);
    }
    if (rot) this.az += rot * 1.2 * dt;
    if (zm) this.zoom(1 + zm * 1.5 * dt);
    if (fwd || side || rot || zm || this.drag) this.idle = 0; else this.idle += dt;
    if (held('Tab')) this.follow = true;
    if (this.follow) this.focus.lerp(dronePos, 1 - Math.exp(-dt * 4));
    if (this.idle > 3) this.az += 0.15 * dt; // hands off → slow orbit
    this.focus.y = Math.max(this.focus.y, 0);
    const h = Math.cos(this.el) * this.dist;
    c.up.set(0, 1, 0);
    c.position.set(this.focus.x + Math.cos(this.az) * h, Math.max(this.focus.y + Math.sin(this.el) * this.dist, 1), this.focus.z + Math.sin(this.az) * h);
    c.lookAt(this.focus);
  }
}
