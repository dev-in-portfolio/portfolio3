'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
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

export default function MintDetailPage() {
  const supabase = getSupabaseClient();
  const params = useParams();
  const weekStart = params?.weekStart as string;
  const [mint, setMint] = useState<MintRow | null>(null);
  const [status, setStatus] = useState('');
  const [showMinutes, setShowMinutes] = useState(false);

  const hours = useMemo(() => {
    if (!mint) return 0;
    return Math.round(mint.total_seconds / 3600);
  }, [mint]);

  const minutes = useMemo(() => {
    if (!mint) return 0;
    return Math.round(mint.total_seconds / 60);
  }, [mint]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        window.location.href = '/login';
      }
    });
  }, []);

  async function loadMint() {
    const { data, error } = await supabase
      .from('sessionmint_weekly_mints')
      .select('id,week_start,total_seconds,session_count,flow_count,drag_count,top_tags,created_at')
      .eq('week_start', weekStart)
      .single();
    if (error) {
      setStatus(error.message);
      return;
    }
    setMint(data as MintRow);
  }

  useEffect(() => {
    if (!weekStart) return;
    loadMint();
  }, [weekStart]);

  if (!mint) {
    return (
      <div className="card">
        <p className="muted">Loading mint...</p>
        {status && <p className="muted">{status}</p>}
      </div>
    );
  }

  return (
    <div className="grid">
      <div className="card">
        <h2>Mint: Week of {new Date(mint.week_start).toLocaleDateString()}</h2>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <span className="badge">Total {showMinutes ? `${minutes}m` : `${hours}h`}</span>
          <span className="badge">Sessions {mint.session_count}</span>
          <span className="badge">Flow {mint.flow_count}</span>
          <span className="badge">Drag {mint.drag_count}</span>
        </div>
        <div className="toolbar" style={{ marginTop: 8 }}>
          <button className="btn secondary" onClick={() => setShowMinutes((prev) => !prev)}>
            {showMinutes ? 'Show hours' : 'Show minutes'}
          </button>
        </div>
        {status && <p className="muted" style={{ marginTop: 12 }}>{status}</p>}
      </div>

      <div className="card alt">
        <h3>Top tags</h3>
        {mint.top_tags.length === 0 ? (
          <p className="muted">No tagged sessions this week.</p>
        ) : (
          <div className="grid" style={{ marginTop: 12 }}>
            {mint.top_tags.map((row) => (
              <div key={row.tag} className="card">
                <strong>{row.tag}</strong>
                <p className="muted">{showMinutes ? `${Math.round(row.seconds / 60)} min` : `${Math.round(row.seconds / 3600)} h`}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
