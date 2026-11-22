'use client';
// LAN remote screen: a phone/tablet becomes the RC's ground-station screen or a camera monitor.
import { useEffect } from 'react';

export default function RemotePage() {
  useEffect(() => {
    let cancelled = false;
    import('../../remote/remote').then((m) => { if (!cancelled) m.startRemote(document.getElementById('remote')!); });
    return () => { cancelled = true; };
  }, []);
  return <div id="remote" />;
}
