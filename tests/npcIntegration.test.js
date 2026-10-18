import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('NPC integration keeps ambient time separate from local lighting previews', () => {
  const app = read('src/App.jsx');
  assert.match(app, /timeRef: npcTimeRef.*useWorldClock\(\{ network: multiplayer \}\)/);
  assert.match(app, /npcTimeRef=\{npcTimeRef\}/);
  assert.match(app, /<NpcDirectory[^>]*timeRef=\{npcTimeRef\}/);
});

test('NPC integration offers directory and nearby F without hijacking typing or game E', () => {
  const app = read('src/App.jsx');
  assert.match(app, /className=(?:"nav-item npc-nav"|\{`nav-item npc-nav\b)/);
  assert.match(app, /aria-haspopup="dialog" onClick=\{\(\) => inspectResidents\(\)\}/);
  assert.match(app, /nearestNpc && event.key.toLowerCase\(\) === 'f'/);
  assert.match(app, /nearest && event.key.toLowerCase\(\) === 'e'/);
  assert.match(app, /event.target\?\.closest\?\.\('input, textarea, select, button, a,/);
  assert.match(app, /<kbd>F<\/kbd> 聊一聊/);
  assert.match(app, /nearest && !nearestNpc && !modal/);
  assert.match(app, /useEffect\(\(\) => \{ inputRef.current = \{ \.\.\.EMPTY_INPUT \}; \}, \[modal, mapOpen\]\)/);
  const keyboardEffect = app.slice(app.indexOf('const handleKey'), app.indexOf('const travel'));
  assert.doesNotMatch(keyboardEffect, /inputRef.current =/,'nearby changes must not cancel a held touch direction');
});

test('NPC integration uses rendered player pose and does not modify server authority', () => {
  const controller = read('src/components/town/PlayerController.jsx');
  const residents = read('src/components/town/characters/Residents.jsx');
  assert.match(controller, /playerPoseRef.current = pose.current/);
  assert.match(residents, /NPCS.map\(npc => <WalkingResident/);
  assert.match(residents, /findNearestNpc\(playerPoseRef.current/);
  assert.doesNotMatch(residents, /sendInput|sendTravel|fetch\(|WebSocket/);
  assert.match(residents, /dispose=\{null\}/);
});
