import { GPT_PARK, GPT_BRIDGE } from '../../../shared/gpt-park.js';

const block = (name, at, size) => Object.freeze({
  name, at: Object.freeze(at), size: Object.freeze(size),
});

// These are adjacent construction layers, not two boxes ending at y=0.
// The former boxes duplicated the whole island top and 0.36 m of every wall.
// Keep the original walk plane, island footprint, bottom and pale stone fascia.
const stoneBottom = -0.36;
const islandBottom = -1.34;
export const GPT_GROUND_LAYERS = Object.freeze([
  block('gpt-island-foundation', [GPT_PARK.x, (islandBottom + stoneBottom) / 2, GPT_PARK.z],
    [GPT_PARK.width, stoneBottom - islandBottom, GPT_PARK.depth]),
  block('gpt-island-stone-cap', [GPT_PARK.x, stoneBottom / 2, GPT_PARK.z],
    [GPT_PARK.width, -stoneBottom, GPT_PARK.depth]),
]);

// The collision bridge intentionally overlaps the island for robust travel.
// Rendering that overlap duplicated its top at y=0, so draw only the exposed
// span. The bridge and island still meet without a gap or a change in height.
const bridgeNorth = Math.max(GPT_BRIDGE.z - GPT_BRIDGE.depth / 2, GPT_PARK.z + GPT_PARK.depth / 2);
const bridgeSouth = GPT_BRIDGE.z + GPT_BRIDGE.depth / 2;
export const GPT_BRIDGE_SURFACE = block('gpt-entrance-bridge',
  [GPT_BRIDGE.x, -0.25, (bridgeNorth + bridgeSouth) / 2],
  [GPT_BRIDGE.width, 0.5, bridgeSouth - bridgeNorth]);

// North and side beds meet edge-to-edge rather than overlaying equal-height
// surfaces at the corners. Both retain their original outer silhouette.
const sideOffset = 14.15, sideWidth = 2.6;
const centerWidth = 2 * (sideOffset - sideWidth / 2);
const northWidth = 27.5, northDepth = 2.7, northZ = -70.15;
const cornerWidth = (northWidth - centerWidth) / 2;
const cornerNorth = northZ - northDepth / 2;
const cornerSouth = GPT_PARK.z - 24.5 / 2;
export const GPT_GARDEN_BEDS = Object.freeze([
  ...[-1, 1].map(side => block(`gpt-garden-side-${side}`,
    [GPT_PARK.x + side * sideOffset, 0.016, GPT_PARK.z], [sideWidth, 0.04, 24.5])),
  block('gpt-garden-north', [GPT_PARK.x, 0.016, northZ], [centerWidth, 0.04, northDepth]),
  ...[-1, 1].map(side => block(`gpt-garden-north-corner-${side}`,
    [GPT_PARK.x + side * (centerWidth + cornerWidth) / 2, 0.016, (cornerNorth + cornerSouth) / 2],
    [cornerWidth, 0.04, cornerSouth - cornerNorth])),
]);
