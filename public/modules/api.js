const API_BASE = "/api/forms";
const PUBLIC_BASE = "/api/public/forms";

function getDeviceKey() {
  let key = localStorage.getItem("formfoundry_device_key");
  if (!key) {
    key = crypto.randomUUID();
    localStorage.setItem("formfoundry_device_key", key);
  }
  return key;
}

async function request(url, options = {}, { isPublic = false } = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(isPublic ? {} : { "X-Device-Key": getDeviceKey() }),
      ...(options.headers || {}),
    },
  });

  if (response.headers.get("content-type")?.includes("text/csv")) {
    if (!response.ok) {
      throw new Error("CSV export failed");
    }
    return response.text();
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

function listForms() {
  return request(API_BASE);
}

function createForm({ name, schema }) {
  return request(API_BASE, {
    method: "POST",
    body: JSON.stringify({ name, schema }),
  });
}

function getForm(id) {
  return request(`${API_BASE}/${id}`);
}

function updateForm(id, payload) {
  return request(`${API_BASE}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

function publishForm(id) {
  return request(`${API_BASE}/${id}/publish`, { method: "POST" });
}

function deleteForm(id) {
  return request(`${API_BASE}/${id}`, { method: "DELETE" });
}

function listResponses(id, query = "") {
  return request(`${API_BASE}/${id}/responses${query}`);
}

function exportResponsesCsv(id) {
  return request(`${API_BASE}/${id}/responses?format=csv`);
}

function deleteResponse(responseId) {
  return request(`/api/responses/${responseId}`, { method: "DELETE" });
}

function getPublicForm(slug) {
  return request(`${PUBLIC_BASE}/${slug}`, {}, { isPublic: true });
}

function submitPublicForm(slug, response) {
  return request(
    `${PUBLIC_BASE}/${slug}/submit`,
    {
      method: "POST",
      body: JSON.stringify({ response }),
    },
    { isPublic: true }
  );
}

export {
  API_BASE,
  PUBLIC_BASE,
  createForm,
  deleteForm,
  deleteResponse,
  exportResponsesCsv,
  getDeviceKey,
  getForm,
  getPublicForm,
  listForms,
  listResponses,
  publishForm,
  submitPublicForm,
  updateForm,
};
