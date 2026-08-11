/**
 * The Purser PREVIEW — demo mode only.
 *
 * The real assistant is hard-off in demo (`config.assistant` requires
 * `!demo && ASSISTANT_URL`), so a demo visitor would otherwise hit a bare
 * "not available" notice and never learn the feature exists. This renders a
 * scripted sample conversation in the REAL chat furniture (same `.turn` bubbles
 * and Markdown renderer as `AssistantPage`) plus a live-feeling composer that
 * answers with one honest canned line.
 *
 * It NEVER touches the network — no `api.assistant*` call is made from here, so
 * the preview cannot accidentally light up a half-configured deployment.
 *
 * The sample is grounded in the bundled `demo/` dataset (the overdue
 * `m-engine-impeller` item, the 24-month impeller service in `boat.yaml`, and
 * the real `photos/m-engine-impeller.jpg`) so it reads as this boat's own log.
 * It deliberately quotes NO money figure — cost is owner-only data and static
 * copy is not a place to blur that line.
 */
import { useEffect, useRef, useState } from 'react';
import { Markdown } from './Markdown.js';
import { Icon } from '../components/Icon.js';
import styles from './AssistantPage.module.css';

interface DemoTurn {
  role: 'user' | 'assistant';
  who?: string;
  content: string;
  /** A record-style photo ref (`photos/<name>.jpg`), served by the /photos route. */
  photo?: string;
  photoAlt?: string;
}

/** The scripted exchange: the Purser reads the boat, sees a photo, and files work. */
const SAMPLE: DemoTurn[] = [
  {
    role: 'user',
    who: 'Skipper',
    content: 'We overheated coming back from Angel Island. What do I check first?',
  },
  {
    role: 'assistant',
    content: [
      'Start with the raw-water side — and your log already points at it.',
      '',
      '1. **Raw-water impeller.** *Replace raw-water impeller (overheating)* is open and **overdue**, filed off the 9 May passage. The engine block agrees: impeller is on a 24-month interval, last done 10 May 2024.',
      '2. **Sea strainer.** Thirty seconds to check, and it is the cheap answer. Weed or a bag over the intake will cook the engine just as fast as a dead impeller.',
      '3. **Belt tension.** Least likely here, but worth a squeeze while the panel is open.',
      '',
      'The Universal M-25 manual is aboard under Manuals if you want the impeller part number.',
    ].join('\n'),
  },
  {
    role: 'user',
    who: 'Skipper',
    content: 'Found this in the strainer.',
    photo: 'photos/m-engine-impeller.jpg',
    photoAlt: 'Impeller pulled from the raw-water strainer',
  },
  {
    role: 'assistant',
    content: [
      'That is your impeller, and it has shed at least two vanes.',
      '',
      'The missing rubber is almost certainly sitting in the heat-exchanger inlet — pull it before you run the engine again, or the new impeller will overheat behind the same blockage.',
      '',
      'I have opened **Clear heat-exchanger inlet** (Engine, priority 1) and linked it to today’s trip. It will be in your maintenance queue.',
    ].join('\n'),
  },
];

/** The one honest answer the preview gives to anything a visitor types. */
const CANNED_REPLY =
  'I am ashore for this demo, so I cannot actually read that. On a real Ship’s Log I would ' +
  'have the whole boat open — every trip, manual, part number and open work order — and could ' +
  'answer in plain language, or file the maintenance item for you while you are still at the helm.';

/** Long enough to read as thinking, short enough not to feel broken. */
const REPLY_DELAY_MS = 700;

export default function AssistantDemo({ label }: { label: string }): JSX.Element {
  const [turns, setTurns] = useState<DemoTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  // Follow the conversation down only once the visitor has added to it. On mount
  // we deliberately do NOT scroll: this is a page to be READ, and the sample opens
  // with the question that sets up everything below it.
  useEffect(() => {
    if (turns.length === 0 && !typing) return;
    const el = threadRef.current;
    if (el && typeof el.scrollTo === 'function') el.scrollTo(0, el.scrollHeight);
  }, [turns, typing]);

  const send = (): void => {
    const message = draft.trim();
    if (!message || typing) return;
    setDraft('');
    setTurns((t) => [...t, { role: 'user', who: 'You', content: message }]);
    setTyping(true);
    timer.current = setTimeout(() => {
      setTurns((t) => [...t, { role: 'assistant', content: CANNED_REPLY }]);
      setTyping(false);
    }, REPLY_DELAY_MS);
  };

  return (
    <div className={`page-wrap ${styles.wrap}`}>
      <div className={styles.head}>
        <h2>{label}</h2>
        <span className={styles.previewTag}>Preview</span>
      </div>

      <p className={`muted ${styles.previewNote}`}>
        This demo boat has no agent connected. Below is what the conversation looks like when one
        is — the Purser reads the ship&rsquo;s log, sees what you show it, and can open a
        maintenance item for you.
      </p>

      <div className={styles.thread} ref={threadRef}>
        {SAMPLE.map((t, i) => (
          <Turn key={`sample-${i}`} turn={t} />
        ))}

        <div className={styles.sampleEnd}>sample conversation</div>

        {turns.map((t, i) => (
          <Turn key={`live-${i}`} turn={t} />
        ))}
        {typing && (
          <div className={`${styles.turn} ${styles.assistant} ${styles.typing}`} role="status">
            <span /><span /><span />
          </div>
        )}
      </div>

      <div className={styles.composer}>
        <button className="btn btn-ghost" disabled title="Photos work with a connected agent">
          <Icon name="box" s={16} /> Attach
        </button>
        <textarea
          rows={2}
          aria-label="Message"
          placeholder={`Message ${label}…`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button className="btn btn-brass" onClick={send}>
          <Icon name="arrowRight" s={16} /> Send
        </button>
      </div>
    </div>
  );
}

/** One bubble — identical furniture to the live thread, plus the photo slot. */
function Turn({ turn }: { turn: DemoTurn }): JSX.Element {
  return (
    <div className={`${styles.turn} ${turn.role === 'user' ? styles.user : styles.assistant}`}>
      {turn.role === 'user' ? (
        <>
          <div className={styles.who}>{turn.who ?? 'You'}</div>
          {turn.photo && (
            <img className={styles.turnPhoto} src={`/${turn.photo}`} alt={turn.photoAlt ?? ''} />
          )}
          {turn.content}
        </>
      ) : (
        <Markdown source={turn.content} />
      )}
    </div>
  );
}
