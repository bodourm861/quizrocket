'use client';
import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Answer, GameSession, Participant } from './types';

export type LinkState = 'connecting' | 'live' | 'reconnecting';

interface Handlers {
  onSession?: (row: GameSession) => void;
  onParticipant?: (row: Participant) => void;
  onAnswer?: (row: Answer) => void;
  onPresence?: (keys: string[]) => void;
  /** Called whenever we (re)connect, come back online, or while disconnected — reload from the database. */
  onResync: () => void;
}

interface Options {
  /** Unique key for presence (participant id for students, 'host' for the teacher). */
  presenceKey: string;
  /** Teacher: listen to every participant + every answer. Student: only their own participant row. */
  role: 'host' | 'player';
  participantId?: string;
}

/**
 * One realtime channel per screen. Supabase Realtime pushes database changes (filtered by
 * row-level security, so students only ever receive what they are allowed to read).
 * If the connection drops, the channel is rebuilt and the full state is re-read from the
 * database, so a student who loses Wi-Fi for a moment carries on where the class is.
 */
export function useGameChannel(db: SupabaseClient | null, sessionId: string | null, opts: Options, handlers: Handlers): LinkState {
  const [state, setState] = useState<LinkState>('connecting');
  const [attempt, setAttempt] = useState(0);
  const h = useRef(handlers);
  h.current = handlers;

  useEffect(() => {
    if (!db || !sessionId) return;
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const ch: RealtimeChannel = db.channel(`game-${sessionId}`, { config: { presence: { key: opts.presenceKey } } });

    ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_sessions', filter: `id=eq.${sessionId}` },
      (p) => h.current.onSession?.(p.new as GameSession));

    if (opts.role === 'host') {
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'participants', filter: `session_id=eq.${sessionId}` },
        (p) => { if (p.new && 'id' in p.new) h.current.onParticipant?.(p.new as Participant); });
      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'answers', filter: `session_id=eq.${sessionId}` },
        (p) => h.current.onAnswer?.(p.new as Answer));
    } else if (opts.participantId) {
      ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'participants', filter: `id=eq.${opts.participantId}` },
        (p) => h.current.onParticipant?.(p.new as Participant));
    }

    ch.on('presence', { event: 'sync' }, () => h.current.onPresence?.(Object.keys(ch.presenceState())));

    ch.subscribe(async (st) => {
      if (disposed) return;
      const status = String(st);
      if (status === 'SUBSCRIBED') {
        setState('live');
        h.current.onResync();
        try { await ch.track({ at: Date.now() }); } catch { /* presence is best-effort */ }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setState('reconnecting');
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => { if (!disposed) setAttempt((a) => a + 1); }, 2500);
      }
    });

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      db.removeChannel(ch);
    };
  }, [db, sessionId, opts.presenceKey, opts.role, opts.participantId, attempt]);

  // Safety net: re-read state when the device comes back online / the tab becomes visible,
  // and poll every 4 s while the realtime link is down.
  useEffect(() => {
    if (!sessionId) return;
    const resync = () => h.current.onResync();
    const onVis = () => { if (document.visibilityState === 'visible') resync(); };
    window.addEventListener('online', resync);
    document.addEventListener('visibilitychange', onVis);
    const poll = setInterval(() => { if (state !== 'live') resync(); }, 4000);
    return () => {
      window.removeEventListener('online', resync);
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(poll);
    };
  }, [sessionId, state]);

  return state;
}

/** Keeps whichever copy of the session row is newest (updates can arrive from RPC replies and realtime). */
export function newer(prev: GameSession | null, next: GameSession): GameSession {
  return !prev || (next.version ?? 0) >= (prev.version ?? 0) ? next : prev;
}
