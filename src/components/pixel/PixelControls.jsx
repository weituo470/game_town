import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, X, Box, Hammer, Backpack, Pause, Play, Save, Download, Upload, RotateCcw, HelpCircle, Home, Navigation, Check, Sun, Moon } from 'lucide-react';
import { BLOCK_BY_ID, HOTBAR, RECIPES } from '../../../shared/pixel-world.js';
import './pixel.css';

const EMPTY = Object.freeze({ phase: 'overview', mode: 'collect', selected: 0, inventory: {}, panel: null, stats: { mined: 0, placed: 0, crafted: 0 }, saveStatus: '正在读取本机世界…', message: '', miningProgress: 0, locked: false });
const noopSubscribe = () => () => {};

function BlockIcon({ id, large = false }) {
  const block = BLOCK_BY_ID[id];
  return <span aria-hidden="true" className={`pixel-block-icon${large ? ' is-large' : ''}`} style={{ '--block-color': block?.color || '#b9a084' }}><i/><b/></span>;
}

function PixelPanel({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const items = [...(ref.current?.querySelectorAll('button:not([disabled]),input,a[href]') || [])].filter(item => item.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement))) { last.focus(); event.preventDefault(); }
      else if (!event.shiftKey && (document.activeElement === last || !items.includes(document.activeElement))) { first.focus(); event.preventDefault(); }
    };
    ref.current?.addEventListener('keydown', key);
    const el = ref.current;
    return () => { el?.removeEventListener('keydown', key); previous?.isConnected && previous.focus?.(); };
  }, [onClose]);
  return <div className="pixel-panel-backdrop"><section ref={ref} className="pixel-panel" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}><header><div><span>VOXEL WORKSHOP</span><h2>{title}</h2></div><button type="button" onClick={onClose} aria-label="关闭面板"><X size={20}/></button></header><div className="pixel-panel-body">{children}</div></section></div>;
}

function HoldButton({ runtime, input, label, children }) {
  return <button type="button" aria-label={label} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); runtime?.setInput(input, true); }} onPointerUp={() => runtime?.setInput(input, false)} onPointerCancel={() => runtime?.setInput(input, false)} onLostPointerCapture={() => runtime?.setInput(input, false)} onBlur={() => runtime?.setInput(input, false)}>{children}</button>;
}

export default function PixelControls({ runtime, onClose, day, onDay }) {
  const subscribe = useCallback(callback => runtime ? runtime.subscribe(callback) : noopSubscribe(), [runtime]);
  const getSnapshot = useCallback(() => runtime ? runtime.getSnapshot() : EMPTY, [runtime]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [fileError, setFileError] = useState('');
  const fileInput = useRef(null), hotbar = useRef(null);
  const playing = state.phase === 'playing', overview = state.phase === 'overview';
  const closePanel = useCallback(() => { setResetConfirm(false); runtime?.togglePanel(null); }, [runtime]);
  const start = mode => { runtime?.start(mode); runtime?.requestLock?.(); };
  const resume = () => { runtime?.resume(); runtime?.requestLock?.(); };
  const leave = () => { runtime?.save(); runtime?.deactivate?.(); onClose(); };
  useEffect(() => { hotbar.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [state.selected]);
  useEffect(() => {
    setFileError(''); setResetConfirm(false);
  }, [state.panel]);
  const download = () => {
    if (!runtime) return;
    const blob = new Blob([runtime.exportSave()], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `playtown-pixel-island-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importFile = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (file.size > 10_000_000) { setFileError('世界文件不能超过 10 MB。'); return; }
    try {
      const ok = runtime?.importSave(await file.text());
      if (!ok) setFileError(runtime?.getSnapshot().message || '无法导入这个世界文件。');
      else setFileError('');
    } catch { setFileError('文件读取失败，原世界没有被替换。'); }
  };
  return <section className={`pixel-controls${overview ? ' is-overview' : ''}${state.panel ? ' has-panel' : ''}`} aria-label="方块原野游戏控制">
    <header className="pixel-heading"><span>PLAYTOWN / VOXEL FRONTIER</span><h1>方块原野<span>像素岛</span></h1><p>{overview ? '把一座岛，搭成你的世界。' : `${state.mode === 'creative' ? '自由创造 · 无限方块' : '采集建造 · 挖掘与合成'}${state.flying ? ' · 飞行中' : ''}`}</p></header>
    <div className="pixel-top-actions">
      {!overview && <button type="button" onClick={() => runtime?.togglePanel('craft')}><Backpack size={19}/><span>背包 / 合成</span><kbd>E</kbd></button>}
      {!overview && <button type="button" onClick={() => runtime?.pause()} aria-label="暂停游戏"><Pause size={19}/></button>}
      <button type="button" onClick={leave}><X size={19}/><span>返回小镇</span></button>
    </div>
    {overview ? <div className="pixel-welcome">
      <div className="pixel-welcome-copy"><span className="pixel-chapter">01 / YOUR FIRST BLOCK</span><h2>从第一块木头开始。</h2><p>穿过树林，挖开矿脉。把收集的材料，变成只属于你的房子。</p></div>
      <div className="pixel-welcome-actions"><button type="button" className="pixel-primary" disabled={!runtime} onClick={() => start('collect')}><Hammer size={20}/>采集建造<ArrowRight size={19}/></button><button type="button" disabled={!runtime} onClick={() => start('creative')}><Box size={20}/>自由创造</button><button type="button" onClick={() => runtime?.togglePanel('save')} disabled={!runtime}><Save size={19}/>世界存档</button></div>
      <div className="pixel-welcome-foot"><span>单人沙盒 · 仅本机存档 · 不与房间同步</span><button type="button" onClick={() => runtime?.togglePanel('help')}><HelpCircle size={18}/>操作说明</button><button type="button" onClick={onDay}>{day ? <Moon size={18}/> : <Sun size={18}/>} {day ? '看看夜景' : '回到白昼'}</button></div>
    </div> : <>
      {playing && !state.panel && <div className="pixel-aim" aria-hidden="true"><span className="pixel-crosshair"/><div className="pixel-mining-track"><i style={{ width: `${Math.max(0, Math.min(1, state.miningProgress || 0)) * 100}%` }}/></div>{state.target && <span className="pixel-target-name">{state.target.name || BLOCK_BY_ID[state.target.id]?.name}</span>}</div>}
      <div className="pixel-play-info"><span className="pixel-scope">单人沙盒 · 仅本机保存</span><span className="pixel-storage-status"><Check size={16}/>{state.saveStatus || '自动保存开启'}</span><button type="button" onClick={() => runtime?.togglePanel('save')}><Save size={18}/>存档与备份</button><button type="button" onClick={() => runtime?.togglePanel('help')}><HelpCircle size={18}/>帮助</button></div>
      <div className="pixel-hotbar-area"><p className="pixel-desktop-hint">WASD 移动 · 空格跳跃 · 长按左键挖掘 · 右键放置 · 1–9 / 滚轮选材{state.mode === 'creative' ? ' · F 飞行' : ''}</p><div ref={hotbar} className="pixel-hotbar" role="group" aria-label="九格方块快捷栏">{HOTBAR.map((id, index) => <button type="button" key={id} className="pixel-slot" aria-pressed={state.selected === index} aria-label={`${index + 1} ${BLOCK_BY_ID[id]?.name}，${state.mode === 'creative' ? '无限' : (state.inventory[id] || 0)}块`} onClick={() => runtime?.select(index)}><span className="pixel-slot-key">{index + 1}</span><BlockIcon id={id}/><span className="pixel-slot-count">{state.mode === 'creative' ? '∞' : (state.inventory[id] || 0)}</span><span className="pixel-slot-name">{BLOCK_BY_ID[id]?.name}</span></button>)}</div><span className="pixel-selected-name">{BLOCK_BY_ID[HOTBAR[state.selected]]?.name} · {state.mode === 'creative' ? '无限供应' : `库存 ${state.inventory[HOTBAR[state.selected]] || 0}`}</span></div>
      {playing && !state.locked && !state.panel && <button type="button" className="pixel-lock-hint" onClick={resume}><Navigation size={19}/>拖动环视 · 长按不移动挖掘</button>}
      {state.phase === 'paused' && !state.panel && <div className="pixel-pause"><span className="pixel-chapter">TAKE A BREATH</span><h2>世界等你回来。</h2><p>操作已暂停，你的建造会自动保留。</p><button type="button" className="pixel-primary" onClick={resume}><Play size={19}/>继续探索</button><button type="button" onClick={() => runtime?.action('home')}><Home size={19}/>回到营地</button><button type="button" onClick={() => runtime?.togglePanel('save')}><Save size={19}/>存档与备份</button><button type="button" onClick={() => start(state.mode === 'creative' ? 'collect' : 'creative')}><Box size={19}/>{state.mode === 'creative' ? '切回采集建造' : '切换自由创造'}</button></div>}
      {playing && !state.panel && <div className="pixel-touch-controls" aria-label="触屏操作"><div className="pixel-touch-move"><HoldButton runtime={runtime} input="forward" label="向前"><ArrowUp/></HoldButton><HoldButton runtime={runtime} input="left" label="向左"><ArrowLeft/></HoldButton><HoldButton runtime={runtime} input="backward" label="向后"><ArrowDown/></HoldButton><HoldButton runtime={runtime} input="right" label="向右"><ArrowRight/></HoldButton></div><div className="pixel-touch-actions"><button type="button" onClick={() => runtime?.action('jump')}>跳跃</button><HoldButton runtime={runtime} input="mine" label="长按挖掘">挖掘</HoldButton><button type="button" onClick={() => runtime?.action('place')}>放置</button>{state.mode === 'creative' && <button type="button" aria-pressed={!!state.flying} onClick={() => runtime?.action('fly')}>飞行</button>}{state.flying && <><HoldButton runtime={runtime} input="ascend" label="上升">上升</HoldButton><HoldButton runtime={runtime} input="descend" label="下降">下降</HoldButton></>}</div></div>}
    </>}
    {!!state.message && <div className="pixel-message" role="status">{state.message}</div>}
    {state.panel === 'craft' && <PixelPanel title="背包与合成" onClose={closePanel}><p>采集木头和岩石，再把原料变成建材。自由创造模式无需消耗库存。</p><div className="pixel-inventory" aria-label="材料库存">{Object.entries(state.inventory).filter(([id, count]) => count > 0 && BLOCK_BY_ID[id]).map(([id, count]) => <div key={id}><BlockIcon id={Number(id)}/><span>{BLOCK_BY_ID[id].name}</span><strong>{count}</strong></div>)}</div><h3>工作台</h3><div className="pixel-recipes">{RECIPES.map(recipe => { const possible = Object.entries(recipe.inputs).every(([id, count]) => (state.inventory[id] || 0) >= count); return <div key={recipe.id}><BlockIcon id={recipe.output.id}/><div><strong>{recipe.name}</strong><span>{Object.entries(recipe.inputs).map(([id, count]) => `${BLOCK_BY_ID[id]?.name} × ${count}`).join(' + ')} → {BLOCK_BY_ID[recipe.output.id]?.name} × {recipe.output.count}</span></div><button type="button" disabled={!possible} onClick={() => runtime?.craft(recipe.id)}><Hammer size={18}/>合成</button></div>; })}</div></PixelPanel>}
    {state.panel === 'save' && <PixelPanel title="保存你的原野" onClose={closePanel}><p>世界与背包只保存在当前浏览器，不会上传到服务器。换设备、清理浏览器前，请先导出 JSON 备份。</p><div className="pixel-save-line"><Save size={23}/><strong>{state.saveStatus || '自动保存开启'}</strong></div><div className="pixel-save-actions"><button type="button" className="pixel-primary" onClick={() => runtime?.save()}><Save size={19}/>立即保存</button><button type="button" onClick={download}><Download size={19}/>导出世界</button><button type="button" onClick={() => fileInput.current?.click()}><Upload size={19}/>导入备份</button><input ref={fileInput} type="file" accept=".json,application/json" className="pixel-file-input" onChange={importFile} tabIndex={-1} aria-label="选择像素岛世界备份"/></div><p>导入将替换当前本机世界，请先备份现有作品。仅接受本游戏导出的有效世界文件。</p>{fileError && <p role="alert" className="pixel-error">{fileError}</p>}<div className="pixel-reset"><h3>重新开始</h3><p>这会清除本机方块改动和库存，不影响小镇其他玩法。</p>{!resetConfirm ? <button type="button" onClick={() => setResetConfirm(true)}><RotateCcw size={19}/>重建原始岛屿</button> : <div><strong>确定重建？当前作品会被替换。</strong><button type="button" className="pixel-danger" onClick={() => { runtime?.reset(); setResetConfirm(false); }}>确认重建</button><button type="button" onClick={() => setResetConfirm(false)}>保留作品</button></div>}</div></PixelPanel>}
    {state.panel === 'help' && <PixelPanel title="第一块方块指南" onClose={closePanel}><p>这是同一座小镇中的单人体素沙盒。你可以采集、合成、造屋，也可以自由飞行搭建；本机改动不会影响其他玩家。</p><dl className="pixel-help-list">{[['移动与观察','WASD 移动，点击场景锁定鼠标环视；Esc 释放鼠标并暂停。浏览器不支持鼠标锁定时，拖动环视，长按不移动挖掘。触屏拖动场景环视，使用方向按钮移动。'],['挖掘与放置','准星对准方块，长按左键挖掘，右键放置。最远可操作 8 米，基岩不可破坏，也不能把方块放进自己身体里。'],['切换材料','1–9 或滚轮切换九格快捷栏；点击格子也可以选材。E 打开背包与合成，木头可以做木板，岩石可以做砌石。'],['跳跃与飞行','空格跳跃；自由创造模式按 F 切换飞行，空格上升，Shift 下降。采集模式不提供无限飞行。'],['保存与回营','方块修改会自动本机保存；可导出 JSON 备份。在暂停菜单点“回到营地”可以脱困，不会清除建筑。']].map(([title, text]) => <div key={title}><dt>{title}</dt><dd>{text}</dd></div>)}</dl><p className="pixel-boundary-note">原创方块与纹理；不包含《我的世界》的专有素材。首版未包含怪物、红石或多人共享建造。</p></PixelPanel>}
  </section>;
}
