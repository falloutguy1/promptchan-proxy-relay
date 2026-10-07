// Battleship design parameters and first-order naval-architecture estimates.
// The formulas are simplified but calibrated against real ships (Iowa, KGV, Bismarck, Nelson)
// so trade-offs behave plausibly: armour and guns add weight -> deeper draft -> slower, etc.

export const CALIBERS = [280, 305, 343, 356, 381, 406, 460];
export const LAYOUTS = {
  'A-X': { label: '2 turrets (A, X)', turrets: [['A', 0.28, 0], ['X', -0.28, 0]] },
  'AB-X': { label: '3 turrets (A, B, X)', turrets: [['A', 0.3, 0], ['B', 0.2, 1], ['X', -0.27, 0]] },
  'AB-XY': { label: '4 turrets (A, B, X, Y)', turrets: [['A', 0.31, 0], ['B', 0.215, 1], ['X', -0.24, 1], ['Y', -0.33, 0]] },
  ABC: { label: '3 turrets forward (A, B, C)', turrets: [['A', 0.3, 0], ['B', 0.2, 1], ['C', 0.1, 0]] },
  'AB-Q-XY': { label: '5 turrets (A, B, Q, X, Y)', turrets: [['A', 0.32, 0], ['B', 0.225, 1], ['Q', -0.05, 0], ['X', -0.25, 1], ['Y', -0.34, 0]] },
};
export const PAINTS = {
  haze: { label: 'Haze Gray', hull: [0.43, 0.46, 0.48], deck: [0.36, 0.37, 0.38], upper: [0.47, 0.5, 0.52] },
  measure22: { label: 'Measure 22', hull: [0.24, 0.29, 0.34], deck: [0.22, 0.24, 0.27], upper: [0.5, 0.53, 0.55] },
  dark: { label: 'Dark Gray', hull: [0.24, 0.255, 0.27], deck: [0.22, 0.23, 0.24], upper: [0.26, 0.275, 0.29] },
  dazzle: { label: 'Dazzle', hull: [0.62, 0.66, 0.67], deck: [0.33, 0.35, 0.37], upper: [0.58, 0.61, 0.63], dazzle: true },
  peacetime: { label: 'Peacetime', hull: [0.6, 0.62, 0.62], deck: [0.6, 0.62, 0.62], upper: [0.66, 0.67, 0.66], buffFunnel: true },
};

export const DEFAULT_DESIGN = {
  name: 'HMS Resolute',
  length: 240, beam: 33, freeboard: 7.6, bow: 'clipper', stern: 'cruiser', sheer: 2.8,
  layout: 'AB-XY', caliber: 381, guns: 2,
  secondary: 4, aa: 2,
  belt: 330, deck: 150,
  power: 130000, funnels: 2, tower: 'tower', mast: 'tripod',
  paint: 'haze',
};

export const PRESETS = {
  'Fast battleship (1940)': { ...DEFAULT_DESIGN },
  'Dreadnought (1912)': { name: 'HMS Valorous', length: 175, beam: 27.5, freeboard: 7.0, bow: 'straight', stern: 'cruiser', sheer: 1.6, layout: 'AB-XY', caliber: 343, guns: 2, secondary: 0, aa: 0, belt: 300, deck: 65, power: 32000, funnels: 2, tower: 'tripod', mast: 'tripod', paint: 'dark' },
  'Super-battleship': { name: 'IJN-style Kaiju', length: 263, beam: 38.9, freeboard: 8.6, bow: 'bulbous', stern: 'cruiser', sheer: 3.6, layout: 'AB-X', caliber: 460, guns: 3, secondary: 3, aa: 3, belt: 410, deck: 200, power: 150000, funnels: 1, tower: 'pagoda', mast: 'pole', paint: 'dark' },
  'All-forward (Nelson)': { name: 'HMS Rodney II', length: 216, beam: 32.3, freeboard: 7.2, bow: 'straight', stern: 'transom', sheer: 2.0, layout: 'ABC', caliber: 406, guns: 3, secondary: 3, aa: 1, belt: 356, deck: 160, power: 45000, funnels: 1, tower: 'tower', mast: 'pole', paint: 'measure22' },
  'Fast & light': { name: 'USS Swiftsure', length: 270, beam: 33, freeboard: 8.0, bow: 'bulbous', stern: 'transom', sheer: 3.0, layout: 'AB-X', caliber: 406, guns: 3, secondary: 5, aa: 3, belt: 307, deck: 150, power: 212000, funnels: 2, tower: 'tower', mast: 'tripod', paint: 'measure22' },
};

export const LIMITS = {
  length: [150, 290, 1], beam: [22, 42, 0.5], freeboard: [4.5, 11, 0.1], sheer: [0, 5, 0.1],
  caliber: CALIBERS, guns: [2, 4, 1], secondary: [0, 6, 1], aa: [0, 3, 1],
  belt: [120, 450, 5], deck: [40, 220, 5], power: [25000, 240000, 1000], funnels: [1, 3, 1],
};

const RHO = 1.025, STEEL = 7.85, G = 9.81, KN = 0.514444;

export function shellMass(cal) { return 1225 * Math.pow(cal / 406, 3); } // kg, Iowa AP shell scaled
export function muzzleVelocity(cal) { return 760 + (406 - cal) * 0.35; }

/** Returns derived performance figures and warnings for a design. */
export function analyse(d) {
  const L = d.length, B = d.beam;
  const layout = LAYOUTS[d.layout];
  const nT = layout.turrets.length;
  const c = d.caliber / 406;
  const Cb = 0.6 - Math.max(0, (L / B - 7.2)) * 0.012; // finer hulls when long and narrow
  const area = Cb * L * B;
  const nGuns = nT * d.guns;

  // weights (tonnes); hull depends on depth, which depends on draft: iterate.
  let T = 9.5, W = {};
  for (let it = 0; it < 6; it++) {
    const D = T + d.freeboard + d.sheer * 0.25;
    W.hull = 0.122 * L * B * D * (1 + 0.04 * (d.bow === 'bulbous'));
    const beltLen = 0.62 * L, beltH = 6.6;
    W.belt = 2 * beltLen * beltH * (d.belt / 1000) * STEEL;
    W.deckArmour = 0.62 * L * B * 0.92 * (d.deck / 1000) * STEEL;
    W.turrets = nT * (d.guns * Math.pow(c, 3) * 560 + 380 * c * c + 680 * c * c * (d.belt / 330));
    W.secondary = d.secondary * 2 * 95;
    W.aa = d.aa * 380;
    W.machinery = d.power * 0.026 + 300;
    W.superstructure = 0.045 * W.hull + (d.tower === 'pagoda' ? 600 : 250);
    const light = Object.values(W).reduce((a, b) => a + b, 0) - (W.loads || 0);
    W.loads = 0.13 * light; // fuel, stores, ammunition, crew
    const disp = light + W.loads;
    T = disp / (RHO * area);
  }
  const disp = Object.values(W).reduce((a, b) => a + b, 0);
  const D = T + d.freeboard;

  // speed: Admiralty coefficient, better for long fine hulls and bulbous bows
  const C = 232 * Math.sqrt((L / B) / 7.9) * (d.bow === 'bulbous' ? 1.05 : 1) * (d.stern === 'transom' ? 1.02 : 1);
  const speedKn = Math.cbrt((C * d.power) / Math.pow(disp, 2 / 3));

  // stability
  const KB = 0.53 * T;
  const BM = (0.083 * B * B) / (T * (Cb / 0.6));
  const zs = {
    hull: 0.58 * D, belt: T * 0.9, deckArmour: D - 1.2, turrets: D + 1.5 + 0.6 * nT / 4, secondary: D + 3.5,
    aa: D + 7, machinery: 0.33 * D, superstructure: D + (d.tower === 'pagoda' ? 14 : 9), loads: 0.35 * D,
  };
  let mom = 0;
  for (const k in W) mom += W[k] * zs[k];
  const KG = mom / disp;
  const GM = KB + BM - KG;
  const rollPeriod = GM > 0.05 ? (0.79 * B) / Math.sqrt(GM) : Infinity;

  const sm = shellMass(d.caliber);
  const broadside = nGuns * sm;
  const mv = muzzleVelocity(d.caliber);
  const rangeKm = Math.min(42, 21 + 22 * c * (mv / 760)) * 0.95;
  // armour penetration of own gun at 15 km (rough De Marre-style scaling, mm)
  const pen15 = 380 * Math.pow(c, 1.1);

  const warnings = [];
  if (GM <= 0.3) warnings.push({ level: 'bad', text: `Unstable: GM ${GM.toFixed(2)} m. She will loll or capsize — lower topweight or widen the beam.` });
  else if (GM < 1.2) warnings.push({ level: 'warn', text: `Tender: GM ${GM.toFixed(2)} m. Slow, deep rolls; poor protection against flooding.` });
  else if (GM > 4.2) warnings.push({ level: 'warn', text: `Stiff: GM ${GM.toFixed(2)} m. Snappy ${rollPeriod.toFixed(1)} s roll makes a poor gun platform.` });
  if (d.freeboard < 6 && speedKn > 26) warnings.push({ level: 'warn', text: 'Low freeboard at high speed: forecastle will be wet in any sea.' });
  if (T > 11.8) warnings.push({ level: 'warn', text: `Deep draft ${T.toFixed(1)} m: belt armour largely submerged, harbour access limited.` });
  if (speedKn < 21) warnings.push({ level: 'warn', text: `Slow (${speedKn.toFixed(1)} kn): cannot keep station with modern fleets.` });
  if (d.belt < pen15 * 0.8) warnings.push({ level: 'warn', text: `Belt ${d.belt} mm is defeated by her own ${d.caliber} mm guns at 15 km (~${pen15.toFixed(0)} mm).` });
  if (L / B < 6.0) warnings.push({ level: 'warn', text: `L/B ${(L / B).toFixed(2)}: very beamy hull, high resistance.` });
  if (L / B > 8.8) warnings.push({ level: 'warn', text: `L/B ${(L / B).toFixed(2)}: slender hull, large turning circle.` });

  return {
    displacement: disp, weights: W, draft: T, depth: D, Cb, speedKn, speedMs: speedKn * KN, GM, KG, KB, BM, rollPeriod,
    broadside, shellMass: sm, muzzleVelocity: mv, rangeKm, pen15, nGuns, nTurrets: nT, warnings,
    turningDiameter: L * (3.6 + Math.max(0, L / B - 7) * 0.4),
    reload: 6 + 6 * Math.pow(c, 1.6) * (d.guns >= 3 ? 1.15 : 1), // gameplay-compressed salvo interval (s)
  };
}

export function clampDesign(d) {
  const out = { ...DEFAULT_DESIGN, ...d };
  for (const [k, lim] of Object.entries(LIMITS)) {
    if (Array.isArray(lim) && typeof lim[0] === 'number' && lim.length === 3) out[k] = Math.min(lim[1], Math.max(lim[0], Number(out[k]) || lim[0]));
  }
  if (!CALIBERS.includes(Number(out.caliber))) out.caliber = 381;
  if (!LAYOUTS[out.layout]) out.layout = 'AB-XY';
  if (!PAINTS[out.paint]) out.paint = 'haze';
  return out;
}
