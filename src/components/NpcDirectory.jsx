import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, MapPin, MessageCircle, Search, Square, Users, Volume2 } from 'lucide-react';
import { NPCS, NPC_MAP } from '../lib/npcCatalog.js';
import { getNpcAnimalCue } from '../lib/npcAnimalPlayer.js';
import { sampleNpc } from '../../shared/npcSimulation.js';
import NpcChat from './NpcChat.jsx';
import './npc-directory.css';

function useActivity(id, timeRef) {
  const [activity, setActivity] = useState(() => id ? sampleNpc(id, timeRef?.current ?? 0) : null);
  useEffect(() => {
    if (!id) { setActivity(null); return undefined; }
    const update = () => setActivity(sampleNpc(id, timeRef?.current ?? 0));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [id, timeRef]);
  return activity;
}

// The directory is intentionally available remotely, including while residents
// rest. It does not claim to accept quests, sell goods, or award any currency.
export default function NpcDirectory({ initialNpcId = null, timeRef, animalPlayer }) {
  const [selectedId, setSelectedId] = useState(NPC_MAP[initialNpcId] ? initialNpcId : null);
  const [topicId, setTopicId] = useState('greeting');
  const [query, setQuery] = useState('');
  const [canStickPortrait, setCanStickPortrait] = useState(false);
  const [animalState, setAnimalState] = useState(() => animalPlayer?.getState());
  const heading = useRef(null);
  const directory = useRef(null);
  const lastSelectedId = useRef(null);
  const chatSessions = useRef(new Map());
  const speechPreference = useRef({ enabled: true });
  const searchId = useId();
  const selected = NPC_MAP[selectedId] ?? null;
  const animalCue = getNpcAnimalCue(selectedId);
  const animalPlaying = animalState?.npcId === selectedId && ['loading', 'playing'].includes(animalState.status);
  const activity = useActivity(selected?.id, timeRef);
  const topic = selected?.dialogue.topics.find(item => item.id === topicId);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const residents = NPCS.filter(npc => `${npc.name} ${npc.role} ${npc.species}`.toLocaleLowerCase().includes(normalizedQuery));

  useEffect(() => animalPlayer?.subscribe(setAnimalState), [animalPlayer]);

  useEffect(() => {
    setSelectedId(NPC_MAP[initialNpcId] ? initialNpcId : null);
    setTopicId('greeting');
  }, [initialNpcId]);

  useEffect(() => {
    if (selectedId) {
      heading.current?.focus({ preventScroll: true });
      heading.current?.closest('.dialog')?.scrollTo({ top: 0 });
      lastSelectedId.current = selectedId;
    } else if (lastSelectedId.current) {
      directory.current?.querySelector(`[data-npc-id="${lastSelectedId.current}"]`)?.focus({ preventScroll: true });
    }
  }, [selectedId]);

  useEffect(() => {
    const root = directory.current;
    const dialog = root?.closest('.dialog');
    const dialogHeading = dialog?.querySelector('.dialog-heading');
    const portrait = root?.querySelector('.npc-profile-visual');
    if (!dialog || !dialogHeading || !portrait) { setCanStickPortrait(false); return undefined; }
    const measure = () => {
      const headerHeight = dialogHeading.getBoundingClientRect().height;
      root.style.setProperty('--npc-dialog-heading-height', `${Math.ceil(headerHeight)}px`);
      setCanStickPortrait(window.innerWidth >= 701 && portrait.offsetHeight + headerHeight + 32 <= dialog.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dialog);
    observer.observe(dialogHeading);
    observer.observe(portrait);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [selectedId]);

  function openResident(id) {
    void animalPlayer?.play(id);
    setTopicId('greeting');
    setSelectedId(id);
  }

  function chooseTopic(id) {
    setTopicId(id);
    if (animalCue) void animalPlayer?.play(selectedId);
  }

  function openFreeChat() {
    const chat = directory.current?.querySelector('.npc-chat');
    const dialog = directory.current?.closest('.dialog');
    if (!chat || !dialog) return;
    const input = chat.querySelector('textarea:not(:disabled)');
    const headerHeight = dialog.querySelector('.dialog-heading')?.getBoundingClientRect().height ?? 0;
    const availableHeight = dialog.clientHeight - headerHeight - 32;
    const fitsComposer = !input || input.getBoundingClientRect().bottom - chat.getBoundingClientRect().top < availableHeight;
    const target = fitsComposer ? chat : input.closest('form');
    dialog.scrollTo({ top: dialog.scrollTop + target.getBoundingClientRect().top - dialog.getBoundingClientRect().top - headerHeight - 16, behavior: 'instant' });
    (input ?? chat).focus({ preventScroll: true });
  }

  return <section className="npc-directory" ref={directory} aria-label="小镇居民">
    {!selected ? <>
      <div className="npc-directory-intro">
        <div>
          <span className="npc-kicker"><Users size={17} aria-hidden="true" /> 16 位新邻居</span>
          <h3>认识小镇里的每一个人</h3>
          <p>有人照料花园，有人沿街送货。选一位邻居聊聊，也可以走近他们按 F 打招呼。</p>
        </div>
        <label className="npc-search" htmlFor={searchId}>
          <Search size={19} aria-hidden="true" />
          <span className="npc-visually-hidden">按姓名或职业搜索居民</span>
          <input id={searchId} type="search" value={query} placeholder="姓名或职业" onChange={event => setQuery(event.target.value)} autoComplete="off" />
        </label>
      </div>
      <div className="npc-directory-grid">
        {residents.map(npc => <button key={npc.id} className="npc-resident-card" data-npc-id={npc.id}
          onClick={() => openResident(npc.id)} aria-label={`与${npc.name}聊天，${npc.role}`}>
          <img src={npc.portrait} alt="" loading="lazy" width="320" height="320" />
          <span className="npc-resident-card-copy">
            <span className="npc-resident-card-title"><strong>{npc.name}</strong><ArrowUpRight size={19} aria-hidden="true" /></span>
            <span className="npc-resident-card-role">{npc.role}</span>
          </span>
        </button>)}
      </div>
      {residents.length === 0 && <div className="npc-empty" role="status">
        <p>没有找到这位邻居，试试名字或“花园”“修理”等职业。</p>
        <button className="button-secondary" onClick={() => setQuery('')}>显示所有居民</button>
      </div>}
      <p className="npc-directory-note">镇中形象是轻量 3D 演绎；开源居民册使用原创几何示意头像，不包含原参考图片。当前支持漫游与对话，职业场所和委托任务尚未开放。</p>
    </> : <>
      <button className="npc-back" onClick={() => { animalPlayer?.stop(); setSelectedId(null); }}><ArrowLeft size={18} aria-hidden="true" /> 返回居民册</button>
      <div className="npc-conversation-layout">
        <div className="npc-profile-visual" data-sticky={canStickPortrait}>
          <img className="npc-profile-portrait" src={selected.portrait} alt={`${selected.name}的原创示意头像`} width="480" height="480" />
          <span className="npc-profile-caption">原创几何示意头像 · 开源版</span>
          <div className="npc-current-activity">
            <span className="npc-kicker">此刻在小镇</span>
            <strong>{activity?.activityLabel ?? '在小镇休息'}</strong>
            <span className="npc-activity-location"><MapPin size={16} aria-hidden="true" /> {activity?.locationLabel ?? '小镇公共街区'}</span>
          </div>
        </div>
        <div className="npc-profile-details">
          <span className="npc-kicker">{selected.role}</span>
          <h3 ref={heading} tabIndex={-1} className="npc-profile-name">{selected.name}</h3>
          <p className="npc-profile-description">{selected.description}</p>
          {animalCue ? <div className="npc-animal-interaction">
            <div className="npc-animal-actions">
              <button type="button" className="npc-chat-shortcut" onClick={() => chooseTopic('greeting')}><Volume2 size={18} aria-hidden="true" /> 再打个招呼</button>
              {animalPlaying && <button type="button" className="npc-animal-stop" onClick={() => animalPlayer?.stop()}><Square size={16} aria-hidden="true" /> 停止叫声</button>}
            </div>
            <p className="npc-animal-status" role="status">{animalState?.npcId === selectedId && animalState.error ? animalState.error : animalPlaying ? `${selected.name}正在用${animalCue.label}回应你。` : animalState?.npcId === selectedId && animalState.status === 'ended' ? `${selected.name}已经用叫声打过招呼啦。` : `与${selected.name}打招呼，会直接播放${animalCue.label}。`}</p>
            <p className="npc-animal-note">宠物用叫声回应，不调用 AI 或语音生成服务。下方文字是固定角色设定，不是叫声翻译。</p>
          </div> : <button type="button" className="npc-chat-shortcut" onClick={openFreeChat}><MessageCircle size={18} aria-hidden="true" /> 自由聊天</button>}
          <div className="npc-dialogue" aria-live="polite" aria-atomic="true">
            <span className="npc-dialogue-speaker"><MessageCircle size={18} aria-hidden="true" /> {selected.name}说 · 固定台词</span>
            <p>{topic?.text ?? selected.dialogue.greeting}</p>
            {topicId === 'place' && <p className="npc-place-note">这是角色设定中的「{selected.locationHint}」；对应职业场所尚未开放，可先在上方标注的公共街区与居民相遇。</p>}
          </div>
          <div className="npc-topic-buttons" role="group" aria-label={`和${selected.name}聊什么`}>
            <button aria-pressed={topicId === 'greeting'} onClick={() => chooseTopic('greeting')}>打个招呼</button>
            {selected.dialogue.topics.map(item => <button key={item.id} aria-pressed={topicId === item.id} onClick={() => chooseTopic(item.id)}>
              {item.id === 'place' ? '聊聊工作间设想' : item.label}
            </button>)}
          </div>
          <p className="npc-conversation-note">居民册可随时聊天，不会接取任务、购买物品或发放金币。</p>
          {!animalCue && <NpcChat key={selected.id} npcId={selected.id} npcName={selected.name} sessions={chatSessions.current} speechPreference={speechPreference.current} />}
        </div>
      </div>
    </>}
  </section>;
}
