import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ArrowRight, ArrowLeft, ArrowUp, ArrowDown, Check, Compass, Eye, Gamepad2, Ghost, HelpCircle, Map, MapPin, Music2, Puzzle, RotateCcw, ShieldCheck, Sparkles, Target, Ticket, Trash2, X, ChevronRight, Heart, Volume2, Flag } from 'lucide-react';
import Town from './components/Town.jsx';
const TownAtlas = React.lazy(() => import('./components/TownAtlas.jsx'));
const SphereControls = React.lazy(() => import('./components/sphere/SphereControls.jsx'));
const OffshoreControls = React.lazy(() => import('./components/offshore/OffshoreControls.jsx'));
const WonderSchedule = React.lazy(() => import('./components/WonderSchedule.jsx'));
const WonderHud = React.lazy(() => import('./components/WonderSchedule.jsx').then(module => ({ default: module.WonderHud })));
import { OutdoorLauncher, OutdoorHud, useOutdoorPlay } from './components/OutdoorPlay.jsx';
import FlightStatus from './components/FlightStatus.jsx';
import { WONDERS } from '../shared/wonders.js';
import { GPT_PARK } from '../shared/gpt-park.js';
import { DEEPSEEK_PARK } from '../shared/deepseek-park.js';
import { DISTRICTS, getDestination } from '../shared/world.js';
import MarketRecommendations from './components/MarketRecommendations.jsx';
import { clearPreferences } from './lib/marketRecommendations.js';
import { NPC_MAP } from './lib/npcCatalog.js';
import { createNpcAnimalPlayer } from './lib/npcAnimalPlayer.js';
import { UserRound, UsersRound } from 'lucide-react';
import { gameCharacterClient } from './lib/gameCharacterClient.js';
import MultiplayerPanel, { MultiplayerStatus } from './components/MultiplayerPanel.jsx';
import useMultiplayer from './lib/useMultiplayer.js';
import useOffshoreCruise from './lib/useOffshoreCruise.js';
import useWorldClock from './lib/useWorldClock.js';
import DayNightControls from './components/DayNightControls.jsx';
import DroneShowControls, { useDroneShowController } from './components/drone/DroneShowControls.jsx';
import { getDroneProgram } from '../shared/dronePrograms.js';
import './components/drone/drone-integration.css';
import { GAMES, GAME_MAP } from './lib/catalog.js';
import { STORAGE_KEY, loadProfile, saveProfile, clearProfile, addVisit, getRecommendations, getDimensions, getCompletion } from './lib/profile.js';

const ICONS = { balloons: Target, haunted: Ghost, rhythm: Music2, puzzle: Puzzle };
const EMPTY_INPUT = { forward: false, backward: false, left: false, right: false };
const DRONE_NIGHT_TIME = Object.freeze({ current: 90000 });
// Non-scene features should not compete with the first 3D frame or compile
// their game logic before the visitor has chosen to open them.
const MiniGame = React.lazy(() => import('./components/MiniGame.jsx'));
const AiDroneStudio = React.lazy(() => import('./components/drone/AiDroneStudio.jsx'));
const NpcDirectory = React.lazy(() => import('./components/NpcDirectory.jsx'));
const CharacterStudio = React.lazy(() => import('./components/CharacterStudio.jsx'));
const GptParkExperience = React.lazy(() => import('./components/gpt/GptParkExperience.jsx'));
const DeepSeekParkExperience = React.lazy(() => import('./components/deepseek/DeepSeekParkExperience.jsx'));
function GameIcon({ id, ...props }) { const Icon = ICONS[id] || Gamepad2; return <Icon aria-hidden="true" {...props} />; }

export function MapCameraControls({ viewMode, onChange }) {
  return <div className="map-camera-controls" role="group" aria-label="地图视角"><div>
    <button aria-pressed={viewMode === 'overview'} onClick={() => onChange('overview')}><Map size={18} aria-hidden="true"/>全镇鸟瞰</button>
    <button aria-pressed={viewMode === 'follow'} onClick={() => onChange('follow')}><Compass size={18} aria-hidden="true"/>跟随人物</button>
    <button aria-pressed={viewMode === 'first-person'} title="近距离第三人称，镜头在主角身后" onClick={() => onChange('first-person')}><Eye size={18} aria-hidden="true"/>近距第三人称</button>
  </div><span className="map-scale-note">主镇九倍面积 · 三大奇观</span></div>;
}

export function FirstPersonOverlay({ status }) {
  return <div className="first-person-overlay">
    <span className="first-person-crosshair" aria-hidden="true"/>
    <p className="first-person-hint" role="status"><span className="first-person-desktop-hint">{status === 'locked' ? '鼠标环视已开启 · WASD 移动 · 空格跳跃／长按喷气 · H 悬停 · Esc 释放鼠标' : status === 'drag' ? '拖动画面环视 · WASD 移动 · 空格跳跃／长按喷气 · H 悬停' : '点击场景开启环视 · WASD 移动 · 空格跳跃／长按喷气 · H 悬停'}</span><span className="first-person-touch-hint">拖动环视 · 长按喷气 · 空中点悬停</span></p>
  </div>;
}

class SceneBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="scene-fallback"><Compass size={44}/><h2>3D 场景暂时无法打开</h2><p>请使用支持 WebGL 的浏览器，或开启硬件加速。你仍可从探索清单直接体验小游戏。</p></div> : this.props.children; }
}

class CharacterStudioBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="character-entry-message" role="alert"><h3>角色工坊暂时无法打开</h3><p>请检查网络后刷新页面重试。这不会取消已提交的生成任务，也不影响你继续逛小镇。</p></div> : this.props.children; }
}

class GptEntryBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <Dialog title="GPT 园区暂时无法打开" onClose={this.props.onClose}><p>场景文件未能加载，请返回小镇后重试。</p></Dialog> : this.props.children; }
}

class DeepSeekEntryBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <Dialog title="DeepSeek 园区暂时无法打开" onClose={this.props.onClose}><p>场景文件未能加载，请返回小镇后重试。</p></Dialog> : this.props.children; }
}

function Dialog({ title, eyebrow, onClose, children, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    function key(event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key === 'Tab') {
        const items = [...ref.current.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex="0"]')].filter(el => el.getClientRects().length > 0);
        const first = items[0], last = items[items.length - 1];
        if (!first) { event.preventDefault(); return; }
        const outside = !ref.current.contains(document.activeElement);
        if (event.shiftKey && (outside || document.activeElement === first || document.activeElement === ref.current)) { last.focus(); event.preventDefault(); }
        else if (!event.shiftKey && (outside || document.activeElement === last || document.activeElement === ref.current)) { first.focus(); event.preventDefault(); }
      }
    }
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', key); previous?.focus?.(); };
  }, [onClose]);
  return <div className="dialog-backdrop"><section ref={ref} className={`dialog ${wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
    <header className="dialog-heading"><div><span className="eyebrow">{eyebrow || 'PLAYTOWN / EXPLORER'}</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭弹窗"><X/></button></header>
    <div className="dialog-content">{children}</div>
  </section></div>;
}

function Feedback({ result, onSave, onDiscard }) {
  const [enjoyment, setEnjoyment] = useState(null);
  const [wantsMore, setWantsMore] = useState(null);
  const [comfort, setComfort] = useState('balanced');
  const game = GAME_MAP[result.gameId];
  return <div className="feedback">
    <div className="result-banner"><span className="result-icon" style={{ '--game-color': game.color }}><GameIcon id={game.id} size={32}/></span><div><span className="eyebrow">一次新的发现</span><h3>{result.completed ? '这一站，探索完成！' : '这次体验已结束'}</h3></div><strong className="result-score">{Math.round(result.score)}<span>本局分数</span></strong></div>
    <p className="result-summary">{result.metrics?.summary || '游玩记录已生成。告诉我们你的体验，让推荐更贴近你。'}</p>
    <fieldset><legend>这次玩得开心吗？</legend><div className="rating-row">{['不太喜欢', '有点无聊', '还不错', '很喜欢', '超喜欢'].map((label, i) => <button key={label} aria-pressed={enjoyment === i + 1} className={`choice ${enjoyment === i + 1 ? 'selected' : ''}`} onClick={() => setEnjoyment(i + 1)}><span>{i + 1}</span>{label}</button>)}</div></fieldset>
    <fieldset><legend>你想再玩一次这类游戏吗？</legend><div className="choice-row"><button className={`choice ${wantsMore === true ? 'selected' : ''}`} aria-pressed={wantsMore === true} onClick={() => setWantsMore(true)}><Heart size={18}/> 想，再来一次</button><button className={`choice ${wantsMore === false ? 'selected' : ''}`} aria-pressed={wantsMore === false} onClick={() => setWantsMore(false)}>先试试别的</button></div></fieldset>
    <fieldset><legend>{game.id === 'haunted' ? '你喜欢哪种刺激强度？' : '你更喜欢怎样的游玩节奏？'}</legend><div className="choice-row">{[['gentle', '轻松一点'], ['balanced', '适度挑战'], ['intense', '刺激一点']].map(([value, label]) => <button key={value} className={`choice ${comfort === value ? 'selected' : ''}`} aria-pressed={comfort === value} onClick={() => setComfort(value)}>{label}</button>)}</div></fieldset>
    <p className="muted">成绩只是本次表现；喜欢程度由你决定，不给你贴固定标签。</p>
    <div className="action-row"><button className="button-primary" disabled={enjoyment === null || wantsMore === null} onClick={() => onSave({ enjoyment, wantsMore, comfort })}>盖章，记入玩家护照 <ArrowRight size={18}/></button><button className="button-plain" onClick={onDiscard}>不保存本次记录</button></div>
  </div>;
}

function Passport({ profile, setProfile, onTravel, onClear, storageOk }) {
  const [tab, setTab] = useState('recommendations');
  const [confirmClear, setConfirmClear] = useState(false);
  const dimensions = getDimensions(profile);
  const complete = getCompletion(profile);
  return <div className="passport">
    {!storageOk && <p className="storage-warning" role="alert">浏览器未允许本地保存。当前记录只在本次页面会话中保留，刷新或关闭页面可能丢失。</p>}
    <div className="passport-intro"><div className="passport-mark"><Compass size={42}/></div><div><span className="eyebrow">EXPLORER PASSPORT</span><h3>{complete === 0 ? '每一种喜欢，都值得探索' : `已经发现 ${complete} 种玩法`}</h3><p>{complete === 0 ? '先去小镇玩一局，再回来看看你的第一条游戏线索。' : '这是根据你的游玩记录和主观偏好生成的探索建议。'}</p></div></div>
    <div className="stamp-row">{GAMES.map(game => { const played = dimensions.find(d => d.gameId === game.id)?.plays > 0; return <div className={`stamp ${played ? 'earned' : ''}`} key={game.id} style={{ '--game-color': game.color }}><GameIcon id={game.id} size={26}/><span>{game.name}</span><small>{played ? '已探索' : '待发现'}</small></div>; })}</div>
    <div className="tabs" role="tablist" aria-label="护照内容"><button role="tab" aria-selected={tab === 'recommendations'} className={tab === 'recommendations' ? 'active' : ''} onClick={() => setTab('recommendations')}>给你的推荐</button><button role="tab" aria-selected={tab === 'performance'} className={tab === 'performance' ? 'active' : ''} onClick={() => setTab('performance')}>表现与偏好</button><button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>游玩记录</button></div>
    {tab === 'recommendations' && <div role="tabpanel"><MarketRecommendations profile={profile} onTravel={onTravel}/></div>}
    {tab === 'performance' && <div role="tabpanel"><p className="section-note">两列分开看：高分不一定喜欢，低分也可以玩得开心。</p><div className="dimension-head"><span>玩法</span><span>近期表现</span><span>喜欢程度</span></div>{dimensions.map(d => <div className="dimension" key={d.gameId}><div><GameIcon id={d.gameId} size={22}/><strong>{GAME_MAP[d.gameId]?.category || d.label}</strong></div><div>{d.score === null ? <span className="muted">未体验</span> : <><strong>{Math.round(d.score)}<small> / 100</small></strong><div className="score-track"><span style={{ width: `${d.score}%`, background: GAME_MAP[d.gameId].color }}/></div></>}</div><div>{d.enjoyment === null ? '待发现' : <><Heart size={17}/><strong>{d.enjoyment.toFixed(1)}</strong><small> / 5</small></>}</div></div>)}<p className="evidence-note">表现取最近 5 局有效记录的平均分，喜欢程度取最新反馈。不同设备、熟练度和状态都会影响表现。</p></div>}
    {tab === 'history' && <div role="tabpanel">{profile.visits.length ? <ul className="history-list">{[...profile.visits].reverse().map((visit, i) => <li key={visit.id || `${visit.createdAt}-${i}`}><GameIcon id={visit.gameId} size={24}/><div><strong>{GAME_MAP[visit.gameId]?.name}</strong><p>{visit.metrics?.summary || '已完成体验'}</p><small>{new Date(visit.createdAt).toLocaleString('zh-CN')} · {visit.inputDevice === 'touch' ? '触屏' : '键鼠'} · 标准难度</small></div><strong>{Math.round(visit.score)}<span>分</span></strong></li>)}</ul> : <div className="empty-state"><p>还没有游玩记录，出发去探索吧。</p></div>}</div>}
    <footer className="passport-footer"><p><ShieldCheck size={18}/>护照游玩记录仅保存在此浏览器。照片与 AI 服务需另行授权，清除这里的记录不会删除角色工坊作品。</p>{!confirmClear ? <button className="button-plain" onClick={() => setConfirmClear(true)}><Trash2 size={17}/>清除记录</button> : <div className="clear-confirm"><span>清除全部本地游玩记录？</span><button className="button-danger" onClick={onClear}>确认清除</button><button className="button-secondary" onClick={() => setConfirmClear(false)}>取消</button></div>}</footer>
  </div>;
}

export default function App() {
  const multiplayer = useMultiplayer();
  const offshore = useOffshoreCruise({ network: multiplayer });
  const outdoor = useOutdoorPlay();
  const flightRef = useRef({ height: 0, flying: false, thrusting: false, hovering: false });
  const [flying, setFlying] = useState(false);
  const [nearestOutdoor, setNearestOutdoor] = useState(null);
  const [dayNightMode, setDayNightMode] = useState('auto');
  const { timeRef, label: dayNightLabel } = useWorldClock({ network: multiplayer, mode: dayNightMode });
  // Lighting preview is local; residents always follow the shared automatic
  // town clock, so previewing night cannot teleport the multiplayer residents.
  const { timeRef: npcTimeRef } = useWorldClock({ network: multiplayer });
  const drone = useDroneShowController(npcTimeRef);
  const droneWatching = drone.state.active;
  const droneReturn = useRef({ view: 'overview', focus: null });
  const droneDeepLinkOpened = useRef(false);
  const [droneSeats, setDroneSeats] = useState([]);
  const [droneSeatId, setDroneSeatId] = useState('');
  const [droneLookStatus, setDroneLookStatus] = useState('ready');
  const droneLookInput = useRef({});
  const droneRecenter = useRef(0);
  const droneTelemetry = useRef({ altitude: 0, identity: null });
  const [profile, setProfile] = useState(loadProfile);
  const [modal, setModal] = useState(() => {
    const params = new URLSearchParams(window.location.search), wonder = params.get('wonder');
    if (params.get('park') === 'gpt') return { type: 'gpt-park' };
    if (params.get('park') === 'deepseek') return { type: 'deepseek-park' };
    return params.has('town') ? { type: 'multiplayer' } : null;
  });
  const [result, setResult] = useState(null);
  const [nearest, setNearest] = useState(null);
  const [nearestNpc, setNearestNpc] = useState(null);
  const [nearestWonder, setNearestWonder] = useState(null);
  const [destination, setDestination] = useState(() => { const id = new URLSearchParams(window.location.search).get('wonder'); return WONDERS.some(w => w.id === id) ? { id, nonce: 0 } : null; });
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState('');
  const [mapOpen, setMapOpen] = useState(false);
  const [viewMode, setViewMode] = useState(() => ['sphere', 'offshore'].includes(new URLSearchParams(window.location.search).get('landmark')) ? new URLSearchParams(window.location.search).get('landmark') : WONDERS.some(w => w.id === new URLSearchParams(window.location.search).get('wonder')) ? 'wonder' : 'overview');
  const sphereWatching = viewMode === 'sphere';
  const offshoreWatching = viewMode === 'offshore';
  const [offshoreView, setOffshoreView] = useState('director');
  const offshoreReturn = useRef('overview');
  const [sphereMode, setSphereMode] = useState('smile');
  const [sphereOrbit, setSphereOrbit] = useState(false);
  const sphereReturn = useRef('overview');
  const [lookStatus, setLookStatus] = useState('ready');
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const characterRevision = useRef(0);
  const onCharacterChanged = useCallback(character => {
    characterRevision.current += 1;
    setSelectedCharacter(previous => previous?.id === character?.id && previous?.modelUrl === character?.modelUrl && previous?.walkingUrl === character?.walkingUrl && previous?.facing === character?.facing ? previous : character);
  }, []);
  // Model loaders receive only their strict private-asset contract, not job IDs.
  const characterAsset = useMemo(() => selectedCharacter ? { modelUrl: selectedCharacter.modelUrl, walkingUrl: selectedCharacter.walkingUrl, facing: selectedCharacter.facing } : null, [selectedCharacter]);
  const beginExploring = useCallback(() => setViewMode(mode => mode === 'wonder' ? 'first-person' : mode === 'overview' ? 'follow' : mode), []);
  const openAtlas = useCallback(() => { setMapOpen(false); setModal({ type: 'atlas' }); }, []);
  const openWonders = useCallback(() => { inputRef.current = { ...EMPTY_INPUT }; setMapOpen(false); setModal({ type: 'wonders' }); }, []);
  const openAiDrone = useCallback(() => { inputRef.current = { ...EMPTY_INPUT }; document.exitPointerLock?.(); setMapOpen(false); setModal({ type: 'ai-drone' }); }, []);
  const observeWonder = useCallback(id => { if (offshore.runtimeRef.current.aboard) { setToast('请返航靠泊后下船，再前往其他地点。'); return; } if (!WONDERS.some(w => w.id === id)) return; inputRef.current = { ...EMPTY_INPUT }; document.exitPointerLock?.(); setMapOpen(false); setModal(null); setViewMode('wonder'); setDestination({ id, nonce: Date.now() }); }, [offshore.runtimeRef]);
  const openGptPark = useCallback(() => { inputRef.current = { ...EMPTY_INPUT }; document.exitPointerLock?.(); setMapOpen(false); setModal({ type: 'gpt-park' }); }, []);
  const openDeepSeekPark = useCallback(() => { inputRef.current = { ...EMPTY_INPUT }; document.exitPointerLock?.(); setMapOpen(false); setModal({ type: 'deepseek-park' }); }, []);
  const [storageOk, setStorageOk] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const inputRef = useRef({ ...EMPTY_INPUT });
  const openSphere = useCallback(() => { sphereReturn.current = viewMode === 'sphere' ? 'overview' : viewMode; inputRef.current = { ...EMPTY_INPUT }; document.exitPointerLock?.(); outdoor.exit(); setMapOpen(false); setModal(null); setSphereOrbit(false); setViewMode('sphere'); }, [viewMode, outdoor.exit]);
  const closeSphere = useCallback(() => { inputRef.current = { ...EMPTY_INPUT }; setViewMode(sphereReturn.current); requestAnimationFrame(() => document.querySelector('.wonder-nav')?.focus()); }, []);
  const openOffshore = useCallback(() => {
    offshoreReturn.current = ['offshore', 'drone', 'sphere'].includes(viewMode) ? 'overview' : viewMode;
    inputRef.current = { ...EMPTY_INPUT }; document.exitPointerLock?.();
    drone.close(); outdoor.exit(); setModal(null); setMapOpen(false);
    setOffshoreView('director'); setViewMode('offshore');
  }, [viewMode, drone.close, outdoor.exit]);
  const closeOffshore = useCallback(() => {
    inputRef.current = { ...EMPTY_INPUT };
    setViewMode(offshore.runtimeRef.current.aboard ? 'follow' : offshoreReturn.current);
    requestAnimationFrame(() => document.querySelector('.wonder-nav')?.focus());
  }, [offshore.runtimeRef]);
  const openDroneShow = useCallback((program = 'avatar', aiRuntime) => {
    droneReturn.current = { view: viewMode === 'drone' ? 'overview' : viewMode, focus: document.activeElement };
    inputRef.current = { ...EMPTY_INPUT };
    document.exitPointerLock?.();
    outdoor.exit();
    setMapOpen(false); setModal(null); setViewMode('drone');
    const metadata = getDroneProgram(program, aiRuntime);
    drone.start({ program: metadata.ambientOnly ? 'avatar' : metadata.id, aiRuntime });
  }, [viewMode, drone.start, outdoor.exit]);
  const closeDroneShow = useCallback(() => {
    drone.close();
    document.exitPointerLock?.();
    droneLookInput.current = {};
    inputRef.current = { ...EMPTY_INPUT };
    setViewMode(droneReturn.current.view);
    // The schedule dialog may have unmounted since entry. Prefer a live entry.
    requestAnimationFrame(() => {
      const focus = droneReturn.current.focus;
      const visible = element => element && element !== document.body && element.isConnected
        && !element.disabled && !element.closest?.('[inert]') && element.getClientRects?.().length > 0;
      if (visible(focus)) focus.focus?.();
      else {
        const entry = document.querySelector('.drone-town-entry');
        (visible(entry) ? entry : document.querySelector('.wonder-nav'))?.focus();
      }
    });
  }, [drone.close]);
  useEffect(() => {
    if (ready && !droneDeepLinkOpened.current && ['drones', 'droplet', 'carrier-battle'].includes(new URLSearchParams(window.location.search).get('show'))) {
      const params = new URLSearchParams(window.location.search);
      droneDeepLinkOpened.current = true;
      openDroneShow(params.get('show') === 'drones' ? params.get('program') : params.get('show'));
    }
  }, [openDroneShow, ready]);
  const animalPlayer = useRef(null);
  if (!animalPlayer.current) animalPlayer.current = createNpcAnimalPlayer();
  useEffect(() => () => animalPlayer.current?.stop(), []);
  useEffect(() => { if (modal?.type !== 'characters') animalPlayer.current?.stop(); }, [modal?.type]);
  const changeViewMode = useCallback(mode => { inputRef.current = { ...EMPTY_INPUT }; setMapOpen(false); setLookStatus('ready'); setViewMode(mode); }, []);
  const completedIds = GAMES.filter(g => profile.visits.some(v => v.gameId === g.id && v.completed)).map(g => g.id);
  const complete = getCompletion(profile);
  const closeModal = useCallback(() => { animalPlayer.current?.stop(); setModal(null); setResult(null); }, []);
  const startOutdoor = useCallback(id => {
    if (offshore.runtimeRef.current.aboard) { setToast('请返航靠泊后下船，再开始其他活动。'); return; }
    inputRef.current = { ...EMPTY_INPUT }; setMapOpen(false); setModal(null); setResult(null); setViewMode(mode => id === 'jetpack' && mode === 'first-person' ? mode : 'follow');
    if (id === 'jetpack') {
      document.activeElement?.blur?.();
      setToast('自由飞行：长按空格上升，H 悬停／解除；WASD 移动，跟随模式按住右键环视。');
      return;
    }
    outdoor.start(id);
  }, [outdoor.start, offshore.runtimeRef]);
  const sceneReady = useCallback(() => setReady(true), []);
  const skyAppearance = useCallback(() => setToast('抬头看看，天空里出现了一位深空来客。'), []);
  const inspectResidents = useCallback(id => { inputRef.current = { ...EMPTY_INPUT }; void animalPlayer.current.play(id); setMapOpen(false); setModal({ type: 'characters', npcId: typeof id === 'string' && NPC_MAP[id] ? id : null }); }, []);
  const openCharacterStudio = useCallback(() => { inputRef.current = { ...EMPTY_INPUT }; setMapOpen(false); setModal({ type: 'character-studio' }); }, []);
  const enterTownWithCharacter = useCallback(() => { inputRef.current = { ...EMPTY_INPUT }; closeModal(); setMapOpen(false); setViewMode('follow'); setToast('已切换为你的 3D 角色。外观当前仅对自己可见。'); }, [closeModal]);
  const openGame = useCallback(id => { inputRef.current = { ...EMPTY_INPUT }; setResult(null); setModal({ type: 'game', gameId: id }); setMapOpen(false); }, []);
  useEffect(() => { setStorageOk(saveProfile(profile)); }, [profile]);
  useEffect(() => {
    const controller = new AbortController();
    const revision = characterRevision.current;
    // This read must never create a private identity or submit a paid job.
    gameCharacterClient.mine({ signal: controller.signal }).then(data => {
      if (!controller.signal.aborted && characterRevision.current === revision) onCharacterChanged(data.selectedCharacter);
    }).catch(error => {
      if (!controller.signal.aborted && error.status !== 401 && error.name !== 'AbortError') setToast('暂时无法恢复你的角色，可在“我的角色”中重新查看。');
    });
    return () => controller.abort();
  }, [onCharacterChanged]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = event => setReducedMotion(event.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const sync = event => { if (event.key === STORAGE_KEY || event.key === null) setProfile(loadProfile()); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => { if (!toast) return; const timeout = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timeout); }, [toast]);
  useEffect(() => { inputRef.current = { ...EMPTY_INPUT }; }, [modal, mapOpen]);
  useEffect(() => {
    const handleKey = event => {
      if (event.key === 'Escape') setMapOpen(false);
      if (droneWatching || sphereWatching || offshoreWatching || offshore.state.aboard || modal || mapOpen || outdoor.selected || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target?.closest?.('input, textarea, select, button, a, [contenteditable="true"], [role="button"]')) return;
      if (nearestOutdoor && event.key.toLowerCase() === 'e') { event.preventDefault(); startOutdoor(nearestOutdoor); return; }
      if (nearest && event.key.toLowerCase() === 'e') { event.preventDefault(); openGame(nearest); }
      if (nearestNpc && event.key.toLowerCase() === 'f') { event.preventDefault(); inspectResidents(nearestNpc); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [droneWatching, sphereWatching, offshoreWatching, offshore.state.aboard, modal, mapOpen, nearest, nearestNpc, openGame, inspectResidents, outdoor.selected, nearestOutdoor, startOutdoor]);
  const travel = useCallback(id => {
    if (offshore.runtimeRef.current.aboard) { setToast('请返航靠泊后下船，再前往其他地点。'); return; }
    if (!getDestination(id)) return;
    closeModal(); setMapOpen(false); setViewMode(mode => WONDERS.some(w => w.id === id) || mode === 'first-person' ? 'first-person' : 'follow');
    setDestination({ id, nonce: Date.now() });
    const name = GAME_MAP[id]?.name || (id === GPT_PARK.id ? GPT_PARK.name : id === DEEPSEEK_PARK.id ? DEEPSEEK_PARK.name : id === 'sphere' ? '球幕剧场' : id === 'offshore' ? '南岸科考码头' : null) || WONDERS.find(item => item.id === id)?.name || DISTRICTS.find(area => area.id === id)?.name || '中央喷泉广场';
    setToast(`前往${name}${GAME_MAP[id] ? '。到达门口后按 E 进入。' : '，沿街自由探索。'}`);
  }, [closeModal, offshore.runtimeRef]);
  function saveResult(feedback) { setProfile(previous => addVisit(previous, result, feedback)); setResult(null); setModal({ type: 'passport' }); setToast('新印章已收进你的玩家护照。'); }
  function clearData() { const success = clearProfile(); const marketSuccess = clearPreferences(); setProfile({ version: 1, visits: [], dismissed: [] }); setToast(success && marketSuccess ? '本地记录和推荐偏好已清除，重新开始探索吧。' : '当前记录已重置，但浏览器不允许访问全部本地存储。'); closeModal(); }
  function requestJump() { if (!modal && !mapOpen) inputRef.current.jumpRequested = (inputRef.current.jumpRequested || 0) + 1; }
  function requestHover() { if (!modal && !mapOpen && !droneWatching && !outdoor.selected && flying) inputRef.current.hoverToggle = (inputRef.current.hoverToggle || 0) + 1; }
  function directionButton(key, label, Icon) { return <button aria-label={label} className={`direction direction-${key}`} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); beginExploring(); inputRef.current[key] = true; }} onPointerUp={() => { inputRef.current[key] = false; }} onPointerCancel={() => { inputRef.current[key] = false; }} onLostPointerCapture={() => { inputRef.current[key] = false; }} onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { beginExploring(); inputRef.current[key] = true; } }} onKeyUp={() => { inputRef.current[key] = false; }}><Icon size={22}/></button>; }
  return <>
    <header className="topbar" inert={droneWatching || sphereWatching || offshoreWatching || !!modal || !!outdoor.selected}>
      <a className="brand" href="#" onClick={event => { event.preventDefault(); closeModal(); setMapOpen(false); }} aria-label="游戏小镇首页"><span className="brand-symbol"><Gamepad2 size={26}/></span><span>PLAYTOWN<span className="brand-cn">游戏小镇</span></span></a>
      <nav aria-label="主导航">
        <button className={`nav-item wonder-nav ${modal?.type === 'wonders' ? 'active' : ''}`} aria-haspopup="dialog" onClick={openWonders}><Sparkles size={18}/><span>奇观</span></button>
        <button data-town-atlas-entry className={`nav-item ${modal?.type === 'atlas' ? 'active' : ''}`} aria-haspopup="dialog" onClick={openAtlas}><Map size={18}/><span>小镇地图</span></button>
        <button className={`nav-item ${modal?.type === 'passport' ? 'active' : ''}`} aria-haspopup="dialog" onClick={() => setModal({ type: 'passport' })}><Ticket size={18}/><span>玩家护照</span>{complete > 0 && <span className="nav-count">{complete}</span>}</button>
        <button className={`nav-item npc-nav ${modal?.type === 'characters' ? 'active' : ''}`} aria-haspopup="dialog" onClick={() => inspectResidents()}><UsersRound size={18}/><span>小镇居民</span></button>
        <button className={`nav-item character-studio-nav ${modal?.type === 'character-studio' ? 'active' : ''}`} aria-haspopup="dialog" onClick={openCharacterStudio}><UserRound size={18}/><span>我的角色</span></button>
      </nav>
      <MultiplayerStatus multiplayer={multiplayer} onClick={() => { setMapOpen(false); setModal({ type: 'multiplayer' }); }}/><button className="help-button" aria-label="怎么玩" onClick={() => setModal({ type: 'help' })}><HelpCircle size={20}/><span>怎么玩</span></button>
    </header>
    <main className={`town-shell is-${viewMode}${droneWatching && drone.state.view === 'fpv' && !reducedMotion ? ' is-drone-fpv' : ''}${nearestWonder ? ' has-wonder' : ''}${offshore.state.aboard ? ' is-offshore-aboard' : ''}${outdoor.selected ? ' has-outdoor-game' : ''}${flying && !outdoor.selected ? ' is-flying' : ''}`} inert={!!modal} aria-label="游戏小镇探索场景">
      <div className="world-stage"><SceneBoundary><Suspense fallback={null}><Town offshoreRef={offshore.runtimeRef} offshoreView={offshoreView} offshoreAboard={offshore.state.aboard} onOffshoreSelect={openOffshore} sphereMode={sphereMode} sphereOrbit={sphereOrbit} onSphereSelect={openSphere} onSkyAppearance={skyAppearance} suspended={['cinema', 'gpt-park', 'deepseek-park'].includes(modal?.type)} onGptSelect={openGptPark} onDeepSeekSelect={openDeepSeekPark} active={!droneWatching && !sphereWatching && !offshoreWatching && !modal && !mapOpen} droneTimeRef={droneWatching ? drone.timeRef : npcTimeRef} droneFpv={{ aiRuntime: droneWatching ? drone.state.aiRuntime : undefined, program: droneWatching ? drone.state.program : 'avatar', view: drone.state.view, seatId: droneSeatId, onSeatsReady: setDroneSeats, lookInputRef: droneLookInput, recenterRef: droneRecenter, telemetryRef: droneTelemetry, onLookStatus: setDroneLookStatus }} network={multiplayer} inputRef={inputRef} destination={destination} onNearest={setNearest} onReady={sceneReady} reducedMotion={reducedMotion} completedIds={completedIds} onInspectResidents={inspectResidents} viewMode={viewMode} onStartExploring={beginExploring} onLookStatus={setLookStatus} timeRef={droneWatching ? DRONE_NIGHT_TIME : timeRef} npcTimeRef={npcTimeRef} onNearestNpc={setNearestNpc} nearestNpcId={nearestNpc} characterAsset={characterAsset} onNearestWonder={setNearestWonder} outdoorRef={outdoor.runtimeRef} outdoorSelected={outdoor.selected} onOutdoorStart={startOutdoor} onNearestOutdoor={setNearestOutdoor} flightRef={flightRef} onFlyingChange={setFlying}/></Suspense></SceneBoundary></div>
      {offshoreWatching && <Suspense fallback={<p className="sphere-loading" role="status">正在打开远海科考港…</p>}><OffshoreControls controller={offshore} view={offshoreView} onView={setOffshoreView} onClose={closeOffshore} onDock={() => { if (offshore.runtimeRef.current.aboard) { offshore.disembark(); } else { travel('offshore'); } }} reducedMotion={reducedMotion} night={dayNightMode === 'night' || dayNightLabel === '夜晚'} onNight={() => setDayNightMode(dayNightMode === 'night' || dayNightLabel === '夜晚' ? 'day' : 'night')}/></Suspense>}
      {offshore.state.aboard && !offshoreWatching && !droneWatching && !sphereWatching && <button className="offshore-resume" onClick={openOffshore}>船上观景 · 返航 / 离船 ↗</button>}
      {sphereWatching && <Suspense fallback={<p className="sphere-loading" role="status">正在打开球幕观景…</p>}><SphereControls mode={sphereMode} onMode={setSphereMode} orbit={sphereOrbit} onOrbit={setSphereOrbit} onExit={closeSphere} onEnter={() => travel('sphere')} night={dayNightMode === 'night' || dayNightLabel === '夜晚'} onNight={() => setDayNightMode(dayNightMode === 'night' || dayNightLabel === '夜晚' ? 'day' : 'night')} reducedMotion={reducedMotion}/></Suspense>}
      {!outdoor.selected && !droneWatching && <FlightStatus flightRef={flightRef} flying={flying} onToggleHover={requestHover} viewMode={viewMode}/>}
      {!outdoor.selected && !mapOpen && <OutdoorLauncher onStart={startOutdoor} nearest={nearestOutdoor}/>}
      {outdoor.selected && <OutdoorHud key={outdoor.selected} runtimeRef={outdoor.runtimeRef} selected={outdoor.selected} onExit={outdoor.exit} connected={multiplayer.status === 'connected'}/>}
      {!ready && <div className="loading-scene" role="status"><Compass className="loading-spin"/><span>正在搭建你的小镇…</span></div>}
      <section className="town-intro"><span className="eyebrow intro-eyebrow"><span/> 从晨光到星夜 · 随心探索</span><h1>游戏小镇<span className="title-dot">.</span></h1><p>在游玩中，发现你的游戏口味。</p><button className="button-primary explore-button" aria-expanded={mapOpen} aria-controls="town-explore-list" onClick={() => setMapOpen(!mapOpen)}>探索小镇 <ArrowUpRight size={20}/></button>
        <div id="town-explore-list" className={`explore-list ${mapOpen ? 'mobile-open' : ''}`}><div className="explore-list-heading"><h2>小镇探索清单</h2><span>{complete} / 4</span><button className="mobile-list-close icon-button" aria-label="收起探索清单" onClick={() => setMapOpen(false)}><X size={18}/></button></div>{GAMES.map((game, index) => <div className="explore-row" key={game.id}><span className="game-icon" style={{ '--game-color': game.color }}><GameIcon id={game.id} size={22}/></span><button className="explore-name" onClick={() => travel(game.id)} aria-label={`前往${game.name}`}><strong>{game.name}</strong><span>{game.category} · {game.duration}</span></button><button className="visit-button" title={`直接体验${game.name}`} aria-label={`直接体验${game.name}`} onClick={() => openGame(game.id)}>{completedIds.includes(game.id) ? <Check size={20}/> : <ArrowUpRight size={20}/>}</button></div>)}<p className="list-note">自由选择顺序，不必每一项都擅长。</p></div>
        <button className="residents-open" onClick={inspectResidents}><UsersRound size={19}/>认识新朋友 <ArrowUpRight size={16}/></button>
      </section>
      <MapCameraControls viewMode={viewMode} onChange={changeViewMode}/>
      {viewMode === 'first-person' && <FirstPersonOverlay status={lookStatus}/>}
      <DayNightControls mode={dayNightMode} label={dayNightLabel} onChange={setDayNightMode}/>
      <button className="drone-town-entry" aria-haspopup="dialog" onClick={openWonders}><Sparkles size={20} aria-hidden="true"/><span>演出节目单 · 自由选择</span><ArrowUpRight size={18} aria-hidden="true"/></button>
      {droneWatching && <DroneShowControls controller={drone} onClose={closeDroneShow} reducedMotion={reducedMotion} onReducedMotion={setReducedMotion} seats={droneSeats} seatId={droneSeatId} onSeatChange={setDroneSeatId} onRecenter={() => { droneRecenter.current += 1; }} lookStatus={droneLookStatus} telemetryRef={droneTelemetry} lookInputRef={droneLookInput}/>}
      {nearestWonder && !modal && !mapOpen && viewMode !== 'overview' && <Suspense fallback={null}><WonderHud id={nearestWonder} timeRef={npcTimeRef} onOpen={openWonders} reducedMotion={reducedMotion} observing={viewMode === 'wonder'} onObserve={() => changeViewMode(viewMode === 'wonder' ? 'first-person' : 'wonder')}/></Suspense>}
      <div className="compass-mark" aria-hidden="true"><span>N</span><Compass size={42}/></div>
      <div className="journey-widget"><button className="journey-button" onClick={() => setModal({ type: 'passport' })}><span className="journey-icon"><Flag size={22}/></span><span><strong>我的探索旅程</strong><span>{complete === 0 ? '你的第一枚印章，等你来拿' : `${complete} / 4 个地点已探索`}</span></span><ChevronRight size={20}/></button><div className="journey-stamps">{GAMES.map(g => <span key={g.id} className={completedIds.includes(g.id) ? 'done' : ''} title={`${g.name}：${completedIds.includes(g.id) ? '已探索' : '待探索'}`}><GameIcon id={g.id} size={20}/></span>)}<span className="journey-line"/></div></div>
      {nearest && !nearestNpc && !modal && viewMode !== 'overview' && <div className="nearby-prompt"><span className="nearby-icon" style={{ '--game-color': GAME_MAP[nearest].color }}><GameIcon id={nearest} size={24}/></span><div><strong>{GAME_MAP[nearest].name}</strong><span>{GAME_MAP[nearest].subtitle}</span></div><button className="button-primary" onClick={() => openGame(nearest)}><kbd>E</kbd> 进入体验</button></div>}
      {nearestNpc && NPC_MAP[nearestNpc] && !modal && !mapOpen && viewMode !== 'overview' && <div className="nearby-prompt npc-nearby-prompt"><img src={NPC_MAP[nearestNpc].portrait} alt=""/><div><strong>{NPC_MAP[nearestNpc].name}</strong><span>{NPC_MAP[nearestNpc].role}</span></div><button className="button-primary" onClick={() => inspectResidents(nearestNpc)}><kbd>F</kbd> 聊一聊</button></div>}
      <div className="world-controls"><div className="keyboard-hint"><span className="key-group"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>移动</span><span className="control-divider"/><kbd>空格</kbd><span>跳跃 / 长按喷气</span><kbd>H</kbd><span>悬停</span>{viewMode === 'follow' && <span>按住右键环视</span>}<span className="control-divider"/><kbd>E</kbd><span>进入店铺</span></div><button className="button-plain reset-view" onClick={() => travel('center')}><RotateCcw size={17}/>回到广场</button></div>
      <div className="touch-controls" aria-label="人物移动控制">{directionButton('forward', '向前移动', ArrowUp)}{directionButton('left', '向左移动', ArrowLeft)}{directionButton('backward', '向后移动', ArrowDown)}{directionButton('right', '向右移动', ArrowRight)}</div>
      <button className="mobile-jump-button" aria-label="跳跃" aria-description="轻点跳跃，长按喷气，松开下落" title="轻点跳跃，长按喷气，松开下落" onPointerDown={event => { event.preventDefault(); event.currentTarget?.setPointerCapture?.(event.pointerId); requestJump(); if (!modal && !mapOpen) inputRef.current.jetHeld = true; }} onPointerUp={() => { inputRef.current.jetHeld = false; }} onPointerCancel={() => { inputRef.current.jetHeld = false; }} onLostPointerCapture={() => { inputRef.current.jetHeld = false; }} onBlur={() => { inputRef.current.jetHeld = false; }} onKeyDown={event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); if (!event.repeat) { requestJump(); inputRef.current.jetHeld = true; } } }} onKeyUp={() => { inputRef.current.jetHeld = false; }} onClick={event => { if (event.detail === 0) requestJump(); }}><ArrowUp size={22} aria-hidden="true"/>{flying ? '长按上升' : '跳跃 / 喷气'}</button>
      <button className="mobile-map-button button-secondary" onClick={openAtlas}><MapPin size={20}/>街区导览</button>
      <div className="local-note"><ShieldCheck size={15}/>{storageOk ? '本机记录 · 随时可清除' : '仅本次会话 · 本地存储不可用'}</div>
    </main>
    <div className="toast-container" aria-live="polite">{toast && <div className="toast"><Check size={19}/>{toast}</div>}</div>
    {modal?.type === 'atlas' && <Dialog wide title="小镇街区导览" eyebrow="TOWN PLAN / TOWN + WONDERS" onClose={closeModal}><Suspense fallback={<p role="status">正在打开小镇地图…</p>}><TownAtlas onTravel={travel} onOutdoorStart={startOutdoor} onGptTour={openGptPark} onDeepSeekTour={openDeepSeekPark} onSphereTour={openSphere} onOffshoreTour={openOffshore}/></Suspense></Dialog>}
    {modal?.type === 'gpt-park' && <GptEntryBoundary onClose={closeModal}><Suspense fallback={<Dialog title="GPT 主题园区" onClose={closeModal}><p role="status">正在打开 GPT 园区…</p></Dialog>}><GptParkExperience onClose={closeModal} onEnterTown={() => travel('gpt')} reducedMotion={reducedMotion}/></Suspense></GptEntryBoundary>}
    {modal?.type === 'deepseek-park' && <DeepSeekEntryBoundary onClose={closeModal}><Suspense fallback={<Dialog title="DeepSeek 主题园区" onClose={closeModal}><p role="status">正在打开 DeepSeek 园区…</p></Dialog>}><DeepSeekParkExperience onClose={closeModal} onEnterTown={() => travel(DEEPSEEK_PARK.id)} reducedMotion={reducedMotion}/></Suspense></DeepSeekEntryBoundary>}
    {modal?.type === 'wonders' && <Dialog wide title="奇观时刻" eyebrow="PLAYTOWN / ONE CONNECTED WORLD" onClose={closeModal}><Suspense fallback={<p role="status">正在打开奇观时刻…</p>}><WonderSchedule onOffshore={openOffshore} onSphere={openSphere} onDroneShow={openDroneShow} onAiDrone={openAiDrone} onImmerse={observeWonder} timeRef={npcTimeRef} onTravel={travel} reducedMotion={reducedMotion} onReducedMotion={setReducedMotion}/></Suspense></Dialog>}
    {modal?.type === 'ai-drone' && <Dialog wide title="AI 演出导演" eyebrow="PLAYTOWN / SKY STUDIO" onClose={closeModal}><Suspense fallback={<p role="status">正在打开天空创作台…</p>}><AiDroneStudio onClose={closeModal} onPlay={runtime => openDroneShow('ai', runtime)}/></Suspense></Dialog>}
    {modal?.type === 'characters' && <Dialog wide title="小镇居民" eyebrow="MEET THE RESIDENTS" onClose={closeModal}><Suspense fallback={<p role="status">正在打开居民名册…</p>}><NpcDirectory key={modal.npcId || 'directory'} initialNpcId={modal.npcId} timeRef={npcTimeRef} animalPlayer={animalPlayer.current}/></Suspense></Dialog>}
    {modal?.type === 'character-studio' && <Dialog wide title="我的 3D 角色" eyebrow="CHARACTER STUDIO / PRIVATE" onClose={closeModal}><CharacterStudioBoundary><Suspense fallback={<p className="character-entry-message" role="status">正在打开角色工坊…</p>}><CharacterStudio onCharacterChanged={onCharacterChanged} onEnterTown={enterTownWithCharacter}/></Suspense></CharacterStudioBoundary></Dialog>}
    {modal?.type === 'multiplayer' && <Dialog title="同游小镇" eyebrow="INVITE YOUR FRIENDS" onClose={closeModal}><MultiplayerPanel multiplayer={multiplayer} onContinue={closeModal}/></Dialog>}
    {modal?.type === 'game' && <Dialog wide title={result ? '收获你的游戏线索' : GAME_MAP[modal.gameId].name} eyebrow={result ? 'A NEW DISCOVERY' : `${GAME_MAP[modal.gameId].category} / 标准难度`} onClose={closeModal}>{result ? <Feedback key={modal.gameId} result={result} onSave={saveResult} onDiscard={closeModal}/> : <Suspense fallback={<p role="status">正在打开小游戏…</p>}><MiniGame key={modal.gameId} gameId={modal.gameId} onComplete={setResult} onExit={closeModal}/></Suspense>}</Dialog>}
    {modal?.type === 'passport' && <Dialog wide title="我的玩家护照" eyebrow="每一次游玩，都是一条线索" onClose={closeModal}><Passport profile={profile} setProfile={setProfile} onTravel={travel} onClear={clearData} storageOk={storageOk}/></Dialog>}
    {modal?.type === 'help' && <Dialog title="欢迎来到游戏小镇" onClose={closeModal}><div className="help-content"><p>这不是一场考试。选一家你感兴趣的店铺，玩一局，再看看自己喜欢什么。</p><ol><li><strong>在小镇里走走</strong><p>默认鸟瞰整座小镇；WASD、方向键或手机方向按钮会切入跟随漫游。跟随人物模式可按住鼠标右键环视，移动方向随镜头变化。也可选择“近距第三人称”，看见角色并从身后观察；点击场景开启鼠标环视，按 Esc 释放鼠标，触屏可拖动画面环视。轻点空格或手机按钮跳跃；任意位置长按空格或手机按钮即可启动喷气背包，不设飞行高度上限。空中按 H 或点击“悬停”锁定当前高度，再按一次解除；重新按空格继续上升，未悬停时松开下落。WASD / 方向按钮控制空中移动，可飞到无人机附近自由观看。昼夜每 3 分钟循环，也可在时段菜单仅为自己预览白天或夜晚。点击“小镇地图”查看街道、空地与场馆，或直接前往街区和中央喷泉。</p></li><li><strong>靠近店铺，进入体验</strong><p>按 E 或点击“进入体验”。也可以点击清单右侧箭头直接试玩。每项游戏都有开始前的操作说明。</p></li><li><strong>和居民聊一聊</strong><p>16 位居民按小镇时间散步、工作与休息。靠近后按 F 或点击“聊一聊”，也可点击角色或导航栏“小镇居民”查看原图头像与公开对话。昼夜预览只改变画面，不改变居民作息；居民任务和奖励暂未开放。</p></li><li><strong>记下喜欢，而不只是分数</strong><p>完成后回答喜欢程度与重玩意愿，玩家护照会生成有依据的游戏类型推荐。</p></li></ol><div className="safety-note"><ShieldCheck size={24}/><p>鬼屋是温和的寻物体验，没有突然惊吓。随时关闭或退出，不会被记录为失败，也不代表真实胆量。</p></div><label className="setting-row"><span>减少场景动态效果</span><input type="checkbox" checked={reducedMotion} onChange={event => setReducedMotion(event.target.checked)}/></label><p className="muted">MVP 采用透明规则推荐，不使用心理诊断或未经验证的人格分数。游玩记录仅保存在此浏览器；照片与 AI 服务需在对应功能中另行授权。</p><button className="button-primary" onClick={closeModal}>知道了，去逛逛 <ArrowRight size={18}/></button></div></Dialog>}
  </>;
}
