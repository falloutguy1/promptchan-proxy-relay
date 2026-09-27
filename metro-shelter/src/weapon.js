// Service pistol viewmodel: hip carry, recoil, reload, muzzle flash, bullet impacts; plus the flashlight.
import * as THREE from 'three';
import { instance } from './assets.js';

const MAG = 8;

export class Weapon {
  constructor(camera, scene) {
    this.cam = camera; this.scene = scene;
    this.mag = MAG;
    this.cool = 0; this.reloadT = 0; this.recoil = 0; this.sway = new THREE.Vector2();
    this.holder = new THREE.Group();
    camera.add(this.holder);
    const gun = instance('service_pistol');
    // The asset is a display set (two pistols, loose magazines, a cartridge): keep the assembled "_a" pistol.
    const keep = /pistol_a|slide_a|hammer_a|trigger_a/;
    gun.traverse((o) => {
      if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; }
      if (o.name && /service_pistol_/.test(o.name) && !keep.test(o.name)) o.visible = false;
      if (/slide_a/.test(o.name || '')) { this.slide = o; this.slideX = o.position.x; }
    });
    this.gun = new THREE.Group();
    gun.rotation.y = Math.PI / 2;             // model barrel runs along +X; point it down the view axis
    gun.position.set(0, -0.02, 0.03);
    this.gun.add(gun);
    this.holder.add(this.gun);
    this.rest = new THREE.Vector3(0.14, -0.145, -0.4);
    this.gun.position.copy(this.rest);
    // muzzle flash: light always present (constant light count), sprite toggled
    this.flash = new THREE.PointLight(0xffb060, 0, 6, 2);
    this.flash.position.set(0.12, -0.09, -0.5);
    this.holder.add(this.flash);
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,240,200,1)'); grd.addColorStop(0.3, 'rgba(255,170,60,.8)'); grd.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    this.flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flashSprite.scale.setScalar(0.12);
    this.flashSprite.position.set(0.12, -0.085, -0.49);
    this.flashSprite.visible = false;
    this.holder.add(this.flashSprite);
    this.flashT = 0;
    // flashlight
    this.torch = new THREE.SpotLight(0xfff1dc, 0, 22, 0.42, 0.55, 2);
    this.torch.position.set(0.2, -0.1, 0);
    this.torch.target.position.set(0.05, -0.05, -3);
    this.torch.shadow.mapSize.set(1024, 1024);
    this.torch.shadow.bias = -0.0005; this.torch.shadow.normalBias = 0.02;
    this.torch.shadow.camera.near = 0.15;
    camera.add(this.torch, this.torch.target);
    this.torchOn = false;
    // bullet-hole decals
    const hc = document.createElement('canvas'); hc.width = hc.height = 64;
    const h = hc.getContext('2d');
    const hg = h.createRadialGradient(32, 32, 2, 32, 32, 30);
    hg.addColorStop(0, 'rgba(8,6,5,1)'); hg.addColorStop(0.25, 'rgba(25,20,16,.9)'); hg.addColorStop(0.5, 'rgba(60,50,40,.35)'); hg.addColorStop(1, 'rgba(0,0,0,0)');
    h.fillStyle = hg; h.fillRect(0, 0, 64, 64);
    this.holeMat = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(hc), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 });
    this.holeMat.map.colorSpace = THREE.SRGBColorSpace;
    this.holes = [];
    this.ray = new THREE.Raycaster();
  }

  // Shadow casting is fixed per quality level so toggling the torch never triggers a shader recompile.
  setTorchShadow(on) { this.torch.castShadow = on; }
  toggleTorch() {
    this.torchOn = !this.torchOn;
    this.torch.intensity = this.torchOn ? 38 : 0;
  }

  canFire() { return this.cool <= 0 && this.reloadT <= 0; }

  // returns {hitRat, point} | 'empty' | null
  fire(rats, worldMeshes) {
    if (!this.canFire()) return null;
    if (this.mag <= 0) { this.cool = 0.3; return 'empty'; }
    this.mag--; this.cool = 0.2; this.recoil = 1; this.flashT = 0.05;
    const origin = new THREE.Vector3(), dir = new THREE.Vector3();
    this.cam.getWorldPosition(origin); this.cam.getWorldDirection(dir);
    this.ray.set(origin, dir); this.ray.far = 60;
    const wh = this.ray.intersectObjects(worldMeshes, false)[0];
    const rh = rats.hit(this.ray.ray, wh ? wh.distance : 60);
    if (rh) return { rat: rh.rat, point: rh.point };
    if (wh && wh.face) this.decal(wh);
    return { point: wh?.point };
  }

  decal(hit) {
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.07), this.holeMat);
    m.position.copy(hit.point).addScaledVector(n, 0.003);
    m.lookAt(hit.point.clone().add(n));
    m.rotation.z = Math.random() * 6;
    this.scene.add(m);
    this.holes.push(m);
    if (this.holes.length > 40) this.scene.remove(this.holes.shift());
  }

  reload(reserve) {
    if (this.reloadT > 0 || this.mag === MAG || reserve <= 0) return 0;
    this.reloadT = 1.6;
    const take = Math.min(MAG - this.mag, reserve);
    this.pending = take;
    return take;
  }

  update(dt, t, player) {
    this.cool -= dt;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { this.mag += this.pending; this.pending = 0; }
    }
    this.recoil = THREE.MathUtils.damp(this.recoil, 0, 14, dt);
    this.flashT -= dt;
    this.flashSprite.visible = this.flashT > 0;
    this.flash.intensity = this.flashT > 0 ? 25 : 0;
    // hip sway from walking and a slow breathing drift; reload dips the gun out of view
    const walk = Math.min(player.speed / 3.4, 1);
    const rl = this.reloadT > 0 ? Math.sin((1 - this.reloadT / 1.6) * Math.PI) : 0;
    this.gun.position.set(
      this.rest.x + Math.sin(player.stride) * 0.008 * walk + Math.sin(t * 0.8) * 0.0015,
      this.rest.y - Math.abs(Math.cos(player.stride)) * 0.006 * walk + Math.sin(t * 1.3) * 0.0015 - rl * 0.22,
      this.rest.z + this.recoil * 0.05);
    this.gun.rotation.set(this.recoil * 0.22 + rl * 0.7, 0.04, rl * 0.4);
    // slide cycles back on each shot and locks back on an empty magazine
    if (this.slide) this.slide.position.x = this.slideX - (this.mag === 0 && this.reloadT <= 0 ? 0.03 : Math.min(this.recoil * 1.6, 1) * 0.03);
  }
}
