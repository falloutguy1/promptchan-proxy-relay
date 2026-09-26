import * as THREE from 'three';
import * as D from './dims.js';
import { gridGeo, wallGeo, bandGeo, capGeo, fullOutline, box, arcLen, offsetLine, samplePolyline } from './geom.js';

const C = {
  white: new THREE.Color(0xe9e9e6),
  offwhite: new THREE.Color(0xd9dad8),
  gray: new THREE.Color(0xa7acae),
  red: new THREE.Color(0xc41a24),
  dark: new THREE.Color(0x2b2f33),
  teak: new THREE.Color(0x8a5a36),
};

const SIDES = [false, true]; // starboard, port(mirror)

function loft(B, key, ys, outlineFn, sOffset = 0) {
  const rows = ys.map((y) => outlineFn(y));
  const sRows = rows.map((r) => arcLen(r).map((v) => v + sOffset));
  for (const mirror of SIDES) {
    const sm = mirror ? -1 : 1;
    const r3 = rows.map((r, j) => r.map((p) => [p[0], ys[j], p[1] * sm]));
    B.add(key, gridGeo(r3, mirror, sRows), undefined, null);
  }
}

export function buildHull(B, inst) {
  const { W, Y_HULL, Y_REC, Y_PUB, DECK_H, N_DECKS, Y_LIDO, BAY, BALC_D, REC_D } = D;

  // ---------------------------------------------------------------- lower hull
  loft(B, 'hull', [-6, -3.5, -1.5, -0.5, 0.5, 2, 4, 6.5, 9, 11, Y_HULL],
    (y) => D.hullOutline(y, null, D.bowTip(y), 60, true));

  // stern block (to the first balcony deck)
  loft(B, 'hull', [Y_HULL, 15, 18, Y_REC, Y_PUB], (y) => D.hullOutline(y, null, -84, 12, true));
  {
    const half = D.hullOutline(Y_PUB, null, -84, 12, true);
    B.add('deckPaint', capGeo(fullOutline(half), Y_PUB));
  }
  // bow block
  const sBow = 84 + 188;
  loft(B, 'hull', [Y_HULL, 15, 18, Y_REC, Y_PUB], (y) => D.hullOutline(y, 84, D.bowTip(y), 40, false), sBow);
  {
    // forecastle deck
    const half = D.hullOutline(Y_PUB, D.X_BALC1, D.bowTip(Y_PUB), 40, false);
    B.add('deckGreen', capGeo(fullOutline(half), Y_PUB - 0.01));
    // bulwark
    const yb = Y_PUB + 1.3;
    const outer = D.hullOutline(yb, 112, D.bowTip(yb), 30, false);
    const outer0 = D.hullOutline(Y_PUB, 112, D.bowTip(Y_PUB), 30, false);
    const inner = offsetLine(outer, -0.28).map((p, i, a) => (i === a.length - 1 ? [p[0] - 0.4, 0] : p));
    loft(B, 'hullDS', [Y_PUB, yb], (y) => (y < yb - 0.01 ? outer0 : outer), 112 + 188);
    for (const mirror of SIDES) {
      B.add('paint', wallGeo(inner, Y_PUB, yb, { mirror, flipFace: true }), C.white);
      B.add('paint', bandGeo(outer, inner, yb, { mirror }), C.white);
    }
  }

  // ---------------------------------------------------------------- lifeboat recesses
  const boats = [];
  for (const [xa, xb] of D.RECESSES) {
    const zi = W - REC_D;
    for (const mirror of SIDES) {
      const sm = mirror ? -1 : 1;
      B.add('wallPromenade', wallGeo([[xa, zi], [xb, zi]], Y_HULL, Y_REC, { mirror, sIsX: true }));
      B.add('deckTeak', bandGeo([[xa, W], [xb, W]], [[xa, zi], [xb, zi]], Y_HULL, { mirror }));
      B.add('paint', bandGeo([[xa, W], [xb, W]], [[xa, zi], [xb, zi]], Y_REC, { mirror, down: true }), C.white);
      B.add('paint', wallGeo([[xa, W], [xa, zi]], Y_HULL, Y_REC, { mirror }), C.offwhite);
      B.add('paint', wallGeo([[xb, zi], [xb, W]], Y_HULL, Y_REC, { mirror }), C.offwhite);
      // bulwark + rail along the promenade edge
      B.add('paint', box(xa, xb, Y_HULL, Y_HULL + 1.0, sm > 0 ? W - 0.22 : -W, sm > 0 ? W : -W + 0.22), C.white);
      B.add('paint', box(xa, xb, Y_HULL + 1.0, Y_HULL + 1.08, sm > 0 ? W - 0.3 : -W + 0.02, sm > 0 ? W - 0.02 : -W + 0.3), C.teak);
      // ceiling light troughs
      for (let x = xa + 2; x < xb - 1; x += 4) {
        B.add('lamp', box(x - 0.9, x + 0.9, Y_REC - 0.08, Y_REC, sm * (zi + 1.2) - 0.15, sm * (zi + 1.2) + 0.15));
      }
      const slot = (xb - xa) / 4;
      for (let i = 1; i < 4; i++) {
        const x = xa + i * slot;
        B.add('paint', box(x - 0.45, x + 0.45, Y_HULL, Y_REC, sm * (W - 0.6) - 0.45, sm * (W - 0.6) + 0.45), C.white);
      }
      for (let i = 0; i < 4; i++) boats.push({ x: xa + slot * (i + 0.5), z: sm * (W - 1.85), side: sm });
      // public deck band above the recess
      B.add('wallPublic', wallGeo([[xa, W], [xb, W]], Y_REC, Y_PUB, { mirror, sIsX: true }));
    }
  }

  // ---------------------------------------------------------------- atrium glass
  {
    const [xa, xb] = D.ATRIUM;
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const x = xa + (xb - xa) * (i / 24);
      const t = x / ((xb - xa) / 2);
      pts.push([x, W + 1.15 * (1 - t * t)]);
    }
    const straight = pts.map((p) => [p[0], W - 0.01]);
    for (const mirror of SIDES) {
      // two slightly canted panels give the curved-glass look
      const rows = [Y_HULL + 0.35, 16.4, 20.3, Y_PUB - 0.3];
      const k = [0.25, 0.9, 1.0, 0.55];
      const sm = mirror ? -1 : 1;
      const r3 = rows.map((y, j) => pts.map((p) => [p[0], y, sm * (W + (p[1] - W) * k[j])]));
      const sR = rows.map(() => pts.map((p) => p[0]));
      B.add('glassAtrium', gridGeo(r3, mirror, sR));
      const bot = pts.map((p) => [p[0], W + (p[1] - W) * 0.25]);
      const top = pts.map((p) => [p[0], W + (p[1] - W) * 0.55]);
      B.add('paint', bandGeo(bot.map((p) => [p[0], p[1] + 0.3]), straight, Y_HULL + 0.35, { mirror }), C.white);
      B.add('paint', wallGeo(bot.map((p) => [p[0], p[1] + 0.3]), Y_HULL, Y_HULL + 0.35, { mirror }), C.white);
      B.add('paint', bandGeo(top.map((p) => [p[0], p[1] + 0.35]), straight, Y_PUB, { mirror }), C.white);
      B.add('paint', wallGeo(top.map((p) => [p[0], p[1] + 0.35]), Y_PUB - 0.3, Y_PUB, { mirror }), C.white);
      B.add('paint', bandGeo(top.map((p) => [p[0], p[1] + 0.35]), straight, Y_PUB - 0.3, { mirror, down: true }), C.white);
      // vertical frame posts at the ends
      for (const x of [xa, xb]) B.add('paint', box(x - 0.35, x + 0.35, Y_HULL, Y_PUB, sm > 0 ? W - 0.5 : -W - 0.3, sm > 0 ? W + 0.3 : -W + 0.5), C.white);
    }
  }

  // ---------------------------------------------------------------- side balconies
  const dividers = inst.dividers;
  const addDivider = (x, yc, z, sx, sy, sz, rotY = 0) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, yc, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(sx, sy, sz));
    dividers.push(m);
  };
  const zb = W - BALC_D;
  for (const [b0, b1] of D.BALC_RUNS) {
    const x0 = D.X_BALC0 + b0 * BAY, x1 = D.X_BALC0 + b1 * BAY;
    for (const mirror of SIDES) {
      const sm = mirror ? -1 : 1;
      B.add('cabin', wallGeo([[x0, zb], [x1, zb]], Y_PUB, Y_LIDO, { mirror, sIsX: true }));
      for (let k = 0; k <= N_DECKS; k++) {
        const y = Y_PUB + k * DECK_H;
        B.add('paint', box(x0, x1, y - 0.28, y, sm > 0 ? zb - 0.05 : -W - 0.06, sm > 0 ? W + 0.06 : -zb + 0.05), C.white);
        if (k === N_DECKS) continue;
        B.add('railGlass', wallGeo([[x0, W - 0.05], [x1, W - 0.05]], y + 0.02, y + 1.04, { mirror, sIsX: true }));
        B.add('paint', box(x0, x1, y + 1.04, y + 1.1, sm > 0 ? W - 0.12 : -W + 0.0, sm > 0 ? W : -W + 0.12), C.white);
        const yc = y + (DECK_H - 0.28) / 2;
        for (let b = b0; b < b1; b++) {
          const h = Math.abs(Math.sin((b * 12.9898 + k * 78.233 + sm * 37.719) * 1.0) * 43758.5453) % 1;
          if (h < 0.3) continue;
          const x = D.X_BALC0 + (b + 0.5) * BAY + (h - 0.5) * 0.8;
          const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, sm * (W - BALC_D * 0.52)), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), sm > 0 ? 0 : Math.PI), new THREE.Vector3(1, 1, 1));
          inst.furniture.push({ m, h });
        }
        for (let b = b0; b <= b1; b++) {
          const x = D.X_BALC0 + b * BAY;
          const end = b === b0 || b === b1;
          if (end) addDivider(x, yc, sm * (W - BALC_D / 2 + 0.03), 0.3, DECK_H - 0.28, BALC_D + 0.1);
          else addDivider(x, yc, sm * (W - BALC_D / 2 - 0.02), 0.08, DECK_H - 0.3, BALC_D - 0.1);
        }
      }
    }
  }

  // ---------------------------------------------------------------- stair towers + lobby
  for (const [xa, xb] of [D.STAIR_A, D.STAIR_B]) {
    for (const mirror of SIDES) {
      const sm = mirror ? -1 : 1;
      B.add('wallStair', wallGeo([[xa, W], [xb, W]], Y_PUB, Y_LIDO + 3.4, { mirror, sIsX: true }));
      B.add('paint', box(xa, xb, Y_LIDO, Y_LIDO + 3.4, sm > 0 ? W - 7 : -W + 0.02, sm > 0 ? W - 0.02 : -W + 7), C.white);
      B.add('paint', box(xa - 0.1, xb + 0.1, Y_LIDO + 3.4, Y_LIDO + 3.65, sm > 0 ? W - 7.1 : -W - 0.1, sm > 0 ? W + 0.1 : -W + 7.1), C.offwhite);
    }
  }
  {
    const [xa, xb] = D.LOBBY; const zi = W - 1.2;
    for (const mirror of SIDES) {
      const sm = mirror ? -1 : 1;
      B.add('glassLobby', wallGeo([[xa, zi], [xb, zi]], Y_PUB, Y_LIDO + 4.2, { mirror, sIsX: true }));
      B.add('paint', wallGeo([[xa, W], [xa, zi]], Y_PUB, Y_LIDO + 4.2, { mirror }), C.white);
      B.add('paint', wallGeo([[xb, zi], [xb, W]], Y_PUB, Y_LIDO + 4.2, { mirror }), C.white);
      for (let k = 0; k <= N_DECKS; k++) {
        const y = Y_PUB + k * DECK_H;
        B.add('paint', box(xa, xb, y - 0.28, y, sm > 0 ? zi - 0.05 : -W - 0.06, sm > 0 ? W + 0.06 : -zi + 0.05), C.white);
      }
      B.add('paint', box(xa - 0.3, xb + 0.3, Y_LIDO + 4.2, Y_LIDO + 4.6, sm > 0 ? W - 9 : -W - 0.2, sm > 0 ? W + 0.2 : -W + 9), C.white);
      B.add('paint', box(xa, xb, Y_LIDO, Y_LIDO + 4.2, sm > 0 ? W - 9 : -zi + 0.02, sm > 0 ? zi - 0.02 : -W + 9), C.offwhite);
    }
  }

  // ---------------------------------------------------------------- stepped tiers (fore & aft)
  const tier = (outer, inner, y0, wallKey, fasciaCol, parapet, sOff) => {
    for (const mirror of SIDES) {
      B.add(wallKey, wallGeo(inner, y0, y0 + DECK_H, { mirror, s0: sOff }));
      B.add('deckTeak', bandGeo(outer, inner, y0, { mirror }));
      B.add('paint', bandGeo(outer, inner, y0 - 0.3, { mirror, down: true }), C.white);
      B.add('paint', wallGeo(outer, y0 - 0.3, y0, { mirror }), fasciaCol);
      if (parapet === 'solid') {
        const pin = offsetLine(outer, -0.14);
        B.add('paint', wallGeo(outer, y0, y0 + 1.0, { mirror }), C.white);
        B.add('paint', wallGeo(pin, y0, y0 + 1.0, { mirror, flipFace: true }), C.offwhite);
        B.add('paint', bandGeo(outer, pin, y0 + 1.0, { mirror }), C.white);
      } else if (parapet === 'glass') {
        const pg = offsetLine(outer, -0.06);
        const ph = offsetLine(outer, -0.14);
        B.add('railGlass', wallGeo(pg, y0 + 0.02, y0 + 1.04, { mirror }));
        B.add('paint', wallGeo(outer, y0 + 1.04, y0 + 1.1, { mirror }), C.white);
        B.add('paint', bandGeo(outer, ph, y0 + 1.1, { mirror }), C.white);
        B.add('paint', wallGeo(ph, y0 + 1.04, y0 + 1.1, { mirror, flipFace: true }), C.white);
      }
    }
  };

  for (let k = 0; k < N_DECKS; k++) {
    const y0 = Y_PUB + k * DECK_H;
    // front
    const fo = D.frontOutline(k, 0), fi = D.frontOutline(k, 1.2);
    tier(fo, fi, y0, k === 8 ? 'glassBridge' : 'glassFront', C.white, k === 8 ? 'none' : 'solid', 0);
    // suite dividers on the nose
    const fs = samplePolyline(D.frontOutline(k, 0.6), 4.8, 6.0);
    if (k !== 8) for (const q of fs) {
      if (q.x < 110) continue;
      for (const sm of [1, -1]) addDivider(q.x, y0 + (DECK_H - 0.3) / 2, sm * q.z, 0.1, DECK_H - 0.3, 1.25, Math.atan2(-q.tz * sm, q.tx) + Math.PI / 2);
    }
    // aft terraces
    const ao = D.aftOutline(k, 0), ai = D.aftOutline(k, 2.2);
    tier(ao, ai, y0, 'cabinAft', C.red, 'glass', 0);
    for (const sm of [1, -1]) addDivider(D.X_BALC0 - 0.16, y0 + (DECK_H - 0.28) / 2, sm * (W - 1.12), 0.3, DECK_H - 0.28, 2.3);
    const as = samplePolyline(D.aftOutline(k, 1.1), 3.6, 1.8);
    for (const q of as) {
      if (q.x > D.X_BALC0 - 1.0) continue;
      for (const sm of [1, -1]) addDivider(q.x, y0 + (DECK_H - 0.3) / 2, sm * q.z, 0.08, DECK_H - 0.3, 2.1, Math.atan2(-q.tz * sm, q.tx) + Math.PI / 2);
    }
  }
  // roof edge of the top tiers (= lido deck edge)
  for (const mirror of SIDES) {
    B.add('paint', wallGeo(D.frontOutline(N_DECKS, 0), Y_LIDO - 0.3, Y_LIDO, { mirror }), C.white);
    B.add('paint', wallGeo(D.aftOutline(N_DECKS, 0), Y_LIDO - 0.3, Y_LIDO, { mirror }), C.red);
    B.add('paint', bandGeo(D.frontOutline(N_DECKS, 0), D.frontOutline(N_DECKS, 1.2), Y_LIDO - 0.3, { mirror, down: true }), C.white);
    B.add('paint', bandGeo(D.aftOutline(N_DECKS, 0), D.aftOutline(N_DECKS, 2.2), Y_LIDO - 0.3, { mirror, down: true }), C.white);
  }
  // bridge wings
  {
    const y0 = Y_PUB + 8 * DECK_H;
    for (const sm of [1, -1]) {
      const za = sm > 0 ? W - 2 : -W - 3.4, zc = sm > 0 ? W + 3.4 : -W + 2;
      B.add('paint', box(103, 113, y0 - 0.35, y0 + DECK_H + 0.25, za, zc), C.white);
      const zo = sm * (W + 3.42);
      B.add('glassBridge', wallGeo([[103.3, Math.abs(zo)], [112.7, Math.abs(zo)]], y0 + 0.9, y0 + DECK_H - 0.15, { mirror: sm < 0, sIsX: true }));
      B.add('glassBridge', wallGeo([[113.02, W + 3.2], [113.02, W - 1.8]], y0 + 0.9, y0 + DECK_H - 0.15, { mirror: sm < 0 }));
    }
  }

  // ---------------------------------------------------------------- lido deck
  {
    const half = [...D.aftOutline(N_DECKS, 0), ...D.frontOutline(N_DECKS, 0)];
    B.add('deckLight', capGeo(fullOutline(half), Y_LIDO));
  }

  return { boats };
}
