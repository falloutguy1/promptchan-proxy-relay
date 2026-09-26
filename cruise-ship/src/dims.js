// Principal dimensions (metres). Ship frame: +x bow, +y up, +z starboard.
export const W = 21;            // half beam
export const Y_HULL = 12.5;     // top of lower hull / promenade deck
export const Y_REC = 21.0;      // underside of superstructure over lifeboat recess
export const Y_PUB = 24.2;      // first balcony deck
export const DECK_H = 2.9;
export const N_DECKS = 12;
export const Y_LIDO = Y_PUB + N_DECKS * DECK_H; // 59.0
export const BAY = 3.3;         // cabin bay width
export const BALC_D = 1.8;      // side balcony depth
export const REC_D = 4.8;       // lifeboat recess depth
export const RECESSES = [[-84, -22], [22, 84]];
export const ATRIUM = [-22, 22];

// Side balconies run on a bay grid starting at X_BALC0.
export const X_BALC0 = -140;
export const N_BAYS = 72;
export const X_BALC1 = X_BALC0 + N_BAYS * BAY; // 97.6
// Bay index ranges that are balconies (the gaps are stair towers / lobby).
export const BALC_RUNS = [[0, 12], [14, 40], [42, 57], [59, 72]];
export const STAIR_A = [X_BALC0 + 12 * BAY, X_BALC0 + 14 * BAY];
export const LOBBY = [X_BALC0 + 40 * BAY, X_BALC0 + 42 * BAY];
export const STAIR_B = [X_BALC0 + 57 * BAY, X_BALC0 + 59 * BAY];

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function bowTip(y) { return 171 + 0.2 * clamp(y, -6, 26); }
export function sternX(y) { return y >= 0 ? -170 : -170 - y * 1.2; }
function bowStart(y) { return 58 + 30 * clamp((y + 2) / 27.4, 0, 1); }

// Half-breadth of the hull at (x, y).
export function hullHalfW(x, y) {
  const h = clamp((y + 2) / 27.4, 0, 1);
  let w = W;
  const xs = bowStart(y), tip = bowTip(y);
  if (x > xs) {
    const t = clamp((x - xs) / (tip - xs), 0, 1);
    const a = lerp(1.9, 2.5, h), b = lerp(0.9, 0.62, h);
    w = W * Math.pow(Math.max(0, 1 - Math.pow(t, a)), b);
  }
  const xa = sternX(y), r = 7;
  if (x < xa + r) {
    const d = xa + r - x;
    w = Math.min(w, W - r + Math.sqrt(Math.max(0, r * r - d * d)));
  }
  if (y < -1) { const k = (-1 - y) / 5; w *= 1 - 0.14 * k * k; }
  return w;
}

// Half outline (z >= 0) of the hull at height y between x0 and x1.
// If fromStern, the outline starts at the stern centreline and wraps the transom corner.
export function hullOutline(y, x0, x1, n, fromStern) {
  const pts = [];
  const xa = sternX(y), r = 7;
  const bw = y < -1 ? 1 - 0.14 * ((-1 - y) / 5) ** 2 : 1;
  if (fromStern) {
    for (let i = 0; i < 4; i++) pts.push([xa, (W - r) * (i / 4) * bw]);
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI - (i / 8) * (Math.PI / 2);
      pts.push([xa + r + r * Math.cos(a), (W - r + r * Math.sin(a)) * bw]);
    }
    x0 = xa + r;
  }
  const tip = bowTip(y);
  const toTip = x1 >= tip - 1e-6;
  if (toTip) x1 = tip;
  for (let i = fromStern ? 1 : 0; i <= n; i++) {
    const u = i / n;
    const g = toTip ? 1 - Math.pow(1 - u, 1.7) : u;
    const x = x0 + (x1 - x0) * g;
    pts.push([x, i === n && toTip ? 0 : hullHalfW(x, y)]);
  }
  return pts;
}

// Front superstructure tier outline (half): straight side then elliptical nose.
export function frontX(k) { return 131 - 0.45 * k; }
export function frontOutline(k, inset = 0, n = 26) {
  const xf = frontX(k) - inset, x0 = 108, b = W - inset;
  const pts = [[X_BALC1, b]];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    pts.push([x0 + (xf - x0) * Math.sin(a), b * Math.cos(a)]);
  }
  return pts;
}

// Aft superstructure tier outline (half), from the stern centreline to X_BALC0.
export function aftX(k) { return -168 + 1.5 * k; }
export function aftOutline(k, inset = 0, n = 10) {
  const xe = aftX(k) + inset, rc = 9, b = W - inset;
  const pts = [];
  const zc = b - rc;
  for (let i = 0; i <= 6; i++) {
    const z = zc * (i / 6);
    pts.push([xe - 2.2 * (1 - (z / zc) ** 2), z]);
  }
  const cx = xe + rc;
  for (let i = 1; i <= n; i++) {
    const a = Math.PI - (i / n) * (Math.PI / 2);
    pts.push([cx + rc * Math.cos(a), zc + rc * Math.sin(a)]);
  }
  pts.push([X_BALC0, b]);
  return pts;
}
