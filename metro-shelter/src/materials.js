// Shared PBR material library (scanned CC0 texture sets from Poly Haven, KTX2-compressed).
import * as THREE from 'three';
import { pbr } from './assets.js';
import { TRACK_Y } from './layout.js';

export const M = {};

export function buildMaterials() {
  // Pylon cladding: marble slabs; tiles are ~0.5 m in a 2 m texture.
  M.marble = pbr('marble_01', { size: 1.5, color: 0xf0ebe2, weathering: { variation: 0.22, damp: 0.55, dampHeight: 0.7, streaks: 0.25, streakTop: 3.4, tint: [0.78, 0.72, 0.62] } });
  M.tiles = pbr('long_white_tiles', { size: 1.27, color: 0xe6e1d6, weathering: { floorY: -1.1, variation: 0.3, varScale: 0.05, damp: 0.5, dampHeight: 1.6, streaks: 0.9, streakTop: 3.4, tint: [0.6, 0.52, 0.42] } });
  M.marbleDark = pbr('slab_tiles', { size: 2.37, weathering: { variation: 0.15, damp: 0.4, dampHeight: 0.35 } });
  M.coping = pbr('granite_tile', { size: 2.3, color: 0xb8b2a8, weathering: { variation: 0.3, varScale: 0.1 } });
  M.granite = pbr('granite_tile', { size: 2.3, weathering: { variation: 0.25, varScale: 0.05, detile: 0.6, damp: 0.0, tint: [0.7, 0.66, 0.6] } });
  M.plaster = pbr('worn_plaster_wall', { size: 1.8, color: 0xd8d2c4, weathering: { variation: 0.3, varScale: 0.06, detile: 0.6, streaks: 0.85, streakTop: 6.1, tint: [0.62, 0.55, 0.45] } });
  M.concreteWall = pbr('concrete_wall_008', { size: 2.71, weathering: { floorY: TRACK_Y, variation: 0.25, damp: 0.7, dampHeight: 0.9, streaks: 0.7, streakTop: 3.4, tint: [0.62, 0.58, 0.5] } });
  M.tunnel = pbr('concrete_wall_008', { size: 2.71, color: 0xb8b4ac, weathering: { floorY: TRACK_Y, variation: 0.3, varScale: 0.04, damp: 0.9, dampHeight: 1.1, streaks: 0.9, streakTop: 3.6, tint: [0.55, 0.5, 0.42] } });
  M.trackbed = pbr('dirty_concrete', { size: 3.0, weathering: { floorY: TRACK_Y, variation: 0.3, detile: 0.5, damp: 0.5, dampHeight: 0.4, tint: [0.55, 0.5, 0.45] } });
  M.roughConcrete = pbr('rough_concrete', { size: 1.23, weathering: { variation: 0.2, damp: 0.5, floorY: TRACK_Y, dampHeight: 0.8 } });
  M.rust = pbr('rusty_metal_04', { size: 2.0 });
  M.rustFine = pbr('rusty_metal_02', { size: 1.0 });
  M.planks = pbr('weathered_planks', { size: 2.0, weathering: { variation: 0.2, damp: 0.3, dampHeight: 0.3 } });
  M.corrugated = pbr('rusty_corrugated_iron', { size: 2.0, weathering: { variation: 0.25, varScale: 0.3 } });
  M.debris = pbr('concrete_debris', { size: 2.0, weathering: { variation: 0.25, varScale: 0.15 } });

  M.steelPolished = new THREE.MeshStandardMaterial({ color: 0x8e9398, metalness: 1, roughness: 0.32 });
  M.cable = new THREE.MeshStandardMaterial({ color: 0x151412, roughness: 0.55, metalness: 0 });
  M.darkVoid = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 });
  M.cloth = fabric('#6a5541', 1);
  M.clothGreen = fabric('#4a5238', 2);
  M.clothGrey = fabric('#7b776c', 3);
  M.clothBlue = fabric('#48525e', 4);
  M.bulbOn = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffc27a, emissiveIntensity: 6 });
  return M;
}

// Woven fabric (canvas-generated): weave, slubs and soiling. Tiled at ~0.25 m.
function fabric(base, seed) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  let s = seed * 9301;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 2) { g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.06})`; g.fillRect(0, y, 256, 1); }
  for (let x = 0; x < 256; x += 2) { g.fillStyle = `rgba(255,255,255,${0.02 + r() * 0.04})`; g.fillRect(x, 0, 1, 256); }
  for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.08})`; g.fillRect(r() * 256, r() * 256, 1 + r() * 30, 1); }
  // soiling toward the lower edge (hem) rather than round blotches, which tile visibly
  const grd = g.createLinearGradient(0, 0, 0, 256); grd.addColorStop(0, 'rgba(40,28,15,0)'); grd.addColorStop(1, 'rgba(40,28,15,0.12)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3); t.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.97, side: THREE.DoubleSide });
}
