import {
  createForm,
  deleteForm,
  deleteResponse,
  exportResponsesCsv,
  getForm,
  getPublicForm,
  listForms,
  listResponses,
  publishForm,
  submitPublicForm,
  updateForm,
} from "./modules/api.js";
import {
  resetDraftToActiveForm,
  setActiveForm,
  setBackendReady,
  setBusy,
  setForms,
  setResponses,
  setTemplate,
  state,
  updateDraftSchema,
} from "./modules/state.js";
import {
  FIELD_TYPES,
  TEMPLATE_LIBRARY,
  copyToClipboard,
  countFields,
  createField,
  createSection,
  createTemplateSchema,
  downloadFile,
  escapeHtml,
  formatDateTime,
  normalizeSchema,
  optionsToText,
  relativeTime,
  slugify,
  summarizeResponses,
  textToOptions,
  validateSchema,
} from "./modules/utils.js";

const app = document.getElementById("app");
const toastStack = document.getElementById("toast-stack");

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastStack.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2800);
}

function getPublicUrl(slug) {
  return `${window.location.origin}/f/${slug}`;
}

function renderWorkspace() {
  const draftSummary = summarizeResponses(state.responses);
  const totalForms = state.forms.length;
  const publishedForms = state.forms.filter((form) => form.status === "published").length;
  const activeFieldCount = countFields(state.draftSchema);
  const latestActive = state.activeForm?.updated_at
    ? relativeTime(state.activeForm.updated_at)
    : "No form selected";

  app.innerHTML = `
    <section class="section-stack">
      <div class="metrics">
        <article class="metric-card">
          <span>Forms</span>
          <strong>${totalForms}</strong>
        </article>
        <article class="metric-card">
          <span>Published</span>
          <strong>${publishedForms}</strong>
        </article>
        <article class="metric-card">
          <span>Fields in Studio</span>
          <strong>${activeFieldCount}</strong>
        </article>
        <article class="metric-card">
          <span>Latest movement</span>
          <strong style="font-size:22px;">${escapeHtml(latestActive)}</strong>
        </article>
      </div>

      <section class="workspace">
        <aside class="left-rail">
          <section class="panel">
            <div class="panel-inner">
              <div class="panel-heading">
                <div>
                  <p class="panel-kicker">Command Deck</p>
                  <h2>Launch a sharp form</h2>
                  <p class="panel-copy">Start from a better-than-generic template, then tune it in the studio.</p>
                </div>
                <span class="status-pill ${state.backendReady ? "ready" : "offline"}">
                  ${state.backendReady ? "API ready" : "API unavailable"}
                </span>
              </div>
              ${renderCreateCard()}
            </div>
          </section>

          <section class="panel">
            <div class="panel-inner">
              <div class="panel-heading">
                <div>
                  <p class="panel-kicker">Library</p>
                  <h2>Form inventory</h2>
                  <p class="panel-copy">Jump straight into editing, responses, publishing, or cleanup.</p>
                </div>
              </div>
              ${renderFormsList()}
            </div>
          </section>
        </aside>

        <section class="main-stage">
          <section class="panel">
            <div class="panel-inner">
              <div class="panel-heading">
                <div>
                  <p class="panel-kicker">Studio</p>
                  <h2>${escapeHtml(state.activeForm ? state.activeForm.name : "Design the next form")}</h2>
                  <p class="panel-copy">
                    Use the visual composer for shape and tone, and the JSON editor for exact control.
                  </p>
                </div>
                <div class="inline-actions">
                  <button class="ghost-button" id="reset-draft" ${state.activeForm ? "" : "disabled"}>Reset draft</button>
                  <button class="button" id="save-form" ${state.activeForm ? "" : "disabled"}>
                    ${state.busy.save ? "Saving..." : "Save form"}
                  </button>
                </div>
              </div>
              ${renderBuilderStudio()}
            </div>
          </section>
        </section>

        <aside class="right-rail">
          <section class="panel">
            <div class="panel-inner">
              <div class="panel-heading">
                <div>
                  <p class="panel-kicker">Publish</p>
                  <h2>Respondent experience</h2>
                  <p class="panel-copy">Preview the public-facing form before you publish or share it.</p>
                </div>
              </div>
              ${renderPublicPanel()}
            </div>
          </section>

          <section class="panel">
            <div class="panel-inner">
              <div class="panel-heading">
                <div>
                  <p class="panel-kicker">Inbox</p>
                  <h2>Response review</h2>
                  <p class="panel-copy">Watch volume, inspect payloads, and export a clean handoff.</p>
                </div>
              </div>
              ${renderInboxPanel(draftSummary)}
            </div>
          </section>
        </aside>
      </section>
    </section>
  `;

  bindWorkspaceEvents();
}

function renderCreateCard() {
  return `
    <div class="section-stack">
      <div class="stacked-field">
        <label for="create-name">Form name</label>
        <input id="create-name" autocomplete="off" value="${escapeHtml(
          state.createName
        )}" placeholder="Signal Intake" />
      </div>
      <div class="stacked-field">
        <label for="template-select">Template</label>
        <select id="template-select">
          ${TEMPLATE_LIBRARY.map(
            (template) => `
              <option value="${template.id}" ${template.id === state.selectedTemplate ? "selected" : ""}>
                ${escapeHtml(template.label)}
              </option>
            `
          ).join("")}
        </select>
      </div>
      <div class="template-list">
        ${TEMPLATE_LIBRARY.map(
          (template) => `
            <article class="template-card ${template.id === state.selectedTemplate ? "active" : ""}" data-template-card="${
              template.id
            }">
              <div class="template-chip">${escapeHtml(template.label)}</div>
              <h4>${escapeHtml(template.summary)}</h4>
              <p>${escapeHtml(template.schema.description)}</p>
            </article>
          `
        ).join("")}
      </div>
      <div class="button-row">
        <button class="button" id="create-form">
          ${state.busy.create ? "Creating..." : "Create from template"}
        </button>
        <button class="ghost-button" id="load-template">Load into studio</button>
      </div>
    </div>
  `;
}

function renderFormsList() {
  if (!state.forms.length) {
    return `
      <div class="empty-state">
        <p>No forms yet. Start with a template, publish it, and this rail becomes your operating index.</p>
      </div>
    `;
  }

  return `
    <div class="forms-list">
      ${state.forms
        .map((form) => {
          const fieldCount = countFields(normalizeSchema(form.schema));
          return `
            <article class="form-card ${state.activeForm?.id === form.id ? "active" : ""}">
              <header>
                <div>
                  <div class="meta-badge">${escapeHtml(form.status)}</div>
                  <h4>${escapeHtml(form.name)}</h4>
                  <p>${fieldCount} fields across ${form.schema?.sections?.length || 0} sections</p>
                </div>
                <div class="small-meta">${relativeTime(form.updated_at)}</div>
              </header>
              <div class="split-actions" style="margin-top:12px;">
                <button class="ghost-button" data-action="open" data-id="${form.id}">Open</button>
                <button class="ghost-button" data-action="responses" data-id="${form.id}">Responses</button>
                <button class="pill-button" data-action="publish" data-id="${form.id}">
                  ${form.public_slug ? "Republish" : "Publish"}
                </button>
                <button class="danger-button" data-action="delete" data-id="${form.id}">Delete</button>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderBuilderStudio() {
  if (!state.activeForm) {
    return `
      <div class="empty-state">
        <p>The studio wakes up once you create or open a form. Load a template into the studio to pre-compose a stronger starting point.</p>
      </div>
      ${renderDraftPreview()}
    `;
  }

  const schemaErrors = validateSchema(state.draftSchema);

  return `
    <div class="builder-grid">
      <div class="builder-column">
        <article class="command-card">
          <div class="field-grid">
            <div class="stacked-field">
              <label for="builder-form-name">Workspace name</label>
              <input id="builder-form-name" autocomplete="off" value="${escapeHtml(
                state.activeForm.name
              )}" />
            </div>
            <div class="stacked-field">
              <label for="builder-title">Public title</label>
              <input id="builder-title" autocomplete="off" value="${escapeHtml(
                state.draftSchema.title
              )}" />
            </div>
          </div>
          <div class="stacked-field" style="margin-top:12px;">
            <label for="builder-description">Public description</label>
            <textarea id="builder-description">${escapeHtml(state.draftSchema.description || "")}</textarea>
          </div>
        </article>

        <article class="command-card">
          <div class="panel-heading">
            <div>
              <h3>Visual composer</h3>
              <p class="panel-copy">Edit sections and fields without losing direct JSON access.</p>
            </div>
            <button class="button" id="add-section">Add section</button>
          </div>
          <div class="section-stack">
            ${state.draftSchema.sections
              .map((section, sectionIndex) => renderSectionCard(section, sectionIndex))
              .join("")}
          </div>
        </article>

        <article class="command-card">
          <div class="panel-heading">
            <div>
              <h3>Schema source</h3>
              <p class="panel-copy">For exact control, paste or edit JSON directly and apply it back to the studio.</p>
            </div>
            <button class="ghost-button" id="apply-json">Apply JSON</button>
          </div>
          <textarea class="json-editor" id="json-editor">${escapeHtml(
            JSON.stringify(state.draftSchema, null, 2)
          )}</textarea>
          ${
            schemaErrors.length
              ? `<div class="empty-state" style="margin-top:12px;"><p>${schemaErrors
                  .map((error) => escapeHtml(error))
                  .join("<br />")}</p></div>`
              : ""
          }
        </article>
      </div>

      <div class="builder-column">
        ${renderDraftPreview()}
      </div>
    </div>
  `;
}

function renderSectionCard(section, sectionIndex) {
  return `
    <article class="section-card active">
      <header>
        <div>
          <div class="meta-badge">Section ${sectionIndex + 1}</div>
          <h4>${escapeHtml(section.title)}</h4>
        </div>
        <div class="inline-actions">
          <button class="ghost-button" data-action="add-field" data-section="${sectionIndex}">Add field</button>
          <button class="danger-button" data-action="remove-section" data-section="${sectionIndex}">Remove</button>
        </div>
      </header>
      <div class="stacked-field" style="margin-top:12px;">
        <label>Section title</label>
          <input
            data-role="section-title"
            data-section="${sectionIndex}"
            autocomplete="off"
            value="${escapeHtml(section.title)}"
          />
      </div>
      <div class="divider"></div>
      <div class="section-stack">
        ${section.fields
          .map((field, fieldIndex) => renderFieldEditor(field, sectionIndex, fieldIndex))
          .join("")}
      </div>
    </article>
  `;
}

function renderFieldEditor(field, sectionIndex, fieldIndex) {
  const optionsText = field.type === "select" ? optionsToText(field.options || []) : "";
  return `
    <div class="command-card">
      <header style="display:flex;justify-content:space-between;gap:12px;align-items:center;">
        <div>
          <h4>${escapeHtml(field.label || "Untitled field")}</h4>
          <p class="panel-copy">${escapeHtml(field.key)}</p>
        </div>
        <button
          class="danger-button"
          data-action="remove-field"
          data-section="${sectionIndex}"
          data-field="${fieldIndex}"
        >
          Remove
        </button>
      </header>
      <div class="field-grid-3" style="margin-top:12px;">
        <div class="stacked-field">
          <label>Label</label>
          <input
            data-role="field-label"
            data-section="${sectionIndex}"
            data-field="${fieldIndex}"
            autocomplete="off"
            value="${escapeHtml(field.label)}"
          />
        </div>
        <div class="stacked-field">
          <label>Key</label>
          <input
            data-role="field-key"
            data-section="${sectionIndex}"
            data-field="${fieldIndex}"
            autocomplete="off"
            value="${escapeHtml(field.key)}"
          />
        </div>
        <div class="stacked-field">
          <label>Type</label>
          <select data-role="field-type" data-section="${sectionIndex}" data-field="${fieldIndex}">
            ${FIELD_TYPES.map(
              (type) => `
                <option value="${type.value}" ${type.value === field.type ? "selected" : ""}>
                  ${escapeHtml(type.label)}
                </option>
              `
            ).join("")}
          </select>
        </div>
      </div>
      <div class="field-grid" style="margin-top:12px;">
        <div class="stacked-field">
          <label>Placeholder</label>
          <input
            data-role="field-placeholder"
            data-section="${sectionIndex}"
            data-field="${fieldIndex}"
            autocomplete="off"
            value="${escapeHtml(field.placeholder || "")}"
          />
        </div>
        <div class="stacked-field">
          <label>Required</label>
          <label class="toggle">
            <input
              type="checkbox"
              data-role="field-required"
              data-section="${sectionIndex}"
              data-field="${fieldIndex}"
              ${field.required ? "checked" : ""}
            />
            Make this field mandatory
          </label>
        </div>
      </div>
      ${
        field.type === "select"
          ? `
            <div class="stacked-field" style="margin-top:12px;">
              <label>Options</label>
              <input
                data-role="field-options"
                data-section="${sectionIndex}"
                data-field="${fieldIndex}"
                autocomplete="off"
                value="${escapeHtml(optionsText)}"
                placeholder="Option A, Option B, Option C"
              />
            </div>
          `
          : ""
      }
    </div>
  `;
}

function renderDraftPreview() {
  return `
    <article class="preview-shell">
      <div class="meta-badge">Live preview</div>
      <h3>${escapeHtml(state.draftSchema.title)}</h3>
      <p class="preview-description">${escapeHtml(
        state.draftSchema.description || "Add a public description to shape expectations."
      )}</p>
      ${state.draftSchema.sections.map((section) => renderPreviewSection(section)).join("")}
    </article>
  `;
}

function renderPreviewSection(section) {
  return `
    <section class="preview-section">
      <h4>${escapeHtml(section.title)}</h4>
      <div class="public-field-list">
        ${section.fields.map((field) => renderPreviewField(field)).join("")}
      </div>
    </section>
  `;
}

function renderPreviewField(field) {
  const fieldId = `preview-${escapeHtml(field.key)}`;
  if (field.type === "select") {
    return `
      <div class="stacked-field">
        <label for="${fieldId}">${escapeHtml(field.label)}${field.required ? " *" : ""}</label>
        <select id="${fieldId}" name="${escapeHtml(field.key)}" disabled>
          <option>Select one</option>
          ${(field.options || [])
            .map((option) => `<option>${escapeHtml(option.label || option.value)}</option>`)
            .join("")}
        </select>
      </div>
    `;
  }

  if (field.type === "textarea") {
    return `
      <div class="stacked-field">
        <label for="${fieldId}">${escapeHtml(field.label)}${field.required ? " *" : ""}</label>
        <textarea
          id="${fieldId}"
          name="${escapeHtml(field.key)}"
          disabled
          placeholder="${escapeHtml(field.placeholder || "")}"
        ></textarea>
      </div>
    `;
  }

  return `
    <div class="stacked-field">
      <label for="${fieldId}">${escapeHtml(field.label)}${field.required ? " *" : ""}</label>
      <input
        id="${fieldId}"
        name="${escapeHtml(field.key)}"
        disabled
        placeholder="${escapeHtml(field.placeholder || "")}"
      />
    </div>
  `;
}

function renderPublicPanel() {
  if (!state.activeForm) {
    return `
      <div class="empty-state">
        <p>Open a form to preview its public side, publish it, and share the live URL.</p>
      </div>
    `;
  }

  const urlMarkup = state.activeForm.public_slug
    ? `
      <div class="link-box">
        <span>${escapeHtml(getPublicUrl(state.activeForm.public_slug))}</span>
      </div>
      <div class="public-actions">
        <button class="button" id="copy-public-link">Copy link</button>
        <button class="ghost-button" id="open-public-link">Open public form</button>
      </div>
    `
    : `
      <div class="empty-state">
        <p>This form is not public yet. Publish it once the preview feels right.</p>
      </div>
    `;

  return `
    <div class="section-stack">
      <div class="command-card">
        <div class="panel-heading">
          <div>
            <h3>${escapeHtml(state.activeForm.name)}</h3>
            <p class="panel-copy">
              ${state.activeForm.public_slug ? "Public link is ready for sharing." : "No public URL yet."}
            </p>
          </div>
          <button class="button" id="publish-form">
            ${state.busy.publish ? "Publishing..." : state.activeForm.public_slug ? "Republish" : "Publish now"}
          </button>
        </div>
        ${urlMarkup}
      </div>
      ${renderDraftPreview()}
    </div>
  `;
}

function renderInboxPanel(summary) {
  if (!state.activeForm) {
    return `
      <div class="empty-state">
        <p>Select a form to review responses, delete noise, or export the inbox.</p>
      </div>
    `;
  }

  return `
    <div class="section-stack">
      <div class="insight-grid">
        <article class="insight-card">
          <div class="panel-kicker">Responses</div>
          <h3>${summary.total}</h3>
          <p>${summary.total ? "Collected on the active form." : "No submissions yet."}</p>
        </article>
        <article class="insight-card">
          <div class="panel-kicker">Latest</div>
          <h3>${escapeHtml(relativeTime(summary.latest))}</h3>
          <p>${escapeHtml(formatDateTime(summary.latest))}</p>
        </article>
      </div>

      ${
        summary.highlights.length
          ? `
            <div class="insight-list">
              ${summary.highlights
                .map(
                  (highlight) => `
                    <article class="insight-card">
                      <div class="response-tag">${escapeHtml(highlight.key)}</div>
                      <h4>${escapeHtml(String(highlight.value))}</h4>
                      <p>${highlight.count} matching responses</p>
                    </article>
                  `
                )
                .join("")}
            </div>
          `
          : ""
      }

      <div class="button-row">
        <button class="ghost-button" id="refresh-responses">Refresh</button>
        <button class="button" id="export-csv" ${state.responses.length ? "" : "disabled"}>
          ${state.busy.export ? "Exporting..." : "Export CSV"}
        </button>
      </div>

      ${
        state.responses.length
          ? `
            <div class="response-list">
              ${state.responses.map((response) => renderResponseCard(response)).join("")}
            </div>
          `
          : `
            <div class="empty-state">
              <p>Once submissions arrive, they show up here with timestamps and raw payloads for fast triage.</p>
            </div>
          `
      }
    </div>
  `;
}

function renderResponseCard(response) {
  return `
    <article class="response-card">
      <header>
        <div>
          <div class="response-tag">Submission</div>
          <h4>${escapeHtml(relativeTime(response.submitted_at))}</h4>
        </div>
        <div class="small-meta">${escapeHtml(formatDateTime(response.submitted_at))}</div>
      </header>
      <div class="response-payload">${escapeHtml(JSON.stringify(response.response, null, 2))}</div>
      <div class="response-meta">
        <button class="danger-button" data-action="delete-response" data-id="${response.id}">Delete</button>
      </div>
    </article>
  `;
}

function bindWorkspaceEvents() {
  document.getElementById("create-name")?.addEventListener("input", (event) => {
    state.createName = event.target.value;
  });

  document.getElementById("template-select")?.addEventListener("change", (event) => {
    setTemplate(event.target.value);
    if (!state.activeForm) {
      state.draftSchema = createTemplateSchema(event.target.value);
    }
    renderWorkspace();
  });

  document.querySelectorAll("[data-template-card]").forEach((card) => {
    card.addEventListener("click", () => {
      setTemplate(card.dataset.templateCard);
      if (!state.activeForm) {
        state.createName = TEMPLATE_LIBRARY.find((item) => item.id === state.selectedTemplate)?.label || state.createName;
        state.draftSchema = createTemplateSchema(state.selectedTemplate);
      }
      renderWorkspace();
    });
  });

  document.getElementById("load-template")?.addEventListener("click", () => {
    setActiveForm(null);
    state.draftSchema = createTemplateSchema(state.selectedTemplate);
    showToast("Template loaded into the studio.");
    renderWorkspace();
  });

  document.getElementById("create-form")?.addEventListener("click", handleCreateForm);
  document.getElementById("save-form")?.addEventListener("click", handleSaveForm);
  document.getElementById("reset-draft")?.addEventListener("click", () => {
    resetDraftToActiveForm();
    renderWorkspace();
    showToast("Draft reset to the saved form.");
  });
  document.getElementById("add-section")?.addEventListener("click", () => {
    updateDraftSchema((draft) => {
      draft.sections.push(createSection());
    });
    renderWorkspace();
  });
  document.getElementById("apply-json")?.addEventListener("click", handleApplyJson);
  document.getElementById("publish-form")?.addEventListener("click", handlePublishForm);
  document.getElementById("copy-public-link")?.addEventListener("click", handleCopyPublicLink);
  document.getElementById("open-public-link")?.addEventListener("click", handleOpenPublicLink);
  document.getElementById("refresh-responses")?.addEventListener("click", refreshResponses);
  document.getElementById("export-csv")?.addEventListener("click", handleExportCsv);

  document.getElementById("builder-form-name")?.addEventListener("input", (event) => {
    if (state.activeForm) {
      state.activeForm.name = event.target.value;
    }
  });

  document.getElementById("builder-title")?.addEventListener("input", (event) => {
    state.draftSchema.title = event.target.value;
    renderWorkspace();
  });

  document.getElementById("builder-description")?.addEventListener("input", (event) => {
    state.draftSchema.description = event.target.value;
    renderWorkspace();
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", handleActionClick);
  });

  document.querySelectorAll("[data-role]").forEach((input) => {
    input.addEventListener("change", handleDraftInputChange);
  });
}

async function handleCreateForm() {
  try {
    if (!state.backendReady) {
      throw new Error("API is unavailable.");
    }
    setBusy("create", true);
    renderWorkspace();
    const schema = createTemplateSchema(state.selectedTemplate);
    const form = await createForm({
      name: state.createName.trim() || "Untitled Form",
      schema,
    });
    setActiveForm(form);
    await refreshForms();
    showToast("Form created.");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setBusy("create", false);
    renderWorkspace();
  }
}

async function handleSaveForm() {
  try {
    if (!state.activeForm) return;
    const errors = validateSchema(state.draftSchema);
    if (errors.length) {
      throw new Error(errors[0]);
    }
    setBusy("save", true);
    renderWorkspace();
    const updated = await updateForm(state.activeForm.id, {
      name: state.activeForm.name.trim() || state.draftSchema.title,
      schema: state.draftSchema,
    });
    setActiveForm(updated);
    await refreshForms();
    showToast("Form saved.");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setBusy("save", false);
    renderWorkspace();
  }
}

async function handlePublishForm() {
  try {
    if (!state.activeForm) return;
    setBusy("publish", true);
    renderWorkspace();
    const published = await publishForm(state.activeForm.id);
    state.activeForm.public_slug = published.public_slug;
    await refreshForms();
    renderWorkspace();
    showToast("Public link is ready.");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setBusy("publish", false);
    renderWorkspace();
  }
}

async function handleCopyPublicLink() {
  if (!state.activeForm?.public_slug) return;
  try {
    await copyToClipboard(getPublicUrl(state.activeForm.public_slug));
    showToast("Public link copied.");
  } catch (error) {
    showToast("Copy failed.", "error");
  }
}

function handleOpenPublicLink() {
  if (!state.activeForm?.public_slug) return;
  window.open(getPublicUrl(state.activeForm.public_slug), "_blank", "noopener,noreferrer");
}

async function handleExportCsv() {
  try {
    if (!state.activeForm) return;
    setBusy("export", true);
    renderWorkspace();
    const csv = await exportResponsesCsv(state.activeForm.id);
    downloadFile(csv, `${slugify(state.activeForm.name)}-responses.csv`, "text/csv");
    showToast("CSV exported.");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setBusy("export", false);
    renderWorkspace();
  }
}

function handleApplyJson() {
  try {
    const next = JSON.parse(document.getElementById("json-editor").value || "{}");
    state.draftSchema = normalizeSchema(next);
    renderWorkspace();
    showToast("JSON applied to the studio.");
  } catch (error) {
    showToast("Invalid JSON.", "error");
  }
}

async function handleActionClick(event) {
  const { action, id, section, field } = event.currentTarget.dataset;

  if (action === "open") {
    await openForm(id);
    return;
  }

  if (action === "responses") {
    await openForm(id, { loadResponses: true });
    return;
  }

  if (action === "publish") {
    if (!state.activeForm || state.activeForm.id !== id) {
      await openForm(id);
    }
    await handlePublishForm();
    return;
  }

  if (action === "delete") {
    if (!window.confirm("Delete this form and its responses?")) return;
    try {
      await deleteForm(id);
      if (state.activeForm?.id === id) {
        setActiveForm(null);
      }
      await refreshForms();
      showToast("Form deleted.");
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }

  if (action === "add-field") {
    updateDraftSchema((draft) => {
      draft.sections[Number(section)].fields.push(createField("text"));
    });
    renderWorkspace();
    return;
  }

  if (action === "remove-section") {
    updateDraftSchema((draft) => {
      draft.sections.splice(Number(section), 1);
    });
    renderWorkspace();
    return;
  }

  if (action === "remove-field") {
    updateDraftSchema((draft) => {
      draft.sections[Number(section)].fields.splice(Number(field), 1);
      if (!draft.sections[Number(section)].fields.length) {
        draft.sections[Number(section)].fields.push(createField("text"));
      }
    });
    renderWorkspace();
    return;
  }

  if (action === "delete-response") {
    if (!window.confirm("Delete this response?")) return;
    try {
      await deleteResponse(id);
      await refreshResponses();
      showToast("Response deleted.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }
}

function handleDraftInputChange(event) {
  const { role, section, field } = event.currentTarget.dataset;
  const sectionIndex = Number(section);
  const fieldIndex = Number(field);

  updateDraftSchema((draft) => {
    if (role === "section-title") {
      draft.sections[sectionIndex].title = event.currentTarget.value;
      return;
    }

    const targetField = draft.sections[sectionIndex].fields[fieldIndex];
    if (!targetField) return;

    if (role === "field-label") {
      targetField.label = event.currentTarget.value;
      if (!targetField.key || targetField.key.startsWith("field_")) {
        targetField.key = slugify(event.currentTarget.value);
      }
    }
    if (role === "field-key") targetField.key = slugify(event.currentTarget.value);
    if (role === "field-placeholder") targetField.placeholder = event.currentTarget.value;
    if (role === "field-required") targetField.required = event.currentTarget.checked;
    if (role === "field-options") targetField.options = textToOptions(event.currentTarget.value);
    if (role === "field-type") {
      targetField.type = event.currentTarget.value;
      if (targetField.type === "select") {
        targetField.options = targetField.options?.length
          ? targetField.options
          : [{ value: "option_1", label: "Option 1" }];
      } else {
        delete targetField.options;
      }
    }
  });

  renderWorkspace();
}

async function openForm(id, options = {}) {
  try {
    const form = await getForm(id);
    setActiveForm(form);
    if (options.loadResponses) {
      await refreshResponses();
    }
    renderWorkspace();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function refreshForms() {
  const data = await listForms();
  setForms(data.forms || []);
  if (state.activeForm) {
    const fresh = state.forms.find((entry) => entry.id === state.activeForm.id);
    if (fresh) {
      setActiveForm(fresh);
    }
  } else if (state.forms.length) {
    setActiveForm(state.forms[0]);
  }
}

async function refreshResponses() {
  try {
    if (!state.activeForm) return;
    const data = await listResponses(state.activeForm.id);
    setResponses(data.responses || []);
    renderWorkspace();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function initWorkspace() {
  try {
    const data = await listForms();
    setForms(data.forms || []);
    if (state.forms.length) {
      setActiveForm(state.forms[0]);
      await refreshResponses();
    }
    setBackendReady(true);
  } catch (error) {
    setBackendReady(false);
  }
  renderWorkspace();
}

function renderPublicMode(form, slug) {
  const normalized = normalizeSchema(form.schema);
  app.innerHTML = `
    <section class="public-mode">
      <div class="public-hero">
        <p class="eyebrow">Public Form</p>
        <h1>${escapeHtml(form.name)}</h1>
        <p>${escapeHtml(
          normalized.description || "Fill out the form below. Everything is designed to be quick, clear, and deliberate."
        )}</p>
      </div>

      <div class="panel" style="margin-top:18px;">
        <div class="panel-inner">
          <form id="public-form" class="public-shell">
            <div class="meta-badge">Live intake</div>
            <h3>${escapeHtml(normalized.title)}</h3>
            <p class="public-description">${escapeHtml(normalized.description || "")}</p>
            ${normalized.sections.map((section) => renderPublicSection(section)).join("")}
            <div class="public-actions">
              <button class="button" type="submit">Submit form</button>
            </div>
            <div id="public-status" class="panel-copy" style="margin-top:12px;"></div>
          </form>
        </div>
      </div>
    </section>
  `;

  document.getElementById("public-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const payload = Object.fromEntries(new FormData(formElement).entries());
    const status = document.getElementById("public-status");
    try {
      await submitPublicForm(slug, payload);
      formElement.reset();
      status.textContent = "Submitted successfully.";
      showToast("Response submitted.");
    } catch (error) {
      status.textContent = error.message;
      showToast(error.message, "error");
    }
  });
}

function renderPublicSection(section) {
  return `
    <section class="public-section">
      <h4>${escapeHtml(section.title)}</h4>
      <div class="response-grid">
        ${section.fields.map((field) => renderPublicField(field)).join("")}
      </div>
    </section>
  `;
}

function renderPublicField(field) {
  const fieldId = `public-${escapeHtml(field.key)}`;
  if (field.type === "select") {
    return `
      <div class="stacked-field">
        <label for="${fieldId}">${escapeHtml(field.label)}${field.required ? " *" : ""}</label>
        <select id="${fieldId}" name="${escapeHtml(field.key)}" ${field.required ? "required" : ""}>
          <option value="">Select one</option>
          ${(field.options || [])
            .map(
              (option) =>
                `<option value="${escapeHtml(option.value || option.label)}">${escapeHtml(
                  option.label || option.value
                )}</option>`
            )
            .join("")}
        </select>
      </div>
    `;
  }

  if (field.type === "textarea") {
    return `
      <div class="stacked-field">
        <label for="${fieldId}">${escapeHtml(field.label)}${field.required ? " *" : ""}</label>
        <textarea
          id="${fieldId}"
          name="${escapeHtml(field.key)}"
          ${field.required ? "required" : ""}
          placeholder="${escapeHtml(field.placeholder || "")}"
        ></textarea>
      </div>
    `;
  }

  const inputType = field.type === "email" || field.type === "tel" ? field.type : "text";
  const autocomplete =
    inputType === "email"
      ? "email"
      : inputType === "tel"
      ? "tel"
      : field.key.includes("name")
      ? "name"
      : "off";
  return `
    <div class="stacked-field">
      <label for="${fieldId}">${escapeHtml(field.label)}${field.required ? " *" : ""}</label>
      <input
        id="${fieldId}"
        type="${inputType}"
        name="${escapeHtml(field.key)}"
        ${field.required ? "required" : ""}
        autocomplete="${autocomplete}"
        placeholder="${escapeHtml(field.placeholder || "")}"
      />
    </div>
  `;
}

async function init() {
  const path = window.location.pathname;
  if (path.startsWith("/f/")) {
    const slug = path.split("/f/")[1];
    try {
      const form = await getPublicForm(slug);
      renderPublicMode(form, slug);
      return;
    } catch (error) {
      app.innerHTML = `
        <section class="public-mode">
          <div class="empty-state">
            <p>${escapeHtml(error.message)}</p>
          </div>
        </section>
      `;
      return;
    }
  }

  await initWorkspace();
}

init();
