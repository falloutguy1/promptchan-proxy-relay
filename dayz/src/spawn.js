import * as THREE from 'three';

// Placement of glTF assets: grounded on their real bounding box, optional
// tilt to the terrain normal, collision registration.

const _box = new THREE.Box3();

export async function spawnModel(ctx, id, o = {}) {
  const src = await ctx.assets.model(id, o.lod || 0);
  if (!src) return null;
  const obj = src.clone(true);
  obj.name = id;
  if (o.scale) obj.scale.setScalar(o.scale);
  obj.rotation.set(o.rx || 0, o.rot || 0, o.rz || 0, 'YXZ');
  obj.updateMatrixWorld(true);
  _box.setFromObject(obj);
  const x = o.x ?? 0, z = o.z ?? 0;
  let y = o.y;
  if (y === undefined) {
    y = ctx.hf.height(x, z);
    if (o.tilt !== false && !o.onFloor) {
      // align to the ground slope by sampling under the footprint corners
      const hx = (_box.max.x - _box.min.x) / 2, hz = (_box.max.z - _box.min.z) / 2;
      const hs = [ctx.hf.height(x - hx, z), ctx.hf.height(x + hx, z), ctx.hf.height(x, z - hz), ctx.hf.height(x, z + hz)];
      const ax = Math.atan2(hs[1] - hs[0], 2 * hx), az = Math.atan2(hs[3] - hs[2], 2 * hz);
      obj.rotation.set(az * (o.tiltAmount ?? 1) + (o.rx || 0), o.rot || 0, -ax * (o.tiltAmount ?? 1) + (o.rz || 0), 'YXZ');
      y = Math.min(...hs) * 0.3 + y * 0.7;
      obj.updateMatrixWorld(true);
      _box.setFromObject(obj);
    }
  }
  // sink slightly so contact is solid (soil / floor boards aren't perfectly flat)
  obj.position.set(x, y - _box.min.y - (o.sink ?? 0.01), z);
  obj.updateMatrixWorld(true);
  if (o.parent) { o.parent.add(obj); o.parent.updateMatrixWorld(true); } else ctx.scene.add(obj);
  if (o.collide) {
    _box.setFromObject(obj);
    const cx = (_box.min.x + _box.max.x) / 2, cz = (_box.min.z + _box.max.z) / 2;
    if (o.collide === 'circle') ctx.collision.circle(cx, cz, Math.min(_box.max.x - _box.min.x, _box.max.z - _box.min.z) / 2, _box.min.y, _box.max.y);
    else ctx.collision.box(cx, cz, (_box.max.x - _box.min.x) / 2, (_box.max.z - _box.min.z) / 2, 0, _box.min.y, _box.max.y);
    if (o.walkTop) ctx.collision.floor(cx, cz, (_box.max.x - _box.min.x) / 2, (_box.max.z - _box.min.z) / 2, 0, _box.max.y);
  }
  if (o.envIntensity !== undefined) obj.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.material.envMapIntensity = o.envIntensity; } });
  return obj;
}
