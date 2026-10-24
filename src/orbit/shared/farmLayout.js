// One shared layout drives curved geometry, walk-in collision and commissioned area.
const freeze = values => Object.freeze(values.map(value => Object.freeze(value)));
export const FARM_SITES = freeze([119,207,295].map((z,index) => ({
  id: `farm-hall-${index}`, name: ['叶菜与香草舱','浆果与果蔬舱','主粮与蛋白实验舱'][index],
  index, x:-54,z,width:40,depth:28,height:32,buildingWidth:36,buildingDepth:24,roofBottom:31.6,
  layers:[12,6,8][index], arrival:Object.freeze({x:-54,z:z-16.2,yaw:0}),
})));
export const FARM_SITE = FARM_SITES[0];
export const FARM_APPROACHES = freeze(FARM_SITES.flatMap(site => [
  {id:`east-road-link-${site.index}`,x:-39,z:site.z-(site.index===2?15.2:16),width:30,depth:2.4},
  {id:`entry-link-${site.index}`,x:-54,z:site.z-15,width:2.4,depth:3},
]));
const crops = [['lettuce','pakchoi','basil','lettuce','pakchoi','basil'],['strawberry','tomato','pepper','strawberry','tomato','pepper'],['potato','wheat','soybean','potato','wheat','soybean']];
export const FARM_RACKS = freeze(FARM_SITES.flatMap(site => [-7.8,0,7.8].flatMap((dz,row) => [-63.9,-44.1].map((x,side) => {
  const local=row*2+side, cropId=crops[site.index][local];
  return {id:`r${site.index*6+local}`,hallIndex:site.index,x,z:site.z+dz,width:8,depth:3.6,height:30.5,
    cropId,layers:site.layers,tierHeights:Object.freeze(Array.from({length:site.layers},(_,i)=>1.1+i*([2.45,4.9,3.6][site.index]))),
    trayWidth:7.2,trayDepth:2.8,areaM2:7.2*2.8*site.layers};
}))));
export const FARM_UTILITIES = freeze(FARM_SITES.flatMap(site => [
  {id:`water-${site.index}`,x:-70,z:site.z-3.9,width:2.2,depth:2.4,height:3.1,role:'water'},
  {id:`treatment-${site.index}`,x:-70,z:site.z+3.9,width:2.2,depth:2.4,height:2.5,role:'treatment'},
  {id:`cooling-${site.index}`,x:-38,z:site.z-3.9,width:2.2,depth:2.4,height:3.1,role:'cooling'},
  {id:`packing-${site.index}`,x:-69.6,z:site.z+9.5,width:3,depth:3.6,height:3.1,role:'packing'},
  {id:`gas-${site.index}`,x:-38,z:site.z+9.5,width:2.2,depth:2.4,height:2.5,role:'gas-seeds'},
  {id:`terminal-${site.index}`,x:-57.4,z:site.z-12.9,width:1.1,depth:.7,height:1.6,role:'terminal'},
].map(item=>({...item,hallIndex:site.index}))));
export const FARM_WALLS = freeze(FARM_SITES.flatMap(site => [
  ...[-11.75,11.75].flatMap((dz,i)=>[-63.8,-44.2].map((x,j)=>({id:`end-${site.index}-${i}-${j}`,x,z:site.z+dz,width:16.4,depth:.5,height:31.6,role:'wall'}))),
  ...[-71.75,-36.25].map((x,i)=>({id:`side-${site.index}-${i}`,x,z:site.z,width:.5,depth:23,height:31.6,role:'wall'})),
]));
export const FARM_COLLIDERS = freeze([...FARM_WALLS,...FARM_RACKS.map(r=>({...r,role:'rack'})),...FARM_UTILITIES]);
export const FARM_VOLUMES = freeze([
  ...FARM_COLLIDERS.map(c=>({...c,minY:0,maxY:c.height})),
  ...FARM_SITES.flatMap(site=>[
    ...[-11.75,11.75].map((dz,i)=>({id:`header-${site.index}-${i}`,x:-54,z:site.z+dz,width:3.2,depth:.5,minY:3.8,maxY:31.6,role:'header'})),
    {id:`gantry-guard-${site.index}`,x:-54,z:site.z,width:35.1,depth:22,minY:30.4,maxY:31.2,role:'guard'},
    {id:`roof-${site.index}`,x:-54,z:site.z,width:36,depth:24,minY:31.6,maxY:32,role:'roof'},
  ]),
]);
export const FARM_TOTAL_AREA_M2 = FARM_RACKS.reduce((sum,rack)=>sum+rack.areaM2,0);

const inside = (rectangle, x, z, margin = 0) =>
  Number.isFinite(x) && Number.isFinite(z)
  && Math.abs(x - rectangle.x) < rectangle.width / 2 + margin
  && Math.abs(z - rectangle.z) < rectangle.depth / 2 + margin;

const safeMargin = margin => Number.isFinite(margin) ? Math.max(0, margin) : .35;

export function farmContains(x, z) { return FARM_SITES.some(site => inside(site, x, z)); }
export function farmSolid(x, z, margin = .35) {
  return FARM_COLLIDERS.some(collider => inside(collider, x, z, safeMargin(margin)));
}

/** Jetpack ground/top surfaces. Being INSIDE the factory does not teleport a
 * flyer onto the roof. The caller also respects farmFlightCeiling below it. */
export function farmFlightFloor(x, z, radius = .45, y = 0) {
  const margin = safeMargin(radius);
  if (Number.isFinite(y) && y >= FARM_SITE.height - 1e-8 && FARM_SITES.some(site => inside({ ...site, width: site.buildingWidth, depth: site.buildingDepth }, x, z, margin))) return FARM_SITE.height;
  let floor = 0;
  for (const collider of FARM_COLLIDERS) {
    if (inside(collider, x, z, margin)) floor = Math.max(floor, collider.height);
  }
  for (const volume of FARM_VOLUMES) {
    if (volume.minY > 0 && y >= volume.maxY - 1e-8 && inside(volume, x, z, margin)) floor = Math.max(floor, volume.maxY);
  }
  return floor;
}

/** Raw underside elevation, NOT head-adjusted. Infinity means no farm ceiling.
 * This is a pressurized interior in the city's existing pressure shell; doors
 * are ordinary internal clean-zone entrances, not vacuum airlocks. */
export function farmFlightCeiling(x, z, y = 0, radius = .45) {
  if (!Number.isFinite(y) || y >= FARM_SITE.height) return Infinity;
  let ceiling = Infinity;
  for (const volume of FARM_VOLUMES) {
    if (volume.minY > 0 && y < volume.maxY && inside(volume, x, z, safeMargin(radius))) ceiling = Math.min(ceiling, volume.minY);
  }
  return ceiling;
}

/** Explicit vertical collision for camera / flight sweeps. Ground movement
 * continues to use farmSolid. A body above a rack can pass above that rack. */
export function farmVolumeBlocks(x, z, y = 0, radius = .45, bodyHeight = 1.9) {
  if (![x, z, y, radius, bodyHeight].every(Number.isFinite)) return true;
  const margin = safeMargin(radius), top = y + Math.max(0, bodyHeight);
  return FARM_VOLUMES.some(volume => inside(volume, x, z, margin) && y < volume.maxY - 1e-8 && top > volume.minY + 1e-8);
}

export function farmSolidAtHeight(x, y, z, radius = .22, height = 0) {
  return farmVolumeBlocks(x, z, y, radius, height || .001);
}
