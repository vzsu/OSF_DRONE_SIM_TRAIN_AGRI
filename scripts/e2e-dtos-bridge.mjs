// End-to-end check of the Drone Training OS ↔ simulator bridge on a throwaway database.
// Usage: node scripts/e2e-dtos-bridge.mjs ../OSF_DRONE_LEARNING_OS
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OS_DIR = process.argv[2];
const data = fs.mkdtempSync(path.join(os.tmpdir(), "dtos-e2e-"));
const PORT = 7899, B = `http://127.0.0.1:${PORT}/api`;
const srv = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server/index.js"], { cwd: OS_DIR, env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", DTOS_DATA_DIR: data }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { if (!c) throw new Error("FAIL: " + m); console.log("  ✓ " + m); };

async function client() {
  let cookie = "";
  const call = async (method, url, body, headers = {}) => {
    const r = await fetch(B + url, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    const ct = r.headers.get("content-type") || "";
    return { status: r.status, body: ct.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  return call;
}

try {
  for (let i = 0; i < 40 && !log.includes("server running"); i++) await sleep(250);
  ok(log.includes("server running"), "Training OS started on a temp database");
  const key = fs.readFileSync(path.join(data, "sim-bridge.key"), "utf8").trim();
  ok(key.length === 64, "bridge key created");
  const admin = await client();
  ok((await admin("POST", "/auth/login", { username: "admin", password: "admin123" })).status === 200, "admin login");
  const st = await admin("POST", "/students", { name: "Test Pilot" });
  ok(st.status === 200, `student created (${st.body.username})`);
  const stu = await client();
  ok((await stu("POST", "/auth/login", { username: st.body.username, password: st.body.password })).status === 200, "student login");
  ok((await stu("POST", "/sim/launch", { mode: "fly", exerciseId: "S5", lessonId: "b1" })).status === 400, "launch refuses a lesson that does not belong to the exercise");
  ok((await admin("POST", "/sim/launch", { mode: "fly", exerciseId: "S5", lessonId: "b6" })).status === 403, "admins cannot fly graded attempts");
  const L = await stu("POST", "/sim/launch", { mode: "fly", exerciseId: "S5", lessonId: "b6" });
  ok(L.status === 200 && /\/dtos\?t=/.test(L.body.url), `launch URL ${L.body.url.replace(/t=.*/, "t=…")}`);
  const token = new URL(L.body.url).searchParams.get("t");
  const bridge = await client();
  ok((await bridge("GET", `/sim/bridge/launch/${token}`)).status === 403, "bridge refuses calls without the key");
  const info = await bridge("GET", `/sim/bridge/launch/${token}`, null, { "x-dtos-key": key });
  ok(info.status === 200 && info.body.user.name === "Test Pilot" && info.body.lessonId === "b6", "bridge resolves student + lesson");
  const osfz = Buffer.concat([Buffer.from("OSFZ"), Buffer.alloc(60, 1)]).toString("base64");
  const send = (lessonId, passed, score, id) => bridge("POST", "/sim/bridge/result", { token, lessonId, passed, score, time: 95, objectives: [{ text: "Circle", done: passed }], drone: "Marut AG365H", summary: { maxAlt: 4.2 }, flight: { id, osfzB64: osfz } }, { "x-dtos-key": key });
  ok((await send("b7", true, 90, "f1700000000001")).status === 400, "result for a different lesson is rejected");
  const r1 = await send("b6", false, 0, "f1700000000002");
  ok(r1.status === 200 && r1.body.exerciseScore === null, "failed attempt stored, no score");
  const r2 = await send("b6", true, 88, "f1700000000003");
  ok(r2.status === 200 && r2.body.exerciseScore === 44, `passed b6 (88) → S5 = mean(b6 88, b7 0) = ${r2.body.exerciseScore}`);
  const sum = await stu("GET", "/me/summary");
  ok(sum.body.summary.sim.perExercise.S5.best === 44, "S5 appears in the student's training summary (best 44)");
  const ov = await admin("GET", `/sim/overview?user=${st.body.id}`);
  ok(ov.body.attempts.length === 2 && ov.body.attempts[0].hasFlight, "instructor sees both attempts with flights");
  const other = await client();
  const st2 = await admin("POST", "/students", { name: "Other" });
  await other("POST", "/auth/login", { username: st2.body.username, password: st2.body.password });
  ok((await other("POST", "/sim/launch", { mode: "replay", attemptId: ov.body.attempts[0].id })).status === 403, "another student cannot replay this flight");
  const R = await admin("POST", "/sim/launch", { mode: "replay", attemptId: ov.body.attempts[0].id });
  const rt = new URL(R.body.url).searchParams.get("t");
  const fl = await bridge("GET", `/sim/bridge/flight/${rt}`, null, { "x-dtos-key": key });
  ok(fl.status === 200 && fl.body.toString("ascii", 0, 4) === "OSFZ", "replay link returns the stored .osfz flight");
  ok(fs.existsSync(path.join(data, "sim-flights", String(st.body.id), "f1700000000003.osfz")), "flight file stored in the student's folder");
  console.log("ALL PASSED");
} catch (e) {
  console.log(String(e.message || e)); console.log(log.slice(-1500)); process.exitCode = 1;
} finally {
  srv.kill(); await sleep(300);
  fs.rmSync(data, { recursive: true, force: true });
}
