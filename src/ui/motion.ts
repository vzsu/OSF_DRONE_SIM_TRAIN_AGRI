// Motion system (GSAP). Apple-like feel: short, physically plausible, interruptible.
//  - screens: content rises in with a soft stagger (expo.out), never longer than ~0.6 s
//  - dialogs: backdrop fades, card springs from 94 % (back.out) — closes faster than it opens
//  - buttons: press-down squash + elastic release
//  - toasts, bottom sheet (ground-station tablet), count-ups, attention pulses
// Everything is skipped for users with "reduce motion" turned on.
import gsap from 'gsap';

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
gsap.defaults({ overwrite: 'auto' });

/** New screen content: header first, then cards / rows in a quick stagger. */
export function enterScreen(root: HTMLElement) {
  if (reduced()) return;
  const wrap = root.querySelector('.wrap') ?? root;
  gsap.fromTo(root, { opacity: 0 }, { opacity: 1, duration: 0.28, ease: 'power1.out' });
  const head = wrap.querySelectorAll(':scope > .row:first-child, :scope > .home-hero');
  gsap.fromTo(head, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, ease: 'expo.out' });
  const items = Array.from(wrap.querySelectorAll('.card, .menu > button, .tabs')).slice(0, 24);
  gsap.fromTo(items, { y: 22, opacity: 0, scale: 0.985 }, { y: 0, opacity: 1, scale: 1, duration: 0.6, ease: 'expo.out', stagger: 0.035, delay: 0.05, clearProps: 'transform' });
}

/** Modal dialog in: backdrop fade + spring card. */
export function popIn(backdrop: HTMLElement) {
  if (reduced()) return;
  const card = backdrop.querySelector('.card') ?? backdrop.firstElementChild;
  gsap.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: 0.22, ease: 'power1.out' });
  if (card) gsap.fromTo(card, { scale: 0.94, y: 14, opacity: 0 }, { scale: 1, y: 0, opacity: 1, duration: 0.5, ease: 'back.out(1.5)', clearProps: 'transform' });
}
/** Modal dialog out, then remove. */
export function popOut(backdrop: HTMLElement, done?: () => void) {
  if (reduced()) { backdrop.remove(); done?.(); return; }
  const card = backdrop.querySelector('.card') ?? backdrop.firstElementChild;
  gsap.to(card, { scale: 0.97, y: 8, opacity: 0, duration: 0.18, ease: 'power2.in' });
  gsap.to(backdrop, { opacity: 0, duration: 0.2, ease: 'power1.in', onComplete: () => { backdrop.remove(); done?.(); } });
}

export function toastIn(el: HTMLElement) {
  if (reduced()) return;
  gsap.fromTo(el, { x: 26, opacity: 0, scale: 0.96 }, { x: 0, opacity: 1, scale: 1, duration: 0.45, ease: 'expo.out' });
}
export function toastOut(el: HTMLElement) {
  if (reduced()) { el.remove(); return; }
  gsap.to(el, { opacity: 0, y: -6, duration: 0.25, ease: 'power1.in', onComplete: () => el.remove() });
}

/** Bottom sheet (ground-station tablet): spring up, quick down. */
export function sheet(el: HTMLElement, open: boolean) {
  if (reduced()) { gsap.set(el, { xPercent: -50, yPercent: open ? 0 : 104 }); return; }
  gsap.to(el, open
    ? { xPercent: -50, yPercent: 0, duration: 0.62, ease: 'expo.out' }
    : { xPercent: -50, yPercent: 104, duration: 0.34, ease: 'power3.in' });
}

/** Number tween (scores, stats). */
export function countUp(el: HTMLElement, to: number, decimals = 0, dur = 1.1) {
  if (reduced()) { el.textContent = to.toFixed(decimals); return; }
  const o = { v: 0 };
  gsap.to(o, { v: to, duration: dur, ease: 'power3.out', onUpdate: () => { el.textContent = o.v.toFixed(decimals); } });
}
/** Grow bars from 0 (debrief score bars, progress). */
export function growBars(els: Iterable<HTMLElement>) {
  if (reduced()) return;
  gsap.from(Array.from(els), { scaleX: 0, transformOrigin: 'left center', duration: 0.9, ease: 'expo.out', stagger: 0.04, delay: 0.15 });
}
/** Short attention pulse (new warning, objective done). */
export function pulse(el: HTMLElement, strong = false) {
  if (reduced()) return;
  gsap.fromTo(el, { scale: strong ? 1.08 : 1.04 }, { scale: 1, duration: strong ? 0.7 : 0.45, ease: 'elastic.out(1, 0.45)' });
}
/** Celebration for a passed lesson: card pops, confetti-like dots burst. */
export function celebrate(el: HTMLElement) {
  if (reduced()) return;
  gsap.fromTo(el, { scale: 0.85, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.7, ease: 'back.out(2)' });
  const colors = ['#ffd23f', '#3bceac', '#ff6b6b', '#4d7cfe', '#c3a6ff'];
  const r = el.getBoundingClientRect();
  for (let i = 0; i < 28; i++) {
    const d = document.createElement('i'); d.className = 'confetti';
    d.style.background = colors[i % colors.length]; d.style.left = `${r.left + r.width / 2}px`; d.style.top = `${r.top + 30}px`;
    document.body.appendChild(d);
    const a = Math.random() * Math.PI * 2, v = 120 + Math.random() * 220;
    gsap.to(d, { x: Math.cos(a) * v, y: Math.sin(a) * v - 80, rotation: Math.random() * 540, opacity: 0, duration: 1.1 + Math.random() * 0.6, ease: 'power2.out', onComplete: () => d.remove() });
  }
}

/** Global press feedback for every button: squash on press, elastic release. */
let pressBound = false;
export function bindPressFeedback() {
  if (pressBound || typeof window === 'undefined') return;
  pressBound = true;
  const target = (e: Event) => (e.target as HTMLElement | null)?.closest?.('button, .slide-thumb, .card.click') as HTMLElement | null;
  window.addEventListener('pointerdown', (e) => {
    const b = target(e); if (!b || reduced() || (b as HTMLButtonElement).disabled) return;
    gsap.to(b, { scale: b.classList.contains('card') ? 0.985 : 0.95, duration: 0.09, ease: 'power2.out' });
  }, { passive: true });
  const release = (e: Event) => {
    const b = target(e); if (!b || reduced()) return;
    gsap.to(b, { scale: 1, duration: 0.55, ease: 'elastic.out(1.1, 0.45)', clearProps: 'scale' });
  };
  window.addEventListener('pointerup', release, { passive: true });
  window.addEventListener('pointercancel', release, { passive: true });
}
