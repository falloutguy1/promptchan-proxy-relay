import * as THREE from 'three';
import { LAYER_NO_AO } from '../engine/Renderer.js';

/**
 * GPU billboard particles (one draw call per system). CPU integrates simple ballistic motion,
 * drag and growth; the shader does camera-facing quads, soft round sprites, sun-lit shading and fog.
 */
export class Particles {
  constructor(max, { additive = false, name = 'particles' } = {}) {
    this.max = max;
    this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.age = new Float32Array(max);
    this.size0 = new Float32Array(max); this.size1 = new Float32Array(max);
    this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    this.col = new Float32Array(max * 4); // rgb + alpha0
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage); // xyz size
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage); // rgb alpha
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', this.aPos); g.setAttribute('aCol', this.aCol); g.setAttribute('aRot', this.aRot);
    g.instanceCount = 0;
    this.rot = new Float32Array(max);
    this.mat = new THREE.ShaderMaterial({
      name,
      uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uAmb: { value: new THREE.Color(0.55, 0.6, 0.66) }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 } },
      vertexShader: `
        attribute vec4 aPos; attribute vec4 aCol; attribute float aRot;
        varying vec4 vCol; varying vec2 vUv; varying float vFog; varying vec3 vN;
        void main(){
          vUv = position.xy + 0.5; vCol = aCol;
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float c = cos(aRot), s = sin(aRot);
          vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
          vec3 wp = aPos.xyz + (right * q.x + up * q.y) * aPos.w;
          vN = normalize(right * q.x + up * q.y + normalize(cameraPosition - aPos.xyz) * 0.6);
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          vFog = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uAmb; uniform vec3 fogColor; uniform float fogDensity;
        varying vec4 vCol; varying vec2 vUv; varying float vFog; varying vec3 vN;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
        void main(){
          vec2 d = vUv - 0.5;
          float r = length(d) * 2.0;
          float puff = vn(vUv * 5.0 + vCol.a * 3.0) * 0.5 + vn(vUv * 11.0) * 0.25;
          float a = smoothstep(1.0, 0.35, r + (puff - 0.35) * 0.6) * vCol.a;
          if (a < 0.004) discard;
          ${additive ? 'vec3 c = vCol.rgb * a; gl_FragColor = vec4(c, a);' : `
          float lit = clamp(dot(vN, uSun) * 0.5 + 0.55, 0.0, 1.0);
          vec3 c = vCol.rgb * (uAmb + uSunCol * lit * 0.85);
          float f = 1.0 - exp(-fogDensity * fogDensity * vFog * vFog);
          c = mix(c, fogColor, f);
          gl_FragColor = vec4(c, a);`}
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(LAYER_NO_AO);
    this.mesh.renderOrder = 5;
    this.geo = g;
  }

  emit(pos, vel, { life = 2, size0 = 1, size1 = 3, color = [1, 1, 1], alpha = 1, drag = 0.5, grav = 0 } = {}) {
    let i = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max);
    this.p.set([pos.x, pos.y, pos.z], i * 3); this.v.set([vel.x, vel.y, vel.z], i * 3);
    this.life[i] = life; this.age[i] = 0; this.size0[i] = size0; this.size1[i] = size1;
    this.drag[i] = drag; this.grav[i] = grav; this.col.set([...color, alpha], i * 4);
    this.rot[i] = Math.random() * 6.28;
  }

  update(dt, scene) {
    if (scene?.fog) { this.mat.uniforms.fogColor.value.copy(scene.fog.color); this.mat.uniforms.fogDensity.value = scene.fog.density; }
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) continue;
      if (j !== i) {
        for (let k = 0; k < 3; k++) { this.p[j * 3 + k] = this.p[i * 3 + k]; this.v[j * 3 + k] = this.v[i * 3 + k]; }
        for (let k = 0; k < 4; k++) this.col[j * 4 + k] = this.col[i * 4 + k];
        this.life[j] = this.life[i]; this.age[j] = this.age[i]; this.size0[j] = this.size0[i]; this.size1[j] = this.size1[i];
        this.drag[j] = this.drag[i]; this.grav[j] = this.grav[i]; this.rot[j] = this.rot[i];
      }
      const dk = Math.exp(-this.drag[j] * dt);
      this.v[j * 3] *= dk; this.v[j * 3 + 1] = this.v[j * 3 + 1] * dk - this.grav[j] * dt; this.v[j * 3 + 2] *= dk;
      for (let k = 0; k < 3; k++) this.p[j * 3 + k] += this.v[j * 3 + k] * dt;
      if (this.grav[j] > 0 && this.p[j * 3 + 1] < -1) { this.age[j] = this.life[j]; }
      const t = this.age[j] / this.life[j];
      this.aPos.setXYZW(j, this.p[j * 3], this.p[j * 3 + 1], this.p[j * 3 + 2], this.size0[j] + (this.size1[j] - this.size0[j]) * Math.sqrt(t));
      const fade = Math.min(1, t * 8) * (1 - t) * (1 - t);
      this.aCol.setXYZW(j, this.col[j * 4], this.col[j * 4 + 1], this.col[j * 4 + 2], this.col[j * 4 + 3] * fade);
      this.aRot.setX(j, this.rot[j] + t * 0.6);
      j++;
    }
    this.n = j;
    this.geo.instanceCount = j;
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aRot.needsUpdate = true;
  }
}
