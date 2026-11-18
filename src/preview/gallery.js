/**
 * Gallery Client-Side Logic
 * Handles resume loading, search, and interaction
 *
 * Strings that are produced at runtime are looked up in the translation
 * dictionary; the static labels are rendered by the server in the request
 * language.
 */

// State
let allResumes = [];
let filteredResumes = [];

// DOM Elements
const galleryEl = document.getElementById("gallery");
const emptyStateEl = document.getElementById("emptyState");
const noResultsEl = document.getElementById("noResults");
const searchInput = document.getElementById("searchInput");
const resumeCountEl = document.getElementById("resumeCount");

/**
 * Looks up a translated string. Falls back to the key when the i18n module
 * is unavailable, so a broken script shows a key instead of an empty page.
 */
function t(key, vars) {
  const i18n = window.RPI18n;
  return i18n ? i18n.t(key, vars) : key;
}

/**
 * Formats a date as relative time (e.g. "2 minutes ago"). The plural rules
 * and the wording come from the browser's Intl implementation.
 */
function formatRelativeTime(date) {
  const i18n = window.RPI18n;
  return i18n ? i18n.relativeTime(date) : new Date(date).toLocaleString();
}

/**
 * Formats file size in human-readable format
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Creates a resume card element
 */
function createResumeCard(resume) {
  const card = document.createElement("div");
  card.className = "resume-card";
  card.dataset.resumeId = resume.id;

  // Action buttons
  const actions = document.createElement("div");
  actions.className = "resume-actions";

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "resume-action-btn delete-btn";
  deleteBtn.innerHTML = "🗑️";
  deleteBtn.title = t("gallery.deleteTitle");
  deleteBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    deleteResume(resume.id);
  };

  actions.appendChild(deleteBtn);

  // Card link wrapper for the preview and the info
  const cardLink = document.createElement("a");
  cardLink.href = `/resume/view/${resume.id}`;
  cardLink.className = "resume-card-link";

  // Preview section — a resume has no thumbnail, so it shows a document mark
  const preview = document.createElement("div");
  preview.className = "resume-preview";
  preview.innerHTML = '<div class="resume-preview-icon">📄</div>';

  // Info section
  const info = document.createElement("div");
  info.className = "resume-info";

  const id = document.createElement("h3");
  id.className = "resume-id";
  id.textContent = resume.id;

  const meta = document.createElement("div");
  meta.className = "resume-meta";

  const template = document.createElement("span");
  template.className = "resume-meta-item";
  template.innerHTML = `<span class="resume-template">${resume.template}</span>`;

  const modified = document.createElement("span");
  modified.className = "resume-meta-item";
  modified.innerHTML = `📅 ${formatRelativeTime(resume.modifiedAt)}`;

  const size = document.createElement("span");
  size.className = "resume-meta-item";
  size.innerHTML = `💾 ${formatFileSize(resume.sizeBytes)}`;

  meta.appendChild(template);
  meta.appendChild(modified);
  meta.appendChild(size);

  info.appendChild(id);
  info.appendChild(meta);

  cardLink.appendChild(preview);
  cardLink.appendChild(info);

  card.appendChild(actions);
  card.appendChild(cardLink);

  return card;
}

/**
 * Renders the gallery with the current filtered resumes
 */
function renderGallery() {
  // Clear gallery
  galleryEl.innerHTML = "";

  // Update count
  const count = filteredResumes.length;
  resumeCountEl.textContent =
    count === 1 ? t("gallery.countOne", { n: count }) : t("gallery.count", { n: count });

  // Show appropriate state
  if (allResumes.length === 0) {
    // No resumes at all
    galleryEl.style.display = "none";
    emptyStateEl.style.display = "block";
    noResultsEl.style.display = "none";
  } else if (filteredResumes.length === 0) {
    // No results from search
    galleryEl.style.display = "none";
    emptyStateEl.style.display = "none";
    noResultsEl.style.display = "block";
  } else {
    // Show resumes
    galleryEl.style.display = "grid";
    emptyStateEl.style.display = "none";
    noResultsEl.style.display = "none";

    filteredResumes.forEach((resume) => {
      const card = createResumeCard(resume);
      galleryEl.appendChild(card);
    });
  }
}

/**
 * Filters resumes based on search query
 */
function filterResumes(query) {
  if (!query || !query.trim()) {
    filteredResumes = [...allResumes];
  } else {
    const normalizedQuery = query.toLowerCase().trim();
    filteredResumes = allResumes.filter((resume) =>
      resume.id.toLowerCase().includes(normalizedQuery)
    );
  }
  renderGallery();
}

/**
 * Loads resumes from the API
 */
async function loadResumes() {
  try {
    const response = await fetch("/api/resumes");

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    allResumes = data.resumes || [];
    filteredResumes = [...allResumes];

    renderGallery();
  } catch (error) {
    console.error("Failed to load resumes:", error);
    galleryEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <h2 class="empty-state-title">${t("gallery.loadFailedTitle")}</h2>
        <p class="empty-state-description">${error.message}</p>
      </div>
    `;
  }
}

/**
 * Deletes a resume
 */
async function deleteResume(resumeId) {
  if (!confirm(t("gallery.deleteConfirm", { id: resumeId }))) {
    return;
  }

  try {
    const response = await fetch(`/api/resumes/${resumeId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Remove from the list
    const index = allResumes.findIndex((r) => r.id === resumeId);
    if (index !== -1) {
      allResumes.splice(index, 1);
    }

    // Re-filter and render
    filterResumes(searchInput.value);
  } catch (error) {
    console.error("Failed to delete resume:", error);
    alert(t("gallery.deleteFailed", { message: error.message }));
  }
}

/**
 * Debounce function for search input
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Event Listeners
searchInput.addEventListener(
  "input",
  debounce((e) => {
    filterResumes(e.target.value);
  }, 300)
);

// Initialize. The dictionary has to be in place before any runtime string
// is rendered.
const i18nReady = window.RPI18n ? window.RPI18n.ready : Promise.resolve();
i18nReady.then(() => {
  loadResumes();
});
