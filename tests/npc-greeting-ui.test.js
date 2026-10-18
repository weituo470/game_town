import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as jsx from 'react/jsx-runtime';
import { transformWithEsbuild } from 'vite';
import { createNpcSpeechPlayer } from '../src/lib/npcSpeechPlayer.js';
import { createNpcChatRequest } from '../src/lib/npcChatClient.js';
import { NPC_MAP } from '../src/lib/npcCatalog.js';

const source = fs.readFileSync(new URL('../src/components/NpcChat.jsx', import.meta.url), 'utf8');
const { code } = await transformWithEsbuild(source, 'NpcChat.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' });
const blob = () => new Blob(['test-audio'], { type: 'audio/mpeg' });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function elements(node, list = []) { if (Array.isArray(node)) node.forEach(item => elements(item, list)); else if (node?.props) { list.push(node); elements(node.props.children, list); } return list; }
function words(node) { if (typeof node === 'string' || typeof node === 'number') return String(node); if (!node || typeof node === 'boolean') return ''; return (Array.isArray(node) ? node : [node.props?.children]).map(words).join(''); }
class AudioFake {
  constructor(play) { this.result = play; this.listeners = new Map(); this.pauses = 0; this.plays = 0; }
  play() { this.plays++; return this.result?.() ?? Promise.resolve(); }
  pause() { this.pauses++; }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  removeEventListener(type) { this.listeners.delete(type); }
  removeAttribute() {}
  load() {}
}
function mount({ npcId = 'npc-ali', preference = { enabled: true }, greetingSpeech = async () => blob(), speechStatus, play } = {}) {
  let cursor = 0, dirty = false, tree, nextTimer = 0; const slots = [], effects = [], timers = new Map(), audio = [], calls = [], revoked = [], sends = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(value) { const index = cursor++; slots[index] ??= { value: typeof value === 'function' ? value() : value }; return [slots[index].value, next => { const value = typeof next === 'function' ? next(slots[index].value) : next; if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; } }]; },
    useId() { const index = cursor++; return slots[index] ??= `npc-test-${index}`; },
    useEffect(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) { const previous = slots[index]; const slot = slots[index] = { deps, setup: fn }; effects.push(() => { previous?.cleanup?.(); slot.cleanup = fn(); }); } },
  };
  const client = {
    status: async () => ({ enabled: true, maxMessageChars: 600, model: 'test-only' }),
    speechStatus: speechStatus ?? (async () => ({ enabled: true, maxTextChars: 420, voiceKind: 'speech', voiceLabel: '匹配身份的声音' })),
    greetingSpeech: (source, options) => { calls.push({ source, signal: options.signal }); return greetingSpeech(source, options); },
    speech: async () => blob(),
    send: async request => { sends.push(request); return { reply: '这是测试回复。', requestId: request.requestId, conversationId: 'conversation-id' }; },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, AbortController, setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); }, require(id) {
    if (id === 'react') return hooks; if (id === 'react/jsx-runtime') return jsx;
    if (id === 'lucide-react') return new Proxy({}, { get: () => () => null });
    if (id === '../lib/npcChatClient.js') return { npcChatClient: client, createNpcChatRequest: data => createNpcChatRequest(data, () => 'test-request'), NPC_CHAT_MAX_CHARS: 600 };
    if (id === '../lib/npcCatalog.js') return { NPC_MAP };
    if (id === '../lib/npcSpeechPlayer.js') return { createNpcSpeechPlayer: options => createNpcSpeechPlayer({ ...options, audioFactory: () => { const value = new AudioFake(play); audio.push(value); return value; }, createURL: () => `blob:${audio.length}`, revokeURL: url => revoked.push(url) }) };
    if (id.endsWith('.css')) return {}; throw new Error(id);
  } });
  const props = { npcId, npcName: NPC_MAP[npcId].name, sessions: new Map(), speechPreference: preference };
  const render = () => { cursor = 0; dirty = false; tree = module.exports.default(props); for (const effect of effects.splice(0)) effect(); };
  render();
  return { get tree() { return tree; }, audio, calls, revoked, sends, timers,
    async flush() { for (let i = 0; i < 12; i++) { await Promise.resolve(); if (dirty) render(); } },
    strictReplay() { for (const slot of slots) slot?.cleanup?.(); for (const slot of slots) if (slot?.setup) slot.cleanup = slot.setup(); },
    tick() { const queued = [...timers.values()]; timers.clear(); for (const fn of queued) fn(); },
    cleanup() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('NPC interaction starts with its fixed authored greeting, defaults voice on, and StrictMode triggers one request/play', async () => {
  const h = mount();
  assert.ok(words(h.tree).includes(NPC_MAP['npc-ali'].dialogue.greeting));
  assert.equal(elements(h.tree).find(node => node.type === 'input' && node.props.type === 'checkbox').props.checked, true);
  h.strictReplay(); await h.flush(); assert.equal(h.calls.length, 0, 'effect startup is deferred until after replay');
  h.tick(); await h.flush(); assert.equal(h.calls.length, 1); assert.equal(h.audio.length, 1); assert.equal(h.audio[0].plays, 1); assert.equal(h.sends.length, 0);
  await h.flush(); h.tick(); await h.flush(); assert.equal(h.calls.length, 1);
  h.cleanup(); assert.equal(h.audio[0].pauses, 1); assert.equal(h.audio[0].listeners.size, 0);
});

test('switching NPC or closing while greeting loads aborts the old voice and ignores late audio', async () => {
  const old = deferred(), h = mount({ greetingSpeech: () => old.promise }); await h.flush(); h.tick(); await h.flush(); assert.equal(h.calls.length, 1);
  h.cleanup(); assert.equal(h.calls[0].signal.aborted, true);
  const next = mount({ npcId: 'npc-chengsu' }); await next.flush(); next.tick(); await next.flush();
  old.resolve(blob()); await h.flush(); assert.equal(h.audio.length, 0); assert.equal(next.audio.length, 1); assert.equal(next.calls[0].source.npcId, 'npc-chengsu');
  next.cleanup(); assert.equal(next.audio[0].pauses, 1);
});

test('default-on voice can be disabled before status resolves and stays disabled across NPC switches in the directory', async () => {
  const status = deferred(), preference = { enabled: true }; const h = mount({ preference, speechStatus: () => status.promise });
  const checkbox = elements(h.tree).find(node => node.type === 'input' && node.props.type === 'checkbox'); assert.notEqual(checkbox.props.disabled, true);
  checkbox.props.onChange({ target: { checked: false } }); await h.flush(); assert.equal(preference.enabled, false);
  status.resolve({ enabled: true, maxTextChars: 420, voiceKind: 'speech' }); await h.flush(); h.tick(); await h.flush(); assert.equal(h.calls.length, 0); h.cleanup();
  const next = mount({ npcId: 'npc-chengsu', preference }); await next.flush(); next.tick(); await next.flush();
  assert.equal(elements(next.tree).find(node => node.type === 'input' && node.props.type === 'checkbox').props.checked, false); assert.equal(next.calls.length, 0); next.cleanup();
});

test('blocked automatic greeting exposes a manual retry which reuses the generated Blob without another paid request', async () => {
  let plays = 0; const h = mount({ play: () => ++plays === 1 ? Promise.reject(Object.assign(new Error('gesture required'), { name: 'NotAllowedError' })) : Promise.resolve() });
  await h.flush(); h.tick(); await h.flush(); assert.equal(h.calls.length, 1); assert.ok(words(h.tree).includes('浏览器需要你点击“播放语音”'));
  const replay = elements(h.tree).find(node => node.type === 'button' && words(node).includes('播放语音')); assert.ok(replay); replay.props.onClick(); await h.flush();
  assert.equal(h.calls.length, 1); assert.equal(plays, 2); assert.ok(words(h.tree).includes('正在播报')); h.cleanup();
});

test('manual conversation before speech status resolves narrates the fresh reply instead of a delayed greeting', async () => {
  const status = deferred(), h = mount({ speechStatus: () => status.promise }); await h.flush();
  elements(h.tree).find(node => node.type === 'textarea').props.onChange({ target: { value: '你好' } }); await h.flush();
  elements(h.tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await h.flush(); assert.equal(h.sends.length, 1);
  status.resolve({ enabled: true, maxTextChars: 420, voiceKind: 'speech' }); await h.flush(); h.tick(); await h.flush(); assert.equal(h.calls.length, 0); assert.equal(h.audio.length, 1); assert.equal(h.audio[0].plays, 1); h.cleanup();
});

test('unmount before deferred start and replayed stale status never create a background greeting', async () => {
  const h = mount(); await h.flush(); assert.equal(h.timers.size, 1); h.cleanup(); h.tick(); await h.flush(); assert.equal(h.calls.length, 0);
  const status = deferred(), delayed = mount({ speechStatus: () => status.promise }); delayed.cleanup();
  status.resolve({ enabled: true, maxTextChars: 420, voiceKind: 'speech' }); await delayed.flush(); delayed.tick(); await delayed.flush(); assert.equal(delayed.calls.length, 0);
});
