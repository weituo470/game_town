"""Render the original 118-second Whale Homecoming score, without samples or APIs.

Requires Python 3, numpy and the ffmpeg executable. Output is reproducible.
The composition, oscillator instruments and render source are project-original
and released under the project's MIT terms. No external music is interpolated.
Run from the project root: python scripts/render-whale-score.py
"""
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile
import wave
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'audio'
SR = 44100
DURATION = 118
N = SR * DURATION
TAU = np.pi * 2
RNG = np.random.default_rng(20261019)
MIX = np.zeros((N, 2), dtype=np.float32)
EVENTS = []

def hz(midi):
    return 440 * 2 ** ((midi - 69) / 12)

def put(sound, start, gain=1, pan=0, label=''):
    offset = max(0, round(start * SR))
    length = min(len(sound), N - offset)
    if length <= 0:
        return
    angle = (np.clip(pan, -1, 1) + 1) * np.pi / 4
    MIX[offset:offset + length, 0] += sound[:length] * (gain * np.cos(angle))
    MIX[offset:offset + length, 1] += sound[:length] * (gain * np.sin(angle))
    EVENTS.append({'at': round(start, 3), 'length': round(length / SR, 3), 'voice': label})

def piano(note, start, duration=3.8, gain=.12, pan=-.1):
    t = np.arange(round(duration * SR), dtype=np.float32) / SR
    f = hz(note)
    sound = np.zeros_like(t)
    # Soft felt attack, inharmonic strings and independently decaying overtones.
    for harmonic, weight in enumerate([1, .39, .19, .08, .035, .013, .004], 1):
        decay = (1.65 + (72 - note) * .027) / harmonic ** .43
        partial = f * harmonic * np.sqrt(1 + .00009 * harmonic * harmonic)
        sound += weight * np.sin(TAU * partial * t + harmonic * .11) * np.exp(-t / decay)
        if harmonic < 4:
            sound += .19 * weight * np.sin(TAU * partial * 1.0009 * t) * np.exp(-t / (decay * .9))
    sound *= (1 - np.exp(-t / .009)) * np.minimum(1, (duration - t) / .45)
    put(sound, start, gain, pan, 'felt-piano')

def bell(note, start, duration=4.8, gain=.065, pan=.3):
    t = np.arange(round(duration * SR), dtype=np.float32) / SR
    f = hz(note)
    sound = (np.sin(TAU * f * t) * np.exp(-t / 1.9)
             + .23 * np.sin(TAU * f * 2 * t) * np.exp(-t / .9)
             + .045 * np.sin(TAU * f * 4.01 * t) * np.exp(-t / .35))
    sound *= (1 - np.exp(-t / .006)) * np.minimum(1, (duration - t) / .6)
    put(sound, start, gain, pan, 'calf-celesta')

def bowed(note, start, duration=4, gain=.045, pan=0, airy=False):
    t = np.arange(round(duration * SR), dtype=np.float32) / SR
    f = hz(note)
    # Gentle pitch drift rather than a hard organ/square-wave timbre.
    vibrato = .0027 * (1 - np.exp(-t / .6)) * np.sin(TAU * 4.7 * t)
    phase = TAU * np.cumsum(f * (1 + vibrato), dtype=np.float64) / SR
    sound = np.zeros_like(t)
    for harmonic in range(1, 9 if not airy else 5):
        weight = np.exp(-harmonic * (.27 if not airy else .57)) / harmonic ** .8
        sound += weight * np.sin(phase * harmonic + .035 * np.sin(TAU * .31 * t + harmonic))
    if airy:
        sound += .16 * np.sin(phase * 1.002)
    envelope = np.minimum(1, t / (.7 if airy else .28)) ** 1.4
    envelope *= np.minimum(1, (duration - t) / (1.4 if airy else .65)) ** 1.3
    envelope *= .88 + .12 * np.sin(np.pi * t / duration)
    put(sound * envelope, start, gain, pan, 'warm-strings' if airy else 'mother-cello')

def whale_call(note, start, duration=4.8, gain=.028, pan=0):
    t = np.arange(round(duration * SR), dtype=np.float32) / SR
    pitch = hz(note) * (1 + .045 * np.sin(np.pi * t / duration))
    phase = TAU * np.cumsum(pitch, dtype=np.float64) / SR
    env = np.sin(np.pi * t / duration) ** 2.7
    sound = (np.sin(phase) + .23 * np.sin(phase * 2) + .07 * np.sin(phase * 3)) * env
    put(sound, start, gain, pan, 'musical-whale-call')

def swell(start, duration=2.4, gain=.014, pan=0):
    t = np.arange(round(duration * SR), dtype=np.float32) / SR
    noise = RNG.normal(0, 1, len(t)).astype(np.float32)
    # FFT-smoothed sea/brush texture, not a crash or a broadband noise wall.
    spectrum = np.fft.rfft(noise)
    freq = np.fft.rfftfreq(len(noise), 1 / SR)
    spectrum *= np.exp(-(freq / 2800) ** 2) * (1 - np.exp(-(freq / 180) ** 2))
    noise = np.fft.irfft(spectrum, len(noise)).astype(np.float32)
    noise /= max(.1, float(np.std(noise)))
    put(noise * np.sin(np.pi * t / duration) ** 2, start, gain, pan, 'sea-brush')

def pulse(start, gain=.055):
    t = np.arange(round(.9 * SR), dtype=np.float32) / SR
    phase = TAU * (48 * t + 19 * .04 * (1 - np.exp(-t / .04)))
    sound = np.sin(phase) * np.exp(-t / .24) * (1 - np.exp(-t / .012))
    put(sound, start, gain, 0, 'rounded-low-drum')

# A five-note family motif; every reply is related to the first call.
MOTHER = [(0, 59, 1.8), (1.6, 62, 1.5), (3.2, 66, 2.6), (6.4, 69, 1.8), (8, 66, 2.5)]
CALF = [(0, 74), (.8, 78), (2.4, 81), (4, 78), (5.6, 76), (6.4, 74)]
# Each harmonic block starts on an intentional story beat.
CHORDS = [
    (0, 8, [47, 54, 59, 62, 66]), (8, 4, [43, 50, 57, 59, 62]),
    (12, 4, [38, 45, 54, 57, 62]), (16, 4, [45, 52, 57, 59, 64]),
    (20, 8, [47, 54, 59, 62, 66]), (28, 8, [43, 50, 57, 59, 62]),
    (36, 8, [38, 45, 54, 57, 62]), (44, 8, [45, 52, 57, 59, 64]),
    (52, 6, [47, 54, 59, 62, 66]), (58, 6, [43, 50, 57, 59, 62]),
    (64, 6, [38, 45, 54, 57, 62]), (70, 7, [43, 50, 55, 59, 62]),
    (77, 7, [45, 52, 57, 61, 64]), (84, 4, [38, 45, 54, 57, 62]),
    (88, 4, [45, 52, 57, 61, 64]), (92, 4, [47, 54, 59, 62, 66]),
    (96, 4, [43, 50, 55, 59, 62]), (100, 8, [38, 45, 54, 57, 62]),
    (108, 10, [38, 45, 50, 54, 62]),
]

for at, length, notes in CHORDS:
    level = .023 if at < 20 else .029 if at < 52 else .038 if at < 84 else .053 if at < 100 else .028
    for i, note in enumerate(notes):
        bowed(note, at, min(length + 1.7, DURATION - at), level * (1 if i > 0 else .9), -.7 + i * .35, True)
    # A slower bass heartbeat leaves air around the melody.
    piano(notes[0], at + .05, min(5.5, DURATION - at - .05), .095 if at < 84 else .15, -.12)
    if 20 <= at < 108:
        step = .8 if at >= 52 else 1.6
        pattern = [1, 2, 3, 2, 4, 3, 2, 1]
        for j, offset in enumerate(np.arange(.8, length - .2, step)):
            note = notes[pattern[j % len(pattern)]] + 12
            piano(note, at + float(offset), 3.4, .044 if at < 84 else .065, (-.34 if j % 2 else .34))

for offset, note in [(0, 71), (1.6, 74), (4.8, 78), (7.2, 74), (10.4, 69), (12, 66)]:
    piano(note, 7.8 + offset, 4.5, .11, -.2)
for offset, note, length in MOTHER:
    bowed(note, 20 + offset, length + .6, .12, -.15)
for offset, note in [(0, 62), (2.4, 61), (4.8, 57)]:
    bowed(note, 30.4 + offset, 2.4, .105, -.15)
whale_call(47, 18.2, 5.2, .032, -.3)
whale_call(54, 30.4, 4.5, .024, -.2)

for base, transpose in [(36, 0), (44, -2)]:
    for offset, note in CALF:
        bell(note + transpose, base + offset, 4.2, .115, .35)
        piano(note + transpose - 12, base + offset + .04, 3.1, .055, -.3)
whale_call(66, 40.4, 3.2, .022, .3)

# The returning family speaks the same phrase in three registers, not three
# unrelated tracks. Counterpoint opens into a broad unison at the shared leap.
for base, transpose, pan in [(52, 0, -.35), (58.4, 7, .3), (64, 12, -.05), (70, 0, -.3), (76.4, 7, .3)]:
    for offset, note, length in MOTHER:
        if base + offset > 83.5:
            continue
        bowed(note + transpose, base + offset, length + .55, .085, pan)
        if base >= 64:
            bell(note + transpose + 12, base + offset + .08, 3.5, .028, -pan)
for base in [52, 58, 64, 70, 77]:
    swell(base - 1.2, 3.1, .010, -.2 if base % 2 else .2)

CLIMAX = [(0, 74, 2.4), (2.4, 78, 1.6), (4, 81, 3.2), (7.2, 78, 1.6), (8.8, 76, 2.4), (11.2, 74, 3.4)]
swell(81.2, 3.3, .024)
for offset, note, length in CLIMAX:
    bowed(note, 84 + offset, length + .7, .145, -.18)
    bowed(note - 12, 84 + offset, length + .7, .105, .2)
    piano(note, 84 + offset, 4.2, .11, .1)
    bell(note + 12, 84 + offset + .03, 4.5, .047, -.4)
for at in np.arange(84, 99, 1.6):
    pulse(float(at), .055 if int(round(at * 10)) % 32 == 8 else .035)
for at in [84, 88, 92, 96]:
    swell(at - .3, 2.8, .013, .2)

for offset, note, length in [(0, 66, 2.4), (2.4, 62, 2.4), (4.8, 59, 2.4), (8, 62, 5.4)]:
    piano(note + 12, 100 + offset, length + 2.2, .11, -.12)
    bowed(note, 100 + offset, length + 1, .07, .15)
bell(86, 105.6, 5.5, .04, .3)
whale_call(50, 106.5, 6.4, .023, 0)

# Stereo hall made from a deterministic exponentially decaying diffuse impulse.
# No bundled impulse responses or commercial samples are needed.
def reverberate(channel, seed):
    rng = np.random.default_rng(seed)
    size = int(2.9 * SR)
    t = np.arange(size) / SR
    impulse = rng.normal(0, 1, size) * np.exp(-t * 2.8)
    impulse[:int(.045 * SR)] = 0
    impulse *= .00073
    for delay, amount in [(.071, .105), (.113, .075), (.173, .049), (.269, .031)]:
        impulse[int(delay * SR)] += amount
    length = 1 << (N + size - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(channel, length) * np.fft.rfft(impulse, length), length)[:N].astype(np.float32)

left = reverberate(MIX[:, 0], 611)
right = reverberate(MIX[:, 1], 937)
MIX[:, 0] += left * .72 + right * .2
MIX[:, 1] += right * .72 + left * .2
MIX *= np.minimum(1, np.arange(N, dtype=np.float32) / (SR * 1.8))[:, None]
MIX *= np.minimum(1, (N - 1 - np.arange(N, dtype=np.float32)) / (SR * 5.5))[:, None]
peak = float(np.max(np.abs(MIX)))
MIX *= .88 / max(peak, .001)

OUT.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='whale-score-') as tmp:
    wav = Path(tmp) / 'score.wav'
    with wave.open(str(wav), 'wb') as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(SR)
        output.writeframes((np.clip(MIX, -1, 1) * 32767).astype('<i2').tobytes())
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav),
        '-af', 'highpass=f=28,lowpass=f=12500,loudnorm=I=-19:TP=-1.5:LRA=11',
        '-ar', str(SR), '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k', '-map_metadata', '-1',
        '-metadata', 'title=Whale Homecoming', '-metadata', 'artist=Game Town original score',
        str(OUT / 'whale-homecoming.mp3')], check=True)

data = (OUT / 'whale-homecoming.mp3').read_bytes()
metadata = {
    'title': '鲸群归航', 'durationSeconds': DURATION, 'channels': 2, 'sampleRate': SR,
    'source': 'Original session-authored composition and additive instruments; no third-party samples or melodies.',
    'license': 'MIT (project-original composition, synthesis source and rendered audio)',
    'sourceScript': 'scripts/render-whale-score.py', 'sampleFile': 'whale-homecoming.mp3',
    'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data),
    'providerCalls': 0, 'motif': 'B-D-F#-A-F#; calf answers in the upper register; finale resolves to D major.',
    'cues': [
        {'seconds': 0, 'name': '起飞与深海'}, {'seconds': 8, 'name': '孤鲸序曲'},
        {'seconds': 20, 'name': '母鲸呼唤'}, {'seconds': 36, 'name': '幼鲸回应'},
        {'seconds': 52, 'name': '鲸群远来'}, {'seconds': 70, 'name': '环游团聚'},
        {'seconds': 84, 'name': '共同跃空'}, {'seconds': 100, 'name': '护送归航'},
        {'seconds': 108, 'name': '尾声与回收'}, {'seconds': 118, 'name': '结束'}
    ], 'noteEvents': len(EVENTS)
}
(OUT / 'whale-homecoming.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'file': str(OUT / 'whale-homecoming.mp3'), 'bytes': len(data), 'events': len(EVENTS), 'sha256': metadata['sha256']}))
