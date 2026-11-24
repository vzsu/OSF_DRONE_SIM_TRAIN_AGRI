import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { OrbitCam } from '../src/render/orbitCam';

const run = (o: OrbitCam, c: THREE.PerspectiveCamera, drone: THREE.Vector3, secs: number, held: string[] = []) => {
  for (let t = 0; t < secs; t += 0.02) o.update(c, drone, 0.02, (k) => held.includes(k));
};

describe('orbit camera (AUTO mission view)', () => {
  it('follows the drone, W moves the camera forward and stops following, Tab follows again', () => {
    const o = new OrbitCam(), c = new THREE.PerspectiveCamera();
    const drone = new THREE.Vector3(0, 4, 0);
    o.start(drone, new THREE.Vector3(20, 6, 0));
    run(o, c, drone, 1);
    expect(o.focus.distanceTo(drone)).toBeLessThan(0.1);
    const lookDir = new THREE.Vector3(); c.getWorldDirection(lookDir); lookDir.y = 0; lookDir.normalize();
    const before = o.focus.clone();
    run(o, c, drone, 1, ['KeyW']);
    expect(o.follow).toBe(false);
    const moved = o.focus.clone().sub(before); moved.y = 0;
    expect(moved.length()).toBeGreaterThan(5);
    expect(moved.normalize().dot(lookDir)).toBeGreaterThan(0.99); // W = where the camera looks
    run(o, c, drone, 2, ['Tab']);
    expect(o.follow).toBe(true);
    expect(o.focus.distanceTo(drone)).toBeLessThan(0.5);
  });
  it('circles slowly when hands-off and never goes below the ground', () => {
    const o = new OrbitCam(), c = new THREE.PerspectiveCamera();
    const drone = new THREE.Vector3(0, 2, 0);
    o.start(drone, new THREE.Vector3(15, 3, 0));
    const az0 = o.az; o.el = 0.05;
    run(o, c, drone, 8);
    expect(o.az - az0).toBeGreaterThan(0.5);
    expect(c.position.y).toBeGreaterThanOrEqual(1);
  });
});
