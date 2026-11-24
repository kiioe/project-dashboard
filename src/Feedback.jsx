import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ThumbsUp, ThumbsDown, MessageSquare, X } from 'lucide-react';
import { BottomSheet } from './PhoneLayout';

// Feedback (24 Nov 2026). Rules agreed with E:
// - Each main section ends with a "Was this section helpful?" strip (thumbs up / down).
//   It appears only once someone has used the app for 3+ days AND opened that section 3+ times,
//   so new users aren't asked about things they haven't used.
// - Once they've voted, the strip shrinks to a small thumb in the corner; tapping it opens it again
//   to change the vote, or tap the same thumb again to take the vote back.
// - Thumbs down offers an optional "What would make it better?" box (up to 500 characters).
// - The header's "Feedback" link is always there: Bug / Idea / Other, a message (up to 2,000 characters)
//   and "OK to contact me".
// - Saved in the feedback table (supabase/feedback.sql). Only E can read it; people see only their own votes.
// Usage (first day seen, how often each section was opened) is kept on this device only.

export const SHOW_AFTER_DAYS = 3;
export const SHOW_AFTER_OPENS = 3;
const VOTE_COMMENT_MAX = 500;
const MESSAGE_MAX = 2000;

const FeedbackContext = createContext(null);
const countedThisLoad = new Set(); // a section counts as opened once per app load

const storageKey = (userId) => `sqnce.feedback.${userId}`;
function readUsage(userId) {
  try {
    const u = JSON.parse(window.localStorage.getItem(storageKey(userId)) || 'null');
    if (u && u.first && u.opens) return u;
  } catch { /* storage unavailable or damaged: start again */ }
  return { first: new Date().toISOString(), opens: {} };
}
function writeUsage(userId, usage) {
  try { window.localStorage.setItem(storageKey(userId), JSON.stringify(usage)); } catch { /* ignore */ }
}

export function FeedbackProvider({ supabase, orgId, user, isPhone, children }) {
  const [votes, setVotes] = useState({}); // section -> { vote, comment }
  const [usage, setUsage] = useState(() => readUsage(user.id));
  const [generalOpen, setGeneralOpen] = useState(false);
  const device = isPhone ? 'phone' : 'desktop';
  const who = {
    org_id: orgId,
    user_id: user.id,
    user_name: user.fullName || null,
    user_email: user.primaryEmailAddress?.emailAddress || null,
  };

  useEffect(() => { writeUsage(user.id, usage); }, [user.id, usage]);

  useEffect(() => {
    let cancelled = false;
    supabase.from('feedback').select('section, vote, comment').eq('org_id', orgId).eq('kind', 'vote')
      .then(({ data }) => {
        if (cancelled || !data) return;
        setVotes(Object.fromEntries(data.map(v => [v.section, { vote: v.vote, comment: v.comment }])));
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, user.id]);

  const noteOpened = useCallback((section) => {
    if (countedThisLoad.has(section)) return;
    countedThisLoad.add(section);
    setUsage(u => ({ ...u, opens: { ...u.opens, [section]: (u.opens[section] || 0) + 1 } }));
  }, []);

  const eligible = (section) => {
    const days = (Date.now() - new Date(usage.first).getTime()) / 86400000;
    return days >= SHOW_AFTER_DAYS && (usage.opens[section] || 0) >= SHOW_AFTER_OPENS;
  };

  // vote: 1, -1, or null to take it back. Returns an error message or ''.
  const castVote = async (section, vote, comment = null) => {
    const before = votes[section];
    setVotes(v => {
      const next = { ...v };
      if (vote === null) delete next[section]; else next[section] = { vote, comment };
      return next;
    });
    const { error } = vote === null
      ? await supabase.from('feedback').delete().eq('org_id', orgId).eq('kind', 'vote').eq('section', section)
      : await supabase.from('feedback').upsert(
        { ...who, kind: 'vote', section, vote, comment, device, topic: null },
        { onConflict: 'user_id,org_id,section' });
    if (error) {
      setVotes(v => {
        const next = { ...v };
        if (before) next[section] = before; else delete next[section];
        return next;
      });
      return 'Couldn’t save your feedback. Please try again.';
    }
    return '';
  };

  const sendGeneral = async ({ topic, message, contactOk }) => {
    const { error } = await supabase.from('feedback').insert(
      { ...who, kind: 'general', topic, comment: message.trim(), contact_ok: contactOk, device });
    return error ? 'Couldn’t send your feedback. Please try again.' : '';
  };

  const value = { votes, noteOpened, eligible, castVote, sendGeneral, openGeneral: () => setGeneralOpen(true), isPhone };
  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <GeneralFeedback open={generalOpen} onClose={() => setGeneralOpen(false)} />
    </FeedbackContext.Provider>
  );
}

// The header link. phone: a compact icon button.
export function FeedbackLink({ phone = false }) {
  const fb = useContext(FeedbackContext);
  if (!fb) return null;
  return phone ? (
    <button onClick={fb.openGeneral} aria-label="Send feedback"
      className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-slate-600 active:bg-slate-100">
      <MessageSquare size={20} aria-hidden="true" />
    </button>
  ) : (
    <button onClick={fb.openGeneral}
      className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 px-3 py-2 rounded-lg hover:bg-white/70">
      <MessageSquare size={18} aria-hidden="true" />
      Feedback
    </button>
  );
}

const stripClass = 'rounded-2xl bg-[#1b1433] text-white';
const upClass = 'text-emerald-400';
const downClass = 'text-pink-500';

// "Was this section helpful?" at the bottom of a section.
export function SectionFeedback({ section, className = '' }) {
  const fb = useContext(FeedbackContext);
  const [expanded, setExpanded] = useState(false);
  const [askWhy, setAskWhy] = useState(false);
  const [comment, setComment] = useState('');
  const [thanks, setThanks] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const commentBox = useRef(null);

  useEffect(() => { fb?.noteOpened(section); }, [fb?.noteOpened, section]);
  useEffect(() => { if (askWhy) commentBox.current?.focus(); }, [askWhy]);
  if (!fb) return null;

  const mine = fb.votes[section];
  if (!mine && !fb.eligible(section) && !thanks) return null;

  const pick = async (vote) => {
    if (busy) return;
    setBusy(true); setError('');
    const taking = mine?.vote === vote;
    const err = await fb.castVote(section, taking ? null : vote, taking ? null : (vote === -1 ? mine?.comment ?? null : null));
    setBusy(false);
    if (err) { setError(err); return; }
    if (taking) { setThanks(''); setAskWhy(false); return; }
    if (vote === -1) { setComment(mine?.comment || ''); setAskWhy(true); setThanks(''); setExpanded(true); }
    else { setAskWhy(false); setThanks('Thanks, glad it helped.'); setExpanded(false); }
  };

  const sendWhy = async (skip) => {
    if (!skip && comment.trim()) {
      setBusy(true); setError('');
      const err = await fb.castVote(section, -1, comment.trim());
      setBusy(false);
      if (err) { setError(err); return; }
    }
    setAskWhy(false); setExpanded(false);
    setThanks(skip || !comment.trim() ? 'Thanks for letting us know.' : 'Thanks, we’ve got it.');
  };

  // After voting: a small thumb in the corner (plus a brief thank-you), tap to open again.
  if (mine && !expanded && !askWhy) {
    const Icon = mine.vote === 1 ? ThumbsUp : ThumbsDown;
    return (
      <div className={`flex items-center justify-end gap-2 ${className}`}>
        {thanks && <span className="text-xs text-slate-500" role="status">{thanks}</span>}
        <button onClick={() => { setExpanded(true); setThanks(''); }}
          aria-label={`Your feedback on this section: ${mine.vote === 1 ? 'helpful' : 'not helpful'}. Change it`}
          title="Change your feedback"
          className={`w-9 h-9 flex items-center justify-center ${stripClass}`}>
          <Icon size={16} className={mine.vote === 1 ? upClass : downClass} aria-hidden="true" />
        </button>
      </div>
    );
  }

  const thumb = (vote) => {
    const Icon = vote === 1 ? ThumbsUp : ThumbsDown;
    const chosen = mine?.vote === vote;
    return (
      <button onClick={() => pick(vote)} disabled={busy} aria-pressed={chosen}
        aria-label={vote === 1 ? 'Yes, helpful' : 'No, not helpful'}
        title={chosen ? 'Tap again to take your vote back' : undefined}
        className={`w-11 h-11 flex items-center justify-center rounded-xl transition-colors disabled:opacity-60 ${chosen ? 'bg-white/15' : 'hover:bg-white/10'}`}>
        <Icon size={24} className={vote === 1 ? upClass : downClass} fill={chosen ? 'currentColor' : 'none'} aria-hidden="true" />
      </button>
    );
  };

  return (
    <div className={`${stripClass} px-4 py-3 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-white/70">Feedback</div>
          <div className="text-sm font-medium">Was this section helpful?</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {thumb(1)}
          {thumb(-1)}
          {mine && (
            <button onClick={() => { setExpanded(false); setAskWhy(false); }} aria-label="Close"
              className="w-9 h-9 flex items-center justify-center text-white/60 hover:text-white">
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {askWhy && (
        <div className="mt-3 space-y-2">
          <label className="block text-sm text-white/80" htmlFor={`fb-why-${section}`}>
            What would make it better? <span className="text-white/50">(optional)</span>
          </label>
          <textarea id={`fb-why-${section}`} ref={commentBox} value={comment} rows={3}
            maxLength={VOTE_COMMENT_MAX} onChange={(e) => setComment(e.target.value)}
            className="w-full rounded-lg bg-white text-slate-900 px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-white/50">{comment.length}/{VOTE_COMMENT_MAX}</span>
            <div className="flex gap-2">
              <button onClick={() => sendWhy(true)} disabled={busy}
                className="min-h-[40px] px-4 rounded-lg text-sm text-white/80 hover:text-white">Skip</button>
              <button onClick={() => sendWhy(false)} disabled={busy || !comment.trim()}
                className="min-h-[40px] px-4 rounded-lg text-sm font-semibold bg-emerald-400 text-slate-900 disabled:opacity-50">Send</button>
            </div>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-pink-300" role="alert">{error}</p>}
    </div>
  );
}

const TOPICS = ['Bug', 'Idea', 'Other'];

function GeneralFeedback({ open, onClose }) {
  const fb = useContext(FeedbackContext);
  const [topic, setTopic] = useState('Idea');
  const [message, setMessage] = useState('');
  const [contactOk, setContactOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (open) { setTopic('Idea'); setMessage(''); setContactOk(false); setError(''); setSent(false); }
  }, [open]);
  useEffect(() => {
    if (!sent) return undefined;
    const t = setTimeout(onClose, 1800);
    return () => clearTimeout(t);
  }, [sent, onClose]);
  if (!open || !fb) return null;

  const send = async (e) => {
    e.preventDefault();
    if (!message.trim()) { setError('Please write a message.'); return; }
    setBusy(true); setError('');
    const err = await fb.sendGeneral({ topic, message, contactOk });
    setBusy(false);
    if (err) setError(err); else setSent(true);
  };

  const body = sent ? (
    <p className="py-6 text-center text-slate-700" role="status">Thanks, we’ve got it.</p>
  ) : (
    <form onSubmit={send} className="space-y-4">
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Type of feedback">
        {TOPICS.map(t => (
          <button key={t} type="button" onClick={() => setTopic(t)} aria-pressed={topic === t}
            className={`min-h-[44px] rounded-lg text-sm font-medium border ${topic === t ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-300 text-slate-700'}`}>
            {t}
          </button>
        ))}
      </div>
      <label className="block text-sm text-slate-700">
        {topic === 'Bug' ? 'What went wrong?' : topic === 'Idea' ? 'What would you like?' : 'Your message'}
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={MESSAGE_MAX} required
          className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <span className="block text-right text-xs text-slate-400">{message.length}/{MESSAGE_MAX}</span>
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={contactOk} onChange={(e) => setContactOk(e.target.checked)} className="w-4 h-4" />
        OK to contact me about this
      </label>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="min-h-[44px] px-4 rounded-lg text-sm bg-slate-200 text-slate-700">Cancel</button>
        <button type="submit" disabled={busy} className="min-h-[44px] px-4 rounded-lg text-sm bg-blue-600 text-white disabled:opacity-60">
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  );

  if (fb.isPhone) return <BottomSheet open title="Send feedback" onClose={onClose}>{body}</BottomSheet>;
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Send feedback" onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-xl w-full max-w-md mt-24 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-800">Send feedback</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-800"><X size={20} /></button>
        </div>
        {body}
      </div>
    </div>
  );
}
