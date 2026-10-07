import { generateTerrain } from './terrainGen.js';

self.onmessage = (e) => {
  const { seed } = e.data;
  const out = generateTerrain(seed, (p) => self.postMessage({ progress: p }));
  self.postMessage({ result: out }, [out.heights.buffer, out.splatA.buffer, out.splatB.buffer]);
};
