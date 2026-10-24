"""Deterministic CC0 recording + original synthesis; requires numpy and ffmpeg.
Run from the project root: python scripts/create-footprint-soundscape.py
"""
from pathlib import Path
import tempfile, subprocess, wave
import numpy as np

SR, DURATION = 48000, 104
rng = np.random.default_rng(20080808)
mix = np.zeros((SR * DURATION, 2), dtype=np.float32)
source = Path('public/audio/sources/firework-336008-cc0.mp3')
decoded = subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i',str(source),'-ar',str(SR),'-ac','1','-f','f32le','pipe:1'],check=True,stdout=subprocess.PIPE).stdout
recording = np.frombuffer(decoded,dtype='<f4').copy()
recording /= max(.01,float(np.max(np.abs(recording))))
window = int(.005*SR)
energies = np.array([np.mean(recording[i:i+window]**2) for i in range(0,len(recording)-window,window)])
peak_time = (int(np.argmax(energies))+.5)*window/SR
print('Recorded shell-break peak:',round(peak_time,4),'seconds; CC0 Rudmer_Rotteveel 336008')

def noise(seconds, low=30, high=16000):
    n = int(seconds * SR)
    raw = rng.standard_normal(n)
    frequencies = np.fft.rfftfreq(n, 1 / SR)
    spectrum = np.fft.rfft(raw)
    band = (1 - np.exp(-(frequencies / low) ** 4)) * np.exp(-(frequencies / high) ** 4)
    value = np.fft.irfft(spectrum * band, n)
    return value / max(.01, np.std(value))

def add(value, at, gain=1, pan=0):
    start = int(at * SR)
    if start < 0: value = value[-start:]; start = 0
    n = min(len(value), len(mix) - start)
    if n <= 0: return
    p = np.clip(pan, -.85, .85)
    mix[start:start+n, 0] += value[:n] * gain * np.sqrt((1-p)/2)
    mix[start:start+n, 1] += value[:n] * gain * np.sqrt((1+p)/2)

def launch(at, strength, pan):
    t = np.arange(int(1.85 * SR)) / SR
    envelope = np.sin(np.pi * t / 1.85) ** 1.1
    chirp = np.sin(2 * np.pi * (420*t + 270*t*t))
    value = (noise(1.85, 450, 4800) * .10 + chirp * .035) * envelope
    add(value, at-1.85, strength, pan)

def burst(at, strength, pan, seed, grand=False):
    seconds = 7.8 if grand else 5.9
    t = np.arange(int(seconds * SR)) / SR
    attack = 1-np.exp(-t*190)
    # Short sharp shell break + long bass body, then airy rolling reverberation.
    # The real recording supplies the recognizable whistle -> crack -> boom.
    # Place its measured shell-break peak 65ms after the visual apex volley.
    add(recording,at+.065-peak_time,strength*.68,pan)
    boom = noise(seconds, 22, 230) * np.exp(-t*2.1) * .13
    boom += noise(seconds, 160, 7000) * np.exp(-t*13) * .04
    boom += np.sin(2*np.pi*(43*t + 18*(1-np.exp(-t*4)))) * np.exp(-t*3.7) * .06
    add(boom*attack, at+.065, strength, pan)
    add(boom*attack, at+.40, strength*.19, -pan)
    add(boom*attack, at+.73, strength*.09, pan*.4)
    # Many separated, quiet crackles rather than a constant white-noise hiss.
    fizz = noise(seconds, 1400, 10500)
    env = np.zeros(len(t))
    local = np.random.default_rng(seed)
    for _ in range(105 if grand else 62):
        pos = int(local.uniform(.35, seconds-.2)*SR)
        length = int(local.uniform(.008,.035)*SR)
        env[pos:pos+length] += np.exp(-np.arange(length)/(length*.21))*local.uniform(.04,.13)
    add(fizz*env*np.exp(-t*.19), at+.24, strength*.65, pan)
    add(noise(seconds, 200, 1800)*np.exp(-t*.75)*(1-np.exp(-t*4)), at+.32, strength*.024, -pan)

launch(5.8,.38,-.5)
for i in range(29):
    at=10+i*2.1
    pan=(-.32 if i%2==0 else .32)
    strength=.56+.32*i/28
    launch(at,strength,pan)
    burst(at,strength,pan,2008+i)
for i, at in enumerate([76,76.65,79.2,79.85,83,86.5,87.15,90]):
    pan=0 if i in [4,7] else (-.56 if i%2==0 else .56)
    launch(at,.9,pan)
    burst(at,1.05,pan,2900+i,True)
# A very quiet low overtone under the final gold rain, not borrowed music.
t=np.arange(int(20*SR))/SR
bed=sum(np.sin(2*np.pi*f*t) for f in [65.4064,98,130.8128])*.0025*np.sin(np.pi*t/20)**2
add(bed,75,1,0)
mix *= np.minimum(1,np.arange(len(mix))/SR/2)[:,None]
mix *= np.minimum(1,(len(mix)-np.arange(len(mix)))/SR/3)[:,None]
peak=float(np.max(np.abs(mix)))
mix*=.82/max(.82,peak)
out=Path('public/audio/footsteps-of-light.mp3'); out.parent.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory() as directory:
    wav=Path(directory)/'original-footprints.wav'
    with wave.open(str(wav),'wb') as f:
        f.setnchannels(2);f.setsampwidth(2);f.setframerate(SR);f.writeframes((np.clip(mix,-1,1)*32767).astype('<i2').tobytes())
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(wav),'-af','loudnorm=I=-19:TP=-2:LRA=11','-ar','48000','-c:a','libmp3lame','-b:a','160k','-t','104',str(out)],check=True)
print(str(out))
