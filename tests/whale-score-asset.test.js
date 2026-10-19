import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('public/audio/whale-homecoming.json', root), 'utf8'));
test('whale score is a bounded, credited original stereo track with reproducible source', () => {
  const bytes = readFileSync(new URL('public/audio/whale-homecoming.mp3', root));
  assert.equal(meta.durationSeconds, 118);
  assert.equal(meta.channels, 2);
  assert.equal(meta.sampleRate, 44100);
  assert.equal(meta.providerCalls, 0);
  assert.match(meta.source, /no third-party samples/i);
  assert.match(meta.license, /MIT/);
  assert.equal(bytes.length, meta.bytes);
  assert.ok(bytes.length > 1_000_000 && bytes.length < 5_000_000);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), meta.sha256);
  assert.ok(bytes.subarray(0, 3).toString() === 'ID3' || bytes[0] === 0xff, 'actual MP3 header');
  const source = readFileSync(new URL(meta.sourceScript, root), 'utf8');
  assert.match(source, /DURATION = 118/);
  assert.match(source, /no third-party samples or melodies/i);
  assert.doesNotMatch(source, /https?:\/\//);
});

test('score cue sheet follows the family story and ends after the return', () => {
  assert.deepEqual(meta.cues.map(cue => cue.seconds), [0, 8, 20, 36, 52, 70, 84, 100, 108, 118]);
  assert.ok(meta.noteEvents >= 200 && meta.noteEvents < 1000);
  assert.equal(meta.cues.at(-1).seconds, meta.durationSeconds);
});
