import {
  BLOCK_BY_ID, HOTBAR, createVoxelWorld, createVoxelInventory, voxelSpawn,
  voxelRaycast, stepVoxelPlayer, mineVoxel, placeVoxel, craftVoxel,
  serializeVoxelSave, restoreVoxelSave,
} from '../../../shared/pixel-world.js';
import { PIXEL_ISLAND } from '../../../shared/pixel-island.js';

export const PIXEL_SAVE_KEY = 'game-town.pixel-island.v1';
const now = () => globalThis.performance?.now?.() ?? Date.now();
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

/** Local-only sandbox state. React receives at most 15 snapshots per second. */
export function createPixelRuntime(options = {}) {
  let world = createVoxelWorld(), inventory = createVoxelInventory(), player = voxelSpawn(world);
  let storage, storageAvailable = true, saveStatus = '尚无改动', message = '', restoredMode = 'collect';
  try { storage = options.storage ?? globalThis.localStorage; } catch { storageAvailable = false; }
  try {
    const raw = storage?.getItem(PIXEL_SAVE_KEY);
    if (raw) {
      const restored = restoreVoxelSave(raw);
      if (!restored?.world) throw new Error('invalid save');
      ({ world, inventory, player } = restored); restoredMode = restored.mode;
      saveStatus = '已恢复本机世界';
    }
  } catch { message = '本机存档无法读取，正在使用新的临时世界；原存档尚未覆盖。'; saveStatus = '读取失败'; }
  if (!storage) storageAvailable = false;
  let mode = restoredMode === 'creative' ? 'creative' : 'collect', phase = 'overview', panel = null, selected = 0, locked = false;
  let target = null, miningProgress = 0, revision = 0, lastEmit = -Infinity, snapshot;
  let lastTargetKey = '', miningKey = '', miningElapsed = 0, jumpQueued = false, pendingEmit = false;
  let timer, changed = false, disposed = false, saveSuppressed = saveStatus === '读取失败';
  let requestLock, releaseLock, audio, toneTime = 0;
  const listeners = new Set(), input = new Set(), effects = [], dirtyChunks = new Set();
  const stats = { mined: 0, placed: 0, crafted: 0 };

  function makeSnapshot() {
    return Object.freeze({ phase, mode, panel, selected, locked,
      inventory: Object.freeze({ ...inventory }), target: target ? Object.freeze({
        ...target, name: BLOCK_BY_ID[target.id]?.name ?? '方块',
      }) : null, miningProgress, saveStatus, message, revision,
      stats: Object.freeze({ ...stats }), flying: !!player.flying });
  }
  function emit(force = true) {
    if (disposed) return;
    if (!force && now() - lastEmit < 1000 / 15) { pendingEmit = true; return; }
    pendingEmit = false;
    lastEmit = now(); revision += 1; snapshot = makeSnapshot();
    for (const listener of listeners) listener();
  }
  function clearInput() { input.clear(); jumpQueued = false; miningProgress = 0; miningElapsed = 0; miningKey = ''; }
  function unlock() { locked = false; releaseLock?.(); }
  function unlockAudio() {
    try {
      const Audio = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (Audio && !audio) audio = new Audio();
      audio?.resume?.()?.catch?.(() => {});
    } catch { /* Audio is optional; a denied device never blocks building. */ }
  }
  function sound(kind) {
    if (!audio || audio.state !== 'running' || now() - toneTime < 55) return;
    toneTime = now();
    try {
      const oscillator = audio.createOscillator(), gain = audio.createGain();
      const t = audio.currentTime; oscillator.type = kind === 'mine' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(kind === 'mine' ? 220 : kind === 'craft' ? 620 : 370, t);
      oscillator.frequency.exponentialRampToValueAtTime(kind === 'mine' ? 70 : 190, t + .09);
      gain.gain.setValueAtTime(.055, t); gain.gain.exponentialRampToValueAtTime(.001, t + .12);
      oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(t); oscillator.stop(t + .13);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    } catch { /* Do not break gameplay when an audio context is suspended. */ }
  }
  function save() {
    if (disposed || (!changed && saveStatus !== '写入失败')) return true;
    if (!storageAvailable) { saveStatus = '浏览器未提供存档权限 · 本次仍可游玩'; emit(); return false; }
    if (saveSuppressed) { saveStatus = '旧存档损坏 · 请导出当前世界或明确重置'; emit(); return false; }
    try {
      storage.setItem(PIXEL_SAVE_KEY, serializeVoxelSave(world, inventory, mode, player));
      changed = false; saveStatus = '已保存到本机'; emit(); return true;
    } catch { saveStatus = '写入失败 · 请导出备份，当前世界仍保留'; emit(); return false; }
  }
  function scheduleSave() {
    changed = true; saveStatus = '正在保存…'; clearTimeout(timer);
    timer = setTimeout(save, 500);
  }
  function markDirty(cell) {
    const x = cell.x ?? cell[0], z = cell.z ?? cell[2];
    for (const [dx, dz] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const cx = Math.floor((x + dx) / 16), cz = Math.floor((z + dz) / 16);
      if (cx >= 0 && cz >= 0 && cx < 4 && cz < 4) dirtyChunks.add(`${cx},${cz}`);
    }
    scheduleSave();
  }
  function effect(kind, cell, id) { effects.push({ kind, x: cell.x ?? cell[0], y: cell.y ?? cell[1], z: cell.z ?? cell[2], id }); sound(kind); }
  function mine() {
    if (!target || phase !== 'playing' || panel) return false;
    const id = target.id, cell = { x: target.x, y: target.y, z: target.z };
    const result = mineVoxel(world, cell, inventory, mode);
    message = result?.message ?? (result?.ok ? '已采集方块' : '暂时无法采集');
    if (result?.ok) { stats.mined += 1; markDirty(cell); effect('mine', cell, id); }
    miningElapsed = 0; miningProgress = 0; emit(); return !!result?.ok;
  }
  function place() {
    if (!target?.place || phase !== 'playing' || panel) return false;
    const cell = target.place, id = HOTBAR[selected];
    const result = placeVoxel(world, cell, id, inventory, mode, player);
    message = result?.message ?? (result?.ok ? '已放置方块' : '无法在这里放置');
    if (result?.ok) { stats.placed += 1; markDirty(cell); effect('place', cell, id); }
    emit(); return !!result?.ok;
  }
  const api = {
    get world() { return world; }, get inventory() { return inventory; }, get player() { return player; },
    get mode() { return mode; }, get phase() { return phase; }, get panel() { return panel; },
    get selected() { return selected; }, get target() { return target; }, get locked() { return locked; },
    get miningProgress() { return miningProgress; }, get dirtyChunks() { return dirtyChunks; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, getSnapshot() { return snapshot; },
    start(nextMode = 'collect') {
      mode = nextMode === 'creative' ? 'creative' : 'collect'; phase = 'playing'; panel = null;
      if (mode !== 'creative') player.flying = false;
      clearInput(); unlockAudio(); message = mode === 'creative' ? '自由建造 · 方块无限，F 可切换飞行' : '采集建造 · 挖掘资源，在背包中合成';
      scheduleSave(); emit();
    },
    pause() { if (phase === 'playing') phase = 'paused'; clearInput(); unlock(); scheduleSave(); emit(); },
    resume() { phase = 'playing'; panel = null; clearInput(); unlockAudio(); emit(); },
    requestLock() { if (phase === 'playing' && !panel) { unlockAudio(); requestLock?.(); } },
    bindPointerLock(request, release) { requestLock = request; releaseLock = release; return () => { requestLock = null; releaseLock = null; }; },
    setLocked(value) {
      const previous = locked; locked = !!value;
      if (!locked) { clearInput(); if (previous && phase === 'playing' && !panel) phase = 'paused'; }
      emit();
    },
    select(index) { selected = ((Math.round(index) % HOTBAR.length) + HOTBAR.length) % HOTBAR.length; emit(); },
    togglePanel(next) { panel = panel === next ? null : next; clearInput(); unlock(); emit(); },
    craft(recipeId) {
      const result = craftVoxel(inventory, recipeId);
      message = result?.message ?? (result?.ok ? '合成成功' : '材料不足');
      if (result?.ok) { stats.crafted += 1; scheduleSave(); sound('craft'); }
      emit(); return !!result?.ok;
    },
    setInput(key, value) {
      const normalized = key === 'backward' ? 'back' : key === 'ascend' ? 'jump' : key;
      if (value) input.add(normalized); else input.delete(normalized);
      if (normalized === 'jump' && value) jumpQueued = true;
    },
    look(dx, dy) { if (phase !== 'playing' || panel) return; player.yaw = (player.yaw || 0) - dx * .0022; player.pitch = clamp((player.pitch || 0) - dy * .0022, -1.48, 1.48); },
    action(type) {
      if (type === 'jump') { jumpQueued = true; return true; }
      if (type === 'fly') {
        if (mode !== 'creative') { message = '飞行仅用于自由建造模式'; emit(); return false; }
        player.flying = !player.flying; player.vy = 0; message = player.flying ? '飞行已开启 · 空格上升 / Shift 下降' : '飞行已关闭'; emit(); return true;
      }
      if (type === 'home') { player = { ...voxelSpawn(world), yaw: 0, pitch: 0 }; clearInput(); message = '已回到岛上安全营地'; scheduleSave(); emit(); return true; }
      if (type === 'mine') return mine(); if (type === 'place') return place(); return false;
    },
    frame(dt) {
      if (disposed || phase !== 'playing' || panel) return;
      if (pendingEmit) emit(false);
      const delta = Math.min(.04, Math.max(0, dt));
      player = stepVoxelPlayer(world, player, { forward: (input.has('forward') ? 1 : 0) - (input.has('back') ? 1 : 0),
        right: (input.has('right') ? 1 : 0) - (input.has('left') ? 1 : 0), jump: jumpQueued,
        ascend: input.has('jump'), descend: input.has('descend'), sprint: input.has('sprint') }, delta);
      jumpQueued = false;
      if (![player.x, player.y, player.z].every(Number.isFinite) || player.y < PIXEL_ISLAND.origin.y - 12) api.action('home');
      const pitch = player.pitch || 0, yaw = player.yaw || 0;
      const direction = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
      target = voxelRaycast(world, { x: player.x, y: player.y + 1.55, z: player.z }, direction, 8);
      const key = target ? `${target.x},${target.y},${target.z}` : '';
      if (key !== lastTargetKey) { miningElapsed = 0; miningProgress = 0; miningKey = ''; lastTargetKey = key; emit(false); }
      if (input.has('mine') && target) {
        if (key !== miningKey) { miningKey = key; miningElapsed = 0; }
        if (!Number.isFinite(BLOCK_BY_ID[target.id]?.hardness)) {
          if (miningProgress || miningElapsed) { miningProgress = 0; miningElapsed = 0; emit(false); }
          return;
        }
        const hardness = mode === 'creative' ? .12 : clamp(Number(BLOCK_BY_ID[target.id]?.hardness) || .35, .18, 1.6);
        miningElapsed += delta; miningProgress = Math.min(1, miningElapsed / hardness);
        if (miningProgress >= 1) mine(); else emit(false);
      } else if (miningProgress) { miningProgress = 0; miningElapsed = 0; emit(false); }
    },
    takeEffects() { return effects.splice(0); },
    save, exportSave() { return serializeVoxelSave(world, inventory, mode, player); },
    importSave(raw) {
      try {
        const restored = restoreVoxelSave(raw); if (!restored?.world) throw new Error('invalid save');
        ({ world, inventory, player } = restored); mode = restored.mode === 'creative' ? 'creative' : 'collect';
        saveSuppressed = false; clearInput(); target = null; phase = 'paused'; panel = null; unlock();
        dirtyChunks.clear(); dirtyChunks.add('*'); message = '备份已导入；继续探索即可进入'; scheduleSave(); emit(); return true;
      } catch { message = '无法导入：文件格式或方块数据不符合本岛存档要求；原世界未更改。'; emit(); return false; }
    },
    reset() {
      world = createVoxelWorld(); inventory = createVoxelInventory(); player = voxelSpawn(world);
      clearInput(); unlock(); target = null; phase = 'overview'; panel = null; stats.mined = stats.placed = stats.crafted = 0;
      dirtyChunks.clear(); dirtyChunks.add('*'); saveSuppressed = false; message = '本机世界已重建'; scheduleSave(); emit();
    },
    deactivate() { clearInput(); if (phase === 'playing') phase = 'paused'; unlock(); if (changed) save(); emit(); },
    dispose() { if (disposed) return; clearTimeout(timer); if (changed) save(); clearInput(); unlock(); audio?.close?.()?.catch?.(() => {}); disposed = true; listeners.clear(); },
  };
  snapshot = makeSnapshot();
  return api;
}
