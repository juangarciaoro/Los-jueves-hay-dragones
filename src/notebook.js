// notebook.js — Player pause menu: bestiary + inventory panels
import { state, getPlayerData } from './state.js';
import { saveState } from './persist.js';
import { ICONS } from './icons.js';

// ===========================
//  BESTIARY
// ===========================
export function renderBestiaryList(container, userId, filter) {
  container.innerHTML = '';
  if (!state.enemies.length) {
    const empty = document.createElement('div');
    empty.className = 'bestiary-empty';
    empty.textContent = 'No hay criaturas registradas.';
    container.appendChild(empty);
    return;
  }

  // Search input
  const searchWrap  = document.createElement('div');
  searchWrap.className = 'bestiary-search-wrap';
  const searchInput = document.createElement('input');
  searchInput.className = 'bestiary-search';
  searchInput.type = 'search'; searchInput.placeholder = 'Buscar criatura\u2026';
  searchInput.value = filter || '';
  searchWrap.appendChild(searchInput);
  container.appendChild(searchWrap);

  const listWrap = document.createElement('div');
  listWrap.className = 'bestiary-entries';
  container.appendChild(listWrap);

  const q = (filter || '').toLowerCase();

  function renderEntries(query) {
    listWrap.innerHTML = '';
    let anyVisible = false;
    state.enemies.forEach(enemy => {
      const known = state.encounteredEnemies.includes(enemy.id);
      const displayName = known ? enemy.name : '???';
      if (query && known  && !enemy.name.toLowerCase().includes(query)) return;
      if (query && !known) return;
      anyVisible = true;
      const row    = document.createElement('div');
      row.className = 'bestiary-row' + (known ? ' known' : ' unknown');
      const icon   = document.createElement('span');
      icon.className = 'bestiary-icon'; icon.innerHTML = known ? ICONS.bookOpen : ICONS.circleHelp;
      const nameEl = document.createElement('span');
      nameEl.className = 'bestiary-name'; nameEl.textContent = displayName;
      row.appendChild(icon); row.appendChild(nameEl);
      if (known) {
        const pd       = getPlayerData(userId);
        const hasNotes = !!(pd.bestiary[enemy.id]);
        if (hasNotes) {
          const badge = document.createElement('span');
          badge.className = 'bestiary-notes-badge'; badge.innerHTML = ICONS.pencil; badge.title = 'Tiene notas';
          row.appendChild(badge);
        }
        row.addEventListener('click', () => openBestiaryDetail(container, enemy, userId));
      }
      listWrap.appendChild(row);
    });
    if (!anyVisible) {
      const empty = document.createElement('div');
      empty.className = 'bestiary-empty';
      empty.textContent = query ? 'Sin resultados.' : 'Ninguna criatura descubierta aún.';
      listWrap.appendChild(empty);
    }
  }

  renderEntries(q);
  searchInput.addEventListener('input', () => renderEntries(searchInput.value.toLowerCase()));
}

export function openBestiaryDetail(container, enemy, userId) {
  container.innerHTML = '';
  const pd = getPlayerData(userId);

  const header  = document.createElement('div');
  header.className = 'bestiary-detail-header';
  const backBtn = document.createElement('button');
  backBtn.className = 'btn btn-outline btn-sm'; backBtn.textContent = '\u2190 Volver';
  backBtn.addEventListener('click', () => renderBestiaryList(container, userId));
  const title   = document.createElement('div');
  title.className = 'bestiary-detail-title'; title.textContent = enemy.name;
  header.appendChild(backBtn); header.appendChild(title);

  const area    = document.createElement('textarea');
  area.className = 'note-area'; area.style.minHeight = '180px';
  area.placeholder = `Tus notas sobre ${enemy.name}\u2026`;
  area.value = pd.bestiary[enemy.id] || '';
  area.addEventListener('input', () => {
    const pd2 = getPlayerData(userId);
    pd2.bestiary[enemy.id] = area.value;
    state.playerNotes[userId] = pd2;
    saveState();
  });

  container.appendChild(header);
  container.appendChild(area);
}

// ===========================
//  INVENTORY
// ===========================
export function renderInventoryPanel(container, userId) {
  container.innerHTML = '';
  const pd = getPlayerData(userId);
  for (let i = 0; i < 10; i++) {
    const slot = document.createElement('div'); slot.className = 'inv-slot';
    const num  = document.createElement('span'); num.className = 'inv-slot-num'; num.textContent = i + 1;
    const inp  = document.createElement('input');
    inp.className = 'inv-input'; inp.type = 'text';
    inp.placeholder = `Objeto ${i + 1}\u2026`; inp.value = pd.inventory[i] || '';
    inp.addEventListener('input', () => {
      const pd2 = getPlayerData(userId);
      pd2.inventory[i] = inp.value;
      state.playerNotes[userId] = pd2;
      saveState();
    });
    slot.appendChild(num); slot.appendChild(inp);
    container.appendChild(slot);
  }
}
