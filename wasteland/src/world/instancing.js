// CPU-culled instancing: one InstancedMesh per model part for the whole map.
// Each update refills the instance buffer with only the instances that are within
// draw distance and (with a margin, so off-screen casters keep their shadows)
// inside the view frustum. Keeps draw calls ~ number of distinct model parts.
import * as THREE from 'three';

const _s = new THREE.Sphere(), _pm = new THREE.Matrix4(), _f = new THREE.Frustum();

export class CulledSet {
  constructor(geometry, material, matrices, { shadow = true, maxD = 220, margin = 12 } = {}) {
    this.im = new THREE.InstancedMesh(geometry, material, matrices.length);
    this.im.count = 0;
    this.im.frustumCulled = false;
    this.im.castShadow = shadow;
    this.im.receiveShadow = true;
    this.im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.matrices = matrices;
    this.maxD = maxD;
    this.margin = margin;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const r0 = geometry.boundingSphere.radius, c0 = geometry.boundingSphere.center;
    this.spheres = matrices.map((m) => {
      const c = c0.clone().applyMatrix4(m);
      const sc = Math.cbrt(Math.abs(m.determinant())) || 1;
      return { c, r: r0 * sc };
    });
    this.removed = new Uint8Array(matrices.length);
  }

  update(frustum, cam, scale = 1) {
    let n = 0;
    const im = this.im, maxD = this.maxD * scale;
    for (let i = 0; i < this.matrices.length; i++) {
      if (this.removed[i]) continue;
      const s = this.spheres[i];
      const d = s.c.distanceTo(cam) - s.r;
      if (d > maxD) continue;
      _s.center.copy(s.c); _s.radius = s.r + this.margin;
      if (!frustum.intersectsSphere(_s)) continue;
      im.setMatrixAt(n++, this.matrices[i]);
    }
    im.count = n;
    im.visible = n > 0;
    im.instanceMatrix.clearUpdateRanges();
    im.instanceMatrix.addUpdateRange(0, n * 16);
    im.instanceMatrix.needsUpdate = true;
  }
}

export function viewFrustum(camera) {
  _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  return _f.setFromProjectionMatrix(_pm);
}
