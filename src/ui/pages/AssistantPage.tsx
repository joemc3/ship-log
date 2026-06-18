/**
 * The Purser chat (route `/assistant`). Renders the shared communal thread, sends
 * a message and streams the reply via SSE, and (owner-only) resets the thread. The
 * feature is optional: when `assistantEnabled` is false (unconfigured, or demo),
 * it shows an unavailable notice instead of the composer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '../state/session.js';
import { api } from '../lib/api.js';
import type { AssistantTurn } from '../lib/types.js';
import { Markdown } from './Markdown.js';
import { Icon } from '../components/Icon.js';
import styles from './AssistantPage.module.css';

export default function AssistantPage(): JSX.Element {
  const { assistantEnabled, assistantLabel, isOwner } = useSession();
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(() => {
    api.assistantHistory().then((r) => setTurns(r.turns)).catch(() => setTurns([]));
  }, []);

  useEffect(() => { if (assistantEnabled) reload(); }, [assistantEnabled, reload]);
  useEffect(() => {
    const el = threadRef.current;
    if (el && typeof el.scrollTo === 'function') el.scrollTo(0, el.scrollHeight);
  }, [turns, streaming]);

  const send = useCallback(async () => {
    const message = draft.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    setDraft('');
    setTurns((t) => [...t, { role: 'user', content: message, at: new Date().toISOString() }]);
    let acc = '';
    try {
      await api.assistantSend(message, (delta) => { acc += delta; setStreaming(acc); });
      setTurns((t) => [...t, { role: 'assistant', content: acc, at: new Date().toISOString() }]);
    } catch {
      setError(`Couldn't reach ${assistantLabel ?? 'the assistant'}. Try again in a moment.`);
    } finally {
      setStreaming('');
      setBusy(false);
    }
  }, [draft, busy]);

  const reset = useCallback(async () => {
    await api.assistantReset();
    setTurns([]);
  }, []);

  if (!assistantEnabled) {
    return (
      <div className="page-wrap">
        <div className={styles.notice}>{`${assistantLabel ?? 'the assistant'} is not available in this deployment.`}</div>
      </div>
    );
  }

  return (
    <div className={`page-wrap ${styles.wrap}`}>
      <div className={styles.head}>
        <h2>{assistantLabel}</h2>
        {isOwner && (
          <button className="btn btn-ghost" onClick={() => void reset()}>
            <Icon name="info" s={15} /> Reset thread
          </button>
        )}
      </div>

      <div className={styles.thread} ref={threadRef}>
        {turns.map((t, i) => (
          <div key={i} className={`${styles.turn} ${t.role === 'user' ? styles.user : styles.assistant}`}>
            {t.role === 'user'
              ? <><div className={styles.who}>{t.name ?? 'You'}</div>{t.content}</>
              : <Markdown source={t.content} />}
          </div>
        ))}
        {streaming && (
          <div className={`${styles.turn} ${styles.assistant}`}><Markdown source={streaming} /></div>
        )}
      </div>

      {error && <div role="alert" className="muted" style={{ marginTop: 8 }}>{error}</div>}

      <div className={styles.composer}>
        <textarea
          rows={2}
          aria-label="Message"
          placeholder="Message the Purser…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
        />
        <button className="btn btn-brass" disabled={busy || !draft.trim()} onClick={() => void send()}>
          <Icon name="arrowRight" s={16} /> Send
        </button>
      </div>
    </div>
  );
}
