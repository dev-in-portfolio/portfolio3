'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '$lib/supabase/client';

type MintRow = {
  id: string;
  week_start: string;
  total_seconds: number;
  session_count: number;
  flow_count: number;
  drag_count: number;
  top_tags: Array<{ tag: string; seconds: number }>;
  created_at: string;
};

function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function MintsPage() {
  const supabase = getSupabaseClient();
  const [mints, setMints] = useState<MintRow[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [filterTag, setFilterTag] = useState('');

  const currentWeek = useMemo(() => getWeekStart(), []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        window.location.href = '/login';
      }
    });
  }, []);

  async function loadMints() {
    const { data, error } = await supabase
      .from('sessionmint_weekly_mints')
      .select('id,week_start,total_seconds,session_count,flow_count,drag_count,top_tags,created_at')
      .order('week_start', { ascending: false });
    if (error) {
      setStatus(error.message);
      return;
    }
    setMints((data || []) as MintRow[]);
  }

  useEffect(() => {
    loadMints();
  }, []);

  async function mintWeek() {
    setLoading(true);
    const weekStart = currentWeek.toISOString().slice(0, 10);
    const { data, error } = await supabase.rpc('sessionmint_mint_week', { p_week_start: weekStart });
    if (error) {
      setStatus(error.message);
      setLoading(false);
      return;
    }
    setMints([data as MintRow, ...mints.filter((m) => m.week_start !== (data as MintRow).week_start)]);
    setLoading(false);
  }

  return (
    <div className="grid">
      <div className="card">
        <h2>Weekly mints</h2>
        <p className="muted">Generate weekly rollups of your sessions.</p>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button className="btn" onClick={mintWeek} disabled={loading}>
            {loading ? 'Minting...' : 'Mint this week'}
          </button>
          <span className="badge">Week of {currentWeek.toLocaleDateString()}</span>
        </div>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <input
            className="input"
            placeholder="Filter by tag"
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value)}
          />
        </div>
        {status && <p className="muted" style={{ marginTop: 12 }}>{status}</p>}
      </div>

      {mints.length === 0 ? (
        <div className="card">
          <p className="muted">No mints yet.</p>
        </div>
      ) : (
        mints
          .filter((mint) => {
            if (!filterTag) return true;
            return (mint.top_tags || []).some((row) => row.tag.toLowerCase().includes(filterTag.toLowerCase()));
          })
          .map((mint) => (
          <a key={mint.id} className="card" href={`/mint/${mint.week_start}`}>
            <div className="toolbar" style={{ justifyContent: 'space-between' }}>
              <strong>Week of {new Date(mint.week_start).toLocaleDateString()}</strong>
              <span className="badge">{Math.round(mint.total_seconds / 3600)}h</span>
            </div>
            <p className="muted">Sessions {mint.session_count} · Flow {mint.flow_count} · Drag {mint.drag_count}</p>
            {(mint.top_tags || []).length > 0 && (
              <div className="toolbar" style={{ marginTop: 8 }}>
                {mint.top_tags.map((row) => (
                  <span key={row.tag} className="badge">{row.tag}</span>
                ))}
              </div>
            )}
          </a>
        ))
      )}
    </div>
  );
}
