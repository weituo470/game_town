import { useEffect, useState } from 'react';
import { ArrowRight, Check, Copy, DoorOpen, Link, LoaderCircle, Users, Wifi, WifiOff } from 'lucide-react';
import './multiplayer.css';

const STATUS_LABELS = {
  offline: '邀请好友', connecting: '连接中', connected: '同游小镇',
  reconnecting: '正在重连', disconnected: '连接已断开', error: '联机未连接',
};

export function MultiplayerStatus({ multiplayer, onClick }) {
  const { status, players = [] } = multiplayer;
  const onlineCount = players.filter(player => player.connected !== false).length;
  const busy = status === 'connecting' || status === 'reconnecting';
  const Icon = busy ? LoaderCircle : status === 'connected' ? Wifi : status === 'disconnected' || status === 'error' ? WifiOff : Users;
  return <button type="button" className={`multiplayer-status multiplayer-status-${status}`} onClick={onClick} aria-label={`${STATUS_LABELS[status] || '多人小镇'}${status === 'connected' ? `，${onlineCount} 人在线` : ''}`}>
    <Icon size={19} className={busy ? 'multiplayer-spinner' : undefined} aria-hidden="true"/>
    <span>{status === 'connected' ? `${onlineCount} / 8 人` : STATUS_LABELS[status] || '邀请好友'}</span>
  </button>;
}

function invitationLink(code) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('town', code);
  return url.href;
}

export default function MultiplayerPanel({ multiplayer, onContinue }) {
  const { status, error, code, players = [], selfId, createRoom, joinRoom, leaveRoom, initialNickname = '', inviteCode = '' } = multiplayer;
  const [nickname, setNickname] = useState(initialNickname);
  const [joinCode, setJoinCode] = useState(code || inviteCode);
  const [validation, setValidation] = useState(null);
  const [copyState, setCopyState] = useState('');
  const busy = status === 'connecting' || status === 'reconnecting';
  const inRoom = status === 'connected' || status === 'reconnecting';
  const onlineCount = players.filter(player => player.connected !== false).length;
  const link = code ? invitationLink(code) : '';
  const localLink = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  useEffect(() => { if (/^[A-Z0-9]{6}$/.test(code || '')) setJoinCode(code); }, [code]);

  async function connect(mode) {
    setValidation(null);
    const trimmedName = nickname.trim();
    if (!trimmedName || [...trimmedName].length > 16) {
      setValidation({ field: 'name', message: '请填写 1–16 个字的昵称，不需要真实姓名。' });
      return;
    }
    if (mode === 'join' && !/^[A-Z0-9]{6}$/.test(joinCode)) {
      setValidation({ field: 'code', message: '请输入完整的 6 位邀请码，包含字母或数字。' });
      return;
    }
    await (mode === 'create' ? createRoom(trimmedName) : joinRoom(joinCode, trimmedName));
  }

  async function copy(value, kind) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setCopyState(kind);
    } catch {
      setCopyState('manual');
    }
  }

  return <div className="multiplayer-panel">
    <div className="multiplayer-intro">
      <span className="multiplayer-emblem" aria-hidden="true"><Users size={29}/></span>
      <div><h3>{status === 'reconnecting' ? '正在找回你的小镇' : inRoom ? onlineCount > 1 ? '你们已在同一座小镇' : '小镇已就绪，邀请朋友吧' : '一起逛这座小镇'}</h3><p>{status === 'reconnecting' ? '短时掉线会保留原位置和席位，请稍候。' : inRoom ? '关闭面板即可继续探索，房间会保持连接。' : '创建小镇，或用邀请码加入朋友。每个小镇最多 8 人。'}</p></div>
    </div>

    {error && <p className="multiplayer-error" role="alert"><WifiOff size={21} aria-hidden="true"/><span>{error}</span></p>}
    {status === 'reconnecting' && <p className="multiplayer-notice" role="status"><LoaderCircle className="multiplayer-spinner" size={21} aria-hidden="true"/>网络中断，正在尝试恢复连接。此时人物暂停移动。</p>}

    {inRoom ? <>
      <section className="multiplayer-invitation" aria-label="邀请朋友">
        <div className="multiplayer-code-heading"><span>小镇邀请码</span><span className="multiplayer-capacity">{status === 'reconnecting' ? '等待恢复连接' : `${onlineCount} / 8 人在线`}</span></div>
        <div className="multiplayer-code-line"><strong className="multiplayer-code">{code || '同步中'}</strong><button type="button" className="button-secondary" disabled={!code} onClick={() => copy(code, 'code')}>{copyState === 'code' ? <Check size={18}/> : <Copy size={18}/>}复制邀请码</button></div>
        <button type="button" className="button-plain multiplayer-copy-link" disabled={!code} onClick={() => copy(link, 'link')}>{copyState === 'link' ? <Check size={18}/> : <Link size={18}/>}复制邀请链接</button>
        {copyState && <p className="multiplayer-copy-result" role="status">{copyState === 'manual' ? '浏览器不允许自动复制，请选中下方链接后手动复制。' : copyState === 'code' ? '邀请码已复制，发给朋友即可。' : '邀请链接已复制。'}</p>}
        {copyState === 'manual' && <input className="multiplayer-link-input" aria-label="手动复制邀请链接" value={link} readOnly onFocus={event => event.currentTarget.select()}/>}
        {localLink && <p className="multiplayer-local-hint">当前地址只供本机访问，服务默认也只监听本机。跨设备游玩需负责人先开启局域网服务，再分享电脑的局域网地址和邀请码。</p>}
      </section>
      <section className="multiplayer-roster" aria-label="真实连接玩家">
        <h4>{status === 'reconnecting' ? '断线前的同游玩家' : '正在同游'}</h4>
        <ul>{players.map(player => <li key={player.id}>
          <span className="multiplayer-player-dot" style={{ '--player-color': /^#[0-9a-f]{6}$/i.test(player.color || '') ? player.color : '#57734b' }} aria-hidden="true"/>
          <span className="multiplayer-player-name">{player.name || '小镇访客'}{player.id === selfId && <small>你</small>}</span>
          <span className={`multiplayer-player-state ${player.connected === false || status === 'reconnecting' ? 'is-away' : ''}`}>{status === 'reconnecting' ? '待同步' : player.connected === false ? '暂时断线' : '已连接'}</span>
        </li>)}</ul>
        {!players.length && <p>正在同步玩家列表…</p>}
      </section>
      <div className="multiplayer-room-actions"><button type="button" className="button-primary" onClick={onContinue}>回到小镇 <ArrowRight size={18}/></button><button type="button" className="button-plain" onClick={leaveRoom}><DoorOpen size={18}/>离开联机房间</button></div>
    </> : <form className="multiplayer-form" onSubmit={event => { event.preventDefault(); connect('join'); }}>
      <div className="multiplayer-field">
        <label htmlFor="town-nickname">你的昵称</label>
        <input id="town-nickname" name="nickname" autoComplete="nickname" maxLength={32} value={nickname} disabled={busy} placeholder="例如：小镇探险家" onChange={event => { setNickname(event.target.value); setValidation(null); }} aria-invalid={validation?.field === 'name' || undefined} aria-describedby={validation?.field === 'name' ? 'town-name-error' : undefined}/>
        {validation?.field === 'name' && <p id="town-name-error" className="multiplayer-field-error" role="alert">{validation.message}</p>}
      </div>
      <button type="button" className="button-primary multiplayer-create" disabled={busy} onClick={() => connect('create')}>{busy ? <LoaderCircle className="multiplayer-spinner" size={18}/> : <Users size={18}/>} {busy ? '正在连接小镇…' : '创建我的小镇'}</button>
      <div className="multiplayer-divider"><span>或加入朋友的小镇</span></div>
      <div className="multiplayer-field">
        <label htmlFor="town-invite-code">6 位邀请码</label>
        <div className="multiplayer-join-row"><input id="town-invite-code" name="code" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={6} value={joinCode} disabled={busy} placeholder="ABC123" onChange={event => { setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)); setValidation(null); }} aria-invalid={validation?.field === 'code' || undefined} aria-describedby={validation?.field === 'code' ? 'town-code-error' : undefined}/><button type="submit" className="button-secondary" disabled={busy}>加入小镇 <ArrowRight size={18}/></button></div>
        {validation?.field === 'code' && <p id="town-code-error" className="multiplayer-field-error" role="alert">{validation.message}</p>}
      </div>
      {busy && <button type="button" className="button-plain" onClick={leaveRoom}>取消连接，先单人探索</button>}
    </form>}
    <p className="multiplayer-privacy">使用游客身份联机，昵称和位置会发给同房玩家；小游戏与护照仍是个人体验。退出联机后仍可单人探索。</p>
  </div>;
}
