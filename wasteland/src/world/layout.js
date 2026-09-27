// "Rustwater Crossing": the single hand-authored location. Distances in metres,
// +X east, +Z south, Y up. The playable/buildable area is the inner PLAY square;
// terrain continues to TERRAIN_SIZE and a low-detail ring carries the horizon.

export const TERRAIN_SIZE = 1024;      // heightfield extent (centred on origin)
export const PLAY = 420;               // square side of the buildable area
export const WATER_LEVEL = -3.2;       // pond surface height

export const ROADS = [
  {
    id: 'highway', kind: 'asphalt', width: 7.2, shoulder: 1.6,
    points: [[-560, 70], [-420, 52], [-300, 36], [-190, 22], [-100, 14], [-20, 10], [60, 6], [150, -4], [250, -22], [360, -44], [560, -70]],
  },
  {
    id: 'farm_track', kind: 'gravel', width: 4.0, shoulder: 0.8,
    points: [[46, 8], [48, -30], [55, -80], [68, -130], [84, -175], [96, -210], [104, -260], [110, -330], [118, -520]],
  },
  {
    id: 'pond_track', kind: 'dirt', width: 3.4, shoulder: 0.6,
    points: [[-58, 12], [-66, 44], [-84, 78], [-110, 112], [-122, 150], [-128, 200], [-150, 280], [-190, 520]],
  },
];

// Pond: irregular basin. radius is modulated by noise in terrain generation.
export const POND = { x: -168, z: 92, radius: 30, depth: 2.6 };

// Pre-collapse buildings. rot is the yaw (radians) the front door faces
// (0 = +Z/south, PI = north). Buildings sit on flattened lots.
export const LOTS = [
  { id: 'gas_station', type: 'gas_station', x: -112, z: 42, rot: Math.PI, w: 26, d: 22 },
  { id: 'store', type: 'store', x: -52, z: 38, rot: Math.PI, w: 14, d: 10 },
  // village street along the highway (north side faces south, south side faces north)
  { id: 'house_h', type: 'house', x: -84, z: -12, rot: 0.04, w: 9, d: 8, variant: 'ochre', floors: 1, condition: 0.5, fence: true },
  { id: 'house_a', type: 'house', x: -40, z: -14, rot: 0, w: 9, d: 8, variant: 'plaster', floors: 1, condition: 0.7, fence: true },
  { id: 'house_f', type: 'house', x: 2, z: -14, rot: -0.03, w: 10, d: 8.5, variant: 'brick', floors: 1, condition: 0.6, fence: true },
  { id: 'house_g', type: 'house', x: 76, z: -18, rot: 0.06, w: 9.5, d: 8, variant: 'plaster', floors: 1, condition: 0.45, fence: true },
  { id: 'house_c', type: 'house', x: 114, z: -24, rot: 0.08, w: 9, d: 7.5, variant: 'damaged', floors: 1, condition: 0.12 },
  { id: 'house_e', type: 'house', x: -150, z: -26, rot: 0.05, w: 8.5, d: 7.5, variant: 'damaged', floors: 1, condition: 0.35 },
  { id: 'house_k', type: 'house', x: -14, z: 36, rot: Math.PI, w: 9, d: 8, variant: 'ochre', floors: 1, condition: 0.55, fence: true },
  { id: 'house_b', type: 'house', x: 24, z: 32, rot: Math.PI, w: 10, d: 8, variant: 'plaster', floors: 2, condition: 0.6, fence: true },
  { id: 'house_i', type: 'house', x: 64, z: 28, rot: Math.PI + 0.05, w: 9, d: 8, variant: 'brick', floors: 1, condition: 0.4, fence: true },
  { id: 'house_d', type: 'house', x: 138, z: 22, rot: Math.PI - 0.1, w: 11, d: 8.5, variant: 'plaster', floors: 2, condition: 0.6 },
  { id: 'bus_stop', type: 'bus_stop', x: 36, z: 15.5, rot: Math.PI, w: 5, d: 2.2 },
  { id: 'water_tower', type: 'water_tower', x: 160, z: -78, rot: 0, w: 8, d: 8 },
  // farmstead up the gravel track
  { id: 'farmhouse', type: 'house', x: 122, z: -186, rot: -Math.PI / 2, w: 10, d: 8, variant: 'ochre', floors: 1, condition: 0.45 },
  { id: 'barn', type: 'barn', x: 70, z: -214, rot: 0.1, w: 22, d: 12 },
  { id: 'shed_1', type: 'shed', x: -48, z: -30, rot: 0.3, w: 3, d: 2.6 },
  { id: 'shed_2', type: 'shed', x: 12, z: -32, rot: -0.2, w: 3.4, d: 2.8 },
  { id: 'shed_3', type: 'shed', x: 32, z: 48, rot: 2.9, w: 3, d: 2.5 },
  { id: 'shed_4', type: 'shed', x: 104, z: -196, rot: 1.4, w: 4, d: 3 },
];

// Where the survivors start: an open meadow north of the crossroads.
export const START = { x: 18, z: -64, radius: 18 };

// Abandoned military checkpoint on the western approach.
export const CHECKPOINT = { x: -196, z: 24 };

// Vegetation regions: [x, z, radius, density 0..1, mix]
// mix: { conifer, birch, oak, dead } relative weights
export const FORESTS = [
  { x: -300, z: -200, r: 230, density: 0.95, mix: { conifer: 6, birch: 2, oak: 1, dead: 0.5 } },
  { x: 320, z: 220, r: 240, density: 0.9, mix: { conifer: 5, birch: 3, oak: 1, dead: 0.4 } },
  { x: -330, z: 260, r: 200, density: 0.8, mix: { conifer: 2, birch: 4, oak: 2, dead: 0.6 } },
  { x: 330, z: -300, r: 230, density: 0.75, mix: { conifer: 4, birch: 2, oak: 1, dead: 0.3 } },
  { x: -120, z: -150, r: 70, density: 0.55, mix: { conifer: 1, birch: 5, oak: 1, dead: 0.3 } },
  { x: 60, z: 120, r: 80, density: 0.5, mix: { conifer: 1, birch: 4, oak: 2, dead: 0.4 } },
  { x: -210, z: 110, r: 60, density: 0.45, mix: { conifer: 1, birch: 3, oak: 1, dead: 0.8 } },
  { x: 210, z: -140, r: 60, density: 0.35, mix: { conifer: 2, birch: 2, oak: 2, dead: 0.2 } },
];

// Overgrown farmland near the farm: soil + dry grass, few trees.
export const FIELDS = [
  { x: 170, z: -210, w: 110, d: 80, rot: 0.1 },
  { x: -10, z: -250, w: 90, d: 70, rot: -0.05 },
];

export const inPlay = (x, z, margin = 0) => Math.abs(x) <= PLAY / 2 - margin && Math.abs(z) <= PLAY / 2 - margin;
