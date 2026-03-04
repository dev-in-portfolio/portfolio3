'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { getSupabaseClient } from '$lib/supabase/client';

type Tag = {
  id: string;
  name: string;
  color: string;
};

type Edge = {
  id: string;
  from_tag: string;
  to_tag: string;
  kind: 'parent' | 'often_with' | 'opposite';
  weight: number;
};

type Thing = {
  id: string;
  title: string;
  body: string;
  url: string;
  created_at: string;
};

type NeighborhoodRow = {
  tag_id: string;
  depth: number;
};

export default function TagDetailPage() {
  const supabase = getSupabaseClient();
  const params = useParams();
  const tagId = params?.id as string;
  const [tag, setTag] = useState<Tag | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [things, setThings] = useState<Thing[]>([]);
  const [neighbors, setNeighbors] = useState<NeighborhoodRow[]>([]);
  const [edgeKind, setEdgeKind] = useState<Edge['kind']>('parent');
  const [edgeTarget, setEdgeTarget] = useState('');
  const [edgeWeight, setEdgeWeight] = useState(1);
  const [edgeFilter, setEdgeFilter] = useState<'all' | Edge['kind']>('all');
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [editWeight, setEditWeight] = useState(1);
  const [status, setStatus] = useState('');

  const neighborTags = useMemo(() => {
    return neighbors
      .filter((row) => row.tag_id !== tagId)
      .map((row) => ({
        ...row,
        tag: tags.find((t) => t.id === row.tag_id)
      }))
      .filter((row) => row.tag) as Array<NeighborhoodRow & { tag: Tag }>;
  }, [neighbors, tags, tagId]);

  const summary = useMemo(() => {
    return {
      edges: edges.length,
      neighbors: neighborTags.length,
      things: things.length
    };
  }, [edges.length, neighborTags.length, things.length]);

  const filteredEdges = useMemo(() => {
    if (edgeFilter === 'all') return edges;
    return edges.filter((edge) => edge.kind === edgeFilter);
  }, [edges, edgeFilter]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        window.location.href = '/login';
      }
    });
  }, []);

  async function loadTag() {
    const { data: tagData, error: tagError } = await supabase
      .from('tags')
      .select('id,name,color')
      .eq('id', tagId)
      .single();
    if (tagError) {
      setStatus(tagError.message);
      return;
    }
    setTag(tagData as Tag);

    const { data: allTags } = await supabase.from('tags').select('id,name,color').order('name', { ascending: true });
    setTags((allTags || []) as Tag[]);

    const { data: edgeData, error: edgeError } = await supabase
      .from('tag_edges')
      .select('id,from_tag,to_tag,kind,weight')
      .or(`from_tag.eq.${tagId},to_tag.eq.${tagId}`);
    if (edgeError) {
      setStatus(edgeError.message);
      return;
    }
    setEdges((edgeData || []) as Edge[]);

    const { data: neighData, error: neighError } = await supabase.rpc('tag_neighborhood', { p_tag: tagId, p_hops: 2 });
    if (neighError) {
      setStatus(neighError.message);
    } else {
      setNeighbors((neighData || []) as NeighborhoodRow[]);
    }

    const { data: thingData, error: thingError } = await supabase
      .from('things')
      .select('id,title,body,url,created_at,thing_tags(tag_id)')
      .order('created_at', { ascending: false });
    if (thingError) {
      setStatus(thingError.message);
      return;
    }
    const filteredThings = (thingData || []).filter((thing: any) =>
      (thing.thing_tags || []).some((tt: any) => tt.tag_id === tagId)
    );
    setThings(filteredThings as Thing[]);
  }

  useEffect(() => {
    if (!tagId) return;
    loadTag();
  }, [tagId]);

  async function addEdge() {
    if (!edgeTarget) {
      setStatus('Choose a target tag.');
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setStatus('Session expired.');
      return;
    }
    const { data, error } = await supabase
      .from('tag_edges')
      .insert({
        user_id: userData.user.id,
        from_tag: tagId,
        to_tag: edgeTarget,
        kind: edgeKind,
        weight: edgeWeight
      })
      .select('id,from_tag,to_tag,kind,weight')
      .single();
    if (error) {
      setStatus(error.message);
      return;
    }
    setEdges([...(edges || []), data as Edge]);
    setEdgeTarget('');
  }

  async function removeEdge(id: string) {
    const { error } = await supabase.from('tag_edges').delete().eq('id', id);
    if (error) {
      setStatus(error.message);
      return;
    }
    setEdges(edges.filter((edge) => edge.id !== id));
  }

  async function saveEdgeWeight(edge: Edge) {
    const { data, error } = await supabase
      .from('tag_edges')
      .update({ weight: editWeight })
      .eq('id', edge.id)
      .select('id,from_tag,to_tag,kind,weight')
      .single();
    if (error) {
      setStatus(error.message);
      return;
    }
    setEdges(edges.map((e) => (e.id === edge.id ? (data as Edge) : e)));
    setEditingEdgeId(null);
  }

  if (!tag) {
    return (
      <div className="card">
        <p className="muted">Loading tag...</p>
        {status && <p className="muted">{status}</p>}
      </div>
    );
  }

  return (
    <div className="grid">
      <div className="card">
        <h2>{tag.name}</h2>
        <p className="muted">Tag neighborhood and relationships.</p>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <span className="badge">Edges {summary.edges}</span>
          <span className="badge">Neighbors {summary.neighbors}</span>
          <span className="badge">Things {summary.things}</span>
        </div>
        {status && <p className="muted">{status}</p>}
      </div>

      <div className="card">
        <h3>Add edge</h3>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <select className="input" value={edgeKind} onChange={(e) => setEdgeKind(e.target.value as Edge['kind'])}>
            <option value="parent">Parent</option>
            <option value="often_with">Often with</option>
            <option value="opposite">Opposite</option>
          </select>
          <select className="input" value={edgeTarget} onChange={(e) => setEdgeTarget(e.target.value)}>
            <option value="">Select target</option>
            {tags.filter((t) => t.id !== tagId).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <input
            className="input"
            type="number"
            min={1}
            max={5}
            value={edgeWeight}
            onChange={(e) => setEdgeWeight(Number(e.target.value))}
          />
          <button className="btn" onClick={addEdge}>Add edge</button>
        </div>
      </div>

      <div className="card alt">
        <h3>Edges</h3>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <span className="muted">Filter:</span>
          <select className="input" value={edgeFilter} onChange={(e) => setEdgeFilter(e.target.value as 'all' | Edge['kind'])}>
            <option value="all">All</option>
            <option value="parent">Parent</option>
            <option value="often_with">Often with</option>
            <option value="opposite">Opposite</option>
          </select>
        </div>
        {filteredEdges.length === 0 ? (
          <p className="muted">No edges yet.</p>
        ) : (
          <div className="grid" style={{ marginTop: 12 }}>
            {filteredEdges.map((edge) => (
              <div key={edge.id} className="card">
                <div className="toolbar" style={{ justifyContent: 'space-between' }}>
                  <strong>{edge.kind}</strong>
                  <button className="btn danger" onClick={() => removeEdge(edge.id)}>Delete</button>
                </div>
                <p className="muted">{edge.from_tag === tagId ? 'From' : 'To'} {edge.from_tag === tagId ? tag.name : tags.find((t) => t.id === edge.from_tag)?.name}</p>
                <p className="muted">{edge.to_tag === tagId ? tag.name : tags.find((t) => t.id === edge.to_tag)?.name}</p>
                {editingEdgeId === edge.id ? (
                  <div className="toolbar">
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={5}
                      value={editWeight}
                      onChange={(e) => setEditWeight(Number(e.target.value))}
                    />
                    <button className="btn secondary" onClick={() => saveEdgeWeight(edge)}>Save</button>
                    <button className="btn secondary" onClick={() => setEditingEdgeId(null)}>Cancel</button>
                  </div>
                ) : (
                  <div className="toolbar">
                    <span className="muted">Weight {edge.weight}</span>
                    <button className="btn secondary" onClick={() => { setEditingEdgeId(edge.id); setEditWeight(edge.weight); }}>
                      Edit weight
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card alt">
        <h3>Neighborhood (2 hops)</h3>
        {neighborTags.length === 0 ? (
          <p className="muted">No neighbors yet.</p>
        ) : (
          <div className="grid" style={{ marginTop: 12 }}>
            {neighborTags.map((row) => (
              <a key={row.tag_id} className="card" href={`/tag/${row.tag_id}`}>
                <div className="toolbar" style={{ justifyContent: 'space-between' }}>
                  <strong>{row.tag.name}</strong>
                  <span className="badge">Depth {row.depth}</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3>Things with this tag</h3>
        {things.length === 0 ? (
          <p className="muted">No things attached yet.</p>
        ) : (
          <div className="grid" style={{ marginTop: 12 }}>
            {things.map((thing) => (
              <div key={thing.id} className="card">
                <strong>{thing.title}</strong>
                <p className="muted">{thing.body || 'No notes'}</p>
                {thing.url && (
                  <a className="link" href={thing.url} target="_blank" rel="noreferrer">{thing.url}</a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
