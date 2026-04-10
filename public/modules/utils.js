const TEMPLATE_LIBRARY = [
  {
    id: "signal",
    label: "Signal Intake",
    summary: "A sharp contact and triage intake for serious inbound work.",
    schema: {
      title: "Signal Intake",
      description:
        "Collect the right operating context before a project starts, not after.",
      sections: [
        {
          title: "Team Context",
          fields: [
            {
              key: "name",
              label: "Primary contact",
              type: "text",
              required: true,
              placeholder: "Your name",
            },
            {
              key: "email",
              label: "Work email",
              type: "email",
              required: true,
              placeholder: "name@company.com",
            },
            {
              key: "team_size",
              label: "Team size",
              type: "select",
              required: true,
              options: ["Solo", "2-5", "6-15", "15+"],
            },
          ],
        },
        {
          title: "Project Shape",
          fields: [
            {
              key: "priority",
              label: "Priority level",
              type: "select",
              required: true,
              options: ["Immediate", "This month", "Exploring"],
            },
            {
              key: "challenge",
              label: "What needs to happen?",
              type: "textarea",
              required: true,
              placeholder: "Describe the work, constraints, and what success looks like.",
            },
          ],
        },
      ],
    },
  },
  {
    id: "event",
    label: "Event Registration",
    summary: "A branded RSVP and attendance form with logistics baked in.",
    schema: {
      title: "Event Registration",
      description:
        "Give attendees a fast registration flow without sacrificing detail.",
      sections: [
        {
          title: "Attendee",
          fields: [
            { key: "full_name", label: "Full name", type: "text", required: true },
            { key: "email", label: "Email", type: "email", required: true },
            {
              key: "ticket_type",
              label: "Ticket type",
              type: "select",
              required: true,
              options: ["General", "VIP", "Speaker"],
            },
          ],
        },
        {
          title: "Logistics",
          fields: [
            {
              key: "dietary",
              label: "Dietary notes",
              type: "textarea",
              required: false,
              placeholder: "Allergies, restrictions, or accessibility needs",
            },
          ],
        },
      ],
    },
  },
  {
    id: "ops",
    label: "Ops Audit",
    summary: "A tight internal request form for audits, incidents, or change reviews.",
    schema: {
      title: "Ops Audit Intake",
      description:
        "Capture scope, system surface, and incident pressure in one pass.",
      sections: [
        {
          title: "Request",
          fields: [
            {
              key: "system_name",
              label: "System or repo",
              type: "text",
              required: true,
              placeholder: "payments-service",
            },
            {
              key: "request_type",
              label: "Request type",
              type: "select",
              required: true,
              options: ["Audit", "Incident", "Hardening", "Migration"],
            },
          ],
        },
        {
          title: "Risk Frame",
          fields: [
            {
              key: "blast_radius",
              label: "Blast radius",
              type: "select",
              required: true,
              options: ["Low", "Moderate", "High", "Critical"],
            },
            {
              key: "notes",
              label: "What matters most?",
              type: "textarea",
              required: true,
              placeholder: "Document hidden constraints, known risks, and urgency.",
            },
          ],
        },
      ],
    },
  },
];

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
  { value: "tel", label: "Phone" },
  { value: "textarea", label: "Textarea" },
  { value: "select", label: "Select" },
];

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slugify(value = "") {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "field";
}

function normalizeOptions(options = []) {
  return options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option
  );
}

function normalizeField(field = {}, index = 0) {
  const type = field.type || "text";
  return {
    key: field.key || `field_${index + 1}`,
    label: field.label || `Field ${index + 1}`,
    type,
    required: Boolean(field.required),
    placeholder: field.placeholder || "",
    options: type === "select" ? normalizeOptions(field.options || []) : undefined,
  };
}

function normalizeSchema(schema = {}) {
  const sections = Array.isArray(schema.sections) ? schema.sections : [];
  return {
    title: schema.title || "Untitled Form",
    description: schema.description || "",
    sections: sections.length
      ? sections.map((section, sectionIndex) => ({
          title: section.title || `Section ${sectionIndex + 1}`,
          fields: Array.isArray(section.fields)
            ? section.fields.map((field, fieldIndex) => normalizeField(field, fieldIndex))
            : [],
        }))
      : [
          {
            title: "Section 1",
            fields: [createField("text")],
          },
        ],
  };
}

function countFields(schema) {
  return (schema.sections || []).reduce(
    (total, section) => total + (section.fields || []).length,
    0
  );
}

function validateSchema(schema) {
  const errors = [];
  if (!schema.title?.trim()) {
    errors.push("Form title is required.");
  }
  if (!Array.isArray(schema.sections) || !schema.sections.length) {
    errors.push("At least one section is required.");
  }

  const seen = new Set();
  schema.sections?.forEach((section, sectionIndex) => {
    if (!section.title?.trim()) {
      errors.push(`Section ${sectionIndex + 1} needs a title.`);
    }
    if (!Array.isArray(section.fields) || !section.fields.length) {
      errors.push(`Section ${sectionIndex + 1} needs at least one field.`);
      return;
    }
    section.fields.forEach((field, fieldIndex) => {
      if (!field.label?.trim()) {
        errors.push(`Field ${fieldIndex + 1} in ${section.title} needs a label.`);
      }
      if (!field.key?.trim()) {
        errors.push(`Field ${fieldIndex + 1} in ${section.title} needs a key.`);
      }
      if (field.key && seen.has(field.key)) {
        errors.push(`Field key "${field.key}" is duplicated.`);
      }
      seen.add(field.key);
      if (!field.type) {
        errors.push(`Field ${fieldIndex + 1} in ${section.title} needs a type.`);
      }
      if (field.type === "select" && !normalizeOptions(field.options || []).length) {
        errors.push(`Select field "${field.label}" needs at least one option.`);
      }
    });
  });
  return errors;
}

function createField(type = "text") {
  return normalizeField({
    key: `field_${Math.random().toString(36).slice(2, 7)}`,
    label: "New field",
    type,
    required: false,
    placeholder: "",
    options: type === "select" ? [{ value: "option_1", label: "Option 1" }] : undefined,
  });
}

function createSection() {
  return {
    title: "New section",
    fields: [createField("text")],
  };
}

function createTemplateSchema(templateId) {
  const template = TEMPLATE_LIBRARY.find((entry) => entry.id === templateId) || TEMPLATE_LIBRARY[0];
  return deepClone(template.schema);
}

function formatDateTime(value) {
  if (!value) return "No activity yet";
  return new Date(value).toLocaleString();
}

function relativeTime(value) {
  if (!value) return "No activity yet";
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function summarizeResponses(responses = []) {
  const total = responses.length;
  const latest = responses[0]?.submitted_at || null;
  const fieldCounts = {};
  responses.forEach((entry) => {
    Object.entries(entry.response || {}).forEach(([key, value]) => {
      if (!fieldCounts[key]) fieldCounts[key] = new Map();
      const bucket = value || "blank";
      fieldCounts[key].set(bucket, (fieldCounts[key].get(bucket) || 0) + 1);
    });
  });

  const highlights = Object.entries(fieldCounts)
    .slice(0, 3)
    .map(([key, counts]) => {
      const [topValue, totalCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        key,
        value: topValue,
        count: totalCount,
      };
    });

  return { total, latest, highlights };
}

function optionsToText(options = []) {
  return normalizeOptions(options)
    .map((option) => option.label)
    .join(", ");
}

function textToOptions(text = "") {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => ({ value: slugify(item), label: item }));
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export {
  FIELD_TYPES,
  TEMPLATE_LIBRARY,
  copyToClipboard,
  countFields,
  createField,
  createSection,
  createTemplateSchema,
  deepClone,
  downloadFile,
  escapeHtml,
  formatDateTime,
  normalizeOptions,
  normalizeSchema,
  optionsToText,
  relativeTime,
  slugify,
  summarizeResponses,
  textToOptions,
  validateSchema,
};
