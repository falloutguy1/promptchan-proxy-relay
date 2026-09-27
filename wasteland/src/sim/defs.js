// Game data for the colony simulation. Rates are per game hour unless noted;
// work is in worker-hours at skill 1.0. One game hour lasts HOUR real seconds at 1x.

export const HOUR = 30;
export const DAY_START = 6, DUSK = 20, NIGHT_START = 21.5, DAWN = 5.5;

export const RES = ['food', 'water', 'wood', 'scrap', 'meds', 'ammo', 'fuel'];
export const RES_NAME = { food: 'Food', water: 'Water', wood: 'Wood', scrap: 'Scrap', meds: 'Meds', ammo: 'Ammo', fuel: 'Fuel' };
export const BASE_CAPACITY = 100;
export const STORAGE_CAPACITY = 100;

export const DIFFICULTY = {
  easy: {
    name: 'Scavenger', start: { food: 45, water: 45, wood: 30, scrap: 22, meds: 5, ammo: 60, fuel: 8 }, survivors: 6, armed: 4,
    need: 0.8, hordeStart: 3, hordeBase: 2, hordeGrowth: 1.0, hordeCap: 22, infectedHp: 0.8, infectedSpeed: 0.92, wanderers: 4, loot: 1.3, damage: 0.75,
  },
  normal: {
    name: 'Survivor', start: { food: 30, water: 32, wood: 24, scrap: 16, meds: 3, ammo: 45, fuel: 4 }, survivors: 5, armed: 3,
    need: 1, hordeStart: 2, hordeBase: 2, hordeGrowth: 1.4, hordeCap: 28, infectedHp: 1, infectedSpeed: 1, wanderers: 6, loot: 1, damage: 1,
  },
  hard: {
    name: 'Dead zone', start: { food: 20, water: 22, wood: 16, scrap: 10, meds: 1, ammo: 25, fuel: 2 }, survivors: 4, armed: 2,
    need: 1.2, hordeStart: 1, hordeBase: 3, hordeGrowth: 2.4, hordeCap: 44, infectedHp: 1.25, infectedSpeed: 1.12, wanderers: 9, loot: 0.8, damage: 1.3,
  },
};

// Structures. w/d = footprint (m) along local X / Z; front faces +Z.
// nav: 'block' (solid), 'walk' (walkable), 'wall' (barricade), 'gate'.
export const STRUCTURES = {
  cache: {
    name: 'Supply cache', cat: null, icon: 's-storage', cost: {}, work: 0.2, w: 3.4, d: 2.6, hp: 400, nav: 'block',
    desc: 'Pallets, crates and drums under a tarp: where everything the colony owns is kept.',
  },
  tent: {
    name: 'Tent', cat: 'shelter', icon: 's-tent', cost: { wood: 4, scrap: 2 }, work: 1.5, w: 2.6, d: 3.4, hp: 120, housing: 2, nav: 'block',
    desc: 'Canvas ridge tent on a timber frame. Sleeps two out of the rain.',
  },
  shack: {
    name: 'Shack', cat: 'shelter', icon: 's-shack', cost: { wood: 18, scrap: 6 }, work: 5, w: 4.2, d: 3.6, hp: 420, housing: 4, comfort: 4, nav: 'block',
    desc: 'Plank walls, a tin roof and a barrel stove. Sleeps four; better rest and morale.',
  },
  campfire: {
    name: 'Campfire', cat: 'shelter', icon: 's-fire', cost: { wood: 3 }, work: 0.5, w: 2.2, d: 2.2, hp: 60, nav: 'block', light: 'fire', unique: 2,
    desc: 'Cooked meals go further (+20% food value). Warmth and light at night lift morale. Burns wood after dark.',
  },
  storage: {
    name: 'Storage shed', cat: 'shelter', icon: 's-storage', cost: { wood: 12, scrap: 4 }, work: 3, w: 4.2, d: 3.0, hp: 300, capacity: STORAGE_CAPACITY, nav: 'block',
    desc: `Lean-to with pallets and crates. +${STORAGE_CAPACITY} storage for every resource.`,
  },
  rain_collector: {
    name: 'Rain collector', cat: 'supply', icon: 's-rain', cost: { wood: 5, scrap: 5 }, work: 1.5, w: 2.0, d: 2.0, hp: 150, nav: 'block',
    desc: 'Tarp funnel over a barrel. Fills itself: fast in rain, a trickle of dew otherwise. No worker needed.',
  },
  well: {
    name: 'Well', cat: 'supply', icon: 's-well', cost: { wood: 6, scrap: 12 }, work: 5, w: 2.6, d: 2.6, hp: 500, job: 'water', slots: 2, nav: 'block',
    desc: 'Hand-dug well with a windlass. A water carrier hauls about 6 water per hour.',
  },
  farm: {
    name: 'Farm plot', cat: 'supply', icon: 's-farm', cost: { wood: 5 }, work: 2, w: 8, d: 6, hp: 200, job: 'farm', slots: 1, nav: 'walk',
    desc: 'Potato rows in turned soil. Grows faster when a farmer tends it; harvest yields ~14 food.',
  },
  workshop: {
    name: 'Workshop', cat: 'supply', icon: 's-workshop', cost: { wood: 12, scrap: 10 }, work: 5, w: 5.0, d: 4.0, hp: 350, job: 'craft', slots: 1, nav: 'block',
    desc: 'Workbench and tools. A crafter turns 2 scrap into 5 rounds of ammo per hour.',
  },
  watchtower: {
    name: 'Watchtower', cat: 'defense', icon: 's-tower', cost: { wood: 18, scrap: 4 }, work: 6, w: 2.8, d: 2.8, hp: 450, guard: 2, nav: 'block',
    desc: 'Two guards on the platform see and shoot 50% further, and are out of reach of the dead.',
  },
  barricade: {
    name: 'Barricade', cat: 'defense', icon: 's-wall', cost: { wood: 5 }, work: 0.8, w: 4.0, d: 0.7, hp: 380, nav: 'wall', snap: true,
    desc: 'Posts, planks and scrap sheeting. The dead must break through; survivors can only climb over slowly. Snaps to other walls.',
  },
  gate: {
    name: 'Gate', cat: 'defense', icon: 's-gate', cost: { wood: 8, scrap: 1 }, work: 1.2, w: 4.0, d: 0.7, hp: 320, nav: 'gate', snap: true,
    desc: 'A barricade survivors can pass through. The dead still have to break it.',
  },
  lamp: {
    name: 'Floodlight', cat: 'defense', icon: 's-lamp', cost: { scrap: 6, wood: 2 }, work: 1, w: 1.0, d: 1.0, hp: 100, power: -2, nav: 'block', light: 'lamp',
    desc: 'Searchlight on a pole. Needs 2 power. Guards nearby shoot better at night.',
  },
  infirmary: {
    name: 'Infirmary', cat: 'utility', icon: 's-infirmary', cost: { wood: 12, scrap: 4, meds: 2 }, work: 5, w: 4.4, d: 5.0, hp: 300, job: 'medic', slots: 1, beds: 3, nav: 'block',
    desc: 'Field hospital tent with three cots. A medic heals the wounded and treats bites with meds.',
  },
  generator: {
    name: 'Generator', cat: 'utility', icon: 's-generator', cost: { scrap: 16, fuel: 4 }, work: 3, w: 2.2, d: 1.6, hp: 250, power: 10, nav: 'block',
    desc: 'Diesel generator: 10 power while there is fuel (1 fuel per 5 hours under load).',
  },
  radio: {
    name: 'Radio mast', cat: 'utility', icon: 's-radio', cost: { scrap: 20, wood: 16 }, work: 10, w: 4.0, d: 4.0, hp: 500, power: -4, nav: 'block', unique: 1,
    desc: 'Needs 4 power. Broadcasting draws other survivors and, given 48 hours on air, the evacuation convoy.',
  },
};
export const BUILD_CATS = [
  { id: 'shelter', name: 'Shelter' },
  { id: 'supply', name: 'Supply' },
  { id: 'defense', name: 'Defence' },
  { id: 'utility', name: 'Utility' },
];

export const JOBS = {
  idle: { name: 'Idle', icon: 'j-idle', desc: 'Rests at camp; helps nowhere.' },
  builder: { name: 'Builder', icon: 'i-hammer', desc: 'Works on construction sites.' },
  woodcutter: { name: 'Woodcutter', icon: 'j-axe', desc: 'Fells trees near the colony and hauls the wood back.' },
  scavenger: { name: 'Scavenger', icon: 'j-bag', desc: 'Searches the village for scrap, food, meds, fuel and ammo. Dangerous.' },
  farmer: { name: 'Farmer', icon: 's-farm', desc: 'Tends and harvests farm plots.' },
  water: { name: 'Water carrier', icon: 'r-water', desc: 'Draws water from the well.' },
  guard: { name: 'Guard', icon: 'r-defense', desc: 'Watches the perimeter or a tower and shoots the dead.' },
  medic: { name: 'Medic', icon: 'r-meds', desc: 'Treats the wounded at the infirmary.' },
  crafter: { name: 'Crafter', icon: 's-workshop', desc: 'Makes ammunition from scrap at the workshop.' },
};

export const TRAITS = {
  handy: { name: 'Handy', good: true, desc: 'Builds 35% faster, crafts 25% faster.' },
  marksman: { name: 'Marksman', good: true, desc: 'Shoots straighter and further.' },
  greenthumb: { name: 'Green thumb', good: true, desc: 'Crops grow 40% faster under their care.' },
  scrounger: { name: 'Scrounger', good: true, desc: 'Finds 35% more when scavenging.' },
  medic: { name: 'Trained medic', good: true, desc: 'Heals 50% faster.' },
  tough: { name: 'Tough', good: true, desc: '+30% health; bites infect less.' },
  quick: { name: 'Quick', good: true, desc: 'Moves 12% faster.' },
  glutton: { name: 'Big appetite', good: false, desc: 'Eats 40% more.' },
  frail: { name: 'Frail', good: false, desc: '-20% health.' },
  lazy: { name: 'Unmotivated', good: false, desc: 'Works 20% slower.' },
  nervous: { name: 'Nervous', good: false, desc: 'Flees from the dead early.' },
};

export const OCCUPATIONS = [
  { name: 'Former carpenter', traits: ['handy'], skill: { build: 1.3 } },
  { name: 'Ex-soldier', traits: ['marksman'], skill: { shoot: 1.35 }, armed: true },
  { name: 'Nurse', traits: ['medic'], skill: { med: 1.4 } },
  { name: 'Farmer', traits: ['greenthumb'], skill: { farm: 1.35 } },
  { name: 'Truck driver', traits: [], skill: { scav: 1.15, build: 1.05 } },
  { name: 'Electrician', traits: ['handy'], skill: { craft: 1.3 } },
  { name: 'Hunter', traits: ['quick'], skill: { shoot: 1.25 }, armed: true },
  { name: 'Schoolteacher', traits: [], skill: { med: 1.1, farm: 1.1 } },
  { name: 'Cook', traits: [], skill: { farm: 1.15 } },
  { name: 'Student', traits: ['quick'], skill: { scav: 1.2 } },
  { name: 'Miner', traits: ['tough'], skill: { build: 1.15 } },
  { name: 'Paramedic', traits: ['medic'], skill: { med: 1.3, scav: 1.05 } },
  { name: 'Mechanic', traits: ['handy'], skill: { craft: 1.35, build: 1.1 } },
  { name: 'Police officer', traits: ['marksman'], skill: { shoot: 1.2 }, armed: true },
  { name: 'Shop clerk', traits: ['scrounger'], skill: { scav: 1.3 } },
  { name: 'Radio operator', traits: [], skill: { craft: 1.15 } },
];

export const FIRST_NAMES = [
  'Artem', 'Olena', 'Mikhail', 'Dasha', 'Viktor', 'Nadia', 'Pavel', 'Irina', 'Bogdan', 'Katya', 'Yuri', 'Sasha', 'Lev', 'Marta', 'Oleg', 'Vera',
  'Anton', 'Zoya', 'Roman', 'Lida', 'Tomas', 'Hana', 'Ilya', 'Polina', 'Stepan', 'Galina', 'Denis', 'Milena', 'Fyodor', 'Alina', 'Kostya', 'Yana',
  'Grigor', 'Tanya', 'Maks', 'Inna', 'Borys', 'Oksana', 'Emil', 'Rada',
];
export const SURNAMES = [
  'Kovalenko', 'Sokolov', 'Melnyk', 'Petrov', 'Hrytsenko', 'Volkov', 'Bondar', 'Kuznetsov', 'Tkachenko', 'Orlov', 'Savchuk', 'Lebedev', 'Moroz',
  'Zaytsev', 'Kravets', 'Popov', 'Shevchuk', 'Novak', 'Levchenko', 'Gromov', 'Rudenko', 'Belov', 'Marchenko', 'Karpov',
];

// what each kind of scavenging site tends to hold (relative weights)
export const LOOT_TABLE = {
  house: { food: 4, water: 2, meds: 1.2, scrap: 4, ammo: 1.2, fuel: 0.3, wood: 1 },
  wreck: { scrap: 6, fuel: 2.5, ammo: 0.4, meds: 0.3 },
  store: { food: 6, water: 4, meds: 1, scrap: 1.5, ammo: 0.5, fuel: 0.2 },
  fuel: { fuel: 5, scrap: 4, food: 1, water: 1, ammo: 0.3 },
  farm: { food: 3, wood: 3, scrap: 3, fuel: 1, ammo: 0.5 },
  military: { ammo: 6, meds: 3, scrap: 2, food: 1, fuel: 1 },
};

export const OBJECTIVES = [
  { id: 'shelter', title: 'Shelter everyone', text: 'Build enough tents or shacks so every survivor has a bed.' },
  { id: 'water', title: 'Secure water', text: 'Build a rain collector or a well.' },
  { id: 'food', title: 'Plant crops', text: 'Build a farm plot and put a farmer on it.' },
  { id: 'tower', title: 'Watch the dark', text: 'Build a watchtower before the dead come in numbers.' },
  { id: 'walls', title: 'Fortify', text: 'Raise 8 barricade segments and a gate around the camp.' },
  { id: 'power', title: 'Power', text: 'Build a generator and keep fuel in it.' },
  { id: 'radio', title: 'Call for help', text: 'Build the radio mast and keep it powered for 48 hours until the convoy answers.' },
];

export const TIPS = [
  'Survivors eat and drink on their own, but only what is in the stockpile.',
  'Gunfire carries. Every shot draws the dead from a long way off.',
  'Guards on a watchtower see further and cannot be reached by the dead.',
  'Bites turn into infection. Meds stop it if you are quick.',
  'Survivors can only walk through gates; barricades must be climbed.',
  'Rain fills collectors fast. Fog lets the dead get close unseen.',
  'Scavengers bring back more from buildings no one has searched yet.',
  'Press Tab at any time to hand the colony to the AI Overseer, or take it back.',
];
