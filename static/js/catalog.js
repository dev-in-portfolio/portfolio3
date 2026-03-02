async function loadIndex() {
  try {
    const res = await fetch('/items/items-index.json');
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

function renderResults(container, results) {
  container.innerHTML = results
    .map(
      (item) => `
      <article class="card">
        <h3><a href="/items/${item.slug}/">${item.title}</a></h3>
        <p>${item.summary}</p>
        <div class="tags">
          ${(item.tags || []).map((t) => `<span>${t}</span>`).join('')}
        </div>
        <span class="pill">${item.category}</span>
      </article>
    `
    )
    .join('');
}

function attachCatalogSearch() {
  const input = document.getElementById('search-input');
  const select = document.getElementById('category-filter');
  const results = document.getElementById('catalog-results');
  if (!input || !results) return;

  loadIndex().then((index) => {
    const applyFilter = () => {
      const query = input.value.toLowerCase();
      const category = select ? select.value : '';
      const filtered = index.filter((item) => {
        const matchesQuery =
          item.title.toLowerCase().includes(query) ||
          item.summary.toLowerCase().includes(query) ||
          (item.tags || []).join(' ').toLowerCase().includes(query);
        const matchesCategory = category ? item.category === category : true;
        return matchesQuery && matchesCategory;
      });
      renderResults(results, query || category ? filtered : index);
    };

    input.addEventListener('input', applyFilter);
    if (select) select.addEventListener('change', applyFilter);
    renderResults(results, index);
  });
}

document.addEventListener('DOMContentLoaded', attachCatalogSearch);
