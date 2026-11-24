// Hindi for simulator launches from the Drone Training OS (the student chose हिंदी there).
// Exercise brief, lesson card, objectives, results and the common messages are swapped for Hindi as
// they render. The flight HUD numbers and the physics are unchanged.
const T: Record<string, string> = {
  // launch screen
  'Drone Training OS · Simulator': 'ड्रोन ट्रेनिंग OS · सिम्युलेटर', 'Checking your link…': 'आपका लिंक जाँचा जा रहा है…',
  '▶ Watch demo, then fly': '▶ पहले डेमो देखें, फिर उड़ाएँ', 'Fly now': 'अभी उड़ाएँ', '▶ Start checkride flight': '▶ चेकराइड उड़ान शुरू करें',
  'First watch the demo — the sticks are shown bottom-left — then it\'s your turn.': 'पहले डेमो देखें — स्टिक नीचे बाईं ओर दिखती हैं — फिर आपकी बारी।',
  'RTH, auto-land and AUTO are disabled. Fly it by hand.': 'RTH, ऑटो-लैंड और AUTO बंद हैं। हाथ से उड़ाएँ।',
  'Session': 'सत्र', 'Student': 'छात्र', 'Drone': 'ड्रोन', 'Controller': 'कंट्रोलर', 'Keyboard (no RC detected)': 'कीबोर्ड (RC नहीं मिला)',
  'Try again': 'फिर कोशिश करें', 'Time left': 'बचा समय',
  'When you finish, your result and the recorded flight go to the Training OS automatically. Your instructor can replay it.': 'पूरा करने पर आपका परिणाम और रिकॉर्ड की गई उड़ान अपने-आप ट्रेनिंग OS में चली जाएगी। आपके इंस्ट्रक्टर इसे रीप्ले कर सकते हैं।',
  'Checkride: no demo, flight aids off. Your best passed attempt counts.': 'चेकराइड: कोई डेमो नहीं, फ़्लाइट सहायता बंद। आपका सबसे अच्छा पास प्रयास गिना जाएगा।',
  'Radiomaster Pocket: plug in by USB-C, choose USB Joystick (HID) and move a stick. Calibrate once in Settings → Controller.': 'Radiomaster Pocket: USB-C से जोड़ें, USB Joystick (HID) चुनें और एक स्टिक हिलाएँ। Settings → Controller में एक बार कैलिब्रेट करें।',
  'Arm / Disarm': 'आर्म / डिसआर्म', 'Take-off & Landing': 'टेक-ऑफ़ और लैंडिंग', 'Hover & Orientation Hold': 'होवर और दिशा स्थिर रखना', 'Square — Right & Left': 'वर्ग — दाएँ और बाएँ',
  'Circle — Clockwise & Anticlockwise': 'गोला — घड़ी की दिशा और उल्टी दिशा', 'Figure-8 (Infinity)': 'आकृति-8 (इनफ़िनिटी)', 'Spiral Up': 'स्पाइरल ऊपर', 'Spiral Down': 'स्पाइरल नीचे',
  'Precision Spot Landing': 'सटीक स्पॉट लैंडिंग', 'Emergency Handling': 'आपातकाल संभालना', 'Loading the recorded flight…': 'रिकॉर्ड की गई उड़ान लोड हो रही है…',
  'Replay closed': 'रीप्ले बंद', 'You can close this tab and go back to Drone Training OS.': 'आप यह टैब बंद करके ड्रोन ट्रेनिंग OS पर लौट सकते हैं।',
  // lesson card / result
  'DEMO': 'डेमो', 'CHECKRIDE': 'चेकराइड', 'Skip demo ▶': 'डेमो छोड़ें ▶', 'Lesson passed': 'पाठ पास', 'Lesson failed': 'पाठ फ़ेल',
  'Fly again': 'फिर उड़ाएँ', 'Next lesson': 'अगला पाठ', 'Lessons': 'पाठ', 'Debrief & score': 'समीक्षा और अंक',
  // beginner lessons
  'Take-off and landing': 'टेक-ऑफ़ और लैंडिंग', 'In-flight control check': 'उड़ान में कंट्रोल जाँच', 'Pitch forward and back': 'आगे-पीछे पिच',
  'Roll right and left': 'दाएँ-बाएँ रोल', 'Square': 'वर्ग (स्क्वेयर)', 'Right circle': 'दायाँ गोला', 'Left circle': 'बायाँ गोला', 'Figure 8': 'आकृति 8',
  'Spiral climb': 'स्पाइरल चढ़ाई', 'Bring it home ×5': 'घर वापस लाएँ ×5',
  'Arm, climb gently to 2 m, hover 3 s, descend slowly and land, then disarm.': 'आर्म करें, धीरे-धीरे 2 m तक चढ़ें, 3 s होवर करें, धीरे उतरकर लैंड करें, फिर डिसआर्म करें।',
  'At 3 m give VERY small inputs: a little yaw, a little pitch, a little roll — check each one answers. Then land.': '3 m पर बहुत छोटे इनपुट दें: थोड़ा यॉ, थोड़ा पिच, थोड़ा रोल — हर एक का जवाब जाँचें। फिर लैंड करें।',
  'Pitch forward 10 m (to the cone), then pitch back to the same place and hover.': '10 m आगे पिच करें (कोन तक), फिर पीछे उसी जगह आकर होवर करें।',
  'Roll right 10 m and back, then roll left 10 m and back to the start.': '10 m दाएँ रोल करके वापस, फिर 10 m बाएँ रोल करके शुरुआत पर लौटें।',
  'A 15 m square: pitch forward, roll right, pitch back, roll left — finish where you started (cones mark the corners).': '15 m का वर्ग: आगे पिच, दाएँ रोल, पीछे पिच, बाएँ रोल — जहाँ से शुरू किया वहीं ख़त्म करें (कोन कोने दिखाते हैं)।',
  'Slight pitch forward with slight yaw right at the same time: one wide circle to the right (at least 14 m across).': 'हल्का आगे पिच और साथ में हल्का दायाँ यॉ: दाईं ओर एक चौड़ा गोला (कम से कम 14 m)।',
  'Slight pitch forward with slight yaw left at the same time: one wide circle to the left (at least 14 m across).': 'हल्का आगे पिच और साथ में हल्का बायाँ यॉ: बाईं ओर एक चौड़ा गोला (कम से कम 14 m)।',
  'A wide right circle followed by a wide left circle — an 8 — and back to the start.': 'पहले चौड़ा दायाँ गोला, फिर चौड़ा बायाँ गोला — एक 8 — और शुरुआत पर वापस।',
  'Pitch forward with slight yaw and a little more throttle: one wide turn (12 m+ across) while climbing at least 3 m.': 'आगे पिच, हल्का यॉ और थोड़ा ज़्यादा थ्रॉटल: कम से कम 3 m चढ़ते हुए एक चौड़ा मोड़ (12 m+)।',
  'The drone appears in the air at 5 different places, one after another. Each time: fly it back and land gently on the pad.': 'ड्रोन एक-एक करके 5 अलग जगहों पर हवा में दिखेगा। हर बार: उसे वापस लाकर पैड पर धीरे से लैंड करें।',
  // advanced lessons
  'Take-off, hover, land': 'टेक-ऑफ़, होवर, लैंड', 'ATTI hover in wind': 'हवा में ATTI होवर', 'Box pattern': 'बॉक्स पैटर्न', 'Nose-in hover': 'नोज़-इन होवर',
  'Precision landing': 'सटीक लैंडिंग', 'Emergency: motor failure': 'आपातकाल: मोटर फ़ेल', 'Manual spray lane': 'मैनुअल स्प्रे लेन',
  'Climb to 3 m in LOITER, hold inside the 1 m box for 20 s, land softly on the pad.': 'LOITER में 3 m तक चढ़ें, 20 s तक 1 m बॉक्स के अंदर रुकें, पैड पर धीरे लैंड करें।',
  'Hold assist OFF, 2.5 m/s wind. Hover in ALT HOLD within 2 m of the marker for 20 s — you must correct the drift yourself.': 'होल्ड असिस्ट बंद, 2.5 m/s हवा। ALT HOLD में मार्कर के 2 m के अंदर 20 s होवर करें — बहाव ख़ुद ठीक करना है।',
  'Fly through the four gates in order at 5 m, then land on the pad.': '5 m पर चारों गेट क्रम से पार करें, फिर पैड पर लैंड करें।',
  'Hover 15 m in front of you with the nose pointing at you (controls reversed!) for 15 s.': 'अपने सामने 15 m पर, नोज़ आपकी ओर रखकर (कंट्रोल उलटे!) 15 s होवर करें।',
  'Hover at 8 m. A motor will fail. Keep it level and land within 60 s without crashing.': '8 m पर होवर करें। एक मोटर फ़ेल होगी। ड्रोन समतल रखें और 60 s में बिना क्रैश लैंड करें।',
  'Take off, fly 20 m out, come back and land within 0.5 m of the pad centre at < 0.6 m/s.': 'टेक-ऑफ़ करें, 20 m दूर जाएँ, लौटें और पैड के बीच से 0.5 m के अंदर < 0.6 m/s पर लैंड करें।',
  // objectives
  'Arm and climb to 2 m': 'आर्म करें और 2 m तक चढ़ें', 'Arm and climb to 3 m': 'आर्म करें और 3 m तक चढ़ें', 'Hover steady — 3 s': 'स्थिर होवर — 3 s',
  'Land gently and disarm': 'धीरे लैंड करें और डिसआर्म करें', 'Small yaw input — the nose turns': 'छोटा यॉ इनपुट — नोज़ मुड़ती है',
  'Small pitch input — the drone tilts': 'छोटा पिच इनपुट — ड्रोन झुकता है', 'Small roll input — the drone tilts': 'छोटा रोल इनपुट — ड्रोन झुकता है',
  'Pitch forward ≥ 10 m': '≥ 10 m आगे पिच', 'Pitch back to the start (< 2 m)': 'पीछे शुरुआत पर लौटें (< 2 m)',
  'Roll right ≥ 10 m': '≥ 10 m दाएँ रोल', 'Roll left ≥ 10 m': '≥ 10 m बाएँ रोल', 'Roll back to the start': 'रोल करके शुरुआत पर लौटें',
  'Pitch forward 15 m to cone 1': '15 m आगे पिच — कोन 1 तक', 'Roll right 15 m to cone 2': '15 m दाएँ रोल — कोन 2 तक',
  'Pitch back 15 m to cone 3': '15 m पीछे पिच — कोन 3 तक', 'Roll left — back to the start': 'बाएँ रोल — शुरुआत पर वापस',
  'One wide circle to the RIGHT (≥ 14 m across)': 'दाईं ओर एक चौड़ा गोला (≥ 14 m)', 'One wide circle to the LEFT (≥ 14 m across)': 'बाईं ओर एक चौड़ा गोला (≥ 14 m)',
  'Back near the start (< 6 m)': 'शुरुआत के पास वापस (< 6 m)', 'Wide right circle': 'चौड़ा दायाँ गोला', 'Wide left circle': 'चौड़ा बायाँ गोला',
  'Spiral: one wide turn while climbing ≥ 3 m': 'स्पाइरल: ≥ 3 m चढ़ते हुए एक चौड़ा मोड़',
  'Take off to 3 m': '3 m तक टेक-ऑफ़', 'Hold LOITER in the 1 m box at 3 m — 20 s': '3 m पर 1 m बॉक्स में LOITER रोकें — 20 s', 'Land on the pad (< 0.7 m/s)': 'पैड पर लैंड करें (< 0.7 m/s)',
  'Land on the pad': 'पैड पर लैंड करें', 'Land': 'लैंड करें', 'Climb to 4 m in ALT HOLD': 'ALT HOLD में 4 m तक चढ़ें', 'Stay within 2 m of the marker — 20 s': 'मार्कर के 2 m के अंदर रहें — 20 s',
  'Fly to the marker 15 m in front of you at 4 m': '4 m पर अपने सामने 15 m वाले मार्कर तक उड़ें', 'Nose pointing at you, inside 3 m — 15 s': 'नोज़ आपकी ओर, 3 m के अंदर — 15 s',
  'Climb to 8 m and hover': '8 m तक चढ़कर होवर करें', 'Motor failure: stay upright': 'मोटर फ़ेल: ड्रोन सीधा रखें', 'Land within 60 s without crashing': '60 s में बिना क्रैश लैंड करें',
  'Fly out to the marker 20 m north': '20 m उत्तर वाले मार्कर तक जाएँ', 'Return and land within 0.5 m of the pad centre': 'लौटकर पैड के बीच से 0.5 m के अंदर लैंड करें', 'Touch down below 0.6 m/s': '0.6 m/s से कम पर टचडाउन',
  // messages
  'ARMED': 'आर्म हुआ', 'DISARMED': 'डिसआर्म हुआ', 'Takeoff': 'टेक-ऑफ़', 'Landed': 'लैंड हुआ', 'Reset — back on the pad': 'रीसेट — पैड पर वापस',
  'DEMO — watch the sticks (bottom left) and the checklist. Press "Skip demo" to fly yourself.': 'डेमो — स्टिक (नीचे बाएँ) और चेकलिस्ट देखें। ख़ुद उड़ाने के लिए "डेमो छोड़ें" दबाएँ।',
  'RTH is disabled during training lessons — fly it by hand': 'प्रशिक्षण पाठ में RTH बंद है — हाथ से उड़ाएँ',
  'AUTO is disabled during training lessons — fly it by hand': 'प्रशिक्षण पाठ में AUTO बंद है — हाथ से उड़ाएँ',
  'auto-land is disabled during training lessons — fly it by hand': 'प्रशिक्षण पाठ में ऑटो-लैंड बंद है — हाथ से उड़ाएँ',
};
const P: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^([✓✗]) (.+)$/, (m) => `${m[1]} ${T[m[2]] ?? m[2]}`],
  [/^(Exercise|Lesson) (\d+) · (.+)$/, (m) => `${m[1] === 'Exercise' ? 'अभ्यास' : 'पाठ'} ${m[2]} · ${T[m[3]] ?? m[3]}`],
  [/^Round (\d+): from (.+) — land on the pad$/, (m) => `राउंड ${m[1]}: ${m[2]} से — पैड पर लैंड करें`],
  [/^Sent to (.+) — (S\d+) score (\d+)$/, (m) => `${m[1]} को भेजा — ${m[2]} के अंक ${m[3]}`],
  [/^Sent to (.+) — attempt recorded$/, (m) => `${m[1]} को भेजा — प्रयास दर्ज हुआ`],
  [/^Checkride: attempt recorded — lesson score (\d+), test score so far (.+)$/, (m) => `चेकराइड: प्रयास दर्ज — पाठ के अंक ${m[1]}, अब तक टेस्ट के अंक ${m[2]}`],
  [/^Checkride: attempt recorded$/, () => 'चेकराइड: प्रयास दर्ज हुआ'],
  [/^Simulator lesson: (.+)$/, (m) => `सिम्युलेटर पाठ: ${T[m[1]] ?? m[1]}`],
  [/^(\d+) min limit$/, (m) => `${m[1]} मिनट सीमा`],
  [/^Lesson (\d+): (.+?) — (.+)$/, (m) => `पाठ ${m[1]}: ${T[m[2]] ?? m[2]} — ${T[m[3]] ?? m[3]}`],
];

function tr(s: string): string | null {
  const k = s.replace(/\s+/g, ' ').trim();
  if (!k || !/[A-Za-z]/.test(k)) return null;
  if (T[k]) return s.replace(k, T[k]);
  for (const [re, f] of P) { const m = re.exec(k); if (m) return s.replace(k, f(m)); }
  return null;
}
function walk(n: Node) {
  if (n.nodeType === Node.TEXT_NODE) { const t = tr((n as Text).data); if (t !== null && t !== (n as Text).data) (n as Text).data = t; return; }
  if (n.nodeType !== Node.ELEMENT_NODE || (n as Element).tagName === 'SCRIPT' || (n as Element).tagName === 'STYLE') return;
  n.childNodes.forEach(walk);
}

let started = false;
/** Translate the menus, the lesson card, results and messages (never the HUD numbers). */
export function startHindi() {
  if (started) return;
  started = true;
  document.documentElement.lang = 'hi';
  const roots = ['ui', 'toasts', 'hud'].map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
  roots.forEach(walk);
  const obs = new MutationObserver((ms) => ms.forEach((m) => (m.type === 'characterData' ? walk(m.target) : m.addedNodes.forEach(walk))));
  roots.forEach((r) => obs.observe(r, { subtree: true, childList: true, characterData: true }));
  // lesson results are shown in a dialog appended to <body>
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n instanceof HTMLElement && n.classList.contains('pause')) { walk(n); obs.observe(n, { subtree: true, childList: true, characterData: true }); } })))
    .observe(document.body, { childList: true });
}
