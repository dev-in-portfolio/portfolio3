const repoPanel = document.getElementById("repo-panel");
const detailPanel = document.getElementById("detail-panel");
const logPanel = document.getElementById("log-panel");
const statusBar = document.getElementById("status-bar");

const WEB_KEY = "dockyard.web.config.v1";
const isElectron = Boolean(window.dockyard);
const logListeners = [];
const exitListeners = [];

function defaultConfig() {
  return {
    repos: [],
    presets: [{ name: "local", env: {} }],
  };
}

function loadWebConfig() {
  try {
    const raw = localStorage.getItem(WEB_KEY);
    return raw ? JSON.parse(raw) : defaultConfig();
  } catch {
    return defaultConfig();
  }
}

function saveWebConfig(config) {
  localStorage.setItem(WEB_KEY, JSON.stringify(config));
}

const api = isElectron
  ? window.dockyard
  : {
      async loadConfig() {
        return loadWebConfig();
      },
      async saveConfig(config) {
        saveWebConfig(config);
      },
      async selectFolder() {
        const value = window.prompt("Web mode: enter a repo label/path", "demo-repo");
        return value ? value.trim() : "";
      },
      async checkNodeModules() {
        return true;
      },
      async checkPort() {
        return false;
      },
      async runRepo({ repo, command }) {
        const line = `web mode: simulated run for ${repo.name} -> ${command}\n`;
        logListeners.forEach((handler) => handler({ repoId: repo.id, line }));
      },
      async stopRepo(repoId) {
        exitListeners.forEach((handler) => handler({ repoId, code: 0 }));
      },
      onLog(handler) {
        logListeners.push(handler);
      },
      onExit(handler) {
        exitListeners.push(handler);
      },
    };

const state = {
  config: null,
  activeRepo: null,
  logs: {},
  running: {},
};

function renderRepos() {
  const repos = state.config.repos;
  repoPanel.innerHTML = `
    <h2>Repos</h2>
    <button id="add-repo">Add Repo</button>
    <div id="repo-list"></div>
  `;
  const list = document.getElementById("repo-list");
  repos.forEach((repo) => {
    const div = document.createElement("div");
    div.className = `repo-item ${state.activeRepo?.id === repo.id ? "active" : ""}`;
    div.textContent = repo.name;
    div.onclick = () => {
      state.activeRepo = repo;
      renderDetail();
      renderRepos();
    };
    list.appendChild(div);
  });

  document.getElementById("add-repo").onclick = async () => {
    const path = await api.selectFolder();
    if (!path) return;
    const parts = path.split(/[\\/]/);
    const repo = {
      id: crypto.randomUUID(),
      name: parts[parts.length - 1] || path,
      path,
      commands: { dev: "npm run dev", build: "npm run build", test: "npm test", lint: "npm run lint" },
      ports: [3000],
      envPresetBindings: { local: ".env" },
    };
    state.config.repos.push(repo);
    await api.saveConfig(state.config);
    renderRepos();
  };
}

function renderDetail() {
  if (!state.activeRepo) {
    detailPanel.innerHTML = `<h2>Details</h2><p>Select a repo.</p>`;
    return;
  }
  const repo = state.activeRepo;
  detailPanel.innerHTML = `
    <h2>${repo.name}</h2>
    <label>Path</label>
    <input id="repo-path" value="${repo.path}" />
    <label>Dev Command</label>
    <input id="cmd-dev" value="${repo.commands.dev}" />
    <label>Build Command</label>
    <input id="cmd-build" value="${repo.commands.build}" />
    <label>Test Command</label>
    <input id="cmd-test" value="${repo.commands.test}" />
    <label>Lint Command</label>
    <input id="cmd-lint" value="${repo.commands.lint}" />
    <label>Ports (comma)</label>
    <input id="repo-ports" value="${repo.ports.join(",")}" />
    <label>Preset</label>
    <select id="preset-select">
      ${state.config.presets.map((p) => `<option value="${p.name}">${p.name}</option>`).join("")}
    </select>
    <label>Env overrides (KEY=VALUE per line)</label>
    <textarea id="env-overrides"></textarea>
    <button id="save-repo">Save</button>
    <button id="run-dev">Start Dev</button>
    <button id="stop-dev">Stop</button>
    <div id="detail-status"></div>
  `;

  document.getElementById("save-repo").onclick = async () => {
    repo.path = document.getElementById("repo-path").value.trim();
    repo.commands.dev = document.getElementById("cmd-dev").value.trim();
    repo.commands.build = document.getElementById("cmd-build").value.trim();
    repo.commands.test = document.getElementById("cmd-test").value.trim();
    repo.commands.lint = document.getElementById("cmd-lint").value.trim();
    repo.ports = document
      .getElementById("repo-ports")
      .value.split(",")
      .map((p) => Number(p.trim()))
      .filter(Boolean);
    await api.saveConfig(state.config);
  };

  document.getElementById("run-dev").onclick = async () => {
    const status = document.getElementById("detail-status");
    try {
      const presetName = document.getElementById("preset-select").value;
      const preset = state.config.presets.find((p) => p.name === presetName);
      const overrides = parseOverrides(document.getElementById("env-overrides").value);
      const portInUse = await api.checkPort(repo.ports[0]);
      if (portInUse) {
        status.textContent = "Port already in use.";
        return;
      }
      const hasModules = await api.checkNodeModules(repo.path);
      if (!hasModules) {
        status.textContent = "node_modules missing. Run install.";
        return;
      }
      await api.runRepo({ repo, command: repo.commands.dev, preset, overrides });
      status.textContent = isElectron ? "Dev server started." : "Web mode simulated run started.";
      state.running[repo.id] = true;
      renderStatus();
    } catch (err) {
      status.textContent = err.message;
    }
  };

  document.getElementById("stop-dev").onclick = async () => {
    await api.stopRepo(repo.id);
    state.running[repo.id] = false;
    renderStatus();
  };
}

function parseOverrides(text) {
  const env = {};
  text.split(/\r?\n/).forEach((line) => {
    if (!line.includes("=")) return;
    const [key, ...rest] = line.split("=");
    env[key.trim()] = rest.join("=").trim();
  });
  return env;
}

function renderLogs() {
  logPanel.innerHTML = `
    <h2>Logs</h2>
    <div class="log-box" id="log-box"></div>
  `;
}

function renderStatus() {
  const badges = Object.entries(state.running)
    .map(([id, running]) => {
      const repo = state.config.repos.find((r) => r.id === id);
      if (!repo) return "";
      return `<span>${repo.name}: ${running ? "running" : "stopped"}</span>`;
    })
    .join("");

  const mode = isElectron ? "Desktop mode" : "Web preview mode";
  statusBar.innerHTML = `<span>${mode}</span>${badges}`;
}

api.onLog(({ repoId, line }) => {
  const box = document.getElementById("log-box");
  if (!box) return;
  box.textContent += `[${repoId.slice(0, 4)}] ${line}`;
  box.scrollTop = box.scrollHeight;
});

api.onExit(({ repoId }) => {
  state.running[repoId] = false;
  renderStatus();
});

async function init() {
  state.config = await api.loadConfig();
  if (!state.config?.repos || !state.config?.presets) {
    state.config = defaultConfig();
  }
  renderRepos();
  renderDetail();
  renderLogs();
  renderStatus();
}

init();
