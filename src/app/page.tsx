'use client';
// The simulator is a client-only app (WebGL, WebAssembly, Gamepad API).
// React renders the DOM shell; the sim modules are loaded after mount so nothing runs on the server.
import { useEffect } from 'react';

export default function Page() {
  useEffect(() => {
    let cancelled = false;
    import('../main').then((m) => { if (!cancelled) m.startApp(); });
    return () => { cancelled = true; };
  }, []);
  return (
    <>
      <canvas id="gl" />
      <div id="hud" className="hidden" />
      <div id="ui" />
      <div id="toasts" />
    </>
  );
}
