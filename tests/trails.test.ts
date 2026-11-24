import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Trails } from '../src/render/trails';

describe('flight trails', () => {
  it('wingtip lines fade and disappear after 15 s; the blue→yellow path stays', () => {
    const tr = new Trails(); tr.style = 'both';
    const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000); cam.position.set(0, 2, 20); cam.lookAt(0, 2, 0);
    const q = new THREE.Quaternion();
    for (let t = 0; t <= 20; t += 0.1) { tr.sample(new THREE.Vector3(t, 3, 0), q, 0.9, true, t); }
    tr.draw(cam, 800, 20);
    const [left, , path] = tr.group.children as THREE.Mesh[];
    const lp = (tr as unknown as { left: { t: number }[] }).left;
    expect(lp[0].t).toBeGreaterThanOrEqual(5 - 1e-6);              // older than 15 s removed
    expect(tr.pathPoints[0].p.x).toBeLessThan(0.5);                  // whole path kept (from the start…
    expect(tr.pathPoints.at(-1)!.p.x).toBeGreaterThan(19.5);         // …to now)
    const col = (left.geometry.attributes.color as THREE.BufferAttribute);
    expect(col.getW(0)).toBeLessThan(0.02);                          // oldest wingtip point almost transparent
    expect(col.getW((lp.length - 1) * 2)).toBeGreaterThan(0.5);      // newest one visible
    expect(path.visible).toBe(true);
    tr.style = 'wingtip'; tr.draw(cam, 800, 20);
    expect(path.visible).toBe(false);
    tr.style = 'off'; tr.draw(cam, 800, 20);
    expect(tr.group.children.every((m) => !m.visible)).toBe(true);
  });
  it('the path ribbon is 4 px wide on screen', () => {
    const tr = new Trails(); tr.style = 'path';
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 1000); cam.position.set(0, 0, 50); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    for (let i = 0; i < 20; i++) tr.sample(new THREE.Vector3(i - 10, 0, 0), new THREE.Quaternion(), 0.5, true, i);
    tr.draw(cam, 1000, 20);
    const pos = ((tr.group.children[2] as THREE.Mesh).geometry.attributes.position as THREE.BufferAttribute);
    const a = new THREE.Vector3().fromBufferAttribute(pos, 10).project(cam), b = new THREE.Vector3().fromBufferAttribute(pos, 11).project(cam);
    expect(Math.abs(a.y - b.y) * 500).toBeCloseTo(4, 1); // NDC → pixels (height 1000)
  });
});
