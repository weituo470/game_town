import { useEffect, useRef, useState } from 'react';
import { createDroneSoundtrack } from '../../lib/droneSoundtrack.js';
import './drone-soundtrack.css';

export default function DroneSoundtrackControl({ controller, program }) {
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
  const enabled = audio.status === 'on' || audio.status === 'starting';
  return <div className="drone-soundtrack">
    <audio ref={media} hidden preload="auto" data-drone-soundtrack={program.soundtrackTitle}/>
    <button type="button" className="drone-action" aria-pressed={enabled} onClick={() => player.current?.setEnabled(!enabled)}>{enabled ? '静音配乐' : '开启配乐'}</button>
    <span className="drone-soundtrack-title">{audio.status === 'starting' ? '正在载入配乐…' : `原创配乐 · ${program.soundtrackTitle}`}</span>
    {audio.message && <p role="status">{audio.message}</p>}
  </div>;
}
