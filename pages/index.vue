<script setup lang="ts">
import { useDeviceKey } from '~/composables/useDeviceKey';

const deviceKey = useDeviceKey();
const signals = ref<any[]>([]);
const polling = ref(true);
const filterStatus = ref('all');
const filterKind = ref('');
const sortMode = ref('severity');
const lastSync = ref('');
const error = ref('');
const newName = ref('');
const newKind = ref('generic');
const createStatus = ref('');

const fetchBoard = async () => {
  try {
    const { signals: data } = await $fetch('/api/signalgrid/board', {
      headers: { 'X-Device-Key': deviceKey },
    });
    signals.value = data;
    lastSync.value = new Date().toLocaleTimeString();
  } catch (err: any) {
    error.value = err?.message || 'Failed to load board';
  }
};

const createSignal = async () => {
  const name = newName.value.trim();
  if (!name) {
    createStatus.value = 'Enter a signal name first.';
    return;
  }
  try {
    await $fetch('/api/signalgrid/signals', {
      method: 'POST',
      headers: { 'X-Device-Key': deviceKey },
      body: { name, kind: newKind.value },
    });
    newName.value = '';
    createStatus.value = 'Signal created.';
    await fetchBoard();
  } catch (err: any) {
    createStatus.value = err?.message || 'Failed to create signal';
  }
};

const filtered = computed(() => {
  let rows = [...signals.value];
  if (filterStatus.value !== 'all') {
    rows = rows.filter((row) => row.status === filterStatus.value);
  }
  if (filterKind.value) {
    rows = rows.filter((row) => row.kind === filterKind.value);
  }
  if (sortMode.value === 'recent') {
    rows.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }
  return rows;
});

onMounted(() => {
  fetchBoard();
  setInterval(() => {
    if (polling.value) fetchBoard();
  }, 15000);
});
</script>

<template>
  <div class="page">
    <header class="hero">
      <h1>SignalGrid Board</h1>
      <p>Live status tiles with server-owned rule evaluation.</p>
    </header>
    <section class="panel controls">
      <input v-model="newName" placeholder="New signal name" />
      <input v-model="newKind" placeholder="Kind (generic, infra, app...)" />
      <button class="primary" @click="createSignal">Add Signal</button>
      <NuxtLink class="ghost" to="/manage">Bulk Manage</NuxtLink>
      <select v-model="filterStatus">
        <option value="all">All status</option>
        <option value="ok">OK</option>
        <option value="warn">WARN</option>
        <option value="bad">BAD</option>
      </select>
      <input v-model="filterKind" placeholder="Filter kind" />
      <select v-model="sortMode">
        <option value="severity">Severity</option>
        <option value="recent">Recent</option>
      </select>
      <button class="ghost" @click="polling = !polling">{{ polling ? 'Pause' : 'Resume' }}</button>
      <button class="primary" @click="fetchBoard">Refresh</button>
      <span class="pill">Last sync {{ lastSync }}</span>
    </section>
    <p v-if="createStatus" class="muted">{{ createStatus }}</p>
    <p v-if="error" class="muted">{{ error }}</p>
    <section class="grid">
      <article v-for="signal in filtered" :key="signal.id" class="card">
        <div class="row">
          <h3>{{ signal.name }}</h3>
          <span :class="['pill', signal.status]">{{ signal.status }}</span>
        </div>
        <p class="muted">{{ signal.kind }}</p>
        <p>{{ signal.note || 'No note' }}</p>
        <p class="muted">Value: {{ signal.value_num ?? '—' }} {{ signal.value_unit }}</p>
        <NuxtLink class="ghost" :to="`/signal/${signal.id}`">Open</NuxtLink>
      </article>
    </section>
  </div>
</template>

<style scoped>
.page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 40px 24px 64px;
}
.hero h1 {
  margin: 0 0 8px;
  font-size: clamp(28px, 4vw, 40px);
}
.hero p {
  color: #94a3b8;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}
.card {
  background: rgba(15, 23, 42, 0.75);
  border-radius: 16px;
  padding: 16px;
  border: 1px solid rgba(148, 163, 184, 0.2);
}
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.pill.ok { color: var(--ok); }
.pill.warn { color: var(--warn); }
.pill.bad { color: var(--bad); }
</style>
