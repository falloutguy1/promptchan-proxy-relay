// Per-dweller look: each character clone gets its own material copies so colourway, fading, skin tone and
// hair colour vary across the shelter. Tints are multipliers on the painted textures, kept dusty and muted
// (rust, olive, ash) so the cast sits in the same palette as the station.
import * as THREE from 'three';

const CLOTH_TINT = ['#ffffff', '#d8c9b0', '#b9b59a', '#c9a58a', '#a8aaa4', '#d0b8a0', '#9fa38c', '#c4b29c'];
const SKIN_TONE = [0.78, 0.72, 0.64, 0.54, 0.44, 0.75];   // the skin maps are bright next to the dark cloth; keep faces from blowing out by the fire
const HAIR_TINT = ['#ffffff', '#6b5646', '#3a2e26', '#a09080', '#2a2420', '#8a6a4a'];

export function outfit(root, d, altTex = {}) {
  const i = d.id;
  const cloth = new THREE.Color(CLOTH_TINT[(i * 3 + 1) % CLOTH_TINT.length]);
  const skin = SKIN_TONE[(i * 5 + 2) % SKIN_TONE.length];
  const hair = new THREE.Color(HAIR_TINT[(i * 7 + 3) % HAIR_TINT.length]);
  const useAlt = (i * 13) % 3 === 0;
  const cache = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const swap = (m) => {
      if (cache.has(m)) return cache.get(m);
      const c = m.clone();
      const n = m.name || '';
      if (/Peasant|Ranger/.test(n)) {
        if (useAlt && altTex[n]) c.map = altTex[n];
        c.color.copy(cloth);
        c.roughness = Math.max(c.roughness, 0.85);
      } else if (/Superhero|Regular/.test(n)) {
        // the skin maps are greyscale roughness, which glTF also reads as metalness: skin is a dielectric
        c.color.setScalar(skin);
        c.metalness = 0; c.metalnessMap = null;
        c.roughness = 1;
      } else if (/Hair|Eye/.test(n)) {
        if (/Hair/.test(n)) c.color.copy(hair);
        c.metalness = 0; c.metalnessMap = null;
      }
      c.envMapIntensity = 0.8;
      cache.set(m, c);
      return c;
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
}
