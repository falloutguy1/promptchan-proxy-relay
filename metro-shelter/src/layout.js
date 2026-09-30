// Real-world dimensions (metres) of a deep-level pylon-type metro station, loosely after 1930s–50s Moscow stations.
// X across the station, Y up, Z along the tracks. Platform floor is y = 0.
export const L = 27;               // half length of the station box (54 m section)
export const PERIOD = 6;           // pylon rhythm
export const OPEN_W = 2.4;         // pylon passage width
export const OPEN_SPRING = 2.1;    // height where the passage arch starts
export const OPENINGS = Array.from({ length: 9 }, (_, k) => -24 + k * PERIOD);
export const BAYS = Array.from({ length: 8 }, (_, k) => -21 + k * PERIOD);  // pylon centres (room bays)

export const HALL = 4.2;           // central hall half-width
export const HALL_SPRING = 3.6, HALL_APEX = 6.0;
export const PYLON_OUT = 6.2;      // outer face of pylons
export const EDGE = 10.0;          // platform edge
export const WALL = 14.3;          // track wall
export const SIDE_SPRING = 3.4, SIDE_APEX = 5.4;
export const SIDE_CX = (PYLON_OUT + WALL) / 2, SIDE_RX = (WALL - PYLON_OUT) / 2;

export const TRACK_Y = -1.1;       // trackbed (top of concrete) relative to platform
export const TRACK_X = 12.1;       // track centreline
export const GAUGE = 1.52;         // Russian gauge
export const TUN_HW = 1.8;         // tunnel half-width (horseshoe)
export const TUN_SPRING = 1.6;     // tunnel arch spring height (absolute y)
export const TUN_END = 67;         // tunnels are modelled to |z| = 67
export const BARRICADE_Z = 47;     // barricades across each tunnel

export const EYE = 1.65;
