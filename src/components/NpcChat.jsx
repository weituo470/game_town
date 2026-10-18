import { useEffect, useId, useRef, useState } from 'react';
import { MessageCircle, RefreshCw, Send, Square, Volume2 } from 'lucide-react';
import { createNpcChatRequest, NPC_CHAT_MAX_CHARS, npcChatClient } from '../lib/npcChatClient.js';
import { createNpcSpeechPlayer } from '../lib/npcSpeechPlayer.js';
import { NPC_MAP } from '../lib/npcCatalog.js';
import './npc-chat.css';

const greetingMessage = npcId => ({ id: `greeting-${npcId}`, role: 'assistant', kind: 'greeting', text: NPC_MAP[npcId]?.dialogue.greeting ?? '' });
const emptySession = npcId => ({ messages: greetingMessage(npcId).text ? [greetingMessage(npcId)] : [], conversationId: undefined, failedRequest: null, error: null, draft: '' });

export default function NpcChat({ npcId, npcName, sessions, speechPreference }) {
  const session = useRef(sessions?.get(npcId) ?? emptySession(npcId));
  const [view, setView] = useState(session.current);
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [statusRevision, setStatusRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const [speechStatus, setSpeechStatus] = useState(null);
  const [speechStatusError, setSpeechStatusError] = useState('');
  const [autoSpeech, setAutoSpeech] = useState(() => speechPreference?.enabled !== false);
  const [speechState, setSpeechState] = useState({ messageId: null, status: 'idle', error: '' });
  const autoSpeechRef = useRef(autoSpeech);
  const greetingAttempted = useRef(false);
  const queuedAutoReply = useRef(null);
  const speechPlayer = useRef(null);
  const active = useRef(null);
  const mounted = useRef(true);
  const composing = useRef(false);
  const textarea = useRef(null);
  const messages = useRef(null);
  const inputId = useId();
  const disclosureId = useId();
  const speechDisclosureId = useId();
  const maxChars = status?.maxMessageChars ?? NPC_CHAT_MAX_CHARS;
  const animalVoice = speechStatus?.voiceKind === 'animal';

  function update(patch) {
    const next = { ...session.current, ...patch };
    session.current = next;
    sessions?.set(npcId, next);
    if (mounted.current) setView(next);
  }

  useEffect(() => {
    mounted.current = true;
    speechPlayer.current = createNpcSpeechPlayer({ loadSpeech: (source, options) => source.kind === 'greeting' ? npcChatClient.greetingSpeech(source, options) : npcChatClient.speech(source, options), onState: next => { if (mounted.current) setSpeechState(next); } });
    return () => {
      mounted.current = false;
      speechPlayer.current?.dispose();
      speechPlayer.current = null;
      if (active.current && session.current.failedRequest) {
        const next = { ...session.current, error: { message: '上次离开时停止了等候，尚未确认回复。可以重试同一条消息。', retryable: true } };
        session.current = next;
        sessions?.set(npcId, next);
      }
      active.current?.abort();
      active.current = null;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setStatus(null);
    setStatusError('');
    setSpeechStatus(null);
    setSpeechStatusError('');
    npcChatClient.status({ signal: controller.signal })
      .then(next => { if (!controller.signal.aborted) setStatus(next); })
      .catch(error => { if (error.name !== 'AbortError') setStatusError(error.message); });
    npcChatClient.speechStatus({ signal: controller.signal, npcId })
      .then(next => { if (!controller.signal.aborted) setSpeechStatus(next); })
      .catch(error => { if (error.name !== 'AbortError') setSpeechStatusError('暂时无法连接语音服务，文字聊天仍可使用。'); });
    return () => controller.abort();
  }, [statusRevision, npcId]);

  useEffect(() => {
    if (!autoSpeech || !speechStatus?.enabled || (!queuedAutoReply.current && (animalVoice || greetingAttempted.current))) return undefined;
    // Effect replay must finish before a paid request starts. StrictMode's first
    // setup is synchronously cleaned up, canceling this task before it can run.
    const timer = setTimeout(() => {
      if (!mounted.current || !autoSpeechRef.current || active.current) return;
      const reply = queuedAutoReply.current;
      if (!reply && greetingAttempted.current) return;
      queuedAutoReply.current = null;
      greetingAttempted.current = true;
      const source = reply ?? greetingMessage(npcId);
      if (source.text && Array.from(source.text).length <= speechStatus.maxTextChars) void speechPlayer.current?.play({ ...source, npcId });
    }, 0);
    return () => clearTimeout(timer);
  }, [npcId, autoSpeech, speechStatus?.enabled, animalVoice, view.messages.length, pending]);

  useEffect(() => {
    if (messages.current) messages.current.scrollTop = messages.current.scrollHeight;
  }, [view.messages.length, pending]);

  async function send(request) {
    if (active.current || !status?.enabled) return;
    greetingAttempted.current = true;
    queuedAutoReply.current = null;
    speechPlayer.current?.stop();
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    update({ error: null, failedRequest: request });
    try {
      const response = await npcChatClient.send(request, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const replyMessage = { id: `${request.requestId}-reply`, role: 'assistant', text: response.reply, requestId: response.requestId, conversationId: response.conversationId };
      // If voice status arrives after a fast LLM reply, narrate that fresh reply
      // once instead of losing it or interrupting it with a delayed greeting.
      if (autoSpeechRef.current) queuedAutoReply.current = replyMessage;
      update({
        messages: [...session.current.messages, replyMessage],
        conversationId: response.conversationId,
        failedRequest: null,
        error: null,
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        if (mounted.current) update({ error: { message: '已停止等候，尚未确认回复。可以重试同一条消息。', retryable: true } });
      } else {
        update({ error: { message: error.message, retryable: error.retryable !== false } });
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        if (mounted.current) setPending(false);
      }
    }
  }

  function submit(event) {
    event?.preventDefault();
    if (active.current || view.failedRequest || !status?.enabled || !view.draft.trim()) return;
    try {
      const request = createNpcChatRequest({ npcId, message: view.draft, conversationId: view.conversationId });
      update({ messages: [...view.messages, { id: request.requestId, role: 'user', text: request.message }], draft: '', error: null });
      void send(request);
    } catch (error) {
      update({ error: { message: error.message, retryable: false } });
    }
  }

  function reconnectConversation() {
    if (active.current) return;
    update({ conversationId: undefined, failedRequest: null, error: null });
    textarea.current?.focus();
  }

  return <section className="npc-chat" tabIndex={-1} aria-label={`与${npcName}自由聊天`}>
    <div className="npc-chat-heading">
      <h4><MessageCircle size={20} aria-hidden="true" /> 与{npcName}自由聊天</h4>
      <span className="npc-chat-badge">AI 对话</span>
    </div>
    <p id={disclosureId} className="npc-chat-disclosure">你的消息、近期对话和 NPC 公开设定会发送给 DeepSeek，请勿填写隐私。AI 可能说错，聊天不会执行任务、交易或发放金币。</p>
    <div className="npc-chat-service" role="status">
      {!status && !statusError && <span>正在检查 AI 聊天连接…</span>}
      {status?.enabled && <span>DeepSeek · 按{npcName}的角色设定回复</span>}
      {status && !status.enabled && <span>AI 聊天尚未启用；上方的固定台词仍可使用。</span>}
      {statusError && <span>{statusError}</span>}
      {(statusError || (status && !status.enabled)) && <button type="button" onClick={() => setStatusRevision(value => value + 1)}><RefreshCw size={16} aria-hidden="true" /> 重新检查</button>}
    </div>
    <div className="npc-speech-options">
      <label className="npc-speech-toggle">
        <input type="checkbox" checked={autoSpeech} aria-describedby={speechDisclosureId}
          onChange={event => {
            const enabled = event.target.checked;
            autoSpeechRef.current = enabled;
            if (speechPreference) speechPreference.enabled = enabled;
            if (!enabled) greetingAttempted.current = true;
            if (!enabled) queuedAutoReply.current = null;
            setAutoSpeech(enabled);
            if (!enabled) speechPlayer.current?.stop();
          }} />
        <span>{animalVoice ? '新回复自动播放叫声' : '自动播报问候与新回复'}</span>
      </label>
      <p id={speechDisclosureId} className="npc-speech-disclosure">{animalVoice ? '播放已授权的动物叫声作为回应，不会把聊天文字发送给语音服务，也不产生语音生成费用。叫声不是逐字朗读，请阅读文字了解回复内容。' : '语音默认开启，可随时关闭。固定问候和 NPC 的新回复会发送给豆包语音服务，可能产生语音调用费用；不会把你的原话单独发送用于配音。'}</p>
      <span className="npc-speech-availability" role="status">{speechStatusError || (speechStatus?.reason === 'animal-audio-pending' ? '这位动物伙伴的授权叫声音效尚未就绪，可以先阅读文字回复。' : speechStatus?.reason === 'voice-pending' ? '配音身份待确认，暂不套用其他角色的声音；文字聊天不受影响。' : speechStatus?.enabled ? `${speechStatus.voiceLabel} · ${autoSpeech ? '问候与新回复自动播报' : '自动回应已关闭'}` : speechStatus ? '语音服务尚未启用，文字聊天不受影响。' : '正在检查语音服务…')}</span>
      {(speechStatusError || (speechStatus && !speechStatus.enabled)) && <button type="button" className="npc-speech-recheck" onClick={() => setStatusRevision(value => value + 1)}>重新检查语音</button>}
    </div>
    {view.messages.length > 0 && <div className="npc-chat-messages" ref={messages} role="log" aria-label={`与${npcName}的 AI 对话记录`} aria-live="polite" aria-relevant="additions text" tabIndex={0}>
      {view.messages.map(message => <div key={message.id} className={`npc-chat-message npc-chat-message-${message.role}`}>
        <span className="npc-chat-speaker">{message.role === 'user' ? '你' : `${npcName} · ${message.kind === 'greeting' ? '固定问候' : 'AI'}`}</span>
        <p>{message.text}</p>
        {message.role === 'assistant' && (message.kind === 'greeting' || (message.requestId && message.conversationId)) && <div className="npc-speech-reply">
          <button type="button" disabled={!speechStatus?.enabled || pending || Array.from(message.text).length > (speechStatus?.maxTextChars ?? 0)}
            onClick={() => {
              greetingAttempted.current = true;
              queuedAutoReply.current = null;
              if (speechState.messageId === message.id && ['loading', 'playing'].includes(speechState.status)) speechPlayer.current?.stop();
              else void speechPlayer.current?.play({ ...message, npcId });
            }}>
            {speechState.messageId === message.id && ['loading', 'playing'].includes(speechState.status)
              ? <><Square size={16} aria-hidden="true" />{speechState.status === 'loading' ? '取消播报' : '停止播报'}</>
              : <><Volume2 size={18} aria-hidden="true" />{animalVoice ? '播放叫声回应' : '播放语音'}</>}
          </button>
          {speechState.messageId === message.id && speechState.status === 'loading' && <span role="status">正在准备语音…</span>}
          {speechState.messageId === message.id && speechState.status === 'playing' && <span role="status">{animalVoice ? '正在播放叫声' : '正在播报'}</span>}
          {speechState.messageId === message.id && speechState.status === 'idle' && <span role="status">{animalVoice ? '叫声播放完毕' : '播报完毕'}</span>}
          {speechStatus?.enabled && Array.from(message.text).length > speechStatus.maxTextChars && <p className="npc-speech-error">这条回复超过 {speechStatus.maxTextChars} 字，暂不支持完整播报；文字仍可阅读。</p>}
          {speechState.messageId === message.id && speechState.error && <p className="npc-speech-error" role="status">{speechState.error}</p>}
        </div>}
      </div>)}
      {pending && <span className="npc-chat-waiting">{npcName}正在想怎么回答…</span>}
    </div>}
    {view.error && <div className="npc-chat-error" role="alert">
      <p>{view.error.message}</p>
      <div className="npc-chat-error-actions">
        {view.failedRequest && view.error.retryable && <button type="button" disabled={pending || !status?.enabled} onClick={() => void send(view.failedRequest)}><RefreshCw size={17} aria-hidden="true" /> 重试这条消息</button>}
        {!view.error.retryable && <button type="button" disabled={pending} onClick={reconnectConversation}>重新连接对话</button>}
      </div>
    </div>}
    <form className="npc-chat-form" onSubmit={submit}>
      <label htmlFor={inputId}>想对{npcName}说什么？</label>
      <textarea id={inputId} ref={textarea} rows={3} value={view.draft} maxLength={maxChars}
        placeholder="比如：你今天在忙什么？" disabled={!status?.enabled || pending || Boolean(view.failedRequest)}
        aria-describedby={disclosureId}
        onChange={event => update({ draft: event.target.value })}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => {
          if (event.key !== 'Enter' || event.shiftKey || composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          submit();
        }} />
      <div className="npc-chat-form-footer">
        <span className="npc-chat-input-hint">Enter 发送 · Shift + Enter 换行 <span>{view.draft.length} / {maxChars}</span></span>
        <button type="submit" className="npc-chat-send" disabled={!status?.enabled || pending || Boolean(view.failedRequest) || !view.draft.trim()}><Send size={17} aria-hidden="true" /> {pending ? '等待回复…' : '发送'}</button>
      </div>
    </form>
    <p className="npc-chat-retention">服务器内存中的对话闲置约 30 分钟后清除，服务重启后也会清除。关闭居民册只清空本页显示，重新打开时 AI 可能仍记得之前的话。</p>
  </section>;
}
