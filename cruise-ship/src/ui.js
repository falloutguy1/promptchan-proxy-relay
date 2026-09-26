// Camera presets (ship frame: +x bow, +z starboard). No text anywhere in the UI.
export const VIEWS = [
  { pos: [305, 44, 262], target: [8, 33, 0], fov: 36 },          // bow three-quarter hero
  { pos: [-18, 34, 480], target: [-6, 33, 0], fov: 38 },          // starboard broadside
  { pos: [-340, 190, 250], target: [-45, 44, 0], fov: 36 },       // aerial stern quarter
  { pos: [-40, 104, 92], target: [-104, 67, 0], fov: 44 },        // top deck: funnel, coaster, slides
  { pos: [88, 3.2, 64], target: [-8, 31, 16], fov: 52 },          // waterline, looking up the side
  { pos: [455, 24, 78], target: [104, 34, 0], fov: 30 },          // bow on
  { pos: [-450, 34, -70], target: [-120, 38, 0], fov: 32 },       // stern
];

const NS = 'http://www.w3.org/2000/svg';

// Plan-view ship silhouette (bow right) with the camera direction + view cone.
function viewIcon(v) {
  const S = 23 / 344, B = 2.4;
  const pts = [];
  for (let i = 0; i <= 20; i++) {
    const x = -170 + (344 * i) / 20;
    let w = 21;
    if (x > 60) { const t = (x - 60) / 114; w = 21 * Math.pow(Math.max(0, 1 - Math.pow(t, 2.2)), 0.72); }
    if (x < -163) w = 17;
    pts.push([16 + x * S, w * S * B]);
  }
  const f = (n) => n.toFixed(2);
  const hull = 'M' + pts.map(([x, w]) => `${f(x)},${f(16 - w)}`).join(' L') + ' L' + pts.slice().reverse().map(([x, w]) => `${f(x)},${f(16 + w)}`).join(' L') + ' Z';
  const funnel = `<rect x="${f(16 - 97 * S - 1.1)}" y="14.6" width="2.2" height="2.8" rx="0.8" class="mark"/>`;
  const dx = v.pos[0] - v.target[0] * 0.3, dz = v.pos[2] - v.target[2] * 0.3;
  const L = Math.hypot(dx, dz) || 1;
  const high = v.pos[1] > 90, low = v.pos[1] < 10;
  const R = high ? 9.5 : 12.6;
  const cx = 16 + (dx / L) * R, cy = 16 + (dz / L) * R * 0.92;
  const tx = 16 + v.target[0] * S, ty = 16 + v.target[2] * S * B;
  const a = Math.atan2(ty - cy, tx - cx);
  const spread = ((v.fov * Math.PI) / 180) * 0.7, len = 7.5;
  const p1 = [cx + Math.cos(a - spread) * len, cy + Math.sin(a - spread) * len];
  const p2 = [cx + Math.cos(a + spread) * len, cy + Math.sin(a + spread) * len];
  return `<svg viewBox="0 0 32 32" aria-hidden="true">
    <path d="M${f(cx)},${f(cy)} L${f(p1[0])},${f(p1[1])} A${len},${len} 0 0 1 ${f(p2[0])},${f(p2[1])} Z" class="cone"/>
    <path d="${hull}" class="hull"/>${funnel}
    <circle cx="${f(cx)}" cy="${f(cy)}" r="2.3" class="eye"/>
    ${high ? `<circle cx="${f(cx)}" cy="${f(cy)}" r="4.1" class="ring"/>` : ''}
    ${low ? `<path d="M${f(cx - 3.4)},${f(cy + 4.2)} q1.7,-1.4 3.4,0 t3.4,0" class="wave"/>` : ''}
  </svg>`;
}

const MOOD_ICONS = [
  // sun
  `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="5.2" class="fill"/>${Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4; const r0 = 8.2, r1 = 11.2;
    return `<path d="M${(16 + Math.cos(a) * r0).toFixed(2)},${(16 + Math.sin(a) * r0).toFixed(2)} L${(16 + Math.cos(a) * r1).toFixed(2)},${(16 + Math.sin(a) * r1).toFixed(2)}" class="stroke"/>`;
  }).join('')}</svg>`,
  // sunset
  `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M9.5,20 A6.5,6.5 0 0 1 22.5,20 Z" class="fill"/><path d="M5,20 H27" class="stroke"/><path d="M8,24 H24" class="stroke thin"/>${[-60, -30, 0, 30, 60].map((d) => {
    const a = ((d - 90) * Math.PI) / 180; const r0 = 8.8, r1 = 11.6;
    return `<path d="M${(16 + Math.cos(a) * r0).toFixed(2)},${(20 + Math.sin(a) * r0).toFixed(2)} L${(16 + Math.cos(a) * r1).toFixed(2)},${(20 + Math.sin(a) * r1).toFixed(2)}" class="stroke"/>`;
  }).join('')}</svg>`,
  // moon
  `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M20.5,6.5 A10,10 0 1 0 25.5,21.5 A8,8 0 1 1 20.5,6.5 Z" class="fill"/><circle cx="24" cy="9" r="0.9" class="fill"/><circle cx="27" cy="14" r="0.6" class="fill"/></svg>`,
];

const PLAY = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M12,9 L23,16 L12,23 Z" class="fill"/></svg>';
const PAUSE = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="10.5" y="9" width="3.6" height="14" rx="1" class="fill"/><rect x="17.9" y="9" width="3.6" height="14" rx="1" class="fill"/></svg>';
const FULL = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8,13 V8 H13 M19,8 H24 V13 M24,19 V24 H19 M13,24 H8 V19" class="stroke"/></svg>';

export function buildUI({ onView, onMood, onTour, onFull }) {
  const bar = document.getElementById('ui');
  const views = document.createElement('div'); views.className = 'grp';
  const moods = document.createElement('div'); moods.className = 'grp';
  const misc = document.createElement('div'); misc.className = 'grp';
  const vBtns = VIEWS.map((v, i) => {
    const b = document.createElement('button');
    b.innerHTML = viewIcon(v);
    b.setAttribute('aria-label', 'View ' + (i + 1));
    b.addEventListener('click', () => onView(i));
    views.appendChild(b);
    return b;
  });
  const mBtns = MOOD_ICONS.map((svg, i) => {
    const b = document.createElement('button');
    b.innerHTML = svg; b.className = 'mood';
    b.setAttribute('aria-label', ['Day', 'Golden hour', 'Night'][i]);
    b.addEventListener('click', () => onMood(i));
    moods.appendChild(b);
    return b;
  });
  const tour = document.createElement('button'); tour.innerHTML = PLAY; tour.setAttribute('aria-label', 'Tour');
  tour.addEventListener('click', onTour);
  const full = document.createElement('button'); full.innerHTML = FULL; full.setAttribute('aria-label', 'Fullscreen');
  full.addEventListener('click', onFull);
  misc.append(tour, full);
  const sep = () => { const s = document.createElement('div'); s.className = 'sep'; return s; };
  bar.append(views, sep(), moods, sep(), misc);

  // auto-hide after inactivity
  let hideT = 0, forcedHidden = false;
  const show = () => {
    if (forcedHidden) return;
    document.body.classList.remove('idle');
    clearTimeout(hideT);
    hideT = setTimeout(() => document.body.classList.add('idle'), 3800);
  };
  addEventListener('pointermove', show, { passive: true });
  addEventListener('pointerdown', show, { passive: true });
  addEventListener('keydown', show);

  return {
    setView(i) { vBtns.forEach((b, k) => b.classList.toggle('on', k === i)); },
    setMood(i) { mBtns.forEach((b, k) => b.classList.toggle('on', k === i)); },
    setTour(on) { tour.innerHTML = on ? PAUSE : PLAY; tour.classList.toggle('on', on); },
    toggleFull: onFull,
    toggleHidden() { forcedHidden = !forcedHidden; document.body.classList.toggle('idle', forcedHidden); },
    ready() {
      document.body.classList.add('ready');
      show();
    },
  };
}
