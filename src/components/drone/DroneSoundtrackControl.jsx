import { useEffect, useRef, useState } from 'react';
import { createDroneSoundtrack } from '../../lib/droneSoundtrack.js';
import './drone-soundtrack.css';

export default function DroneSoundtrackControl(props) {
  return props.program.mediaMaster ? <MasterAudioControl {...props}/> : <SyncedAudioControl {...props}/>;
}
function MasterAudioControl({ controller, program }) {
  const [muted, setMuted] = useState(Boolean(program.mediaMaster.muted));
  return <div className="drone-soundtrack"><button type="button" className="drone-action" aria-pressed={!muted} onClick={() => { program.mediaMaster.muted = !muted; setMuted(!muted); }}>{muted ? '开启本机音轨' : '静音本机音轨'}</button><span className="drone-soundtrack-title">本机排练 · 音乐与画面同步</span></div>;
}
function SyncedAudioControl({ controller, program }) {
  const player = useRef(null), media = useRef(null), latest = useRef(controller.state);
  latest.current = controller.state;
  const [audio, setAudio] = useState({ status: 'starting', message: '' });
  useEffect(() => {
    const instance = createDroneSoundtrack({ url: program.soundtrackUrl, timeRef: controller.timeRef, createAudio: () => media.current,
      getState: () => latest.current, onStatus: setAudio });
    player.current = instance;
    return () => { instance.dispose(); if (player.current === instance) player.current = null; };
  }, [program.soundtrackUrl, controller.timeRef]);
  useEffect(() => { player.current?.sync(); }, [controller.state]);
  const soundscape = program.sampleId === 'footsteps-of-light';
  const enabled = audio.status === 'on' || audio.status === 'starting';
  return <div className="drone-soundtrack">
    <audio ref={media} hidden preload="auto" data-drone-soundtrack={program.soundtrackTitle}/>
    <button type="button" className="drone-action" aria-pressed={enabled} onClick={() => player.current?.setEnabled(!enabled)}>{enabled ? (soundscape ? '静音烟花音效' : '静音配乐') : (soundscape ? '开启烟花音效' : '开启配乐')}</button>
    <span className="drone-soundtrack-title">{audio.status === 'starting' ? '正在载入配乐…' : `${soundscape ? '同步音效' : '原创配乐'} · ${program.soundtrackTitle}`}</span>
    {audio.message && <p role="status">{audio.message}</p>}
  </div>;
}
