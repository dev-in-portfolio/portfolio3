'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '$lib/supabase/client';

type Thing = {
  id: string;
  title: string;
  body: string;
  url: string;
  created_at: string;
};

type Tag = {
  id: string;
  name: string;
  color: string;
};

export default function ThingsPage() {
  const supabase = getSupabaseClient();
  const [things, setThings] = useState<Thing[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState('');
  const [status, setStatus] = useState('');
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter) return things;
    const needle = filter.toLowerCase();
    return things.filter((thing) => thing.title.toLowerCase().includes(needle) || thing.body.toLowerCase().includes(needle));
  }, [filter, things]);

  const filteredByTag = useMemo(() => {
    if (!tagFilter) return filtered;
    return filtered.filter((thing: any) => (thing.tag_ids || []).includes(tagFilter));
  }, [filtered, tagFilter]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        window.location.href = '/login';
      }
    });
  }, []);

  async function loadThings() {
    const { data: thingData, error: thingError } = await supabase
      .from('things')
      .select('id,title,body,url,created_at,thing_tags(tag_id)')
      .order('created_at', { ascending: false });
    if (thingError) {
      setStatus(thingError.message);
      return;
    }
    const mapped = (thingData || []).map((thing: any) => ({
      ...thing,
      tag_ids: (thing.thing_tags || []).map((tt: any) => tt.tag_id)
    }));
    setThings(mapped as Thing[]);

    const { data: tagData } = await supabase
      .from('tags')
      .select('id,name,color')
      .order('name', { ascending: true });
    setTags((tagData || []) as Tag[]);
  }

  useEffect(() => {
    loadThings();
  }, []);

  function toggleTag(id: string) {
    setSelectedTags((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  async function createThing() {
    if (!title.trim()) {
      setStatus('Title required.');
      return;
    }
    if (url.trim() && !/^https?:\/\//i.test(url.trim())) {
      setStatus('URL must start with http:// or https://');
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setStatus('Session expired.');
      return;
    }
    const { data, error } = await supabase
      .from('things')
      .insert({
        user_id: userData.user.id,
        title: title.trim(),
        body: body.trim(),
        url: url.trim()
      })
      .select('id,title,body,url,created_at')
      .single();
    if (error) {
      setStatus(error.message);
      return;
    }

    if (selectedTags.length > 0) {
      const rows = selectedTags.map((tagId) => ({ thing_id: (data as Thing).id, tag_id: tagId }));
      const { error: mapError } = await supabase.from('thing_tags').insert(rows);
      if (mapError) {
        setStatus(mapError.message);
      }
    }

    setThings([data as Thing, ...things]);
    setTitle('');
    setBody('');
    setUrl('');
    setSelectedTags([]);
  }

  async function removeThing(id: string) {
    if (!confirm('Delete this thing?')) return;
    const { error } = await supabase.from('things').delete().eq('id', id);
    if (error) {
      setStatus(error.message);
      return;
    }
    setThings(things.filter((thing) => thing.id !== id));
  }

  return (
    <div className="grid">
      <div className="card">
        <h2>Create thing</h2>
        <p className="muted">Attach notes or links to tags.</p>
        <div className="grid" style={{ marginTop: 12 }}>
          <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea placeholder="Notes" value={body} onChange={(e) => setBody(e.target.value)} />
          <input className="input" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
          <div className="toolbar">
            {tags.map((tag) => (
              <button
                key={tag.id}
                className={selectedTags.includes(tag.id) ? 'btn' : 'btn secondary'}
                onClick={() => toggleTag(tag.id)}
                style={{ borderColor: tag.color, color: selectedTags.includes(tag.id) ? '#04131d' : tag.color }}
              >
                {tag.name}
              </button>
            ))}
          </div>
          <button className="btn" onClick={createThing}>Add thing</button>
        </div>
        {status && <p className="muted" style={{ marginTop: 12 }}>{status}</p>}
      </div>

      <div className="card alt">
        <div className="toolbar" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0 }}>Your things</h2>
            <p className="muted" style={{ marginTop: 6 }}>Filter and explore attached tags.</p>
          </div>
          <div className="toolbar">
            <input className="input" placeholder="Search" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <select className="input" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
              <option value="">All tags</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {filteredByTag.length === 0 ? (
        <div className="card">
          <p className="muted">No things yet.</p>
        </div>
      ) : (
        filteredByTag.map((thing: any) => (
          <div key={thing.id} className="card">
            <div className="toolbar" style={{ justifyContent: 'space-between' }}>
              <strong>{thing.title}</strong>
              <button className="btn danger" onClick={() => removeThing(thing.id)}>Delete</button>
            </div>
            <p className="muted">{thing.body || 'No notes'}</p>
            {thing.url && (
              <a className="link" href={thing.url} target="_blank" rel="noreferrer">{thing.url}</a>
            )}
            {thing.tag_ids?.length > 0 && (
              <div className="toolbar" style={{ marginTop: 8 }}>
                {thing.tag_ids.map((tagId: string) => {
                  const tag = tags.find((t) => t.id === tagId);
                  if (!tag) return null;
                  return (
                    <span key={tag.id} className="badge" style={{ borderColor: tag.color, color: tag.color }}>
                      {tag.name}
                    </span>
                  );
                })}
              </div>
            )}
            <p className="muted">Created {new Date(thing.created_at).toLocaleString()}</p>
          </div>
        ))
      )}
    </div>
  );
}
