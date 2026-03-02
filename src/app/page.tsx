'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '$lib/supabase/client';

type SessionRow = {
  id: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  tag: string;
  feel: 'drag' | 'neutral' | 'flow';
  note: string;
};

export default function SessionPage() {
  const supabase = getSupabaseClient();
  const [activeStart, setActiveStart] = useState<Date | null>(null);
  const [tag, setTag] = useState('Deep work');
  const [feel, setFeel] = useState<SessionRow['feel']>('neutral');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('');
  const [recent, setRecent] = useState<SessionRow[]>([]);
  const [presets] = useState([
    { tag: 'Deep work', feel: 'flow' as const, note: '' },
    { tag: 'Admin', feel: 'neutral' as const, note: '' },
    { tag: 'Meetings', feel: 'drag' as const, note: '' }
  ]);

  const elapsed = useMemo(() => {
    if (!activeStart) return 0;
    return Math.floor((Date.now() - activeStart.getTime()) / 1000);
  }, [activeStart]);

  const feelCounts = useMemo(() => {
    return recent.reduce(
      (acc, session) => {
        acc[session.feel] += 1;
        return acc;
      },
      { drag: 0, neutral: 0, flow: 0 } as Record<SessionRow['feel'], number>
    );
  }, [recent]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        window.location.href = '/login';
      }
    });
  }, []);

  useEffect(() => {
    if (!activeStart) return;
    const id = setInterval(() => {
      setActiveStart((prev) => (prev ? new Date(prev.getTime()) : prev));
    }, 1000);
    return () => clearInterval(id);
  }, [activeStart]);

  async function loadRecent() {
    const { data, error } = await supabase
      .from('sessionmint_sessions')
      .select('id,started_at,ended_at,duration_seconds,tag,feel,note')
      .order('started_at', { ascending: false })
      .limit(5);
    if (error) {
      setStatus(error.message);
      return;
    }
    setRecent((data || []) as SessionRow[]);
  }

  useEffect(() => {
    loadRecent();
  }, []);

  function startSession() {
    if (activeStart) return;
    setActiveStart(new Date());
  }

  async function stopSession() {
    if (!activeStart) return;
    const ended = new Date();
    const duration = Math.max(0, Math.floor((ended.getTime() - activeStart.getTime()) / 1000));
    if (duration < 60) {
      setStatus('Session too short (min 60s).');
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setStatus('Session expired.');
      return;
    }
    const { data, error } = await supabase
      .from('sessionmint_sessions')
      .insert({
        user_id: userData.user.id,
        started_at: activeStart.toISOString(),
        ended_at: ended.toISOString(),
        duration_seconds: duration,
        tag: tag.trim() || 'Session',
        feel,
        note: note.trim()
      })
      .select('id,started_at,ended_at,duration_seconds,tag,feel,note')
      .single();
    if (error) {
      setStatus(error.message);
      return;
    }
    setRecent([data as SessionRow, ...recent].slice(0, 5));
    setActiveStart(null);
    setNote('');
  }

  function applyPreset(preset: { tag: string; feel: SessionRow['feel']; note: string }) {
    setTag(preset.tag);
    setFeel(preset.feel);
    setNote(preset.note);
  }

  function repeatLast() {
    if (recent.length === 0) return;
    const last = recent[0];
    setTag(last.tag);
    setFeel(last.feel);
    setNote(last.note || '');
  }

  return (
    <div className="grid">
      <div className="card">
        <h2>Session Logger</h2>
        <p className="muted">Track focused work and feelings.</p>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <input className="input" placeholder="Tag" value={tag} onChange={(e) => setTag(e.target.value)} />
          <select className="input" value={feel} onChange={(e) => setFeel(e.target.value as SessionRow['feel'])}>
            <option value="drag">Drag</option>
            <option value="neutral">Neutral</option>
            <option value="flow">Flow</option>
          </select>
          <button className="btn secondary" onClick={repeatLast} disabled={recent.length === 0}>Repeat last</button>
        </div>
        <textarea placeholder="Notes" value={note} onChange={(e) => setNote(e.target.value)} style={{ marginTop: 12 }} />
        <div className="toolbar" style={{ marginTop: 12 }}>
          {presets.map((preset) => (
            <button key={preset.tag} className="btn secondary" onClick={() => applyPreset(preset)}>
              {preset.tag} · {preset.feel}
            </button>
          ))}
        </div>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button className="btn" onClick={startSession} disabled={!!activeStart}>Start</button>
          <button className="btn secondary" onClick={stopSession} disabled={!activeStart}>Stop</button>
          <span className="badge">Elapsed {Math.floor(elapsed / 60)}m {elapsed % 60}s</span>
        </div>
        {status && <p className="muted" style={{ marginTop: 12 }}>{status}</p>}
      </div>

      <div className="card alt">
        <h3>Recent sessions</h3>
        <div className="toolbar" style={{ marginTop: 8 }}>
          <span className="badge">Flow {feelCounts.flow}</span>
          <span className="badge">Neutral {feelCounts.neutral}</span>
          <span className="badge">Drag {feelCounts.drag}</span>
        </div>
        {recent.length === 0 ? (
          <p className="muted">No sessions yet.</p>
        ) : (
          <div className="grid" style={{ marginTop: 12 }}>
            {recent.map((session) => (
              <div key={session.id} className="card">
                <div className="toolbar" style={{ justifyContent: 'space-between' }}>
                  <strong>{session.tag}</strong>
                  <span className="badge">{session.feel}</span>
                </div>
                <p className="muted">{Math.round(session.duration_seconds / 60)} min</p>
                <p className="muted">{new Date(session.started_at).toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
