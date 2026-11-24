'use client';
// The simulator is a client-only app (WebGL, WebAssembly, Gamepad API).
// React renders the DOM shell; the sim modules are loaded after mount so nothing runs on the server.
import { useEffect, useState } from 'react';

/** WebGL can be missing when the browser's GPU process crashed (often low memory) or hardware
 *  acceleration is off — show how to fix it instead of a blank page. */
function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    (gl as WebGL2RenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch { return false; }
}

export default function Page() {
  const [noGl, setNoGl] = useState(false);
  useEffect(() => {
    if (!hasWebGL()) { setNoGl(true); return; }
    let cancelled = false;
    import('../../main').then((m) => { if (!cancelled) m.startApp(); }).catch((e) => { console.error(e); setNoGl(true); });
    return () => { cancelled = true; };
  }, []);
  return (
    <>
      <canvas id="gl" />
      <div id="lens" />
      <div id="hud" className="hidden" />
      <div id="ui">
        {noGl && (
          <div className="screen"><div className="wrap" style={{ maxWidth: 640 }}>
            <h1>3D graphics are off</h1>
            <div className="card" style={{ marginTop: 18 }}>
              <p><b>The browser could not start WebGL</b>, so the 3D simulator can&apos;t run.</p>
              <ol>
                <li>Close other heavy programs (the PC may be low on memory), then <b>fully restart Chrome / Edge</b>.</li>
                <li>Chrome: Settings → System → turn on <b>Use graphics acceleration when available</b>, relaunch.</li>
                <li>Check <span className="mono">chrome://gpu</span> — &quot;WebGL: Hardware accelerated&quot; should be listed.</li>
              </ol>
              <button className="primary" onClick={() => location.reload()}>Try again</button>
            </div>
          </div></div>
        )}
      </div>
      <div id="toasts" />
    </>
  );
}
