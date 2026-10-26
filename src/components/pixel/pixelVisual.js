import * as THREE from 'three';
import { BLOCKS, BLOCK_BY_ID, getVoxel } from '../../../shared/pixel-world.js';
import { PIXEL_ISLAND } from '../../../shared/pixel-island.js';

export const CHUNK_SIZE = 16;
const TILE = 24, ATLAS_COLUMNS = 16, ATLAS_ROWS = 6;
const fallbackColors = ['#202b34', '#6a9c48', '#977250', '#87918e', '#d9c58f', '#91683c', '#4c894d', '#71838d', '#8b704c', '#b78251', '#b8dfe7', '#c4a56c', '#6c8c99', '#60c4bb', '#a56d42', '#e1e8e6'];
const hash = (x, y, id) => { let h = Math.imul(x + 19, 374761393) ^ Math.imul(y + 11, 668265263) ^ Math.imul(id + 3, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
const shade = (hex, amount) => { const c = new THREE.Color(hex); c.multiplyScalar(amount); return `#${c.getHexString()}`; };
const colorFor = id => BLOCK_BY_ID[id]?.color ?? fallbackColors[id] ?? '#9a9f9b';

/** Original procedural pixels: no commercial game's atlas or sounds are used. */
export function createPixelMaterial() {
  const canvas = document.createElement('canvas'); canvas.width = TILE * ATLAS_COLUMNS; canvas.height = TILE * ATLAS_ROWS;
  const ctx = canvas.getContext('2d');
  for (const block of BLOCKS) {
    const id = block.id; if (!id) continue;
    for (let variant = 0; variant < 3; variant += 1) {
      const tile = id * 3 + variant, ox = (tile % ATLAS_COLUMNS) * TILE, oy = Math.floor(tile / ATLAS_COLUMNS) * TILE;
      const base = id === 1 && variant !== 1 ? '#987550' : colorFor(id);
      ctx.fillStyle = base; ctx.fillRect(ox, oy, TILE, TILE);
      for (let y = 0; y < TILE; y += 2) for (let x = 0; x < TILE; x += 2) {
        let brightness = .86 + hash(x, y, id * 3 + variant) * .25;
        if (id === 1 && variant === 0 && y < 6 + hash(x, 7, id) * 4) {
          ctx.fillStyle = shade(colorFor(1), brightness);
        } else if (id === 5 || id === 7) {
          brightness = .75 + .22 * hash(Math.floor(x / 4), 0, id) + .12 * hash(x, y, id);
          ctx.fillStyle = shade(base, brightness);
        } else ctx.fillStyle = shade(base, brightness);
        ctx.fillRect(ox + x, oy + y, 2, 2);
      }
      // A bevel only one pixel wide preserves a tangible grid at a distance.
      ctx.fillStyle = shade(base, 1.08); ctx.fillRect(ox, oy, TILE, 1); ctx.fillRect(ox, oy, 1, TILE);
      ctx.fillStyle = shade(base, .75); ctx.fillRect(ox, oy + TILE - 1, TILE, 1);
      if (id === 9) { ctx.strokeStyle = '#e4f8ff'; ctx.lineWidth = 2; ctx.strokeRect(ox + 1, oy + 1, TILE - 2, TILE - 2); ctx.fillStyle = '#e6fcff'; ctx.fillRect(ox + 5, oy + 5, 2, 8); }
      if (id === 11) { ctx.fillStyle = '#fff0b8'; ctx.fillRect(ox + 8, oy + 7, 8, 8); }
      if (id === 12 || id === 13) { ctx.fillStyle = id === 12 ? '#343a44' : '#d6a17d'; for (let s = 0; s < 5; s += 1) ctx.fillRect(ox + 3 + hash(s, 5, id) * 15, oy + 3 + hash(s, 9, id) * 15, 4, 3); }
      if (id === 7 || id === 10 || id === 8) { ctx.fillStyle = shade(base, .7); ctx.fillRect(ox, oy + 11, TILE, 1); ctx.fillRect(ox + 11, oy, 1, 11); ctx.fillRect(ox + 5, oy + 12, 1, 12); }
    }
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 2;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0, vertexColors: true });
  return { material, texture, dispose() { material.dispose(); texture.dispose(); } };
}

// Each face is counter-clockwise as seen from outside; no per-cube mesh cost.
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 1], [1, 1, 0]], shade: .81 },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1]], shade: .73 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]], shade: 1 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]], shade: .57 },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]], shade: .89 },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]], shade: .77 },
];

export function createPixelChunkGeometry(world, cx, cz) {
  const positions = [], normals = [], uvs = [], colors = [], indices = [];
  const { columns, layers, cell, origin } = PIXEL_ISLAND;
  for (let y = 0; y < layers; y += 1) for (let z = cz * CHUNK_SIZE; z < Math.min(columns, (cz + 1) * CHUNK_SIZE); z += 1) {
    for (let x = cx * CHUNK_SIZE; x < Math.min(columns, (cx + 1) * CHUNK_SIZE); x += 1) {
      const id = getVoxel(world, x, y, z); if (!id) continue;
      for (const face of FACES) {
        const neighbor = getVoxel(world, x + face.n[0], y + face.n[1], z + face.n[2]);
        if (neighbor) continue;
        const offset = positions.length / 3, variant = face.n[1] > 0 ? 1 : face.n[1] < 0 ? 2 : 0;
        const tile = id * 3 + variant, tx = tile % ATLAS_COLUMNS, ty = Math.floor(tile / ATLAS_COLUMNS);
        const inset = .5 / TILE;
        const uv = [[inset, inset], [1 - inset, inset], [inset, 1 - inset], [1 - inset, 1 - inset]];
        for (let corner = 0; corner < 4; corner += 1) {
          const c = face.c[corner]; positions.push(origin.x + (x + c[0]) * cell, origin.y + (y + c[1]) * cell, origin.z + (z + c[2]) * cell);
          normals.push(...face.n); colors.push(face.shade, face.shade, face.shade);
          uvs.push((tx + uv[corner][0]) / ATLAS_COLUMNS, 1 - (ty + uv[corner][1]) / ATLAS_ROWS);
        }
        indices.push(offset, offset + 1, offset + 2, offset + 2, offset + 1, offset + 3);
      }
    }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setIndex(indices); geometry.computeBoundingSphere();
  return geometry;
}

export function createBlockParticles() {
  const count = 96, positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size: .15, vertexColors: true, transparent: true, opacity: .9, depthWrite: false, sizeAttenuation: true });
  const points = new THREE.Points(geometry, material); points.frustumCulled = false; points.visible = false;
  const particles = Array.from({ length: count }, () => ({ life: 0, vx: 0, vy: 0, vz: 0 })); let cursor = 0;
  function burst(event) {
    const color = new THREE.Color(colorFor(event.id)), { cell, origin } = PIXEL_ISLAND;
    const amount = event.kind === 'mine' ? 16 : 6;
    for (let n = 0; n < amount; n += 1) {
      const i = cursor++ % count, p = particles[i]; p.life = .4 + hash(i, n, event.id) * .25;
      p.vx = (hash(i, 1, n) - .5) * 3; p.vy = 1 + hash(i, 2, n) * 2; p.vz = (hash(i, 3, n) - .5) * 3;
      positions[i * 3] = origin.x + (event.x + .5) * cell; positions[i * 3 + 1] = origin.y + (event.y + .5) * cell;
      positions[i * 3 + 2] = origin.z + (event.z + .5) * cell; colors.set([color.r, color.g, color.b], i * 3);
    }
  }
  function update(dt) {
    let live = false;
    for (let i = 0; i < count; i += 1) { const p = particles[i]; if (p.life <= 0) { positions[i * 3 + 1] = -1000; continue; }
      live = true; p.life -= dt; p.vy -= dt * 8; positions[i * 3] += p.vx * dt; positions[i * 3 + 1] += p.vy * dt; positions[i * 3 + 2] += p.vz * dt;
    }
    points.visible = live; geometry.attributes.position.needsUpdate = true; geometry.attributes.color.needsUpdate = true;
  }
  return { points, burst, update, dispose() { geometry.dispose(); material.dispose(); } };
}
