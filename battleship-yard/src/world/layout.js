// World layout for the one finished location: "Kestrel Point" naval fitting-out yard.
// Units are metres. +Y up, sea level at y = 0. Land lies toward -Z, open sea toward +Z.

export const WORLD = {
  x0: -1536, x1: 1536, z0: -1536, z1: 768, // terrain extent
  cell: 2, // heightfield / splat resolution
};

export const QUAY = {
  x0: -190, x1: 190, // quay wall length
  edgeZ: 0, // face of the quay wall
  topY: 3.0, // coping level above mean sea level
  floorY: -12.5, // dredged berth depth
  yardZ: -82, // back of the paved yard
  apronZ: -26, // concrete apron width (crane rails inside it)
  railZ: [-3.2, -15.2], // crane rail centre lines
};

// Gravel road climbing from the yard gate into the hills behind.
export const ROAD = [
  [-28, -78], [-40, -120], [-80, -170], [-150, -205], [-215, -260], [-230, -330], [-205, -420], [-240, -520], [-330, -600],
];

// Footprints used by terrain flattening and vegetation exclusion.
export const BUILDINGS = {
  shed: { x: 70, z: -52, w: 64, d: 34, h: 15 }, // fabrication shed (long axis along X)
  office: { x: -62, z: -50, w: 22, d: 12, h: 7.2 },
  store: { x: 150, z: -58, w: 18, d: 12, h: 5.5 },
};

export const BERTH = { x: 0, z: 0 }; // ship centre line z is offset by half beam + fenders at runtime
