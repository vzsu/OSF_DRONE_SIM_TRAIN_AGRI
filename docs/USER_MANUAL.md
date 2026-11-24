# OSF Drone Flight Trainer — User Manual

This manual is for instructors and students. Developers should read `AGENTS.md` instead.

---

## 1. What this is

The trainer is a drone flight simulator that runs in a web browser. You fly it with your real RC transmitter (for example a Radiomaster Pocket) or with the keyboard. It is built for two kinds of training:

| Category | Drone | What you practise |
|---|---|---|
| **Agri spray** | Marut AG365 family, Garuda, IoTech, DJI T25/T50 | Take-off and landing, hover, manual spray lanes, AUTO spray missions with breakpoint resume, battery and tank logistics, emergencies |
| **Wedding / event shoot** | DJI Mavic 3 Pro, Air 3S, Phantom 4 Pro | Smooth camera moves with the gimbal camera, keeping away from guests (no flying over people), dodging string lights and tents |

Each category has several **training grounds**. Every ground is generated from a seed, so you can make as many new places as you want.

---

## 2. Starting the trainer (instructor PC)

1. Double-click **`start-sim.cmd`**. The first start installs and builds everything, which takes a few minutes. Later starts take seconds.
2. The browser opens at `http://localhost:3000`.
3. **First time only:** the server creates the instructor account **`admin`** with a random password. You can find the password in:
   - the server window, and
   - the file `data/ADMIN_FIRST_LOGIN.txt`.

   Sign in, open **Admin panel → My password** and set your own password. Then delete that file.
4. **Trainee PCs** on the same Wi-Fi or LAN open the `https://192.168.x.x:3443` address printed in the server window.
   - Accept the certificate warning once (**Advanced → Proceed**).
   - It must be the **https** address. Browsers only allow RC transmitters on secure pages.
5. Run **`start-sim.cmd -SetupFirewall`** once, so the other PCs can connect. It asks for Windows administrator permission one time.

Other launcher options: `-Rebuild`, `-Dev`, `-NoBrowser`, `-HttpPort 3000`, `-HttpsPort 3443`.

---

## 3. Accounts

| Role | Can do |
|---|---|
| **Student** | Fly, see **own** flight logs, debriefs and scores, and change own password |
| **Instructor (admin)** | Everything a student can do, plus: add, delete and reset students, see **every** flight, and see each student's progress (flights, flight time, average and best score, crashes, last flight) |

- **Add a student:** Home → **Admin panel** → *Add user*. Enter the full name, a username (for example `ravi.k`) and a password. Give the username and password to the student.
- **Forgotten password:** in Admin panel → *Reset password*, the new password is shown on the button.
- The server, not the browser, decides who flew a flight, so students cannot save flights under another name.
- If the server can't be reached, the app still opens in **local practice** mode. Flights are kept in that browser and uploaded when the server is back.

---

## 4. Connect the radio (Radiomaster Pocket)

1. Plug the Pocket into the PC with USB-C.
2. On the radio, choose **USB Joystick (HID)**.
3. Move a stick. The home screen shows the controller name.
4. Open **Settings → Controller → Run calibration wizard** and follow the steps for the sticks, then every switch (arm, mode, spray, RTL, kill, pump knob, view, reset).

**Radio layout diagram:** Settings → Controller shows the Pocket.
- SA and SD are 2-position switches, SB and SC are 3-position switches, and SE is a button.
- Move anything on the radio and the function it drives lights up on the diagram.
- Use the **"On radio"** column to label which physical switch each function is on.

Suggested EdgeTX mixer: CH5 = SA **arm**, CH6 = SB **flight mode**, CH7 = SC **spray**, CH8 = SD **RTL**. If you have a free channel, map SE to **reset to pad**.

You can set each mode-switch position to STABILIZE, ALT HOLD, LOITER, RTL, LAND or **AUTO** (spray mission).

---

## 5. Choosing drone, place and weather

- **Select drone:** pick the airframe and the tank fill at take-off.
- **Environment:**
  - **Training ground:** agri farms or wedding venues. *Generate new* makes a fresh random place.
  - **Hold assist** (on by default): in ALT HOLD / ATTI, centring the sticks makes the drone stop and hold its position. Switch it **off** to practise real ATTI flying, where the drone drifts with the wind.
  - **360° scene:** real HDRI photo backgrounds, or *Simple sky* for weak PCs.
  - **Weather:** wind, gusts, turbulence, temperature, elevation, GPS satellites, battery charge. The default is **calm (no wind)**. Add wind on purpose when the lesson needs it.

---

## 6. Flying

### Keyboard (Mode 2)
| Key | Action |
|---|---|
| W / S | Throttle up / down |
| A / D | Yaw left / right |
| Arrow keys | Pitch / roll |
| Enter | Arm / disarm switch |
| 1 / 2 / 3 / 4 | STABILIZE / ALT HOLD / LOITER / **AUTO** |
| Space | Spray on/off |
| [ / ] | Pump flow − / + |
| K | Emergency motor stop (kill) |
| R | RTL (return to launch) |
| V | Change view: VLOS → chase → FPV → **camera** (DJI) → top |
| M | Big aerial map (coverage, trail, mission) |
| B | Batteries & tank (tablet Battery tab) |
| Backspace | Reset: back to the pad |
| C | Camera drones: start/stop recording (screen overlay) |
| PageUp / PageDown | Camera drones: gimbal tilt |
| G | Ground-station tablet (slides up) |
| Esc | Pause menu |

### Flight modes
| Mode | Behaviour |
|---|---|
| STABILIZE | You control tilt and throttle directly. There is no height hold. |
| ALT HOLD (DJI: ATTI) | Holds height. With hold assist it also holds position when the sticks are centred; without it, the drone drifts with the wind. |
| LOITER (DJI: P-GPS) | Holds position with GPS. Stick = speed. DJI drones also hold to the centimetre with vision positioning below 30 m. |
| RTL | Climbs to RTL height, flies home and lands. |
| LAND | Lands where it is. |
| AUTO (DJI: ROUTE) | Flies the planned spray mission. |

### Views
- **VLOS:** what the pilot standing on the ground sees. This is the main view for real-world practice.
- **Chase:** third-person view from behind the drone.
- **FPV:** onboard nose camera.
- **CAMERA:** 3-axis stabilised gimbal on DJI camera drones. The same gimbal feeds the pilot view, the tablet and phones.
  - **Follow** (default): the horizon stays level however the drone pitches or rolls. Pan follows the heading smoothly, and the tilt glides at the gimbal's speed instead of jumping.
  - **FPV** (key **F**): the picture rolls with the aircraft.
  - **Track** (key **T**, or *Track subject* in the tablet camera tab): locks on whatever is in the middle of the picture, like DJI Spotlight / POI. The camera stays on the subject and the flight controller yaws the drone to keep it in frame while you fly with the sticks. Yawing yourself overrides it. Press T again to release.
  - Tilt: PgUp/PgDn, the radio knob or the tablet slider.
  - Original note: The horizon stays level. The overlay shows rule-of-thirds lines, REC, gimbal angle, height and distance. On camera drones, the radio's pump knob controls gimbal tilt.
- **Top:** map view from straight above.

### Pause menu (Esc)
In the pause menu you can:
- resume, restart on the pad, end and debrief, or quit;
- **change the drone or tank fill** (this restarts the flight);
- open **Settings** or the **Mission planner** without losing the flight;
- swap the battery and refill the tank;
- turn hold assist and sound on or off;
- change the view and the live wind;
- **inject failures** (instructor): GPS loss, RC link loss, motor failure, compass error.

### Minimal HUD
- **Default view:** a small status bar at the top, the **height block on the right** (height above ground and above crop, take-off, MSL, vertical speed, target, altitude tape), the stick monitor (bottom left) and the minimap.
- **I** (or *Detailed telemetry* in Esc / Settings → Display): adds speed, wind and home distance, the tank / spray / power bar and the key help.
- **H:** hides the whole HUD except warnings. Press H again to bring it back.
- **During exercises:** the checklist is a small panel on the left. Mission panels and the tablet button are hidden. Targets are **orange cones with a ground circle** (lime = next, grey = done), not floating rings.
- **Exercise sizes:** pitch/roll legs are 10 m, the square has 15 m sides, and circles must be at least 14 m across. A tight spin is refused with "Too tight — use less yaw".

### Flight trails (Esc menu → *Flight trail*, Settings → Display, or key **Y** to cycle)
| Style | What you see |
|---|---|
| Off | no trail |
| Wingtip | two white, semi-transparent lines from the arm tips; each part fades and disappears after 15 s |
| Path | one 4 px line, blue (oldest) → yellow (newest), for the whole flight, plus its faint ground track and the trail on the map |
| Both | wingtip + path |

Checkride mode switches trails off.

### On-screen aids
- **Flight trail:** a 3D line of the path flown. The **blue** end is the oldest and the **yellow** end is the newest. A faint copy on the ground helps you judge height. The same trail is drawn on the map. Turn it off in Settings → Display.
- **Map** (bottom right, `M` for big):
  - field or lawn, trees, power line, house;
  - wedding tents, stage and guest areas (red = no-fly);
  - spray coverage: blue = sprayed once, amber = sprayed twice, red = off-target;
  - mission lanes, the current lane, and the breakpoint "BP".
- **Warnings bar:** battery, GPS, RC, wind, VRS, tank empty, emergency stop, **OVER PEOPLE**.
- **Sound:** rotors, motors, wind, pump and radio-style alert beeps. Sound gets louder and higher as the drone comes closer (Doppler). Turn it on or off in Settings → Display or in the pause menu.

---

## 7. Ground-station tablet (agri RC screen)

Press **G**, or click *Ground station* at the bottom right, and the tablet slides up from the bottom. It works like the screen on a real agri RC, and the sim keeps running while it is open.

**Top bar:** mode, ARMED/FLYING, GNSS (satellites, HDOP, RTK), battery % and volts, tank, height, speed, distance, flight time.

**Map:**
- It is geo-referenced: latitude/longitude grid, scale bar and north arrow. The farm sits near Nashik.
- It shows the field, trees with 5 m keep-out rings, power lines and string lights as red dashed lines, buildings, tents, and the guest no-fly zone.
- It also shows the spray coverage, the trail (blue→yellow), the current lane and the **BREAKPOINT**.
- Navigation: `+` / `−` / mouse wheel to zoom, drag to pan, ⤢ to fit the field, ◎ to follow the drone.

**Plan tab:**
- Tick *Edit area* and tap the map to add corners. Drag a corner to move it; long-press or right-click to delete it.
- Set swath, height above the crop, speed, route direction and margin.
- It shows area (ha/acre), perimeter, lanes, dose (L/ha), litres, tank loads and time.

**Slide to start:**
- Drag the white thumb to the right.
- The pre-flight check runs one item at a time, each with a tone: RC link, GNSS (satellites/HDOP, spoken "GPS ready"), compass, battery pack (%, V, °C), tank, sensors, route, propellers.
- Then a voice says "Stand clear", the ESC start-up tones play, and the drone arms, takes off in AUTO and sprays.
- If a check fails, the tablet tells you which one and why.

**Fly tab:**
- Progress ring, lane, sprayed area, coverage/overlap, cross-track error, pump.
- Buttons: **Pause** (hover), **Resume**, **Return home** (RTH tones + voice), **Manual control**.
- Moving the RC mode switch always takes control back.

**Battery tab — 3 packs (A in the drone, B on the charger, C spare):**
- Each pack shows %, volts, °C, cycles and status.
- Buttons move packs between **drone ↔ charger ↔ ground**. The charger has **one slot**.
- Packs come out of the drone hot. A pack above 45 °C must cool before it charges, just like real smart batteries.
- Set the charge time in Environment. Real chargers take 30–60 min; the training default is 6 min.
- **Refill tank** fills the spray tank (landed and disarmed only).

**Breakpoint workflow (like the real thing):**
1. The battery goes low or the tank runs empty. You hear "Battery low. Returning home" or "Spray tank empty".
2. The drone returns home, lands and saves the breakpoint.
3. In the Battery tab: drone pack → charger (or ground), charged pack → *Install*. Press *Refill tank*.
4. Slide to resume from the breakpoint. The drone flies to the red BP and carries on with the same lane.

**Voice prompts and sounds:** "GPS ready", "Motors armed", "Taking off", "Returning home", "Battery low", "Spray tank empty", "Breakpoint saved", "Resuming from breakpoint", "Landed". Turn voice on or off in Settings → Display, sound & aids.

## 8. Phone or tablet as the RC screen / camera monitor (LAN)

1. **Once on the sim PC:** run `start-sim.cmd -SetupFirewall`. Phone hotspots and many Wi-Fi networks count as **Public** networks in Windows, and the rule now covers them, but only for devices on the same local network.
2. In flight press **Esc → Phone / tablet screen**. A **QR code** and the address (for example `http://192.168.x.x:3000/remote?t=…`) appear.
3. Connect the phone to the **same Wi-Fi or hotspot** and scan the QR code. No app, login or certificate is needed.
4. The phone shows, live:
   - **Ground station:** the same tablet UI. For agri drones that is the spray app; for DJI camera drones it is the camera app.
   - **Camera:** the drone's own camera picture.

Everything goes through the training server over plain HTTP: telemetry 10 times a second, and the camera as a ~12 fps picture stream. This is why it works on hotspots where direct peer-to-peer connections fail. Commands from the phone (start, RTH, batteries, area edits) act on the sim immediately.

## 8b. Camera drones (Mavic 3 Pro, Air 3S, Phantom 4 Pro) — a different app

With a DJI camera drone, the ground station becomes a **camera app** in the style of DJI Fly, not the spray app:
- The **live camera** fills the screen. It shows thirds grid lines, a REC timer, a photo count, H / D / H.S / V.S readouts and a gimbal indicator. Use ⇄ to swap the camera and the map.
- **Camera tab:**
  - Photo/Video switch and a big shutter button (a white flash on photos).
  - Gimbal tilt slider, plus buttons for 0°, −45°, −90° and −15°.
- **Flight tab:**
  - A big **height** readout, with height above take-off, altitude MSL, distance, and horizontal/vertical speed.
  - **Take off** — quick checks, then auto take-off to 1.2 m and hover in P-GPS. **Land**, **Return home**, **Brake**, **Manual**.
- **Slide to take off** at the bottom.

## 8c. Real maps — Chhattisgarh

Home → **Real map — Chhattisgarh**:
1. Search for a village or town (free OpenStreetMap search), or pan the satellite map. Switch between Satellite and Streets.
2. **📍 Pin home:** pick this tool on the right, then click the map where the pilot takes off (**H**). The dashed orange box (160 × 190 m) is the 3D training ground. Drag H to move it.
   **▱ Draw fly area:** pick this tool and click the corners of the area you may fly / spray (min. 3). Drag the numbered corners to adjust; *Undo point* / *Clear area*; right-click a corner deletes it. Hectares and perimeter update live, with a warning if the area leaves the 3D box.
   The fly area becomes the **spray area** and a **geofence**: in flight it is drawn on the map and tablet, the HUD warns *OUTSIDE FLY AREA*, more than 3 m outside triggers **return home**, and the debrief scores time outside.
3. Pick the **weather** for this map.
   **🏠 Add building / 🌳 Add tree:** click to place your own buildings (outline blocks) and trees; drag to move, right-click to delete. They are always included — use them when OpenStreetMap has no data for the village or its server is busy.
4. Give it a name and press **Build training ground** (a clean **mockup**: flat ground, roads, water, buildings as outlined blocks from their real footprints, normal trees — no satellite picture):
   - **trees, buildings and power lines** are downloaded from OpenStreetMap;
   - the **largest mapped farmland** becomes the spray field (otherwise a default area is used, which you can redraw in the planner);
   - a 400 × 400 m **satellite picture** becomes the ground.
5. **Fly here** to start. The map is saved on the server for everyone. It appears under *Saved real maps* and as a training-ground card in Environment.

All sources are free and need no API key: Esri World Imagery, OpenStreetMap, Overpass and Nominatim. Downloads are cached in `data/tiles` and `data/osm`, so a place you built before also works offline. Only areas inside Chhattisgarh are allowed. In many villages OpenStreetMap has few buildings or trees mapped; the satellite picture still shows the real place.

## 9. Crops, grass and realism

- **Environment → Crop:** paddy (flooded, with water sheen), wheat, soybean, cotton, maize, sugarcane, or bare soil. Crop height is real.
  - The agri **radar measures height above the canopy**, so "2.5 m" over 2.8 m sugarcane is about 5.3 m above the ground. The HUD shows radar height.
  - Plants **bend away from the rotor downwash** under the drone and sway in the wind.
- **Grass:** lush (monsoon), dry (summer) or pale (winter).

## 10. Keyboard shortcuts are remappable

Go to **Settings → Keyboard shortcuts**, click an action and press the new key. A key already used by another action is swapped onto that action. *Reset to defaults* restores the original keys. RC sticks, switches and buttons are mapped in **Settings → Controller (RC)**.

## 10a. Course, beginner exercises, accounts and URLs

**Sign in or guest mode.** The first screen offers *Sign in* and, below it, **Continue in guest mode**. A guest can use every screen, the course and the simulator, but **nothing is saved**: no flight logs, quiz scores or exercise results. Guest mode lasts until the browser tab is closed.

**Course** (Home → *Course — theory & checklists*, URL `/course`)
- **5 DGCA RPC theory modules:**
  1. Air Law Part 1
  2. Air Law Part 2
  3. Meteorology
  4. RPAS Systems & Human Factors
  5. Flight Planning & Emergencies

  Each has concepts with properly typeset formulas, "In practice" notes, a *Mark as read* button and short-answer self-check cards.
- **Quiz per module:** 10 random questions from 106 MCQ and true/false questions. Each answer shows an explanation; the pass mark is **70%**. Your best and latest scores are saved to your account.
- **Flight checklists:** pre-flight (11 items), in-flight (6) and post-flight (6). Critical items are red. Completing a checklist is recorded.
- **Practical training plan:** the simulator syllabus (S1–S10) and the on-field syllabus (F1–F9), with steps and marking criteria. Each simulator item links straight to the matching sim exercise.

**Beginner exercises 1–10** (Home → *Simulator lessons*, URL `/lessons`)

| # | Exercise |
|---|---|
| 1 | Take-off and landing |
| 2 | In-flight control check (very small yaw / pitch / roll — each must answer) |
| 3 | Pitch forward and back to the same place |
| 4 | Roll right and back, roll left and back |
| 5 | Square (forward → right → back → left, through gates) |
| 6 | Right circle (slight pitch forward + slight yaw right) |
| 7 | Left circle |
| 8 | Figure 8 |
| 9 | Spiral climb (pitch + yaw + a little throttle) |
| 10 | Bring it home ×5 — the drone appears in the air at 5 different places, one after another; each time fly it back and land gently on the pad. A missed or hard landing repeats that round. |

- **Demo first:** each exercise is first flown by the autopilot (*▶ Watch demo, then fly*). Watch the **stick monitor** (bottom left): it has centre axes, a 25% grid and live numbers (T/Y, P/R). The checklist fills as the demo flies. Then it says **"Your turn"** and you fly the same exercise. *Skip demo* jumps straight to your turn. *Fly now* skips the demo entirely.
- Every finished step plays a short tick, fills its progress bar and ticks the checklist. Results are saved to the student's account.

**Training airfield.** All lessons fly on one dedicated field, except the camera orbit (wedding venue) and the agri lessons (farm). It's flat mown grass with painted white lines, permanent orange cones and a hangar, with no crops, power lines or crowd. The lines are a 15 m square, the pitch/roll axes with 5 m ticks, a practice lane and two circle references. The cones sit at 10 m forward and 10 m left/right, at the square corners and at the lane ends. Beginner exercises start from the pad, so the graded cones match the painted cones exactly. You can also free-fly the airfield: Environment → *Training airfield*.

**Lessons are flown by hand.** During a lesson the RTH switch, the R key, mode-switch positions set to RTL / LAND / AUTO, and the tablet's RTH / Start / Take-off / Land are disabled. The pilot sees "… is disabled during training lessons — fly it by hand". If an automatic return or landing still takes over (for example the battery failsafe), the run fails: lessons only count when flown manually.

**Admin panel** shows each student's flights, scores, **theory quizzes (passed / average)** and **sim exercises passed**.

**Real URLs and breadcrumbs.**
- Every screen has its own address, for example `/course/08-air-law-airspace-zones/quiz`, `/lessons/b5`, `/logs/<flight id>` and `/admin`.
- Addresses can be bookmarked and shared, and the browser Back/Forward buttons work.
- A breadcrumb trail (Home › Course › Module › Quiz) sits above every title.
- Unknown or tampered addresses go to Home. The server checks login and admin rights on every request.

## 10b. Lessons and checkride

Open **Home → Lessons & checkride**. There are 8 lessons:

1. Take-off, hover and land
2. ATTI hover in wind (hold assist off)
3. Box pattern through 4 gates
4. Nose-in hover
5. Manual spray lane
6. Motor-failure emergency
7. Precision landing
8. Wedding orbit shot (camera drone)

**During a lesson:** a card at the top lists the objectives with live progress. Gates, boxes and landing targets appear in 3D: green is next, yellow is done. A lesson fails on a crash, a time-out or its own rule (for example, flying over the guests).

**Checkride mode** switches off the trail, ground marker, orientation arrow and hold assist, and injects one random failure: GPS loss, motor failure or RC loss.

**Results:** they go into the flight log and the debrief. Your best result shows on each lesson card. The ▶ Fly button on the home screen is always free flight.

## 11. Agri spray mission (AUTO) — same as in the field

1. Open **Mission planner** from the home screen or the pause menu.
2. Click the corners of the area on the map. Drag a corner to move it, and right-click a corner to delete it. *Whole field* fills the current field.
3. Set the following. The planner then shows hectares, L/ha, litres, tank loads and estimated time.
   - **lane spacing** (spray swath)
   - **height**
   - **speed**
   - **lane direction**
   - **margin**
4. In flight, switch to **AUTO** (key `4` or your mode switch) and arm.
   - The drone takes off and sprays lane by lane. The pump is on only over the lanes.
   - It stops and turns at each lane end, then returns and lands.
5. **Low battery or empty tank:**
   - The drone returns home by itself and saves a **breakpoint**.
   - After it lands, press **B** to swap the battery and refill the tank.
   - Arm again in AUTO. It flies to the breakpoint and continues the same lane.
6. Switch out of AUTO at any time to take over manually. The breakpoint is kept.

---

## 12. Debrief and scores

After every flight (or *End flight* in the pause menu) the debrief shows:
- **Summary:** flight time, max height and speed, distance, battery used, litres sprayed, warnings.
- **Training score 0–100 and grade:**
  - A — checkride ready
  - B — good
  - C — needs practice
  - D — repeat lesson
  - FAIL — crash

  Each item shows a tip:
  - spray height hold and speed consistency
  - area coverage, overlap (double dose), off-target spray / drift
  - smooth stick control (full-stick reversals, max tilt)
  - landing softness (touchdown speed)
  - obstacle clearance (closest distance to trees, poles, wires, tents)
  - **flight over people** (wedding grounds)
  - battery reserve at landing
  - emergency handling
- **Coverage map image**
- **Charts:** height, speed and wind, battery voltage, stick inputs
- **Events list:** arm, modes, failsafes, crashes
- **Export:** CSV or JSON for deeper analysis.

**Flight logs** lists all flights with their score. Students see their own flights; instructors see everyone's.

---

## 13. Suggested lesson plan

| # | Lesson | Ground | Pass |
|---|---|---|---|
| 1 | Hover in LOITER, then ALT HOLD | Home farm, calm | Score ≥ 70, no crash |
| 2 | Box pattern and nose-in hover in ALT HOLD | Home farm, 3 m/s wind, hold assist OFF | Stays inside the field |
| 3 | Manual spray lanes at 2.5 m | Long paddy strip | Height ±0.3 m, coverage ≥ 80% |
| 4 | AUTO mission with tank-empty breakpoint | Any farm, tank 30% | Resumes and finishes all lanes |
| 5 | Emergencies: GPS loss, motor failure, RC loss | Any farm | Lands without a crash |
| 6 | Wedding orbit and reveal shot with the camera view | Lawn wedding | 0 s over people, smooth score ≥ 70 |
| 7 | String lights and tents at dusk | Evening reception | No wire strike, clearance ≥ 3 m |

---

## 14. Troubleshooting

| Problem | Fix |
|---|---|
| Radio not detected | USB Joystick mode, move a stick, use Chrome/Edge, use the **https** address on other PCs |
| Drone drifts in ALT HOLD | Wind is set in Environment, or hold assist is off (that's real ATTI behaviour) |
| Slow motion / laggy | Keep the sim window in front, Settings → Display → Low, *Simple sky* |
| Other PCs can't connect | `start-sim.cmd -SetupFirewall`, same network, https address |
| Server closes by itself | The PC is low on memory — close other programs |
| Phone can't open the QR address | Same Wi-Fi/hotspot as the PC; run `start-sim.cmd -SetupFirewall` once (covers Public networks now); a flight must be running |
| Real map build fails | Internet needed the first time (cached afterwards); the Overpass server is sometimes busy — try again in a minute |
| Blank screen / "3D graphics are off" | The browser's GPU is off: close heavy programs, restart Chrome, turn on hardware acceleration |
| No voice | Settings → Display, sound & aids → Voice prompts. Windows needs an English speech voice installed |
| Forgot the admin password | Stop the server, delete `data/users.json` (removes **all** accounts), start again: a new admin password is written to `data/ADMIN_FIRST_LOGIN.txt` |
