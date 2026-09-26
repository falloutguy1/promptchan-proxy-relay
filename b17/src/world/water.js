// River surface: ribbon mesh following the valley, PBR water with scrolling ripple normals,
// shallow translucent edges and IBL/sun reflections.
import * as THREE from 'three';
import { riverZ, WATER_Y, RIVER_W } from './layout.js';

function rippleNormalTexture(size = 256) {
  const h = new Float32Array(size * size);
  const waves = [];
  let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 28; i++) {
    const kx = Math.round((rnd() - 0.5) * 18), ky = Math.round((rnd() - 0.5) * 18);
    waves.push([kx, ky, rnd() * 6.28, 1 / (1 + Math.hypot(kx, ky))]);
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0;
    for (const [kx, ky, p, a] of waves) v += a * Math.sin(((kx * x + ky * y) / size) * Math.PI * 2 + p);
    h[y * size + x] = v;
  }
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const g = (i, j) => h[((y + j + size) % size) * size + ((x + i + size) % size)];
    const dx = (g(1, 0) - g(-1, 0)) * 1.2, dy = (g(0, 1) - g(0, -1)) * 1.2;
    const L = Math.hypot(dx, dy, 1);
    const k = (y * size + x) * 4;
    d[k] = (-dx / L * 0.5 + 0.5) * 255; d[k + 1] = (-dy / L * 0.5 + 0.5) * 255; d[k + 2] = (1 / L * 0.5 + 0.5) * 255; d[k + 3] = 255;
  }
  const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export class River {
  constructor(scene, env) {
    const pos = [], edge = [], idx = [];
    const half = RIVER_W / 2 + 9;
    let n = 0;
    for (let x = -14000; x <= 14000; x += 12) {
      const z0 = riverZ(x);
      const dz = (riverZ(x + 2) - riverZ(x - 2)) / 4;
      const L = Math.hypot(1, dz);
      const nx = -dz / L, nz = 1 / L;
      for (const s of [-1, -0.55, 0, 0.55, 1]) {
        pos.push(x + nx * half * s, WATER_Y, z0 + nz * half * s);
        edge.push(Math.abs(s));
      }
      if (n > 0) {
        const b = (n - 1) * 5, c = n * 5;
        for (let k = 0; k < 4; k++) idx.push(b + k, b + k + 1, c + k, b + k + 1, c + k + 1, c + k);
      }
      n++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
    const nrm = new Float32Array(pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();

    this.uniforms = { uTime: { value: 0 }, tRip: { value: rippleNormalTexture() } };
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.030, 0.045, 0.036), roughness: 0.06, metalness: 0.0, transparent: true, envMapIntensity: 1.0 });
    env.material(mat, (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aEdge; varying float vEdge; varying vec3 vWP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = aEdge; vWP = (modelMatrix*vec4(transformed,1.0)).xyz;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          { float dd = length(mvPosition.xyz); mvPosition.xyz *= 1.0 - clamp(dd * 0.0015, 0.0, 6.0) / max(dd, 1.0); gl_Position = projectionMatrix * mvPosition; }`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform sampler2D tRip; varying float vEdge; varying vec3 vWP;')
        .replace('#include <normal_fragment_maps>', `
          vec2 p = vWP.xz;
          float dist = length(vWP - cameraPosition);
          vec3 n1 = texture2D(tRip, p / 23.0 + vec2(uTime * 0.013, uTime * 0.004)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(tRip, p / 7.3 + vec2(-uTime * 0.021, uTime * 0.017)).xyz * 2.0 - 1.0;
          vec3 n3 = texture2D(tRip, p / 97.0 + vec2(uTime * 0.006, 0.0)).xyz * 2.0 - 1.0;
          vec3 nn = normalize(vec3((n1.xy * 0.55 + n2.xy * 0.35 * (1.0 - smoothstep(150.0, 900.0, dist)) + n3.xy * 0.5) * 0.12, 1.0));
          vec3 nW = normalize(vec3(nn.x, nn.z, -nn.y));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        `)
        .replace('#include <opaque_fragment>', `
          // shallow, muddy edges let the bank show through; mid river is opaque
          float a = mix(0.97, 0.35, smoothstep(0.55, 1.0, vEdge));
          diffuseColor.a = a;
          outgoingLight = mix(outgoingLight, outgoingLight * vec3(1.2, 1.1, 0.9), smoothstep(0.6, 1.0, vEdge) * 0.4);
          #include <opaque_fragment>
        `);
    }, 'river');
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'river';
    scene.add(this.mesh);
  }

  update(t) { this.uniforms.uTime.value = t; }
}
