// utils.js — Pure utility functions (no DOM, no state deps)

export function uid() { return Math.random().toString(36).slice(2, 10); }

// Lightweight FNV-1a-inspired hash. NOT cryptographic.
// Used only for local/private session management; Firestore rules enforce real security.
export function hashPassword(pw) {
  let h = 0;
  for (let i = 0; i < pw.length; i++) { h = Math.imul(31, h) + pw.charCodeAt(i) | 0; }
  return 'h' + Math.abs(h).toString(36);
}

export function slugifyCampaignName(name) {
  const base = (name || 'campaña')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'campaña';
}

export function getUniqueCampaignId(name, existingIds) {
  const base = slugifyCampaignName(name);
  let candidate = base;
  let n = 2;
  const ids = new Set(existingIds);
  while (ids.has(candidate)) { candidate = `${base}-${n}`; n++; }
  return candidate;
}

// Case-insensitive substring filter on a list of DOM elements or strings.
export function filterList(query, items, getText) {
  const q = (query || '').toLowerCase();
  items.forEach(item => {
    const text = (getText ? getText(item) : item.textContent || '').toLowerCase();
    item.style.display = (!q || text.includes(q)) ? '' : 'none';
  });
}
