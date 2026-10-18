import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Check, Heart, RotateCcw, Settings2 } from 'lucide-react';
import { MARKET_GAMES, INTEREST_TAGS } from '../lib/marketCatalog.js';
import { PREFERENCES_KEY, loadPreferences, savePreferences, defaultPreferences, recommendGames, deriveInterests } from '../lib/marketRecommendations.js';
import './market-recommendations.css';

const TAG_LABELS = Object.fromEntries(INTEREST_TAGS.map(tag => [tag.id, tag.label]));
const FEEDBACK_LABELS = { want: '想玩', dislike: '不感兴趣', played: '已玩过' };

export default function MarketRecommendations({ profile, onTravel }) {
  const [preferences, setPreferences] = useState(loadPreferences);
  const [storageOk, setStorageOk] = useState(true);
  const [announcement, setAnnouncement] = useState('');
  const [undo, setUndo] = useState(null);
  useEffect(() => { setStorageOk(savePreferences(preferences)); }, [preferences]);
  useEffect(() => {
    const sync = event => { if (event.key === PREFERENCES_KEY || event.key === null) setPreferences(loadPreferences()); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const recommendations = useMemo(() => recommendGames(profile, preferences), [profile, preferences]);
  const interests = useMemo(() => deriveInterests(profile, preferences), [profile, preferences]);
  const positiveInterests = interests.filter(item => item.value > 0);
  const savedWants = MARKET_GAMES.filter(game => preferences.feedback[game.id] === 'want');
  const hiddenCount = Object.values(preferences.feedback).filter(value => value === 'dislike' || value === 'played').length;
  const patch = changes => {
    setPreferences(previous => ({ ...previous, ...changes }));
    setAnnouncement('偏好已更新，推荐已重新匹配。');
  };
  const toggleInterest = id => {
    setPreferences(previous => ({ ...previous, interests: previous.interests.includes(id) ? previous.interests.filter(tag => tag !== id) : [...previous.interests, id] }));
    setAnnouncement('兴趣选择已更新，推荐已重新匹配。');
  };
  const recordFeedback = (game, value) => {
    const previous = preferences.feedback[game.id];
    const next = previous === value ? undefined : value;
    setPreferences(current => {
      const feedback = { ...current.feedback };
      if (next) feedback[game.id] = next; else delete feedback[game.id];
      return { ...current, feedback };
    });
    setUndo({ id: game.id, previous });
    setAnnouncement(next ? `已将《${game.title}》标记为${FEEDBACK_LABELS[next]}。推荐已更新。` : `已取消《${game.title}》的标记。`);
  };
  const undoFeedback = () => {
    if (!undo) return;
    setPreferences(current => {
      const feedback = { ...current.feedback };
      if (undo.previous) feedback[undo.id] = undo.previous; else delete feedback[undo.id];
      return { ...current, feedback };
    });
    setUndo(null);
    setAnnouncement('已撤销上一次游戏反馈。');
  };
  return <section className="market-recommendations" aria-label="市售游戏推荐">
    <div className="market-heading"><div><h3>下一款，玩点什么？</h3><p>从 {MARKET_GAMES.length} 款游戏中找线索。喜欢决定方向，成绩只记录本次表现。</p></div><span className="market-count">{MARKET_GAMES.length} 款精选</span></div>
    {!storageOk && <p role="alert" className="market-warning">推荐偏好暂时无法保存；刷新后可能丢失。本次仍可使用。</p>}
    {positiveInterests.length > 0 ? <div className="market-interest-summary"><strong>目前的兴趣线索</strong><div className="market-tags">{positiveInterests.map(item => <span key={item.id}>{TAG_LABELS[item.id] || item.label}</span>)}</div><details className="market-evidence"><summary>查看依据与待探索项</summary><ul>{interests.map(item => <li key={item.id}>{item.evidence}</li>)}</ul><p>没有体验或主动选择的玩法仍是未知；小游戏偏好只是初步线索，可在下面纠正。</p></details></div> : <p className="market-empty-hint">还没有明确的喜欢。下面是探索推荐；玩一局并评价，或直接选择兴趣，就会重新匹配。{onTravel && <button className="market-text-button" onClick={() => onTravel('balloons')}>先去打气球 <ArrowUpRight size={18} aria-hidden="true"/></button>}</p>}
    <details className="market-settings">
      <summary><Settings2 size={19} aria-hidden="true"/>调整兴趣与游玩条件</summary>
      <div className="market-settings-body">
        <fieldset><legend>我也想试试这些玩法 <span>可多选，主动选择优先</span></legend><div className="market-interest-choices">{INTEREST_TAGS.map(tag => <button type="button" key={tag.id} aria-pressed={preferences.interests.includes(tag.id)} className={`market-chip ${preferences.interests.includes(tag.id) ? 'is-selected' : ''}`} onClick={() => toggleInterest(tag.id)}>{tag.label}</button>)}</div></fieldset>
        <div className="market-selects"><label>今天的体验强度<select aria-label="今天的体验强度" value={preferences.comfort} onChange={event => patch({ comfort: event.target.value })}><option value="auto">跟随最近游玩反馈</option><option value="any">暂不限制</option><option value="gentle">轻松一点</option><option value="balanced">适度挑战</option><option value="intense">更强挑战</option></select></label><label>想怎样玩<select aria-label="想怎样玩" value={preferences.playMode} onChange={event => patch({ playMode: event.target.value })}><option value="any">暂不限制</option><option value="solo">单人</option><option value="coop">合作</option><option value="competitive">竞技</option></select></label></div>
        <div className="market-checks"><label><input type="checkbox" checked={preferences.hasPartner} onChange={event => patch({ hasPartner: event.target.checked })}/>我有一起玩的同伴</label><label><input type="checkbox" checked={preferences.hasVR} onChange={event => patch({ hasVR: event.target.checked })}/>我有 VR 设备</label><label><input type="checkbox" checked={preferences.allowHorror} onChange={event => patch({ allowHorror: event.target.checked })}/>接受恐怖内容推荐</label></div>
        <p>默认不推荐明确标为恐怖、必须 VR 或必须双人却不满足条件的作品。其他作品仍可能包含暴力等内容，请查看官方说明。</p>
        <button className="market-text-button" onClick={() => { setPreferences(defaultPreferences()); setUndo(null); setAnnouncement('已重置推荐设置与游戏标记，游玩记录保留。'); }}><RotateCcw size={17} aria-hidden="true"/>重置推荐设置（保留游玩记录）</button>
      </div>
    </details>
    <div className="market-status" role="status" aria-live="polite">{announcement}{undo && <button className="market-text-button" onClick={undoFeedback}>撤销上次标记</button>}</div>
    <div className="market-results">
      {recommendations.map((game, index) => <article className="market-game" key={game.id} aria-labelledby={`market-title-${game.id}`}>
        <div className="market-game-heading"><span className="market-rank" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><div><div className="market-game-meta"><span>{game.kind}</span>{game.kind !== game.confidence && <span>{game.confidence}</span>}</div><h3 id={`market-title-${game.id}`}>{game.title}</h3></div></div>
        <div className="market-tags">{game.tags.map(tag => <span key={tag}>{TAG_LABELS[tag] || tag}</span>)}</div>
        <ul className="market-reasons">{game.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>
        <p className="market-entry"><strong>入门建议：</strong>{game.entryTip}</p>
        {game.cautions.length > 0 && <p className="market-caution"><strong>留意：</strong>{game.cautions.join('；')}</p>}
        <div className="market-game-actions"><a href={game.storeUrl} target="_blank" rel="noopener noreferrer" className="market-store">查看官方介绍 <ArrowUpRight size={18} aria-hidden="true"/><span className="market-sr-only">（新窗口）</span></a><div className="market-feedback"><button aria-label={`想玩《${game.title}》`} aria-pressed={preferences.feedback[game.id] === 'want'} onClick={() => recordFeedback(game, 'want')}><Heart size={17} aria-hidden="true"/>想玩</button><button aria-label={`对《${game.title}》不感兴趣`} onClick={() => recordFeedback(game, 'dislike')}>不感兴趣</button><button aria-label={`已玩过《${game.title}》`} onClick={() => recordFeedback(game, 'played')}><Check size={17} aria-hidden="true"/>已玩过</button></div></div>
      </article>)}
      {!recommendations.length && <div className="market-no-results"><h3>这些条件下暂时没有合适的候选</h3><p>可以调整上方条件，或恢复隐藏的游戏。不必为了推荐而接受不喜欢的内容。</p></div>}
    </div>
    {hiddenCount > 0 && <button className="market-text-button" onClick={() => { setPreferences(current => ({ ...current, feedback: Object.fromEntries(Object.entries(current.feedback).filter(([, value]) => value === 'want')) })); setUndo(null); setAnnouncement('已恢复隐藏与已玩过的游戏。'); }}>恢复 {hiddenCount} 款隐藏／已玩过的游戏</button>}
    {savedWants.length > 0 && <details className="market-wishlist"><summary>我的想玩清单 · {savedWants.length} 款</summary><ul>{savedWants.map(game => <li key={game.id}><a href={game.storeUrl} target="_blank" rel="noopener noreferrer">{game.title} <ArrowUpRight size={17} aria-hidden="true"/></a><button className="market-text-button" onClick={() => recordFeedback(game, 'want')} aria-label={`取消想玩《${game.title}》`}>取消想玩</button></li>)}</ul></details>}
    <p className="market-disclosure">静态目录 · 玩法标签为人工标注，非心理测评。官方名称与链接核验于 2026-10-17；价格、地区可用性与设备配置请以官方页面为准。推荐不代表购买建议或平台背书。</p>
  </section>;
}
