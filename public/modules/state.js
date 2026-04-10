import { createTemplateSchema, deepClone, normalizeSchema } from "./utils.js";

const state = {
  backendReady: true,
  forms: [],
  activeForm: null,
  draftSchema: createTemplateSchema("signal"),
  responses: [],
  selectedTemplate: "signal",
  createName: "Signal Intake",
  createDescription: "",
  publicForm: null,
  busy: {
    create: false,
    save: false,
    publish: false,
    delete: false,
    export: false,
  },
};

function setForms(forms) {
  state.forms = Array.isArray(forms) ? forms : [];
}

function setActiveForm(form) {
  state.activeForm = form
    ? {
        ...form,
        schema: normalizeSchema(form.schema),
      }
    : null;
  state.responses = [];
  state.draftSchema = form
    ? deepClone(normalizeSchema(form.schema))
    : createTemplateSchema(state.selectedTemplate);
}

function updateDraftSchema(mutator) {
  const next = deepClone(state.draftSchema);
  mutator(next);
  state.draftSchema = normalizeSchema(next);
}

function resetDraftToActiveForm() {
  state.draftSchema = state.activeForm
    ? deepClone(normalizeSchema(state.activeForm.schema))
    : createTemplateSchema(state.selectedTemplate);
}

function setResponses(responses) {
  state.responses = Array.isArray(responses) ? responses : [];
}

function setBackendReady(value) {
  state.backendReady = Boolean(value);
}

function setBusy(key, value) {
  state.busy[key] = Boolean(value);
}

function setTemplate(templateId) {
  state.selectedTemplate = templateId;
  if (!state.activeForm) {
    state.draftSchema = createTemplateSchema(templateId);
  }
}

export {
  resetDraftToActiveForm,
  setActiveForm,
  setBackendReady,
  setBusy,
  setForms,
  setResponses,
  setTemplate,
  state,
  updateDraftSchema,
};
