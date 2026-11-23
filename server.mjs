// OSF Agri Flight Trainer — Node server for the local network.
//
// Serves the Next.js app on all network interfaces:
//   HTTPS  :3443  ← use this from other PCs. Browsers only allow the Gamepad API (RC transmitter)
//                   on secure pages, and http://<LAN-IP> is NOT secure.
//   HTTP   :3000  ← fine on the server PC itself (http://localhost counts as secure).
//
// A self-signed certificate is created in ./certs on first run (covers localhost + current LAN IPs).
// Each trainee PC must accept the certificate warning once.
//
// Usage: node server.mjs [--dev] [--http-port 3000] [--https-port 3443]
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import next from 'next';
import selfsigned from 'selfsigned';
import { extraRoutes } from './server-live.mjs';

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const dev = process.argv.includes('--dev');
const HTTP_PORT = Number(arg('--http-port', process.env.PORT || 3000));
const HTTPS_PORT = Number(arg('--https-port', process.env.HTTPS_PORT || 3443));
process.env.HTTPS_PORT = String(HTTPS_PORT); // LAN link API builds the https URLs from it
process.env.PORT_HTTP = String(HTTP_PORT);
const HOST = '0.0.0.0';

const VIRTUAL_NIC = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Docker|vmnet|Loopback/i;
/** All non-internal IPv4 addresses; `real` excludes virtual adapters (WSL, Hyper-V, VM, Docker). */
function lanIPv4() {
  const all = [], real = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      all.push(a.address);
      if (!VIRTUAL_NIC.test(name)) real.push(a.address);
    }
  }
  return { all, real: real.length ? real : all };
}

function loadOrCreateCert(ips) {
  const dir = path.join(process.cwd(), 'certs');
  const keyF = path.join(dir, 'key.pem'), certF = path.join(dir, 'cert.pem'), metaF = path.join(dir, 'meta.json');
  try {
    const meta = JSON.parse(fs.readFileSync(metaF, 'utf8'));
    const covered = ips.every((ip) => meta.ips.includes(ip));
    const fresh = Date.now() < meta.expires - 7 * 864e5;
    if (covered && fresh) return { key: fs.readFileSync(keyF), cert: fs.readFileSync(certF) };
  } catch { /* create */ }
  const altNames = [
    { type: 2, value: 'localhost' }, { type: 2, value: os.hostname() },
    { type: 7, ip: '127.0.0.1' }, ...ips.map((ip) => ({ type: 7, ip })),
  ];
  const pems = selfsigned.generate([{ name: 'commonName', value: 'OSF Agri Flight Trainer (local)' }], {
    keySize: 2048, days: 825, algorithm: 'sha256',
    extensions: [{ name: 'basicConstraints', cA: false }, { name: 'subjectAltName', altNames }],
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyF, pems.private); fs.writeFileSync(certF, pems.cert);
  fs.writeFileSync(metaF, JSON.stringify({ ips, expires: Date.now() + 825 * 864e5 }));
  console.log('  created self-signed certificate in ./certs');
  return { key: pems.private, cert: pems.cert };
}

const app = next({ dev, hostname: 'localhost', port: HTTP_PORT });
const handle = app.getRequestHandler();
await app.prepare();

const { all: allIps, real: ips } = lanIPv4();
const tls = loadOrCreateCert(allIps);
const extra = extraRoutes(() => lanIPv4().real);
const handler = (req, res) => { if (!extra(req, res)) handle(req, res); };
http.createServer(handler).listen(HTTP_PORT, HOST);
https.createServer(tls, handler).listen(HTTPS_PORT, HOST);

console.log(`\n  OSF Agri Flight Trainer ${dev ? '(development)' : '(production)'}`);
console.log(`  This PC:        http://localhost:${HTTP_PORT}`);
for (const ip of ips) console.log(`  Trainee PCs:    https://${ip}:${HTTPS_PORT}   (accept the certificate warning once)`);
for (const ip of ips) console.log(`  Phone screen:   scan the QR in the sim (Esc → Phone / tablet screen) or open http://${ip}:${HTTP_PORT}/remote`);
if (!ips.length) console.log('  No LAN address found — connect this PC to the network.');
console.log('  Flight logs are saved in ./data/logs\n');
