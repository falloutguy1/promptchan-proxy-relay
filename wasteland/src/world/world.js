// Assembles the location: terrain, roads, water, sky, architecture, vegetation,
// props. Each stage reports progress to the loading screen.
import * as THREE from 'three';
import { Terrain } from './terrain.js';
import { createTerrainMaterial, createHorizonMaterial } from './terrainMaterial.js';
import { buildRoads } from './roads.js';
import { buildWater } from './water.js';
import { Sky } from './sky.js';
import { Trees } from './vegetation.js';
import { Grass } from './grass.js';
import { Town } from './town.js';
import { Props } from './props.js';
import { Characters } from '../gfx/characters.js';

export class World {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.assets = game.assets;
    this.settings = game.settings;
    this.updatables = [];
    this.colliders = [];
  }

  async build(loading) {
    const { scene, assets } = this;
    const stage = (i, t) => loading?.stageStart(i, t);

    stage(0, 'Reading the land');
    this.terrain = new Terrain(this.settings.url.get('seed') ? Number(this.settings.url.get('seed')) : 1337);
    await this.terrain.generate((t) => loading?.progress(0, 0, t));

    stage(1, 'Loading sky and light');
    this.sky = new Sky(this.game.renderer, scene, assets, this.settings);
    await this.sky.load();

    stage(2, 'Laying ground materials');
    const tMat = await createTerrainMaterial(assets, this.terrain);
    this.terrainGroup = this.terrain.buildMeshes(tMat);
    scene.add(this.terrainGroup);
    scene.add(this.terrain.buildHorizon(createHorizonMaterial()));

    stage(3, 'Paving roads');
    this.roads = await buildRoads(this.terrain, assets);
    scene.add(this.roads);
    this.water = buildWater(this.terrain);
    scene.add(this.water);
    this.updatables.push(this.water.userData.update);

    stage(4, 'Raising the town');
    this.town = new Town(this);
    scene.add(await this.town.build(assets));

    stage(5, 'Growing the forest');
    this.trees = new Trees(this);
    scene.add(await this.trees.build(assets));
    this.props = new Props(this);
    scene.add(await this.props.build(assets, this.town));
    this.grass = new Grass(this);
    scene.add(await this.grass.build(assets));
    this.characters = new Characters(this);
    await this.characters.init(assets);
    scene.add(this.characters.group);
  }

  update(dt, camera, focus) {
    this.terrain.updateLod(camera.position, this.settings.values.treeDetail >= 0.75 ? 1 : 0.6);
    this.trees?.update(camera, focus, this.settings.values.shadowDistance * 0.9);
    this.grass?.update(camera, focus);
    this.props?.update(camera, this.settings.values.grassDistance / 64);
    this.characters?.update(dt, camera);
    for (const u of this.updatables) u(dt, camera);
  }
}
