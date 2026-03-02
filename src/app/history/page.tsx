'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
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

export default function HistoryPage() {
  const supabase = getSupabaseClient();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [status, setStatus] = useState('');
  const [filter, setFilter] = useState('');
  const [feelFilter, setFeelFilter] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        window.location.href = '/login';
      }
    });
  }, []);

  async function loadSessions() {
    const { data, error } = await supabase
      .from('sessionmint_sessions')
      .select('id,started_at,ended_at,duration_seconds,tag,feel,note')
      .order('started_at', { ascending: false });
    if (error) {
      setStatus(error.message);
      return;
    }
    setSessions((data || []) as SessionRow[]);
  }

  useEffect(() => {
    loadSessions();
  }, []);

  async function deleteSession(id: string) {
    if (!confirm('Delete this session?')) return;
    const { error } = await supabase.from('sessionmint_sessions').delete().eq('id', id);
    if (error) {
      setStatus(error.message);
      return;
    }
    setSessions(sessions.filter((s) => s.id !== id));
  }

  async function bulkDelete() {
    if (!confirm('Delete selected sessions?')) return;
    const ids = Object.entries(selected).filter(([, v]) => v).map(([id]) => id);
    if (!ids.length) return;
    const { error } = await supabase.from('sessionmint_sessions').delete().in('id', ids);
    if (error) {
      setStatus(error.message);
      return;
    }
    setSessions(sessions.filter((s) => !ids.includes(s.id)));
    setSelected({});
  }

  return (
    <div className="grid">
      <div className="card">
        <h2>Session history</h2>
        <p className="muted">Review and clean up your session log.</p>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <input className="input" placeholder="Search tag" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <select className="input" value={feelFilter} onChange={(e) => setFeelFilter(e.target.value)}>
            <option value="">All feels</option>
            <option value="flow">Flow</option>
            <option value="neutral">Neutral</option>
            <option value="drag">Drag</option>
          </select>
          <button className="btn danger" onClick={bulkDelete}>Delete selected</button>
        </div>
        {status && <p className="muted" style={{ marginTop: 12 }}>{status}</p>}
      </div>

      {sessions.length === 0 ? (
        <div className="card">
          <p className="muted">No sessions logged.</p>
        </div>
      ) : (
        sessions
          .filter((session) => {
            const tagMatch = !filter || session.tag.toLowerCase().includes(filter.toLowerCase());
            const feelMatch = !feelFilter || session.feel === feelFilter;
            return tagMatch && feelMatch;
          })
          .map((session) => (
          <div key={session.id} className="card">
            <div className="toolbar" style={{ justifyContent: 'space-between' }}>
              <div className="toolbar">
                <input
                  type="checkbox"
                  checked={!!selected[session.id]}
                  onChange={(e) => setSelected((prev) => ({ ...prev, [session.id]: e.target.checked }))}
                />
                <strong>{session.tag}</strong>
              </div>
              <button className="btn danger" onClick={() => deleteSession(session.id)}>Delete</button>
            </div>
            <p className="muted">{session.feel} · {Math.round(session.duration_seconds / 60)} min</p>
            {session.note && <p className="muted">{session.note}</p>}
            <p className="muted">{new Date(session.started_at).toLocaleString()}</p>
          </div>
        ))
      )}
    </div>
  );
}
