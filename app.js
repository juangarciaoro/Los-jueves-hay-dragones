// ===========================
//  FIREBASE
//  Configuración e inicialización del cliente Firebase.
//  `db` es la instancia global de Firestore usada en toda la app.
//  Documentos principales:
//    app/campaigns  — catálogo de campañas (IDs + nombres)
//    app/users      — usuarios globales compartidos entre campañas
//    campaigns/{id} — estado completo de cada campaña
// ===========================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.8.1/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot }
  from "https://www.gstatic.com/firebasejs/11.8.1/firebase-firestore.js";
// UI icon catalog lives in a dedicated folder of individual SVG files.
import { UI_ICONS, loadIcons, paintStaticIcons } from "./ui-icons.js";

const firebaseConfig = {
  apiKey: "AIzaSyBPplQt9hJDAvyD0Pm0iVudj9wXMnWOzHE",
  authDomain: "los-jueves-hay-dragones.firebaseapp.com",
  projectId: "los-jueves-hay-dragones",
  storageBucket: "los-jueves-hay-dragones.firebasestorage.app",
  messagingSenderId: "355740854962",
  appId: "1:355740854962:web:3afb8b063aa96cd54177ab"
};
const fbApp = initializeApp(firebaseConfig);
const db    = getFirestore(fbApp);
const LEGACY_STATE_DOC = doc(db, 'campaign', 'state');
const CAMPAIGNS_INDEX_DOC = doc(db, 'app', 'campaigns');
const APP_USERS_DOC = doc(db, 'app', 'users');

// Helpers de marcado para reutilizar los iconos SVG del catalogo externo.
const withIcon = (icon, label) => `${icon}<span>${label}</span>`;
const cardIcon = (icon, label) => `<span class="card-icon">${icon}</span><span class="card-label">${label}</span>`;
const toggleGlyph = collapsed => collapsed ? UI_ICONS.chevronRight : UI_ICONS.chevronDown;

// ===========================
//  STATE
//  `state` contiene todos los datos de la campaña cargada:
//    sessions   — sesiones con diario, iniciativa, historial de dados
//    chars      — fichas de personajes (jugadores)
//    enemies    — tipos de enemigo reutilizables
//    users      — (legado) reemplazado por globalUsers
//    estados    — condiciones de combate personalizadas
//    actos      — unidades narrativas de cada sesión
//    eventos    — eventos aleatorios ligados a actos
//    playerNotes — mapa {userId: {notes,bestiary,inventory,encounteredEnemies}}
//  Las variables de control:
//    _saveTimeout   — ID del debounce de guardado en Firestore
//    _unsubscribe   — detiene el listener de la campaña activa
//    _ignoreNext    — evita procesar el eco de nuestro propio setDoc
//    _playerPreview — DM en modo "vista jugador" para previsualizar
// ===========================
let state = { sessions:[], chars:[], enemies:[], users:[], estados:[], actos:[], eventos:[], playerNotes:{} };
let campaigns = [];
let globalUsers = [];
let currentCampaignId = null;
let currentUser  = null;
let _saveTimeout = null;
let _unsubscribe = null;
let _usersUnsubscribe = null;
let _ignoreNext  = false;
let _playerPreview = false; // DM preview mode as player

function emptyState() {
  return { sessions:[], chars:[], enemies:[], users:[], estados:[], actos:[], eventos:[], playerNotes:{} };
}

// Garantiza que todos los campos del estado tienen valores por defecto.
// Imprescindible cuando se leen documentos de Firestore guardados con
// versiones anteriores de la app que podían carecer de campos nuevos.
function normalizeState(data) {
  return {
    sessions: data?.sessions || [],
    chars: data?.chars || [],
    enemies: data?.enemies || [],
    users: data?.users || [],
    estados: data?.estados || [],
    actos: data?.actos || [],
    eventos: data?.eventos || [],
    playerNotes: data?.playerNotes || {}
  };
}

// Normaliza el cuaderno del jugador conservando compatibilidad con el formato legado
// donde playerNotes[userId] era solo un string de texto libre.
function getPlayerNotebook(userId) {
  const raw = state.playerNotes[userId];
  if (!raw || typeof raw === 'string') {
    return {
      notes: typeof raw === 'string' ? raw : '',
      bestiary: {},
      inventory: [],
      encounteredEnemies: []
    };
  }
  const inventory = Array.isArray(raw.inventory) ? raw.inventory : [];
  return {
    notes: raw.notes || '',
    bestiary: raw.bestiary || {},
    inventory: inventory
      .map(item => ({
        name: (item?.name || '').trim(),
        qty: Math.max(1, Math.min(10, parseInt(item?.qty) || 1))
      }))
      .filter(item => item.name)
      .slice(0, 10),
    encounteredEnemies: Array.isArray(raw.encounteredEnemies) ? raw.encounteredEnemies.filter(Boolean) : []
  };
}

function setPlayerNotebook(userId, notebook) {
  state.playerNotes[userId] = {
    notes: notebook.notes || '',
    bestiary: notebook.bestiary || {},
    inventory: Array.isArray(notebook.inventory) ? notebook.inventory.filter(item => item?.name).slice(0, 10) : [],
    encounteredEnemies: Array.isArray(notebook.encounteredEnemies) ? [...new Set(notebook.encounteredEnemies)] : []
  };
}

function enemyEncounteredByUser(userId, enemyId) {
  const notebook = getPlayerNotebook(userId);
  if (notebook.encounteredEnemies.includes(enemyId)) return true;
  // Compatibilidad retroactiva: si el enemigo quedó guardado en un combate previo,
  // lo tratamos como descubierto aunque el array no exista todavía.
  return state.sessions.some(session => (session.combatants || []).some(c => c.type === 'enemy' && c.enemyId === enemyId));
}

function registerEncounteredEnemy(enemyId) {
  globalUsers.filter(u => !u.isDM).forEach(user => {
    const notebook = getPlayerNotebook(user.id);
    if (!notebook.encounteredEnemies.includes(enemyId)) {
      notebook.encounteredEnemies.push(enemyId);
      setPlayerNotebook(user.id, notebook);
    }
  });
}

function clampNotebookQty(value) {
  return Math.max(0, Math.min(10, parseInt(value) || 0));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeNotebookInventory(inventory) {
  return (Array.isArray(inventory) ? inventory : [])
    .map(item => ({
      name: (item?.name || '').trim(),
      qty: Math.max(1, Math.min(10, parseInt(item?.qty) || 1))
    }))
    .filter(item => item.name)
    .slice(0, 10);
}

function autosizeTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

function autosizeTextareaDeferred(el) {
  if (!el) return;
  autosizeTextarea(el);
  requestAnimationFrame(() => autosizeTextarea(el));
}

function renderPlayerNotebook(clone) {
  if (!currentUser) return;

  const wrap = clone.querySelector('.player-notes-panel-wrap');
  if (!wrap) return;

  const menu = clone.querySelector('[data-notebook-menu]');
  const menuButtons = Array.from(clone.querySelectorAll('[data-notebook-open]'));
  const backButtons = Array.from(clone.querySelectorAll('[data-notebook-back]'));
  const panels = Array.from(clone.querySelectorAll('[data-notebook-panel]'));
  const notesArea = clone.querySelector('[data-field="player_notebook_notes"]');
  const bestiarySearch = clone.querySelector('[data-bestiary-search]');
  const bestiaryLayout = clone.querySelector('[data-bestiary-layout]');
  const bestiaryList = clone.querySelector('[data-bestiary-list]');
  const bestiaryPagination = clone.querySelector('[data-bestiary-pagination]');
  const bestiaryDetail = clone.querySelector('[data-bestiary-detail]');
  const inventoryGrid = clone.querySelector('[data-inventory-grid]');
  let activeBestiaryEnemyId = null;
  let bestiaryFilter = '';
  let bestiaryPage = 1;
  const BESTIARY_PAGE_SIZE = 5;

  function getNotebook() {
    return getPlayerNotebook(currentUser.id);
  }

  function saveNotebook(notebook) {
    notebook.inventory = normalizeNotebookInventory(notebook.inventory);
    setPlayerNotebook(currentUser.id, notebook);
    saveState();
  }

  function openNotebookMenu() {
    if (menu) menu.classList.add('is-active');
    panels.forEach(panel => panel.classList.remove('is-active'));
  }

  function openNotebookSection(sectionName) {
    if (menu) menu.classList.remove('is-active');
    panels.forEach(panel => panel.classList.toggle('is-active', panel.dataset.notebookPanel === sectionName));
  }

  function openBestiaryEnemy(enemyId) {
    const enemy = state.enemies.find(item => item.id === enemyId);
    if (!enemy || !enemyEncounteredByUser(currentUser.id, enemy.id)) return false;
    activeBestiaryEnemyId = enemyId;
    openNotebookSection('bestiary');
    renderBestiaryList();
    renderBestiaryDetail();
    return true;
  }

  function showBestiaryListView() {
    if (!bestiaryLayout) return;
    bestiaryLayout.classList.remove('is-detail-view');
    if (bestiarySearch) bestiarySearch.style.display = '';
    if (bestiaryPagination) bestiaryPagination.style.display = '';
  }

  function showBestiaryDetailView() {
    if (!bestiaryLayout) return;
    bestiaryLayout.classList.add('is-detail-view');
    if (bestiarySearch) bestiarySearch.style.display = 'none';
    if (bestiaryPagination) bestiaryPagination.style.display = 'none';
  }

  function renderBestiaryPagination(totalItems) {
    if (!bestiaryPagination) return;

    const totalPages = Math.max(1, Math.ceil(totalItems / BESTIARY_PAGE_SIZE));
    bestiaryPage = Math.min(bestiaryPage, totalPages);
    bestiaryPagination.innerHTML = '';

    if (totalItems <= BESTIARY_PAGE_SIZE) return;

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'btn btn-outline btn-sm';
    prevBtn.disabled = bestiaryPage === 1;
    prevBtn.innerHTML = withIcon(UI_ICONS.back, 'Anterior');
    prevBtn.addEventListener('click', () => {
      bestiaryPage = Math.max(1, bestiaryPage - 1);
      renderBestiaryList();
    });

    const status = document.createElement('span');
    status.className = 'bestiary-page-status';
    status.textContent = `Pagina ${bestiaryPage} de ${totalPages}`;

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'btn btn-outline btn-sm';
    nextBtn.disabled = bestiaryPage === totalPages;
    nextBtn.innerHTML = withIcon(UI_ICONS.next, 'Siguiente');
    nextBtn.addEventListener('click', () => {
      bestiaryPage = Math.min(totalPages, bestiaryPage + 1);
      renderBestiaryList();
    });

    bestiaryPagination.appendChild(prevBtn);
    bestiaryPagination.appendChild(status);
    bestiaryPagination.appendChild(nextBtn);
  }

  function renderBestiaryDetail() {
    if (!bestiaryDetail) return;

    const notebook = getNotebook();
    const enemy = state.enemies.find(item => item.id === activeBestiaryEnemyId);
    const known = enemy && enemyEncounteredByUser(currentUser.id, enemy.id);

    if (!enemy || !known) {
      showBestiaryListView();
      bestiaryDetail.innerHTML = '<div class="bestiary-detail-empty">Selecciona una criatura conocida para anotar debilidades, tacticas o recuerdos utiles.</div>';
      return;
    }

    showBestiaryDetailView();
    bestiaryDetail.innerHTML = `
      <div class="bestiary-detail-card">
        <button type="button" class="btn btn-outline btn-sm bestiary-back-btn">${withIcon(UI_ICONS.back, 'Volver al listado')}</button>
        <div class="bestiary-detail-title">${escapeHtml(enemy.name)}</div>
        <div class="bestiary-detail-meta">Tus apuntes privados sobre este enemigo.</div>
        <textarea class="note-area bestiary-note-area" placeholder="Puntos debiles, tacticas, botin, rituales, resistencias..."></textarea>
      </div>
    `;

    const backBtn = bestiaryDetail.querySelector('.bestiary-back-btn');
    backBtn?.addEventListener('click', () => {
      activeBestiaryEnemyId = null;
      showBestiaryListView();
      renderBestiaryList();
      renderBestiaryDetail();
    });

    const area = bestiaryDetail.querySelector('.bestiary-note-area');
    if (!area) return;
    area.value = notebook.bestiary?.[enemy.id] || '';
    autosizeTextareaDeferred(area);
    area.addEventListener('input', () => {
      autosizeTextarea(area);
      const nextNotebook = getNotebook();
      nextNotebook.bestiary = nextNotebook.bestiary || {};
      nextNotebook.bestiary[enemy.id] = area.value;
      saveNotebook(nextNotebook);
    });
  }

  function renderBestiaryList() {
    if (!bestiaryList) return;

    bestiaryList.innerHTML = '';
    if (bestiaryPagination) bestiaryPagination.innerHTML = '';
    if (!state.enemies.length) {
      bestiaryList.innerHTML = '<div class="bestiary-empty">No hay enemigos registrados en la campaña.</div>';
      activeBestiaryEnemyId = null;
      renderBestiaryDetail();
      return;
    }

    const discoveredIds = state.enemies
      .filter(enemy => enemyEncounteredByUser(currentUser.id, enemy.id))
      .map(enemy => enemy.id);

    if (activeBestiaryEnemyId && !discoveredIds.includes(activeBestiaryEnemyId)) activeBestiaryEnemyId = null;

    const filteredEnemies = state.enemies.filter(enemy => {
      const label = enemyEncounteredByUser(currentUser.id, enemy.id) ? enemy.name : '???';
      return !bestiaryFilter || label.toLowerCase().includes(bestiaryFilter);
    });

    if (!filteredEnemies.length) {
      bestiaryList.innerHTML = '<div class="bestiary-empty">No hay resultados para esa busqueda.</div>';
      return;
    }

    renderBestiaryPagination(filteredEnemies.length);
    const start = (bestiaryPage - 1) * BESTIARY_PAGE_SIZE;
    const pageEnemies = filteredEnemies.slice(start, start + BESTIARY_PAGE_SIZE);

    pageEnemies.forEach(enemy => {
      const known = enemyEncounteredByUser(currentUser.id, enemy.id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bestiary-entry' + (known ? '' : ' is-locked') + (activeBestiaryEnemyId === enemy.id ? ' is-active' : '');
      button.disabled = !known;
      button.innerHTML = `
        <span class="bestiary-entry-name">${known ? escapeHtml(enemy.name) : '???'}</span>
        <span class="bestiary-entry-state">${known ? 'Conocido' : 'No descubierto'}</span>
      `;
      if (known) {
        button.addEventListener('click', () => {
          openBestiaryEnemy(enemy.id);
        });
      }
      bestiaryList.appendChild(button);
    });
  }

  function renderInventoryGrid() {
    if (!inventoryGrid) return;

    const notebook = getNotebook();
    const slots = Array.from({ length: 10 }, (_, index) => notebook.inventory[index] || { name: '', qty: 1 });

    inventoryGrid.innerHTML = '';
    slots.forEach((item, index) => {
      const slot = document.createElement('div');
      slot.className = 'inventory-slot';
      slot.innerHTML = `
        <div class="inventory-slot-head">
          <span class="inventory-slot-label">Hueco ${index + 1}</span>
        </div>
        <input type="text" class="form-input inventory-name-input" placeholder="Objeto" value="${escapeHtml(item.name)}">
        <div class="inventory-qty-row">
          <button type="button" class="inventory-step-btn" data-delta="-1">${UI_ICONS.down}</button>
          <input type="number" min="0" max="10" class="qty-input inventory-qty-input" value="${item.name ? item.qty : 1}">
          <button type="button" class="inventory-step-btn" data-delta="1">${UI_ICONS.up}</button>
        </div>
      `;

      const nameInput = slot.querySelector('.inventory-name-input');
      const qtyInput = slot.querySelector('.inventory-qty-input');

      function commitInventory(nextName, nextQty, { rerender = false } = {}) {
        const nextNotebook = getNotebook();
        const inventory = normalizeNotebookInventory(nextNotebook.inventory);
        while (inventory.length < 10) inventory.push({ name: '', qty: 1 });

        const trimmedName = (nextName || '').trim();
        const qty = clampNotebookQty(nextQty);

        if (!trimmedName || qty === 0) {
          inventory[index] = { name: '', qty: 1 };
        } else {
          inventory[index] = { name: trimmedName, qty: Math.max(1, qty || 1) };
        }

        nextNotebook.inventory = inventory.filter(entry => entry.name);
        saveNotebook(nextNotebook);
        if (rerender) renderInventoryGrid();
      }

      nameInput.addEventListener('input', () => {
        const nextQty = item.name ? qtyInput.value : 1;
        commitInventory(nameInput.value, nextQty, { rerender: !nameInput.value.trim() });
      });

      qtyInput.addEventListener('change', () => {
        commitInventory(nameInput.value, qtyInput.value, { rerender: true });
      });

      slot.querySelectorAll('.inventory-step-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const baseQty = clampNotebookQty(qtyInput.value || (nameInput.value.trim() ? 1 : 0));
          const nextQty = baseQty + parseInt(btn.dataset.delta);
          commitInventory(nameInput.value, nextQty, { rerender: true });
        });
      });

      inventoryGrid.appendChild(slot);
    });
  }

  menuButtons.forEach(button => {
    button.addEventListener('click', () => {
      openNotebookSection(button.dataset.notebookOpen);
    });
  });

  backButtons.forEach(button => {
    button.addEventListener('click', () => {
      openNotebookMenu();
    });
  });

  if (bestiarySearch) {
    bestiarySearch.addEventListener('input', () => {
      bestiaryFilter = bestiarySearch.value.trim().toLowerCase();
      bestiaryPage = 1;
      renderBestiaryList();
    });
  }

  if (notesArea) {
    notesArea.value = getNotebook().notes || '';
    autosizeTextarea(notesArea);
    notesArea.addEventListener('input', () => {
      autosizeTextarea(notesArea);
      const notebook = getNotebook();
      notebook.notes = notesArea.value;
      saveNotebook(notebook);
    });
  }

  clone._openPlayerBestiaryEnemy = enemyId => openBestiaryEnemy(enemyId);
  clone._openPlayerNotebookMenu = () => openNotebookMenu();
  openNotebookMenu();
  showBestiaryListView();
  renderBestiaryList();
  renderInventoryGrid();
  renderBestiaryDetail();
}

function getCurrentStateDoc() {
  return currentCampaignId ? doc(db, 'campaigns', currentCampaignId) : null;
}

function slugifyCampaignName(name) {
  const base = (name || 'campaña')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'campaña';
}

function getUniqueCampaignId(name) {
  const base = slugifyCampaignName(name);
  let candidate = base;
  let n = 2;
  const ids = new Set(campaigns.map(c => c.id));
  while (ids.has(candidate)) {
    candidate = `${base}-${n}`;
    n++;
  }
  return candidate;
}

function formatPublishedDiaryEntry(title, content) {
  const heading = `-${(title || '').trim()}-`;
  const body = (content || '').trim();
  return `${heading}\n${body}`.trim();
}

async function saveCampaignCatalog() {
  await setDoc(CAMPAIGNS_INDEX_DOC, { campaigns }, { merge: true });
}

function normalizeUser(u) {
  return {
    id: u?.id || uid(),
    username: (u?.username || '').trim(),
    passwordHash: u?.passwordHash || hashPassword('dm1234'),
    isDM: !!u?.isDM,
    charId: u?.charId || null
  };
}

function sanitizeUsers(users) {
  const seen = new Set();
  const out = [];
  (users || []).forEach(raw => {
    const u = normalizeUser(raw);
    if (!u.username) return;
    const key = u.username.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(u);
  });
  if (!out.some(u => u.isDM)) {
    out.push({ id: uid(), username: 'dm', passwordHash: hashPassword('dm1234'), isDM: true, charId: null });
  }
  return out;
}

async function saveGlobalUsers() {
  globalUsers = sanitizeUsers(globalUsers);
  await setDoc(APP_USERS_DOC, { users: globalUsers }, { merge: true });
}

async function ensureGlobalUsers(seedUsers = []) {
  const usersSnap = await getDoc(APP_USERS_DOC);
  if (usersSnap.exists() && Array.isArray(usersSnap.data().users) && usersSnap.data().users.length) {
    globalUsers = sanitizeUsers(usersSnap.data().users);
    return;
  }

  let seed = Array.isArray(seedUsers) ? [...seedUsers] : [];
  if (!seed.length && campaigns.length) {
    const firstCampaign = campaigns.find(c => !c.archived) || campaigns[0];
    if (firstCampaign?.id) {
      const campaignSnap = await getDoc(doc(db, 'campaigns', firstCampaign.id));
      if (campaignSnap.exists()) {
        const data = campaignSnap.data();
        seed = Array.isArray(data.users) ? data.users : [];
      }
    }
  }

  globalUsers = sanitizeUsers(seed);
  await saveGlobalUsers();
}

async function migrateLegacyUsersToGlobal() {
  const candidates = [];

  // Legacy single-campaign storage
  try {
    const legacySnap = await getDoc(LEGACY_STATE_DOC);
    if (legacySnap.exists()) {
      const data = legacySnap.data();
      if (Array.isArray(data.users)) candidates.push(...data.users);
    }
  } catch (e) {
    console.error('Legacy users migration read error:', e);
  }

  // Existing campaign documents from pre-migration model
  for (const c of campaigns) {
    if (!c?.id) continue;
    try {
      const snap = await getDoc(doc(db, 'campaigns', c.id));
      if (!snap.exists()) continue;
      const data = snap.data();
      if (Array.isArray(data.users) && data.users.length) candidates.push(...data.users);
    } catch (e) {
      console.error('Campaign users migration read error:', c.id, e);
    }
  }

  if (!candidates.length) return;

  const before = sanitizeUsers(globalUsers);
  const merged = sanitizeUsers([...before, ...candidates]);
  if (merged.length !== before.length) {
    globalUsers = merged;
    await saveGlobalUsers();
  }
}

function startUsersRealtimeSync() {
  if (_usersUnsubscribe) _usersUnsubscribe();
  _usersUnsubscribe = onSnapshot(APP_USERS_DOC, snap => {
    if (!snap.exists()) return;
    const data = snap.data();
    globalUsers = sanitizeUsers(data.users || []);

    if (currentUser && !globalUsers.find(u => u.id === currentUser.id)) { doLogout(); return; }
    if (currentUser) currentUser = globalUsers.find(u => u.id === currentUser.id) || currentUser;

    renderUserList();
    renderMaintLanding();
    applyRoleUI();
  }, err => {
    console.error('Users onSnapshot error:', err);
  });
}

async function ensureCampaignCatalog() {
  const indexSnap = await getDoc(CAMPAIGNS_INDEX_DOC);
  if (indexSnap.exists() && Array.isArray(indexSnap.data().campaigns) && indexSnap.data().campaigns.length) {
    campaigns = indexSnap.data().campaigns;
    return;
  }

  // First run migration path: if legacy state exists, move it to a default campaign.
  const legacySnap = await getDoc(LEGACY_STATE_DOC);
  const defaultId = 'principal';
  const defaultName = 'Campaña Principal';
  const migrated = legacySnap.exists() ? normalizeState(legacySnap.data()) : emptyState();
  const migratedUsers = sanitizeUsers(migrated.users || []);

  await setDoc(doc(db, 'campaigns', defaultId), JSON.parse(JSON.stringify(migrated)));
  campaigns = [{ id: defaultId, name: defaultName, archived: false }];
  await saveCampaignCatalog();
  await ensureGlobalUsers(migratedUsers);
}

function renderCampaignSelect() {
  const sel = document.getElementById('login-campaign');
  if (!sel) return;
  const available = campaigns.filter(c => !c.archived);
  sel.innerHTML = '';

  if (!available.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = 'No hay campañas activas';
    sel.appendChild(o);
    sel.disabled = true;
    applyCampaignBranding();
    return;
  }

  sel.disabled = false;
  available.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name;
    sel.appendChild(o);
  });

  const savedCampaign = sessionStorage.getItem('ljhd_campaign');
  if (savedCampaign && available.some(c => c.id === savedCampaign)) sel.value = savedCampaign;
  else sel.value = available[0].id;
  applyCampaignBranding();
}

function getCurrentCampaignName() {
  const c = campaigns.find(x => x.id === currentCampaignId);
  return c ? c.name : '—';
}

function getSelectedCampaignName() {
  const sel = document.getElementById('login-campaign');
  if (!sel || sel.selectedIndex < 0) return '';
  return sel.options[sel.selectedIndex]?.textContent?.trim() || '';
}

function getBrandName() {
  const current = getCurrentCampaignName();
  if (current && current !== '—') return current;
  const selected = getSelectedCampaignName();
  if (selected) return selected;
  return 'Campaña';
}

function applyCampaignBranding() {
  const brand = getBrandName();
  const login = document.getElementById('brand-login');
  const header = document.getElementById('brand-header');
  const landing = document.getElementById('brand-landing');
  const spectator = document.getElementById('brand-spectator');
  const loading = document.getElementById('brand-loading');

  if (login) login.textContent = brand;
  if (header) header.textContent = brand;
  if (landing) landing.textContent = brand;
  if (spectator) spectator.textContent = brand;
  if (loading) loading.textContent = brand;
  document.title = brand;
}

function getDeskSubtitle() {
  if (!currentUser) return 'Mesa del Director de Juego';
  return isDM() ? 'Mesa del Director de Juego' : 'Mesa de Jugador';
}

function applyDeskSubtitle() {
  const loginSub = document.getElementById('brand-sub-login');
  const headerSub = document.getElementById('brand-sub-header');
  const landingSub = document.getElementById('brand-sub-landing');
  const text = getDeskSubtitle();

  // Login remains oriented to the DM desk before authentication.
  if (loginSub) loginSub.textContent = 'Mesa del Director de Juego';
  if (headerSub) headerSub.textContent = text;
  if (landingSub) landingSub.textContent = text;
}

// ===========================
//  PERSIST (Firestore)
//  saveState(): persiste el estado con debounce de 1.5s para agruz
//    cambios rápidos (ej: plusieurs clics de HP) en una sola escritura.
//  loadState(): carga completa al cambiar de campaña.
//  startRealtimeSync(): activa el listener onSnapshot; cualquier cambio
//    externo (otro usuario) actualiza la UI automáticamente.
// ===========================
// Persiste el estado en Firestore con debounce de 1.5s.
// Usa JSON.parse(JSON.stringify(...)) para clonar y eliminar
// referencias cíclicas antes de escribir.
function saveState() {
  const stateDoc = getCurrentStateDoc();
  clearTimeout(_saveTimeout);
  setSaveIndicator('saving');
  _saveTimeout = setTimeout(async () => {
    try {
      _ignoreNext = true;
      await setDoc(stateDoc, JSON.parse(JSON.stringify(state)));
      setSaveIndicator('saved');
    } catch(e) { console.error('Firestore write:', e); setSaveIndicator(''); }
  }, 1500);
}

function setSaveIndicator(status) {
  const el = document.getElementById('save-indicator');
  if (!el) return;
  clearTimeout(el._hideTimeout);
  if (status === 'saving') {
    el.textContent = 'Guardando…'; el.className = 'save-indicator saving';
  } else if (status === 'saved') {
    el.textContent = '✓ Guardado'; el.className = 'save-indicator saved';
    el._hideTimeout = setTimeout(() => { el.textContent = ''; el.className = 'save-indicator'; }, 2000);
  } else {
    el.textContent = ''; el.className = 'save-indicator';
  }
}

// Carga el estado completo de la campaña desde Firestore.
// Actualiza currentCampaignId y refresca el branding de la UI.
// Muestra el overlay de carga mientras espera la respuesta.
async function loadState(campaignId) {
  currentCampaignId = campaignId;
  const stateDoc = getCurrentStateDoc();
  if (!stateDoc) return;
  showLoadingOverlay(true);
  try {
    const snap = await getDoc(stateDoc);
    if (snap.exists()) {
      state = normalizeState(snap.data());
    } else {
      state = emptyState();
    }
  } catch(e) { console.error('Firestore read:', e); }
  const badge = document.getElementById('campaign-badge');
  if (badge) badge.textContent = getCurrentCampaignName();
  applyCampaignBranding();
  showLoadingOverlay(false);
}

// Activa la escucha en tiempo real de Firestore para la campaña activa.
// Cancela y reemplaza cualquier suscripción previa (_unsubscribe).
// Al recibir cambios externos reconstruye vistas de sesión, listas de
// personajes/enemigos y la ficha de personaje del jugador si está visible.
function startRealtimeSync() {
  if (_unsubscribe) _unsubscribe();
  const stateDoc = getCurrentStateDoc();
  if (!stateDoc) return;
  _unsubscribe = onSnapshot(stateDoc, snap => {
    // Saltamos el eco de nuestro propio setDoc para evitar re-renderizados redundantes
    if (_ignoreNext) { _ignoreNext = false; return; }
    if (!snap.exists()) return;
    state = normalizeState(snap.data());
    if (currentUser && !globalUsers.find(u => u.id === currentUser.id)) { doLogout(); return; }
    if (currentUser) currentUser = globalUsers.find(u => u.id === currentUser.id) || currentUser;
    rebuildSessionTabs();
    renderCharList();
    renderEnemyList();
    if (isDM()) {
      renderUserList(); renderEstadoList(); renderActoList(); renderEventoList(); renderCampaignList();
      document.querySelectorAll('.view[data-session-id]').forEach(view => {
        const s = state.sessions.find(x => x.id === view.dataset.sessionId);
        if (s) renderSessionActos(s, view);
      });
    }
    applyRoleUI();
    // Re-render charsheet: if currently visible OR if player (charsheet is their home)
    const activeView = document.querySelector('.view.active');
    const onCharsheet = activeView && activeView.id === 'view-charsheet';
    if (onCharsheet || (!isDM() && currentUser?.charId)) {
      const csChar = currentUser?.charId ? state.chars.find(c => c.id === currentUser.charId) : null;
      if (onCharsheet || csChar) renderCharSheetView(csChar);
    }
    // Render active sessions if that view is visible
    const onSessionsList = activeView && activeView.id === 'view-sessions-list';
    if (onSessionsList) renderActiveSessions();
    // Update session list in maintenance if visible
    const onMaint = activeView && activeView.id === 'view-maint';
    if (onMaint) renderSessionList();
  }, err => {
    console.error('Firestore onSnapshot error:', err);
  });
}

// Hash de contraseña ligero basado en FNV-1a simplificado.
// NO es criptográfico: no usar para datos sensibles fuera de este contexto
// de uso local/privado donde el propietario del proyecto controla Firestore.
function hashPassword(pw) {
  let h = 0;
  for (let i = 0; i < pw.length; i++) { h = Math.imul(31, h) + pw.charCodeAt(i) | 0; }
  return 'h' + Math.abs(h).toString(36);
}

// ===========================
//  HELPERS
//  uid()      — genera un ID aleatorio de 8 caracteres (base-36)
//  isDM()     — true si el usuario actual es DM y NO está en modo vista-jugador
//  isRealDM() — true si es DM independientemente del modo de previsión
//  getSession — acceso rápido a una sesión por ID
// ===========================
function uid() { return Math.random().toString(36).slice(2,10); }
function isDM() { return currentUser && currentUser.isDM && !_playerPreview; }
function isRealDM() { return currentUser && currentUser.isDM; }
function getSession(id) { return state.sessions.find(s => s.id === id); }

// ===========================
//  LOGIN / LOGOUT
//  doLogin():
//    1. Carga el estado de la campaña si ha cambiado
//    2. Busca el usuario por (username + hash de contraseña) en globalUsers
//    3. Si es válido: oculta loginscreen, construye tabs de sesión,
//       arranca listeners en tiempo real y restaura la vista
//  doLogout():
//    Cancela listeners, limpia sessionStorage, restablece el estado
//    a vacío y vuelve a mostrar la pantalla de login.
// ===========================
async function doLogin() {
  const campaignId = document.getElementById('login-campaign')?.value || '';
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  const hasActiveCampaigns = campaigns.some(c => !c.archived);
  if (!campaignId && hasActiveCampaigns) { errEl.textContent = 'Selecciona una campaña.'; return; }
  if (!username || !password) { errEl.textContent = 'Introduce usuario y contraseña.'; return; }

  if (campaignId && currentCampaignId !== campaignId) {
    await loadState(campaignId);
  }

  const hash = hashPassword(password);
  const user = globalUsers.find(u => u.username === username && u.passwordHash === hash);
  if (!user) { errEl.textContent = 'Usuario o contraseña incorrectos.'; return; }
  currentUser = user;
  errEl.textContent = '';
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('login-pass').value = '';
  if (campaignId) sessionStorage.setItem('ljhd_campaign', campaignId);
  sessionStorage.setItem('ljhd_user', user.id);
  applyRoleUI();
  rebuildSessionTabs();
  renderCharList();
  renderEnemyList();
  renderUserList();
  renderCampaignList();

  // If no campaign selected: DM goes to maintenance to unarchive/create; players see an error
  if (!campaignId) {
    if (!user.isDM) {
      currentUser = null;
      document.getElementById('login-screen').classList.remove('hidden');
      errEl.textContent = 'No hay campañas activas. Contacta al Director de Juego.';
      return;
    }
    switchView('maint');
  } else {
    switchView('landing');
    startRealtimeSync();
  }
  startUsersRealtimeSync();
}

function doLogout() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  if (_usersUnsubscribe) { _usersUnsubscribe(); _usersUnsubscribe = null; }
  sessionStorage.removeItem('ljhd_campaign');
  sessionStorage.removeItem('ljhd_user');
  currentUser = null;
  state = emptyState();
  document.querySelectorAll('#main-content .view[data-session-id]').forEach(v => v.remove());
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  document.getElementById('login-error').textContent = '';
  const campaignSel = document.getElementById('login-campaign');
  if (campaignSel) campaignSel.value = campaigns.find(c => !c.archived)?.id || '';
  const campaignBadge = document.getElementById('campaign-badge');
  if (campaignBadge) campaignBadge.textContent = '—';
  applyCampaignBranding();
  applyDeskSubtitle();
  document.getElementById('login-screen').classList.remove('hidden');
}

// Aplica la UI según el rol del usuario actual.
//   - DM: muestra controles .dm-only-ctrl, badge "DM", botón de preview
//   - Jugador: oculta controles de DM, muestra tab de su ficha
// También gestiona el modo _playerPreview del DM (ver app como jugador).
function applyRoleUI() {
  const dm = isDM();
  const realDM = isRealDM();
  applyDeskSubtitle();
  // Badge
  const badge = document.getElementById('user-badge');
  badge.innerHTML = realDM
    ? (_playerPreview
        ? `<span class="role-player">${UI_ICONS.eye} Vista Jugador</span>`
        : `<span class="role-dm">${UI_ICONS.sword} DM</span> &nbsp;${currentUser.username}`)
    : `${currentUser.username} &nbsp;<span class="role-player">Jugador</span>`;

  // DM-only controls
  document.querySelectorAll('.dm-only-ctrl').forEach(el => { el.style.display = dm ? '' : 'none'; });

  // Legacy tabs may not exist after navigation refactor
  const maintTab = document.getElementById('tab-maint');
  const charsheetTab = document.getElementById('tab-charsheet');
  if (maintTab) maintTab.style.display = dm ? '' : 'none';
  if (charsheetTab) charsheetTab.style.display = !dm ? '' : 'none';

  // Preview toggle: only real DMs
  const togBtn = document.getElementById('preview-toggle');
  if (togBtn) togBtn.style.display = realDM ? '' : 'none';

  // Hide legacy player-char-panel (no longer used)
  const panel = document.getElementById('player-char-panel');
  if (panel) panel.style.display = 'none';
}

// ===========================
//  PLAYER PREVIEW TOGGLE
//  Permite al DM cambiar temporalmente a la perspectiva de jugador
//  para verificar qué ve cada participante sin cerrar sesión.
//  El flag _playerPreview hace que isDM() devuelva false.
// ===========================
function togglePlayerPreview() {
  if (!isRealDM()) return;
  _playerPreview = !_playerPreview;
  const btn = document.getElementById('preview-toggle');
  const lbl = document.getElementById('preview-label');
  btn.classList.toggle('active', _playerPreview);
  lbl.textContent = _playerPreview ? 'Vista DM' : 'Vista jugador';
  // Rebuild everything with new role
  rebuildSessionTabs();
  renderCharList();
  renderEnemyList();
  applyRoleUI();
  // Navigate to landing page
  switchView('landing');
}

// ===========================
//  VIEWS
//  Sistema de vistas de página única: solo una .view tiene la clase .active
//  en cada momento. switchView() desactiva todas y activa la solicitada.
//  Las vistas de sesión se crean dinámicamente con buildSessionView().
// ===========================
function updateBreadcrumbs(viewId) {
  const current = document.getElementById('breadcrumb-current');
  const separator = document.getElementById('breadcrumb-separator');
  
  if (!current) return;
  
  let label = '—';
  let show = false;
  
  if (viewId === 'landing') {
    label = '—';
    show = false;
  } else if (viewId === 'maint') {
    // Check if we're in landing or content
    const maintLanding = document.getElementById('maint-landing');
    if (maintLanding && maintLanding.style.display !== 'none') {
      label = isDM() ? 'Mantenimiento' : 'Hoja de Usuario';
    } else {
      label = isDM() ? 'Mantenimiento' : 'Hoja de Usuario';
    }
    show = true;
  } else if (viewId === 'sessions-list') {
    label = 'Sesiones';
    show = true;
  } else if (viewId === 'session-edit') {
    const editSession = state.sessions.find(s => s.id === _editSessionId);
    label = editSession ? editSession.name : 'Preparar sesión';
    show = true;
  } else if (viewId === 'charsheet') {
    label = 'Hoja de Personaje';
    show = true;
  } else {
    const session = state.sessions.find(s => s.id === viewId);
    if (session) {
      label = session.name;
      show = true;
    }
  }
  
  current.textContent = label;
  separator.style.display = show ? '' : 'none';
  current.style.display = show ? '' : 'none';
}

function switchView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById('view-' + viewId);
  if (target) target.classList.add('active');
  
  if (viewId === 'landing') {
    renderLandingPage();
  } else if (viewId === 'maint') {
    // Show maint landing first
    document.getElementById('maint-landing').style.display = '';
    document.getElementById('maint-content').style.display = 'none';
    renderMaintLanding();
  } else if (viewId === 'sessions-list') {
    renderActiveSessions();
  } else if (viewId === 'session-edit') {
    renderSessionEditView();
  } else if (viewId === 'charsheet') {
    let csChar = null;
    if (currentUser && currentUser.charId) {
      csChar = state.chars.find(c => c.id === currentUser.charId) || null;
    }
    renderCharSheetView(csChar);
  }
  
  updateBreadcrumbs(viewId);
}

function switchMaintTab(name, btn) {
  document.querySelectorAll('.maint-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.maint-section').forEach(s => s.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('maint-' + name).classList.add('active');
}

function switchMaintSection(name, btn) {
  // Hide landing, show content
  document.getElementById('maint-landing').style.display = 'none';
  document.getElementById('maint-content').style.display = '';
  
  // Switch to section
  document.querySelectorAll('.maint-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.maint-section').forEach(s => s.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('maint-' + name).classList.add('active');
  
  // Update breadcrumbs with section name
  const sectionNames = {
    personajes: 'Personajes',
    sesiones: 'Sesiones',
    enemigos: 'Tipos de Enemigos',
    usuarios: 'Usuarios',
    campanas: 'Campañas',
    estados: 'Estados',
    actos: 'Actos',
    eventos: 'Eventos Aleatorios',
    backup: 'Copia de Seguridad'
  };
  
  const current = document.getElementById('breadcrumb-current');
  const separator = document.getElementById('breadcrumb-separator');
  if (current) {
    current.textContent = sectionNames[name] || name;
    separator.style.display = '';
    current.style.display = '';
  }
}

function renderMaintLanding() {
  const container = document.getElementById('maint-landing-buttons');
  if (!container) return;
  container.innerHTML = '';
  
  const sections = [
    { id: 'sesiones', name: 'Sesiones', icon: UI_ICONS.scroll, dmOnly: true },
    { id: 'actos', name: 'Actos', icon: UI_ICONS.sword, dmOnly: true },
    { id: 'eventos', name: 'Eventos Aleatorios', icon: UI_ICONS.dice, dmOnly: true },
    { id: 'enemigos', name: 'Tipos de Enemigos', icon: UI_ICONS.skull, alwaysShow: true },
    { id: 'estados', name: 'Estados', icon: UI_ICONS.spark, dmOnly: true },
    { id: 'personajes', name: 'Personajes', icon: UI_ICONS.helm, alwaysShow: true },
    { id: 'usuarios', name: 'Usuarios', icon: UI_ICONS.users, dmOnly: true },
    { id: 'campanas', name: 'Campañas', icon: UI_ICONS.castle, dmOnly: true },
    { id: 'backup', name: 'Copia de Seguridad', icon: UI_ICONS.key, dmOnly: true }
  ];
  
  const counts = {
    personajes: state.chars.length,
    sesiones:   state.sessions.length,
    enemigos:   state.enemies.length,
    usuarios:   globalUsers.length,
    campanas:   campaigns.filter(c => !c.archived).length,
    estados:    state.estados.length,
    actos:      state.actos.length,
    eventos:    state.eventos.length,
  };

  sections.forEach(section => {
    if (section.dmOnly && !isDM()) return;

    const count = counts[section.id];
    const badge = (count !== undefined)
      ? `<span style="font-family:'Cinzel',serif;font-size:.58rem;color:var(--text-muted);letter-spacing:1px;">(${count})</span>`
      : '';
    const btn = document.createElement('button');
    btn.className = 'landing-card';
    btn.innerHTML = `<span class="card-icon">${section.icon}</span><span class="card-label">${section.name} ${badge}</span>`;
    btn.onclick = () => {
      const maintBtn = document.querySelector(`.maint-tab[data-section="${section.id}"]`);
      switchMaintSection(section.id, maintBtn);
    };
    container.appendChild(btn);
  });
}

function initMaintView() {
  renderMaintLanding();
}

function renderLandingPage() {
  const container = document.getElementById('landing-buttons');
  if (!container) return;
  container.innerHTML = '';
  
  const dm = isDM();
  const isRealDm = isRealDM();
  
  // Button 1: Mantenimiento (DM) / Hoja de Usuario (Player)
  const btn1 = document.createElement('button');
  btn1.className = 'landing-card';
  if (dm) {
    btn1.innerHTML = cardIcon(UI_ICONS.gear, 'Mantenimiento');
    btn1.onclick = () => switchView('maint');
  } else {
    btn1.innerHTML = cardIcon(UI_ICONS.scroll, 'Hoja de Usuario');
    btn1.onclick = () => switchView('charsheet');
  }
  container.appendChild(btn1);
  
  // Button 2: Sesiones
  const btn2 = document.createElement('button');
  btn2.className = 'landing-card';
  btn2.innerHTML = cardIcon(UI_ICONS.book, 'Sesiones');
  btn2.onclick = () => switchView('sessions-list');
  container.appendChild(btn2);
}

function renderActiveSessions() {
  const list = document.getElementById('active-sessions-list');
  if (!list) return;
  list.innerHTML = '';
  
  // Show all existing sessions
  const activeSessions = state.sessions;
  
  if (activeSessions.length === 0) {
    list.innerHTML = '<div class="empty-state">No hay sesiones en este momento.</div>';
    return;
  }
  
  // Sort by most recent first; players only see published sessions
  const sortedSessions = [...activeSessions]
    .filter(s => isDM() || s.published)
    .reverse();

  if (sortedSessions.length === 0) {
    list.innerHTML = '<div class="empty-state">No hay sesiones disponibles en este momento.</div>';
    return;
  }

  sortedSessions.forEach(session => {
    const card = document.createElement('div');
    card.className = 'entity-card';
    card.innerHTML = `
      <div class="entity-card-info">
        <span class="entity-name">${session.name}</span>
        <span class="entity-meta">${session.title || '—'}</span>
      </div>
      <div class="entity-actions">
        <button class="btn btn-outline btn-sm" onclick="switchView('${session.id}')">Entrar</button>
      </div>`;
    list.appendChild(card);
  });
}

// ===========================
//  SESSION EDIT VIEW
//  Vista de preparación de sesión (solo DM):
//  Muestra actos ordenables con sus eventos aleatorios anidados,
//  y el selector de enemigos permitidos en el combate de esa sesión.
// ===========================
const EDIT_CAT_COLORS = { 'Tensión':'#c86e1e','Combate':'#a02020','Social':'#3ca050','Entorno':'#3a7ab8' };
const EDIT_CAT_BG     = { 'Tensión':'rgba(200,110,30,0.15)','Combate':'rgba(160,32,32,0.15)','Social':'rgba(60,160,80,0.15)','Entorno':'rgba(58,122,184,0.15)' };

let _editSessionId = null;

function openSessionEdit(sessionId) {
  _editSessionId = sessionId;
  renderSessionEditView();
  switchView('session-edit');
}

function renderSessionEditView() {
  const session = state.sessions.find(s => s.id === _editSessionId);
  const wrap = document.getElementById('session-edit-content');
  if (!session || !wrap) return;

  const actos = state.actos
    .filter(a => a.sessionId === session.id)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  let html = `
    <div class="se-header">
      <button class="btn btn-outline btn-sm" onclick="switchView('maint');switchMaintSection('sesiones',null)">${withIcon(UI_ICONS.back, 'Sesiones')}</button>
      <span class="se-session-name">${session.name}</span>
      <span style="font-family:'Crimson Text',serif;font-size:.9rem;color:var(--text-muted)">${actos.length} acto${actos.length!==1?'s':''} · ${state.eventos.filter(e=>e.sessionId===session.id).length} eventos</span>
    </div>`;

  if (actos.length === 0) {
    html += `<div style="font-family:'Crimson Text',serif;font-size:1rem;color:var(--text-muted);padding:20px 0">Esta sesión no tiene actos todavía.</div>`;
  }

  wrap.innerHTML = html;

  actos.forEach(acto => {
    const eventos = state.eventos.filter(e => e.actoId === acto.id);
    const block = document.createElement('div');
    block.className = 'se-acto-block';
    block.dataset.actoId = acto.id;

    // Acto header
    const actoHeader = document.createElement('div');
    actoHeader.className = 'se-acto-header';
    const isFirst = actos.indexOf(acto) === 0;
    const isLast  = actos.indexOf(acto) === actos.length - 1;
    actoHeader.innerHTML = `
      <span class="se-acto-title">${UI_ICONS.scroll} ${acto.title}</span>
      <span style="font-family:'Crimson Text',serif;font-size:.82rem;color:var(--text-muted)">${eventos.length} evento${eventos.length!==1?'s':''}</span>
      <button class="btn btn-outline btn-xs" ${isFirst?'disabled':''} onclick="moveActo('${acto.id}',-1)" title="Mover arriba">${UI_ICONS.up}</button>
      <button class="btn btn-outline btn-xs" ${isLast?'disabled':''} onclick="moveActo('${acto.id}',1)" title="Mover abajo">${UI_ICONS.down}</button>
      <button class="btn btn-outline btn-sm" onclick="openActoModal('${acto.id}','${session.id}')">${withIcon(UI_ICONS.edit, 'Editar')}</button>
      <button class="btn btn-danger btn-sm" onclick="deleteActo('${acto.id}')">${withIcon(UI_ICONS.close, 'Borrar')}</button>`;
    block.appendChild(actoHeader);

    // Events list
    const evList = document.createElement('div');
    evList.className = 'se-events-list';
    if (eventos.length === 0) {
      evList.innerHTML = `<div style="font-family:'Crimson Text',serif;font-style:italic;color:var(--text-muted);font-size:.88rem;padding:6px 0">Sin eventos. Añade el primero.</div>`;
    }
    eventos.forEach(ev => {
      const color = EDIT_CAT_COLORS[ev.categoria] || 'var(--text-muted)';
      const bg    = EDIT_CAT_BG[ev.categoria]     || 'transparent';
      const row = document.createElement('div');
      row.className = 'se-event-row';
      row.style.borderLeftColor = color;
      row.innerHTML = `
        <span class="se-event-cat" style="color:${color};background:${bg}">${ev.categoria}</span>
        <span class="se-event-title">${ev.title}</span>
        <button class="btn btn-outline btn-sm" onclick="openEventoModal('${ev.id}','${session.id}','${acto.id}')" title="Editar">${UI_ICONS.edit}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteEvento('${ev.id}')" title="Borrar">${UI_ICONS.close}</button>`;
      evList.appendChild(row);
    });
    block.appendChild(evList);

    // Add event button
    const addEvRow = document.createElement('div');
    addEvRow.className = 'se-add-row';
    addEvRow.innerHTML = `<button class="btn btn-outline btn-sm" onclick="openEventoModal(null,'${session.id}','${acto.id}')">${withIcon(UI_ICONS.plus, 'Añadir evento a este acto')}</button>`;
    block.appendChild(addEvRow);

    wrap.appendChild(block);
  });

  // Add acto button
  const addActo = document.createElement('div');
  addActo.className = 'se-add-acto-row';
  addActo.innerHTML = `<button class="btn btn-gold btn-sm" onclick="openActoModal(null,'${session.id}')">${withIcon(UI_ICONS.plus, 'Añadir acto a esta sesión')}</button>`;
  wrap.appendChild(addActo);

  // Enemy selector
  const allowedSet = new Set(session.allowedEnemies || []);
  const enemiesSection = document.createElement('div');
  enemiesSection.className = 'se-enemies-section';
  const eTitle = document.createElement('div');
  eTitle.className = 'se-enemies-title';
  eTitle.innerHTML = withIcon(UI_ICONS.sword, 'Enemigos de la sesión');
  enemiesSection.appendChild(eTitle);
  const eChips = document.createElement('div');
  eChips.className = 'se-enemies-chips';
  if (state.enemies.length === 0) {
    eChips.innerHTML = '<span class="empty-state" style="display:inline">No hay enemigos registrados.</span>';
  } else {
    state.enemies.forEach(en => {
      const chip = document.createElement('button');
      chip.className = 'chip-enemy-prep' + (allowedSet.has(en.id) ? ' selected' : '');
      chip.textContent = en.name;
      chip.onclick = () => toggleEditEnemy(en.id);
      eChips.appendChild(chip);
    });
  }
  enemiesSection.appendChild(eChips);
  wrap.appendChild(enemiesSection);
}

function moveActo(actoId, dir) {
  const acto = state.actos.find(a => a.id === actoId);
  if (!acto) return;
  const siblings = state.actos
    .filter(a => a.sessionId === acto.sessionId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  // Normalise orders first
  siblings.forEach((a, i) => { a.order = i; });
  const idx = siblings.indexOf(acto);
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= siblings.length) return;
  siblings[idx].order   = swapIdx;
  siblings[swapIdx].order = idx;
  saveState();
  renderActoList();
  if (_editSessionId) renderSessionEditView();
}

function toggleEditEnemy(enemyId) {
  const session = state.sessions.find(s => s.id === _editSessionId);
  if (!session) return;
  const set = new Set(session.allowedEnemies || []);
  if (set.has(enemyId)) set.delete(enemyId); else set.add(enemyId);
  session.allowedEnemies = [...set];
  saveState();
  renderSessionEditView();
}

// ===========================
//  SESSIONS
//  rebuildSessionTabs(): regenera todas las vistas de sesión y restaura
//    la vista activa previa si sigue existiendo.
//  buildSessionView(): clona la plantilla HTML #session-view-template,
//    la adapta al rol del usuario y la añade a #main-content.
// ===========================
function rebuildSessionTabs() {
  const activeView = document.querySelector('#main-content .view.active');
  const activeId = activeView ? (activeView.dataset.sessionId || activeView.id.replace('view-', '')) : null;
  // Don't restore if currently on landing/main menus (or if no activeId)
  const isMenuView = !activeId || activeId === 'landing' || activeId === 'sessions-list' || activeId === 'maint' || activeId === 'charsheet';

  // Remove old session views
  document.querySelectorAll('#main-content .view[data-session-id]').forEach(v => v.remove());

  // Rebuild session views — players only see published sessions
  state.sessions.forEach(session => {
    if (!isDM() && !session.published) return;
    buildSessionView(session);
  });

  // Restore the active session view only if we weren't on a menu and have a valid activeId
  if (!isMenuView && activeId) {
    const restoredView = document.getElementById('view-' + activeId);
    if (restoredView) {
      document.querySelectorAll('#main-content .view').forEach(v => v.classList.remove('active'));
      restoredView.classList.add('active');
      updateBreadcrumbs(activeId);
    }
  }

  renderSessionList();
}

function renderSessionList() {
  const list = document.getElementById('session-maint-list');
  if (!list) return;
  list.innerHTML = '';

  if (state.sessions.length === 0) {
    list.innerHTML = '<div class="empty-state">No hay sesiones creadas.</div>';
    return;
  }

  // Sort by most recent first (reverse order)
  const sortedSessions = [...state.sessions].reverse();
  const itemsPerPage = 10;
  const totalPages = Math.ceil(sortedSessions.length / itemsPerPage);
  let currentPage = parseInt(sessionStorage.getItem('session_list_page') || '1');
  if (currentPage > totalPages) currentPage = 1;
  
  const start = (currentPage - 1) * itemsPerPage;
  const end = start + itemsPerPage;
  const pageSessions = sortedSessions.slice(start, end);

  pageSessions.forEach(session => {
    const card = document.createElement('div');
    card.className = 'entity-card';
    
    const dm = isDM();
    const isPublished = !!session.published;
    card.classList.add(isPublished ? 'session-card--published' : 'session-card--unpublished');
    const pubBtn = isPublished
      ? `<button class="btn btn-sm btn-published" onclick="toggleSessionPublished('${session.id}')">${withIcon(UI_ICONS.globe, 'Publicada')}</button>`
      : `<button class="btn btn-sm btn-unpublished" onclick="toggleSessionPublished('${session.id}')">${withIcon(UI_ICONS.lock, 'No publicada')}</button>`;
    const actionBtns = dm
      ? `${pubBtn}
         <button class="btn btn-outline btn-sm" onclick="openSessionEdit('${session.id}')">${withIcon(UI_ICONS.edit, 'Preparar')}</button>
         <button class="btn btn-outline btn-sm" onclick="switchView('${session.id}')">Abrir</button>
         <button class="btn btn-danger btn-sm" onclick="deleteSession('${session.id}')">${withIcon(UI_ICONS.close, 'Borrar')}</button>`
      : `<button class="btn btn-outline btn-sm" onclick="switchView('${session.id}')">Abrir</button>`;
    
    const actosCount  = state.actos.filter(a => a.sessionId === session.id).length;
    const eventosCount = state.eventos.filter(e => e.sessionId === session.id).length;
    const countersHtml = isDM() ? `<span class="session-card-counters">${actosCount} acto${actosCount!==1?'s':''} &middot; ${eventosCount} evento${eventosCount!==1?'s':''}</span>` : '';
    card.innerHTML = `
      <div class="entity-card-info">
        <span class="entity-name">${session.name}</span>
        <span class="entity-meta">${(session.title || '')}</span>
        ${countersHtml}
      </div>
      <div class="entity-actions">
        ${actionBtns}
      </div>`;
    list.appendChild(card);
  });

  // Pagination
  if (totalPages > 1) {
    const pagDiv = document.createElement('div');
    pagDiv.style.cssText = 'display:flex;gap:6px;justify-content:center;margin-top:16px;flex-wrap:wrap';
    for (let p = 1; p <= totalPages; p++) {
      const btn = document.createElement('button');
      btn.className = `btn btn-outline btn-sm ${p === currentPage ? 'active' : ''}`;
      btn.style.cssText = p === currentPage ? 'background:rgba(166,151,123,.3);border-color:var(--gold)' : '';
      btn.textContent = p;
      btn.onclick = () => { sessionStorage.setItem('session_list_page', p); renderSessionList(); };
      pagDiv.appendChild(btn);
    }
    list.appendChild(pagDiv);
  }
}

function deleteSession(id) {
  showConfirm('¿Eliminar sesión? Esta acción no se puede deshacer.', () => {
  const idx = state.sessions.findIndex(s => s.id === id);
  if (idx === -1) return;
  const wasActive = document.querySelector('.view.active')?.dataset.sessionId === id;
  state.sessions.splice(idx, 1);
  saveState();
  rebuildSessionTabs();
  if (wasActive) switchView('maint');
  showToast('Sesión eliminada', 'info');
  }, 'Eliminar sesión');
}

// ===========================
//  PREPARE COMBATS MODAL
// ===========================
let _prepareCombatsSessionId = null;
let _prepareCombatsSelected  = new Set();

function openPrepareCombatsModal(sessionId) {
  const session = state.sessions.find(s => s.id === sessionId);
  if (!session) return;
  _prepareCombatsSessionId = sessionId;
  _prepareCombatsSelected  = new Set(session.allowedEnemies || []);

  const title = document.getElementById('modal-prepare-combats-title');
  if (title) title.innerHTML = `${UI_ICONS.sword} Preparar Combates — ${session.name}`;

  const wrap  = document.getElementById('prepare-combats-chips');
  const empty = document.getElementById('prepare-combats-empty');
  wrap.innerHTML = '';

  if (!state.enemies.length) {
    wrap.style.display   = 'none';
    empty.style.display  = '';
  } else {
    wrap.style.display   = '';
    empty.style.display  = 'none';
    state.enemies.forEach(enemy => {
      const chip = document.createElement('button');
      chip.className = 'chip-enemy-prep' + (_prepareCombatsSelected.has(enemy.id) ? ' selected' : '');
      chip.textContent = enemy.name;
      chip.dataset.enemyId = enemy.id;
      chip.onclick = () => {
        if (_prepareCombatsSelected.has(enemy.id)) {
          _prepareCombatsSelected.delete(enemy.id);
          chip.classList.remove('selected');
        } else {
          _prepareCombatsSelected.add(enemy.id);
          chip.classList.add('selected');
        }
      };
      wrap.appendChild(chip);
    });
  }

  openModal('modal-prepare-combats');
}

function toggleSessionPublished(id) {
  const session = state.sessions.find(s => s.id === id);
  if (!session) return;
  session.published = !session.published;
  saveState();
  renderSessionList();
  showToast(session.published ? 'Sesión publicada' : 'Sesión ocultada', 'info');
}

function savePrepareCombats() {
  const session = state.sessions.find(s => s.id === _prepareCombatsSessionId);
  if (!session) { closeModal('modal-prepare-combats'); return; }
  session.allowedEnemies = [..._prepareCombatsSelected];
  saveState();
  closeModal('modal-prepare-combats');
  showToast('Combates guardados', 'success');
  // Refresh chips in any open session view
  const container = document.getElementById('view-' + session.id);
  if (container) renderCombatantChips(container, session);
}



function openNewSessionModal() {
  const input = document.getElementById('new-session-name');
  input.value = `Sesión ${state.sessions.length + 1}`;
  input.onkeydown = e => { if (e.key === 'Enter') createSession(); };
  openModal('modal-new-session');
  setTimeout(() => input.select(), 80);
}

function createSession() {
  const name = document.getElementById('new-session-name').value.trim() || `Sesión ${state.sessions.length + 1}`;
  const session = { id: uid(), name, title:'', diary:'', dm_notes:'', quick_notes:'', combatants:[], round:1, activeTurn:0, rollHistory:[], published: false };
  state.sessions.push(session);
  saveState();
  closeModal('modal-new-session');
  buildSessionView(session);
  renderSessionList();
  openSessionEdit(session.id);
  showToast('Sesión creada', 'success');
}



// Clona la plantilla #session-view-template y la configura para la sesión.
// DM: diario editable, actos, eventos, iniciativa completa, notas privadas.
// Jugador: diario solo lectura, iniciativa (sin PV de enemigos), cuaderno personal.
// El clon recibe id="view-{session.id}" y se añade a #main-content.
function buildSessionView(session) {
  const template = document.getElementById('session-view-template');
  if (!template) return;
  
  const clone = template.cloneNode(true);
  clone.id = 'view-' + session.id;
  clone.removeAttribute('style');
  clone.classList.add('view');
  clone.dataset.sessionId = session.id;

  const dm = isDM();

  // Grid layout: players don't have the actos column
  if (!dm) clone.querySelector('.session-grid').classList.add('player-grid');

  // Diary read-only for players
  const diaryArea = clone.querySelector('[data-field="diary"]');
  const titleInput = clone.querySelector('[data-session-name]');
  if (titleInput) titleInput.value = session.name || '';
  const roLabel = clone.querySelector('#diary-ro-label');
  if (!dm) {
    diaryArea.setAttribute('readonly', true);
    if (roLabel) roLabel.style.display = 'inline';
  } else {
    if (roLabel) roLabel.style.display = 'none';
  }

  // Bind text fields
  clone.querySelectorAll('[data-field]').forEach(el => {
    const field = el.dataset.field;
    if (field === 'player_notebook_notes') return;
    el.value = session[field] || '';
    if (!el.hasAttribute('readonly')) {
      el.addEventListener('input', () => { session[field] = el.value; saveState(); });
    }
  });

  // DM-only sections
  if (!dm) {
    clone.querySelectorAll('.dm-only-ctrl').forEach(el => el.style.display = 'none');
    const pnw = clone.querySelector('.player-notes-panel-wrap');
    if (pnw) pnw.style.display = '';
    renderPlayerNotebook(clone);
  }

  // Popup buttons
  const notesBtn    = clone.querySelector('.btn-popup-notes');
  const notesPopup  = clone.querySelector('.popup-notes');
  const diceBtn     = clone.querySelector('.btn-popup-dice');
  const dicePopup   = clone.querySelector('.popup-dice');

  if (notesBtn) {
    notesBtn.innerHTML = dm ? UI_ICONS.quill : UI_ICONS.book;
    notesBtn.title = dm ? 'Notas del DM' : 'Mi Cuaderno';
  }
  const notesPopupTitle = clone.querySelector('.popup-notes-title');
  if (notesPopupTitle) notesPopupTitle.innerHTML = dm ? `${UI_ICONS.quill} Notas del DM` : `${UI_ICONS.book} Mi Cuaderno`;

  function openPopup(popup, btn) {
    popup.style.display = 'flex';
    btn.classList.add('active');
  }
  function closePopup(popup, btn) {
    popup.style.display = 'none';
    btn.classList.remove('active');
  }
  if (notesBtn && notesPopup) {
    notesBtn.addEventListener('click', () => {
      if (notesPopup.style.display === 'none') {
        if (!dm) clone._openPlayerNotebookMenu?.();
        openPopup(notesPopup, notesBtn);
        if (dicePopup && diceBtn) closePopup(dicePopup, diceBtn);
      } else {
        closePopup(notesPopup, notesBtn);
      }
    });
    clone.querySelector('.btn-close-notes')?.addEventListener('click', () => closePopup(notesPopup, notesBtn));
    notesPopup.addEventListener('click', e => { if (e.target === notesPopup) closePopup(notesPopup, notesBtn); });
  }

  if (diceBtn && dicePopup) {
    diceBtn.addEventListener('click', () => {
      if (dicePopup.style.display === 'none') {
        openPopup(dicePopup, diceBtn);
        if (notesPopup && notesBtn) closePopup(notesPopup, notesBtn);
      } else {
        closePopup(dicePopup, diceBtn);
      }
    });
    clone.querySelector('.btn-close-dice')?.addEventListener('click', () => closePopup(dicePopup, diceBtn));
    dicePopup.addEventListener('click', e => { if (e.target === dicePopup) closePopup(dicePopup, diceBtn); });
  }

  // Dice
  const rollDisplay = clone.querySelector('.result-rolls');
  const rollHistory = clone.querySelector('.roll-history');
  const secretLabel = clone.querySelector('.dice-secret-label');
  if (dm && secretLabel) secretLabel.style.display = 'none';
  renderRollHistory(session, rollHistory);
  clone.querySelectorAll('.dice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sides = parseInt(btn.dataset.sides);
      const qty = Math.min(20, Math.max(1, parseInt(clone.querySelector('.dice-qty').value) || 1));
      const rolls = Array.from({length: qty}, () => Math.ceil(Math.random() * sides));
      const total = rolls.reduce((a,b) => a+b, 0);
      const secret = clone.querySelector('.dice-secret-chk').checked;
      const isDMroll = isDM();
      const entry = { label:`${qty}d${sides}`, rolls, total, user: currentUser?.username || '?', secret, isDMroll };
      session.rollHistory.unshift(entry);
      if (session.rollHistory.length > 60) session.rollHistory.pop();
      saveState();
      renderRollDisplay(rollDisplay, entry);
      renderRollHistory(session, rollHistory);
    });
  });
  clone.querySelector('.clear-dice-btn')?.addEventListener('click', () => {
    session.rollHistory = [];
    saveState();
    if (rollHistory) rollHistory.innerHTML = '';
    if (rollDisplay) rollDisplay.textContent = '—';
  });

  // Initiative
  clone.querySelector('.round-num').textContent = session.round;
  if (dm) {
    clone.querySelector('.next-turn-btn').addEventListener('click', () => {
      const alive = session.combatants.filter(c => !c.dead);
      if (!alive.length) return;
      session.activeTurn = (session.activeTurn + 1) % alive.length;
      if (session.activeTurn === 0) session.round++;
      clone.querySelector('.round-num').textContent = session.round;
      saveState();
      renderCombatantList(session, clone);
    });
    clone.querySelector('.reset-combat-btn').addEventListener('click', () => {
      session.activeTurn = 0; session.round = 1;
      clone.querySelector('.round-num').textContent = 1;
      saveState();
      renderCombatantList(session, clone);
    });
    clone.querySelector('.sort-init-btn').addEventListener('click', () => {
      session.combatants.sort((a,b) => b.init - a.init);
      session.activeTurn = 0;
      saveState();
      renderCombatantList(session, clone);
    });
    clone.querySelector('.clear-npcs-btn').addEventListener('click', () => {
      session.combatants = session.combatants.filter(c => c.type === 'pj');
      session.activeTurn = 0;
      saveState();
      renderCombatantList(session, clone);
    });
    renderCombatantChips(clone, session);
    clone.querySelector('.add-combatant-btn').addEventListener('click', () => addCombatantToSession(session, clone));
  }
  renderCombatantList(session, clone);
  if (dm) {
    renderSessionActos(session, clone);
    wireSessionEventos(session, clone);
    const spectatorBtn = clone.querySelector('.btn-spectator');
    if (spectatorBtn) spectatorBtn.addEventListener('click', () => openSpectatorWindow(session.id));
  }
  renderSessionGallery(session, clone);
  document.getElementById('main-content').appendChild(clone);
}

// ===========================
//  SESSION EVENTOS
// ===========================
function wireSessionEventos(session, clone) {
  const COLORS = { Tensión:'#c86e1e', Combate:'#a02020', Social:'#3ca050', Entorno:'#3a7ab8' };

  function getOpenActo() {
    // Open acto has its toggle set to the ▼ glyph
    const openHeader = Array.from(clone.querySelectorAll('.actos-accordion .acto-header'))
      .find(h => h.querySelector('.acto-toggle').textContent.trim() === '\u25bc');
    if (!openHeader) return null;
    const titleText = openHeader.querySelector('.acto-title').textContent.trim();
    return state.actos.find(a => a.sessionId === session.id && a.title === titleText) || null;
  }

  function showEvento(evento) {
    const empty = clone.querySelector('.evr-empty');
    const content = clone.querySelector('.evr-content');
    if (!evento) {
      empty.style.display = '';
      content.style.display = 'none';
      empty.textContent = 'No hay eventos de esta categoría para el acto seleccionado.';
      return;
    }
    empty.style.display = 'none';
    content.style.display = '';
    const color = COLORS[evento.categoria] || 'var(--text-muted)';
    const badge = clone.querySelector('.evr-cat-badge');
    badge.textContent = evento.categoria;
    badge.style.color = color;
    clone.querySelector('.evr-title').textContent = evento.title;
    clone.querySelector('.evr-public').value = evento.public || '';
    clone.querySelector('.evr-private').value = evento.private || '';
  }

  clone.querySelectorAll('.evt-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      const acto = getOpenActo();
      if (!acto) {
        const empty = clone.querySelector('.evr-empty');
        const content = clone.querySelector('.evr-content');
        empty.style.display = '';
        content.style.display = 'none';
        empty.textContent = 'Despliega un acto primero.';
        return;
      }
      let pool = state.eventos.filter(e => e.sessionId === session.id && e.actoId === acto.id);
      if (cat !== 'Todos') pool = pool.filter(e => e.categoria === cat);
      if (!pool.length) { showEvento(null); return; }
      showEvento(pool[Math.floor(Math.random() * pool.length)]);
    });
  });

  clone.querySelector('.evr-pub-btn').addEventListener('click', () => {
    const text = clone.querySelector('.evr-public').value;
    if (!text) return;
    const title = clone.querySelector('.evr-title')?.textContent || 'Evento';
    const entry = formatPublishedDiaryEntry(title, text);
    const diary = clone.querySelector('[data-field="diary"]');
    if (diary) {
      diary.value = diary.value ? diary.value + '\n\n' + entry : entry;
      session.diary = diary.value;
      saveState();
    }
  });
}

// ===========================
//  SESSION ACTOS ACCORDION
// ===========================
function renderSessionActos(session, clone) {
  const accordion = clone.querySelector('.actos-accordion');
  if (!accordion) return;
  accordion.innerHTML = '';
  const sessionActos = state.actos.filter(a => a.sessionId === session.id);
  if (sessionActos.length === 0) {
    accordion.innerHTML = '<div style="padding:8px 2px;color:var(--text-muted);font-family:\'Crimson Text\',serif;font-style:italic;font-size:.9rem">No hay actos para esta sesi\u00f3n.</div>';
    return;
  }
  sessionActos.forEach(acto => {
    const item = document.createElement('div');
    item.className = 'acto-item';
    const header = document.createElement('div');
    header.className = 'acto-header';
    header.innerHTML = `<span class="acto-toggle">&#9658;</span><span class="acto-title">${acto.title}</span>`;
    const body = document.createElement('div');
    body.className = 'acto-body';
    body.style.display = 'none';

    // Contenido público + botón publicar
    const pubRow = document.createElement('div');
    pubRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
    const pubLabel = document.createElement('label');
    pubLabel.className = 'flabel';
    pubLabel.style.margin = '0';
    pubLabel.textContent = 'Contenido Público';
    const pubBtn = document.createElement('button');
    pubBtn.className = 'btn btn-outline btn-sm';
    pubBtn.innerHTML = withIcon(UI_ICONS.horn, 'Publicar');
    pubBtn.addEventListener('click', () => {
      const text = acto.public || '';
      if (!text) return;
      const entry = formatPublishedDiaryEntry(acto.title, text);
      const diary = clone.querySelector('[data-field="diary"]');
      if (diary) {
        diary.value = diary.value ? diary.value + '\n\n' + entry : entry;
        session.diary = diary.value;
        saveState();
      }
    });
    pubRow.appendChild(pubLabel);
    pubRow.appendChild(pubBtn);
    const pubArea = document.createElement('textarea');
    pubArea.className = 'note-area';
    pubArea.style.minHeight = '80px';
    pubArea.readOnly = true;
    pubArea.value = acto.public || '';

    // Contenido privado
    const privLabel = document.createElement('label');
    privLabel.className = 'flabel';
    privLabel.textContent = 'Contenido Privado';
    const privArea = document.createElement('textarea');
    privArea.className = 'note-area';
    privArea.style.minHeight = '80px';
    privArea.readOnly = true;
    privArea.value = acto.private || '';

    body.appendChild(pubRow);
    body.appendChild(pubArea);
    body.appendChild(privLabel);
    body.appendChild(privArea);

    // Imagen del acto: thumbnail + botón para publicarla en el diario de la sesión
    if (acto.image) {
      const imgRow = document.createElement('div');
      imgRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;';
      const imgLabel = document.createElement('label');
      imgLabel.className = 'flabel'; imgLabel.style.margin = '0';
      imgLabel.innerHTML = withIcon(UI_ICONS.camera, 'Imagen');
      imgRow.appendChild(imgLabel);
      if (isDM()) {
        const imgPubBtn = document.createElement('button');
        imgPubBtn.className = 'btn btn-outline btn-sm';
        imgPubBtn.innerHTML = withIcon(UI_ICONS.camera, 'Publicar imagen');
        imgPubBtn.addEventListener('click', () => publishActoImage(session, acto, clone));
        imgRow.appendChild(imgPubBtn);
      }
      const thumbnail = document.createElement('img');
      thumbnail.src = acto.image; thumbnail.alt = acto.title;
      thumbnail.className = 'acto-img-thumb';
      thumbnail.addEventListener('click', () => openGalleryLightbox(acto.image, acto.title));
      body.appendChild(imgRow);
      body.appendChild(thumbnail);
    }

    header.addEventListener('click', () => {
      const open = body.style.display !== 'none';
      // Collapse all other items first
      accordion.querySelectorAll('.acto-body').forEach((b, _, all) => {
        b.style.display = 'none';
        b.previousElementSibling.querySelector('.acto-toggle').innerHTML = '&#9658;';
      });
      // Toggle clicked item
      if (!open) {
        body.style.display = '';
        header.querySelector('.acto-toggle').innerHTML = '&#9660;';
      }
    });
    item.appendChild(header);
    item.appendChild(body);
    accordion.appendChild(item);
  });
}

// ===========================
//  DICE
// ===========================
function renderRollDisplay(el, entry) {
  if (entry.rolls.length === 1) {
    el.innerHTML = `<span class="result-total">${entry.total}</span>`;
  } else {
    el.innerHTML = `<span style="font-size:1.1rem;color:var(--ink-faded)">[${entry.rolls.join(', ')}]</span> <span style="color:var(--ink-faded);font-size:.9rem">=</span> <span class="result-total">${entry.total}</span>`;
  }
}
function renderRollHistory(session, el) {
  el.innerHTML = '';
  const dm = isDM();
  session.rollHistory.forEach(e => {
    if (e.isDMroll && !dm) return;
    if (e.secret && !dm && e.user !== currentUser?.username) return;
    const d = document.createElement('div'); d.className = 'roll-entry';
    const badge = e.secret ? ` <span class="roll-badge secret">${UI_ICONS.lock}</span>` : (e.isDMroll ? ` <span class="roll-badge dm">${UI_ICONS.mask}</span>` : '');
    d.innerHTML = `<span><span class="ru">${e.user||'?'}</span>${badge}<span class="rl">${e.label}</span></span><span class="rv">${e.rolls.length>1?'['+e.rolls.join(',')+'] = ':''}${e.total}</span>`;
    el.appendChild(d);
  });
}

// ===========================
//  COMBATANTS
//  renderCombatantChips(): muestra chips de PJs y enemigos permitidos
//    para añadirlos rápidamente al combate.
//  addCombatantToSession(): agrega un combatiente libre con iniciativa
//    aleatoria y HP manual.
//  renderCombatantList(): renderiza las tarjetas de la lista de iniciativa.
//    Muestra/oculta HP de enemigos según el rol.
//    Agrupa en columnas de 6 si hay más de 6 combatientes.
// ===========================
function renderCombatantChips(clone, session) {
  const pjWrap = clone.querySelector('.chips-pj');
  const enWrap = clone.querySelector('.chips-enemy');
  if (!pjWrap || !enWrap) return;

  pjWrap.innerHTML = '';
  enWrap.innerHTML = '';

  state.chars.forEach(char => {
    const alreadyIn = session.combatants.some(c => c.charId === char.id && !c.dead);
    const chip = document.createElement('button');
    chip.className = 'chip-pj' + (alreadyIn ? ' in-session' : '');
    chip.textContent = char.name;
    chip.disabled = alreadyIn;
    chip.onclick = () => {
      session.combatants.push({ id:uid(), name:char.name, charId:char.id, init:10, hp:char.vida||10, maxHp:char.vida||10, tempHp:0, type:'pj', dead:false, conditions:[] });
      session.combatants.sort((a,b) => b.init - a.init);
      saveState();
      renderCombatantList(session, clone);
    };
    pjWrap.appendChild(chip);
  });

  const visibleEnemies = Array.isArray(session.allowedEnemies)
    ? state.enemies.filter(e => session.allowedEnemies.includes(e.id))
    : state.enemies;

  visibleEnemies.forEach(enemy => {
    const chip = document.createElement('button');
    chip.className = 'chip-enemy';
    chip.textContent = enemy.name;
    chip.onclick = () => {
      const rndInit = Math.ceil(Math.random() * 20);
      session.combatants.push({ id:uid(), name:enemy.name, enemyId:enemy.id, init:rndInit, hp:enemy.pv||10, maxHp:enemy.pv||10, tempHp:0, type:'enemy', dead:false, conditions:[] });
      registerEncounteredEnemy(enemy.id);
      session.combatants.sort((a,b) => b.init - a.init);
      saveState();
      renderCombatantList(session, clone);
    };
    enWrap.appendChild(chip);
  });
}

function addCombatantToSession(session, clone) {
  const name = clone.querySelector('.combatant-name-in').value.trim() || 'Desconocido';
  const init = Math.ceil(Math.random() * 20);
  const hp   = parseInt(clone.querySelector('.combatant-hp-in').value) || 10;
  session.combatants.push({ id:uid(), name, init, hp, maxHp:hp, tempHp:0, type:'custom', dead:false, conditions:[] });
  session.combatants.sort((a,b) => b.init - a.init);
  clone.querySelector('.combatant-name-in').value = '';
  saveState();
  renderCombatantList(session, clone);
}

// Renderiza la lista de tarjetas de iniciativa.
// - Jugadores solo ven HP de sus propios personajes (type==='pj' && charId === suyo).
// - El turno activo (activeTurn sobre vivos) resalta con clase .active-turn.
// - Con >6 combatientes agrupa en columnas de 6 (.multi-col) para aprovechar
//   el ancho de pantalla en combates grandes.
function renderCombatantList(session, clone) {
  const dm = isDM();
  const list = clone.querySelector('.combatant-list');
  list.innerHTML = '';
  const cards = [];
  const alive = session.combatants.filter(c => !c.dead);
  session.combatants.forEach((c, idx) => {
    const aliveIdx = alive.indexOf(c);
    const isActive = !c.dead && aliveIdx === session.activeTurn;
    const totalHp = c.hp + (c.tempHp || 0);
    const pct = Math.max(0, Math.min(100, (totalHp / c.maxHp) * 100));
    const barClass = pct > 60 ? 'ok' : pct > 25 ? 'low' : '';
    const card = document.createElement('div');
    const typeClass = c.type === 'pj' ? ' type-pj' : c.type === 'enemy' ? ' type-enemy' : '';
    card.className = 'combatant-card' + typeClass + (isActive?' active-turn':'') + (c.dead?' dead':'');
    // Players: see HP of PJs but NOT enemies
    const showHp = dm || c.type === 'pj';
    const hpDisplay = c.tempHp > 0 ? `${c.hp} + ${c.tempHp}T / ${c.maxHp}` : `${c.hp} / ${c.maxHp}`;
    const hpHtml = showHp
      ? `<div class="hp-bar-wrap">
          <div class="hp-bar-track"><div class="hp-bar-fill ${barClass}" style="width:${pct}%"></div></div>
          <div class="hp-text">${hpDisplay}</div>
        </div>`
      : `<div class="hp-bar-wrap"><div class="hp-text" style="font-style:italic;opacity:.5">—</div></div>`;
    const isOwnChar = !dm && c.type === 'pj' && currentUser?.charId && c.charId === currentUser.charId;
    const canControl = dm || isOwnChar;
    const initHtml = canControl
      ? `<input class="c-init-input" type="number" value="${c.init}" min="1" max="99" title="Editar iniciativa">`
      : `<div class="c-init">${c.init}</div>`;
    card.innerHTML = `
      <div class="c-init-wrap">${initHtml}</div>
      <div class="c-name">${c.name}<span class="c-type">${c.type==='pj'?'Personaje':c.type==='enemy'?'Enemigo':''}</span></div>
      ${hpHtml}
      <div class="hp-actions${canControl?'':' player-hide'}">
        <button class="hp-btn dmg" title="Daño">−</button>
        <button class="hp-btn heal" title="Curar">+</button>
      </div>
      <div class="conditions-wrap"></div>
      <div class="dead-btns-corner ${dm?'':'player-hide'}">
        <button class="dead-btn">${c.dead?'♻':'☠'}</button>
        <button class="dead-btn" style="border-color:var(--ink-faded);color:var(--ink-faded)">${UI_ICONS.close}</button>
      </div>
      ${(c.type==='enemy' && c.enemyId && (dm || !c.dead)) ? `<button class="enemy-info-btn${dm ? '' : ' enemy-info-btn-player'}" title="${dm ? 'Ver ficha del enemigo' : 'Abrir bestiario'}">${UI_ICONS.eye}</button>` : ''}`;

    // Info button hover — DM only, enemy with template
    if (c.type === 'enemy' && c.enemyId) {
      const infoBtn = card.querySelector('.enemy-info-btn');
      if (infoBtn && dm) {
        infoBtn.addEventListener('mouseenter', () => showEnemyTooltip(c.enemyId, infoBtn));
        infoBtn.addEventListener('mouseleave', scheduleHideEnemyTooltip);
        infoBtn.addEventListener('click', e => { e.stopPropagation(); showEnemyTooltip(c.enemyId, infoBtn); });
      } else if (infoBtn && !dm) {
        infoBtn.addEventListener('click', e => {
          e.stopPropagation();
          const opened = clone._openPlayerBestiaryEnemy?.(c.enemyId);
          if (!opened) return;
          const notesBtn = clone.querySelector('.btn-popup-notes');
          const notesPopup = clone.querySelector('.popup-notes');
          const diceBtn = clone.querySelector('.btn-popup-dice');
          const dicePopup = clone.querySelector('.popup-dice');
          if (notesBtn && notesPopup) {
            notesPopup.style.display = 'flex';
            notesBtn.classList.add('active');
          }
          if (diceBtn && dicePopup) {
            dicePopup.style.display = 'none';
            diceBtn.classList.remove('active');
          }
        });
      }
    }

    // Conditions
    const condWrap = card.querySelector('.conditions-wrap');
    c.conditions.forEach((cond, ci) => {
      const tag = document.createElement('span'); tag.className = 'condition-tag';
      tag.innerHTML = canControl ? `${cond} ${UI_ICONS.close}` : cond;
      if (canControl) tag.onclick = () => { c.conditions.splice(ci,1); saveState(); renderCombatantList(session, clone); };
      condWrap.appendChild(tag);
    });
    if (canControl) {
      const addBtn = document.createElement('button'); addBtn.className = 'add-cond-btn'; addBtn.textContent = '+ estado';
      addBtn.onclick = () => openCondModal(session, idx, clone);
      condWrap.appendChild(addBtn);
    }

    // Initiative input — DM always, player for own char
    const initInput = card.querySelector('.c-init-input');
    if (initInput) {
      initInput.addEventListener('change', () => { c.init = parseInt(initInput.value) || 1; saveState(); });
    }

    if (canControl) {
      const [dmgBtn, healBtn] = card.querySelectorAll('.hp-btn');
      dmgBtn.onclick = () => { c.hp = Math.max(0, c.hp-1); saveState(); renderCombatantList(session, clone); };
      healBtn.onclick = () => { c.hp = Math.min(c.maxHp, c.hp+1); saveState(); renderCombatantList(session, clone); };
    }
    if (dm) {
      const [deadBtn, removeBtn] = card.querySelectorAll('.dead-btn');
      deadBtn.onclick = () => { c.dead = !c.dead; saveState(); renderCombatantList(session, clone); };
      removeBtn.onclick = () => { session.combatants.splice(idx,1); saveState(); renderCombatantList(session, clone); };
    }
    cards.push(card);
  });
  if (cards.length > 6) {
    list.classList.add('multi-col');
    const COL_SIZE = 6;
    for (let i = 0; i < cards.length; i += COL_SIZE) {
      const col = document.createElement('div');
      col.className = 'combatant-column';
      cards.slice(i, i + COL_SIZE).forEach(c => col.appendChild(c));
      list.appendChild(col);
    }
  } else {
    list.classList.remove('multi-col');
    cards.forEach(c => list.appendChild(c));
  }
  // Refresh chips so disabled state of PJ chips stays accurate
  renderCombatantChips(clone, session);
}

// ===========================
//  ENEMY STAT TOOLTIP
//  Tooltip flotante (solo DM) que muestra la ficha completa del enemigo
//  al pasar el ratón sobre el botón ⓘ en su tarjeta de combate.
//  Se oculta automáticamente 150ms después de sacar el ratón
//  (scheduleHideEnemyTooltip) a menos que se mueva al propio tooltip.
// ===========================
let _tooltipHideTimer = null;

function showEnemyTooltip(enemyId, anchor) {
  const enemy = state.enemies.find(e => e.id === enemyId);
  if (!enemy) return;
  const tip = document.getElementById('enemy-stat-tooltip');
  if (!tip) return;

  clearTimeout(_tooltipHideTimer);

  tip.querySelector('.est-name').textContent = enemy.name;
  tip.querySelector('.est-pv').textContent = enemy.pv ?? '—';
  tip.querySelector('.est-armor').textContent = enemy.armor || '—';
  tip.querySelector('.est-fue').textContent = enemy.fue ?? '—';
  tip.querySelector('.est-int').textContent = enemy.int ?? '—';
  tip.querySelector('.est-car').textContent = enemy.car ?? '—';
  tip.querySelector('.est-des').textContent = enemy.des ?? '—';

  const attacksWrap = tip.querySelector('.est-attacks-wrap');
  const attacksEl   = tip.querySelector('.est-attacks');
  const attacks = (enemy.attacks || '').trim();
  attacksEl.textContent = attacks;
  attacksWrap.style.display = attacks ? '' : 'none';

  const notesWrap = tip.querySelector('.est-notes-wrap');
  const notesEl   = tip.querySelector('.est-notes');
  const notes = (enemy.notes || '').trim();
  notesEl.textContent = notes;
  notesWrap.style.display = notes ? '' : 'none';

  // Position near anchor
  const rect = anchor.getBoundingClientRect();
  const tipW = 280;
  const margin = 8;
  let left = rect.right + margin;
  if (left + tipW > window.innerWidth - margin) left = rect.left - tipW - margin;
  if (left < margin) left = margin;
  let top = rect.top;
  tip.style.left = left + 'px';
  tip.style.top  = top + 'px';
  tip.style.maxWidth = tipW + 'px';

  tip.removeAttribute('aria-hidden');
  tip.classList.add('visible');

  // Keep visible when hovering the tooltip itself
  tip.onmouseenter = () => clearTimeout(_tooltipHideTimer);
  tip.onmouseleave = scheduleHideEnemyTooltip;
}

function scheduleHideEnemyTooltip() {
  clearTimeout(_tooltipHideTimer);
  _tooltipHideTimer = setTimeout(hideEnemyTooltip, 150);
}

function hideEnemyTooltip() {
  const tip = document.getElementById('enemy-stat-tooltip');
  if (!tip) return;
  tip.classList.remove('visible');
  tip.setAttribute('aria-hidden', 'true');
}

// ===========================
//  HP MODAL
//  Abre el modal de modificación de PV para un combatiente específico.
//  hpRef almacena la referencia {session, idx, clone} para que
//  applyHP/setTempHP puedan actualizar el estado y refrescar la lista.
// ===========================
let hpRef = null;
function openHpModal(session, idx, clone) {
  hpRef = {session, idx, clone};
  const c = session.combatants[idx];
  document.getElementById('modal-hp-title').textContent = `PV — ${c.name}`;
  document.getElementById('hp-current-display').textContent = `${c.hp} / ${c.maxHp}`;
  document.getElementById('temp-hp-display').textContent = c.tempHp || 0;
  document.getElementById('hp-amount-in').value = 1;
  document.getElementById('temp-hp-amount-in').value = c.tempHp || 0;
  openModal('modal-hp');
}
// Aplica daño o curación al combatiente referenciado en hpRef.
// Orden de absorción del daño:
//   1. PV temporales (tempHp) se descuentan primero
//   2. El exceso se aplica a los PV normales (no negativos)
// Curar nunca supera el máximo (maxHp); no afecta tempHp.
// `exact=true` fija el HP normal al valor del input sin lógica de absorción.
function applyHP(dir, exact) {
  if (!hpRef) return;
  const {session, idx, clone} = hpRef;
  const c = session.combatants[idx];
  const amount = parseInt(document.getElementById('hp-amount-in').value) || 1;
  
  if (exact) {
    // Establecer valor exacto en HP (no afecta tempHp)
    c.hp = Math.max(0, Math.min(c.maxHp, amount));
  } else if (dir === -1) {
    // Daño: primero descontar tempHp, luego hp
    c.tempHp -= amount;
    if (c.tempHp < 0) {
      c.hp += c.tempHp; // c.tempHp es negativo, así que resta
      c.tempHp = 0;
    }
    c.hp = Math.max(0, Math.min(c.maxHp, c.hp));
  } else if (dir === 1) {
    // Curar: solo curar HP normal, no tempHp
    c.hp = Math.max(0, Math.min(c.maxHp, c.hp + amount));
  }
  
  document.getElementById('hp-current-display').textContent = `${c.hp} / ${c.maxHp}`;
  document.getElementById('temp-hp-display').textContent = c.tempHp || 0;
  saveState();
  renderCombatantList(session, clone);
}
function setTempHP() {
  if (!hpRef) return;
  const {session, idx, clone} = hpRef;
  const c = session.combatants[idx];
  const tempAmount = parseInt(document.getElementById('temp-hp-amount-in').value) || 0;
  c.tempHp = Math.max(0, tempAmount);
  document.getElementById('temp-hp-display').textContent = c.tempHp;
  saveState();
  renderCombatantList(session, clone);
}

// ===========================
//  CONDITION MODAL
//  Muestra chips de los estados definidos en Mantenimiento > Estados.
//  Si no hay estados personalizados usa 8 estados por defecto.
//  Los estados seleccionados se añaden a combatants[idx].conditions[]
// ===========================
let condRef = null;
function openCondModal(session, idx, clone) {
  condRef = {session, idx, clone};
  document.getElementById('cond-input').value = '';
  renderCondChips();
  openModal('modal-cond');
}
function renderCondChips() {
  const wrap = document.getElementById('cond-chips');
  if (!wrap) return;
  wrap.innerHTML = '';
  const lista = state.estados.length
    ? state.estados
    : [{id:'_',nombre:'Envenenado'},{id:'_',nombre:'Aturdido'},{id:'_',nombre:'Asustado'},{id:'_',nombre:'Ralentizado'},{id:'_',nombre:'Paralizado'},{id:'_',nombre:'Cegado'},{id:'_',nombre:'Atrapado'},{id:'_',nombre:'Sangrando'}];
  lista.forEach(e => {
    const btn = document.createElement('button');
    btn.className = 'condition-tag';
    btn.textContent = e.nombre;
    btn.onclick = () => { document.getElementById('cond-input').value = e.nombre; };
    wrap.appendChild(btn);
  });
}
function setCondInput(v) { document.getElementById('cond-input').value = v; }
function addConditionConfirm() {
  if (!condRef) return;
  const {session, idx, clone} = condRef;
  const v = document.getElementById('cond-input').value.trim();
  if (v) { session.combatants[idx].conditions.push(v); saveState(); }
  closeModal('modal-cond');
  renderCombatantList(session, clone);
}

// ===========================
//  ESTADOS MAINTENANCE
//  Lista simple de nombres de estado. Si está vacía, renderCondChips()
//  usa los 8 estados predeterminados del sistema.
// ===========================
function renderEstadoList() {
  const list = document.getElementById('estado-list');
  if (!list) return;
  list.innerHTML = '';
  if (state.estados.length === 0) {
    list.innerHTML = '<div class="empty-state">No hay estados definidos. Los estados predeterminados del sistema se usarán en el gestor de iniciativa.</div>';
    return;
  }
  state.estados.forEach((e, i) => {
    const card = document.createElement('div');
    card.className = 'entity-card';
    card.innerHTML = `
      <div class="entity-card-info">
        <span class="entity-name">${e.nombre}</span>
      </div>
      <div class="entity-actions">
        <button class="btn btn-danger btn-sm" onclick="deleteEstado('${e.id}')">${withIcon(UI_ICONS.close, 'Borrar')}</button>
      </div>`;
    list.appendChild(card);
  });
}
function addEstado() {
  const input = document.getElementById('nuevo-estado-input');
  const nombre = input ? input.value.trim() : '';
  if (!nombre) return;
  if (state.estados.some(e => e.nombre.toLowerCase() === nombre.toLowerCase())) {
    input.value = ''; return;
  }
  state.estados.push({ id: uid(), nombre });
  saveState();
  input.value = '';
  renderEstadoList();
}
function deleteEstado(id) {
  const idx = state.estados.findIndex(e => e.id === id);
  if (idx === -1) return;
  showConfirm('¿Eliminar este estado?', () => {
    state.estados.splice(idx, 1);
    saveState();
    renderEstadoList();
    showToast('Estado eliminado', 'info');
  }, 'Eliminar estado');
}

// ===========================
//  ACTOS MAINTENANCE
//  Los actos se listan agrupados por sesión en un árbol colapsable.
//  El campo `order` (entero) determina el orden dentro de la sesión;
//  moveActo() normaliza y permuta los índices de orden.
// ===========================
let editingActoId = null;
let _editingActoImage = null; // base64 de la imagen del acto en edición

function renderActoList() {
  const list = document.getElementById('acto-list');
  if (!list) return;
  list.innerHTML = '';
  if (state.actos.length === 0 && state.sessions.length === 0) {
    list.innerHTML = '<div class="empty-state">No hay actos definidos.</div>';
    return;
  }

  // Group actos by session; show all sessions that have actos
  const sessionIds = [...new Set(state.actos.map(a => a.sessionId))];
  if (sessionIds.length === 0) {
    list.innerHTML = '<div class="empty-state">No hay actos definidos.</div>';
    return;
  }

  sessionIds.forEach(sid => {
    const session = state.sessions.find(s => s.id === sid);
    const actos = state.actos
      .filter(a => a.sessionId === sid)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    // Session node
    const sessionNode = document.createElement('div');
    sessionNode.className = 'tree-session';
    const sessionHeader = document.createElement('div');
    sessionHeader.className = 'tree-session-header';
    sessionHeader.innerHTML = `<span class="tree-toggle">▾</span><span class="tree-session-name">${session ? session.name : sid}</span><span class="tree-count">${actos.length} acto${actos.length !== 1 ? 's' : ''}</span>`;
    const childWrap = document.createElement('div');
    childWrap.className = 'tree-children';
    sessionHeader.addEventListener('click', () => {
      const collapsed = childWrap.classList.toggle('collapsed');
      sessionHeader.querySelector('.tree-toggle').textContent = collapsed ? '▸' : '▾';
    });
    sessionNode.appendChild(sessionHeader);

    actos.forEach((a, idx) => {
      const isFirst = idx === 0;
      const isLast  = idx === actos.length - 1;
      const row = document.createElement('div');
      row.className = 'tree-leaf entity-card';
      row.innerHTML = `
        <div class="entity-card-info">
          <span class="entity-name">${a.title}</span>
        </div>
        <div class="entity-actions">
          <button class="btn btn-outline btn-xs" ${isFirst?'disabled':''} onclick="moveActo('${a.id}',-1)">▲</button>
          <button class="btn btn-outline btn-xs" ${isLast?'disabled':''} onclick="moveActo('${a.id}',1)">▼</button>
          <button class="btn btn-outline btn-sm" onclick="openActoModal('${a.id}')">${withIcon(UI_ICONS.edit, 'Editar')}</button>
          <button class="btn btn-danger btn-sm" onclick="deleteActo('${a.id}')">${withIcon(UI_ICONS.close, 'Borrar')}</button>
        </div>`;
      childWrap.appendChild(row);
    });

    sessionNode.appendChild(childWrap);
    list.appendChild(sessionNode);
  });
}

function openActoModal(id, preSessionId) {
  editingActoId = id || null;
  const a = id ? state.actos.find(x => x.id === id) : null;
  document.getElementById('modal-acto-title').textContent = id ? 'Editar Acto' : 'Nuevo Acto';
  // Populate session dropdown
  const sel = document.getElementById('af-session');
  sel.innerHTML = '<option value="">— Selecciona sesión —</option>';
  state.sessions.forEach(s => {
    const o = document.createElement('option');
    o.value = s.id; o.textContent = s.name;
    const selId = a ? a.sessionId : preSessionId;
    if (selId === s.id) o.selected = true;
    sel.appendChild(o);
  });
  document.getElementById('af-title').value = a ? a.title : '';
  document.getElementById('af-public').value = a ? (a.public || '') : '';
  document.getElementById('af-private').value = a ? (a.private || '') : '';
  // Imagen
  const _preview   = document.getElementById('af-img-preview');
  const _pholder   = document.getElementById('af-img-placeholder');
  const _clearBtn  = document.getElementById('af-img-clear');
  const _fileInput = document.getElementById('af-image');
  _editingActoImage = a?.image || null;
  if (_editingActoImage) {
    _preview.src = _editingActoImage; _preview.style.display = '';
    _pholder.style.display = 'none';  _clearBtn.style.display = '';
  } else {
    _preview.src = ''; _preview.style.display = 'none';
    _pholder.style.display = '';      _clearBtn.style.display = 'none';
  }
  _fileInput.value = '';
  _fileInput.onchange = handleActoImageSelect;
  document.getElementById('af-img-drop').onclick = (e) => {
    if (!e.target.closest('#af-img-clear')) _fileInput.click();
  };
  openModal('modal-acto');
}

function saveActo() {
  const sessionId = document.getElementById('af-session').value;
  const title = document.getElementById('af-title').value.trim();
  if (!sessionId || !title) return;
  const obj = {
    sessionId,
    title,
    public:  document.getElementById('af-public').value.trim(),
    private: document.getElementById('af-private').value.trim(),
    image:   _editingActoImage || null
  };
  if (editingActoId) {
    const idx = state.actos.findIndex(a => a.id === editingActoId);
    if (idx !== -1) {
      // Si se quitó la imagen, retirarla también del diario de cualquier sesión
      if (!obj.image) {
        state.sessions.forEach(s => {
          if (s.publishedImages) s.publishedImages = s.publishedImages.filter(i => i.actoId !== editingActoId);
        });
      }
      state.actos[idx] = { id: editingActoId, ...obj };
    }
  } else {
    const maxOrder = state.actos.filter(a => a.sessionId === obj.sessionId)
      .reduce((m, a) => Math.max(m, a.order ?? 0), -1);
    state.actos.push({ id: uid(), order: maxOrder + 1, ...obj });
  }
  saveState();
  closeModal('modal-acto');
  renderActoList();
  showToast('Acto guardado', 'success');
  if (_editSessionId) renderSessionEditView();
  document.querySelectorAll('.view[data-session-id]').forEach(view => {
    const s = state.sessions.find(x => x.id === view.dataset.sessionId);
    if (s) { renderSessionActos(s, view); renderSessionGallery(s, view); }
  });
}

function deleteActo(id) {
  showConfirm('¿Eliminar acto? Los eventos asociados perderán su referencia.', () => {
  const idx = state.actos.findIndex(a => a.id === id);
  if (idx === -1) return;
  // Retirar la imagen del acto del diario de cualquier sesión
  state.sessions.forEach(s => {
    if (s.publishedImages) s.publishedImages = s.publishedImages.filter(i => i.actoId !== id);
  });
  state.actos.splice(idx, 1);
  saveState();
  renderActoList();
  if (_editSessionId) renderSessionEditView();
  // Refrescar galerías de sesiones abiertas
  document.querySelectorAll('.view[data-session-id]').forEach(view => {
    const s = state.sessions.find(x => x.id === view.dataset.sessionId);
    if (s) renderSessionGallery(s, view);
  });
  showToast('Acto eliminado', 'info');
  }, 'Eliminar acto');
}

// Selecciona y comprime (máx 900 px, JPEG q0.75) una imagen local para un acto.
function handleActoImageSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 900;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
        else        { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const data = canvas.toDataURL('image/jpeg', 0.75);
      _editingActoImage = data;
      document.getElementById('af-img-preview').src           = data;
      document.getElementById('af-img-preview').style.display  = '';
      document.getElementById('af-img-placeholder').style.display = 'none';
      document.getElementById('af-img-clear').style.display    = '';
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// Limpia la imagen seleccionada en el modal de acto.
function clearActoImage() {
  _editingActoImage = null;
  document.getElementById('af-img-preview').src               = '';
  document.getElementById('af-img-preview').style.display      = 'none';
  document.getElementById('af-img-placeholder').style.display  = '';
  document.getElementById('af-img-clear').style.display        = 'none';
  document.getElementById('af-image').value = '';
}

// Publica la imagen de un acto en la galería del diario de la sesión.
// Si ya existía una entrada del mismo acto la reemplaza (sin duplicados).
function publishActoImage(session, acto, clone) {
  if (!acto.image) return;
  if (!session.publishedImages) session.publishedImages = [];
  session.publishedImages = session.publishedImages.filter(i => i.actoId !== acto.id);
  session.publishedImages.push({ id: uid(), actoId: acto.id, src: acto.image, caption: acto.title });
  saveState();
  renderSessionGallery(session, clone);
  showToast('Imagen publicada en el diario', 'success');
}

// Renderiza la galería de imágenes publicadas en el panel del diario.
// DM puede retirar entradas; todos los usuarios pueden ver y ampliar.
function renderSessionGallery(session, clone) {
  const wrap = clone.querySelector('.diary-gallery-wrap');
  const grid = clone.querySelector('.diary-gallery-grid');
  if (!wrap || !grid) return;
  const imgs = session.publishedImages || [];
  if (!imgs.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  grid.innerHTML = '';
  imgs.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'diary-gallery-item';
    const imgEl = document.createElement('img');
    imgEl.src = entry.src; imgEl.alt = entry.caption || '';
    imgEl.className = 'diary-gallery-img';
    imgEl.title = entry.caption || '';
    imgEl.addEventListener('click', () => openGalleryLightbox(entry.src, entry.caption));
    item.appendChild(imgEl);
    if (entry.caption) {
      const cap = document.createElement('div');
      cap.className = 'diary-gallery-caption';
      cap.textContent = entry.caption;
      item.appendChild(cap);
    }
    if (isDM()) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-danger btn-xs diary-gallery-remove';
      removeBtn.innerHTML = UI_ICONS.close; removeBtn.title = 'Retirar del diario';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        session.publishedImages = session.publishedImages.filter(i => i.id !== entry.id);
        saveState();
        renderSessionGallery(session, clone);
      });
      item.appendChild(removeBtn);
    }
    grid.appendChild(item);
  });
}

// Abre un lightbox de pantalla completa para ver la imagen ampliada.
function openGalleryLightbox(src, caption) {
  let overlay = document.getElementById('gallery-lightbox');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'gallery-lightbox';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;cursor:pointer;';
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <img src="${src}" style="max-width:90vw;max-height:80vh;border-radius:6px;object-fit:contain;" alt="${caption || ''}">
    ${caption ? `<div style="color:#fff;font-family:'Crimson Text',serif;font-size:1.05rem;opacity:.85">${caption}</div>` : ''}
    <div style="color:#aaa;font-size:.78rem;">Clic para cerrar</div>`;
  overlay.style.display = 'flex';
}

// ===========================
//  EVENTOS ALEATORIOS
//  Los eventos se anidan bajo Sesión > Acto en un árbol colapsable.
//  Durante la sesión, wireSessionEventos() permite sacar uno al azar
//  filtrado por categoría y el acto actualmente desplegado.
// ===========================
let editingEventoId = null;

const EVENTO_CAT_COLORS = { Tensión:'#c86e1e', Combate:'#a02020', Social:'#3ca050', Entorno:'#3a7ab8' };

function renderEventoList() {
  const list = document.getElementById('evento-list');
  if (!list) return;
  list.innerHTML = '';
  if (state.eventos.length === 0) {
    list.innerHTML = '<div class="empty-state">No hay eventos aleatorios definidos.</div>';
    return;
  }

  // Group by session
  const sessionIds = [...new Set(state.eventos.map(e => e.sessionId))];

  sessionIds.forEach(sid => {
    const session = state.sessions.find(s => s.id === sid);
    const sessionEventos = state.eventos.filter(e => e.sessionId === sid);

    const sessionNode = document.createElement('div');
    sessionNode.className = 'tree-session';
    const sessionHeader = document.createElement('div');
    sessionHeader.className = 'tree-session-header';
    sessionHeader.innerHTML = `<span class="tree-toggle">▾</span><span class="tree-session-name">${session ? session.name : sid}</span><span class="tree-count">${sessionEventos.length} evento${sessionEventos.length !== 1 ? 's' : ''}</span>`;
    const sessionChildren = document.createElement('div');
    sessionChildren.className = 'tree-children';
    sessionHeader.addEventListener('click', () => {
      const collapsed = sessionChildren.classList.toggle('collapsed');
      sessionHeader.querySelector('.tree-toggle').textContent = collapsed ? '▸' : '▾';
    });
    sessionNode.appendChild(sessionHeader);

    // Group by acto within session
    const actoIds = [...new Set(sessionEventos.map(e => e.actoId || '__none__'))];
    actoIds.forEach(aid => {
      const acto = aid !== '__none__' ? state.actos.find(a => a.id === aid) : null;
      const actoEventos = sessionEventos.filter(e => (e.actoId || '__none__') === aid);

      const actoNode = document.createElement('div');
      actoNode.className = 'tree-acto';
      const actoHeader = document.createElement('div');
      actoHeader.className = 'tree-acto-header';
      actoHeader.innerHTML = `<span class="tree-toggle">▾</span><span class="tree-acto-name">${acto ? acto.title : '— Sin acto —'}</span><span class="tree-count">${actoEventos.length}</span>`;
      const actoChildren = document.createElement('div');
      actoChildren.className = 'tree-children';
      actoHeader.addEventListener('click', () => {
        const collapsed = actoChildren.classList.toggle('collapsed');
        actoHeader.querySelector('.tree-toggle').textContent = collapsed ? '▸' : '▾';
      });
      actoNode.appendChild(actoHeader);

      actoEventos.forEach(e => {
        const color = EVENTO_CAT_COLORS[e.categoria] || 'var(--text-muted)';
        const row = document.createElement('div');
        row.className = 'tree-leaf entity-card';
        row.innerHTML = `
          <div class="entity-card-info">
            <span class="entity-name">${e.title}</span>
            <span class="evento-cat-badge" style="color:${color}">${e.categoria}</span>
          </div>
          <div class="entity-actions">
            <button class="btn btn-outline btn-sm" onclick="openEventoModal('${e.id}')">${withIcon(UI_ICONS.edit, 'Editar')}</button>
            <button class="btn btn-danger btn-sm" onclick="deleteEvento('${e.id}')">${withIcon(UI_ICONS.close, 'Borrar')}</button>
          </div>`;
        actoChildren.appendChild(row);
      });

      actoNode.appendChild(actoChildren);
      sessionChildren.appendChild(actoNode);
    });

    sessionNode.appendChild(sessionChildren);
    list.appendChild(sessionNode);
  });
}

function openEventoModal(id, preSessionId, preActoId) {
  editingEventoId = id || null;
  const e = id ? state.eventos.find(x => x.id === id) : null;
  document.getElementById('modal-evento-title').textContent = id ? 'Editar Evento' : 'Nuevo Evento Aleatorio';
  // Session dropdown
  const sSel = document.getElementById('ef2-session');
  sSel.innerHTML = '<option value="">— Selecciona sesión —</option>';
  state.sessions.forEach(s => {
    const o = document.createElement('option');
    o.value = s.id; o.textContent = s.name;
    const selId = e ? e.sessionId : preSessionId;
    if (selId === s.id) o.selected = true;
    sSel.appendChild(o);
  });
  // Populate acto dropdown
  const resolvedSessionId = e ? e.sessionId : preSessionId;
  const resolvedActoId    = e ? e.actoId    : preActoId;
  populateEventoActos(resolvedSessionId, resolvedActoId);
  document.getElementById('ef2-cat').value = e ? e.categoria : 'Tensión';
  document.getElementById('ef2-title').value = e ? e.title : '';
  document.getElementById('ef2-public').value = e ? (e.public || '') : '';
  document.getElementById('ef2-private').value = e ? (e.private || '') : '';
  openModal('modal-evento');
}

function onEventoSessionChange() {
  const sessionId = document.getElementById('ef2-session').value;
  populateEventoActos(sessionId, null);
}

function populateEventoActos(sessionId, selectedActoId) {
  const aSel = document.getElementById('ef2-acto');
  aSel.innerHTML = '<option value="">— Selecciona acto —</option>';
  if (!sessionId) { aSel.disabled = true; return; }
  const actos = state.actos.filter(a => a.sessionId === sessionId);
  actos.forEach(a => {
    const o = document.createElement('option');
    o.value = a.id; o.textContent = a.title;
    if (a.id === selectedActoId) o.selected = true;
    aSel.appendChild(o);
  });
  aSel.disabled = actos.length === 0;
}

function saveEvento() {
  const sessionId = document.getElementById('ef2-session').value;
  const actoId = document.getElementById('ef2-acto').value;
  const title = document.getElementById('ef2-title').value.trim();
  if (!sessionId || !title) return;
  const obj = {
    sessionId,
    actoId: actoId || null,
    categoria: document.getElementById('ef2-cat').value,
    title,
    public:  document.getElementById('ef2-public').value.trim(),
    private: document.getElementById('ef2-private').value.trim()
  };
  if (editingEventoId) {
    const idx = state.eventos.findIndex(e => e.id === editingEventoId);
    if (idx !== -1) state.eventos[idx] = { id: editingEventoId, ...obj };
  } else {
    state.eventos.push({ id: uid(), ...obj });
  }
  saveState();
  closeModal('modal-evento');
  renderEventoList();
  showToast('Evento guardado', 'success');
  if (_editSessionId) renderSessionEditView();
}

function deleteEvento(id) {
  showConfirm('¿Eliminar este evento?', () => {
  const idx = state.eventos.findIndex(e => e.id === id);
  if (idx === -1) return;
  state.eventos.splice(idx, 1);
  saveState();
  renderEventoList();
  if (_editSessionId) renderSessionEditView();
  showToast('Evento eliminado', 'info');
  }, 'Eliminar evento');
}
const SKILLS = [
  {key:'nadar',label:'Nadar / Bucear',attr:'DES'},{key:'cerraduras',label:'Abrir Cerraduras',attr:'INT'},
  {key:'idiomas',label:'Idiomas',attr:'INT'},{key:'sigilo',label:'Sigilo',attr:'DES'},
  {key:'medicina',label:'Medicina',attr:'INT'},{key:'brutalidad',label:'Brutalidad',attr:'FUE'},
  {key:'observacion',label:'Observación',attr:'INT'},{key:'intimidar',label:'Intimidar',attr:'CAR'},
  {key:'enganar',label:'Engañar',attr:'CAR'},{key:'persuasion',label:'Persuasión',attr:'CAR'},
  {key:'acrobacias',label:'Acrobacias',attr:'DES'},{key:'montar',label:'Montar',attr:'DES'},
  {key:'agarrar',label:'Agarrar',attr:'FUE'},{key:'reflejos',label:'Reflejos',attr:'DES'},
];
const WEAPON_SKILLS = [
  {key:'espadas',label:'Espadas'},{key:'dagas',label:'Dagas'},{key:'arcos',label:'Arcos'},
  {key:'mandobles',label:'Mandobles'},{key:'hachas',label:'Hachas'},
  {key:'contundentes',label:'Armas Contundentes'},{key:'arrojadizas',label:'Arrojadizas'},
  {key:'sin_armas',label:'Sin Armas (daño /2)'},
];

let editingCharId = null, editingEnemyId = null, editingUserId = null;
let currentArmorSel = '', currentEnemyArmorSel = '';
let charSkillState = {}, charWeaponSkillState = {}, charHabState = {};

function selectArmor(t) {
  currentArmorSel = currentArmorSel===t?'':t;
  ['L','M','P'].forEach(x => document.getElementById('armor-'+x).classList.toggle('sel', currentArmorSel===x));
}
function selectEnemyArmor(t) {
  currentEnemyArmorSel = currentEnemyArmorSel===t?'':t;
  ['L','M','P'].forEach(x => document.getElementById('ef-armor-'+x).classList.toggle('sel', currentEnemyArmorSel===x));
}
function addHab() {
  const list = document.getElementById('cf-habs-list');
  const habId = 'hab-' + uid();
  const row = document.createElement('div'); row.className = 'hab-row';
  row.innerHTML = `<div style="flex:1;display:flex;flex-direction:column;gap:6px">
    <input class="form-input" placeholder="Nombre">
    <textarea class="form-input note-area" placeholder="Descripción…" style="min-height:60px"></textarea>
  </div>
  <div class="skill-cost-btns" style="display:flex;flex-direction:column;gap:4px;min-width:80px">
    <button type="button" class="cost-btn" data-hab-id="${habId}" data-level="1">●○○</button>
    <button type="button" class="cost-btn" data-hab-id="${habId}" data-level="5">●●○</button>
    <button type="button" class="cost-btn" data-hab-id="${habId}" data-level="15">●●●</button>
  </div>
      <button class="remove-btn" onclick="this.parentElement.remove()">${UI_ICONS.close}</button>`;
  row.dataset.habId = habId;
  row.querySelectorAll('[data-level]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const level = parseInt(btn.dataset.level);
      charHabState[habId] = charHabState[habId] === level ? 0 : level;
      row.querySelectorAll('[data-level]').forEach(b => b.classList.remove('sel1','sel5','sel15'));
      if(charHabState[habId] === 1) row.querySelector('[data-level="1"]').classList.add('sel1');
      else if(charHabState[habId] === 5) row.querySelector('[data-level="5"]').classList.add('sel5');
      else if(charHabState[habId] === 15) row.querySelector('[data-level="15"]').classList.add('sel15');
    });
  });
  list.appendChild(row);
}
function renderSkillsGrid() {
  const sg = document.getElementById('cf-skills-grid'); sg.innerHTML='';
  SKILLS.forEach(sk => {
    const cur = charSkillState[sk.key]||0;
    const row = document.createElement('div'); row.className='skill-row';
    row.innerHTML=`<span class="skill-attr">${sk.attr}</span><label>${sk.label}</label>
      <div class="skill-cost-btns">
        <button type="button" class="cost-btn ${cur===1?'sel1':''}" onclick="setSkill('${sk.key}',1)">1</button>
        <button type="button" class="cost-btn ${cur===5?'sel5':''}" onclick="setSkill('${sk.key}',5)">5</button>
        <button type="button" class="cost-btn ${cur===15?'sel15':''}" onclick="setSkill('${sk.key}',15)">15</button>
      </div>`;
    sg.appendChild(row);
  });
  const wg = document.getElementById('cf-weapon-skills-grid'); wg.innerHTML='';
  WEAPON_SKILLS.forEach(sk => {
    const cur = charWeaponSkillState[sk.key]||0;
    const row = document.createElement('div'); row.className='skill-row';
    row.innerHTML=`<span class="skill-attr"></span><label>${sk.label}</label>
      <div class="skill-cost-btns">
        <button type="button" class="cost-btn ${cur===1?'sel1':''}" onclick="setWeaponSkill('${sk.key}',1)">1</button>
        <button type="button" class="cost-btn ${cur===5?'sel5':''}" onclick="setWeaponSkill('${sk.key}',5)">5</button>
        <button type="button" class="cost-btn ${cur===15?'sel15':''}" onclick="setWeaponSkill('${sk.key}',15)">15</button>
      </div>`;
    wg.appendChild(row);
  });
}
function setSkill(key,val) { charSkillState[key]=charSkillState[key]===val?0:val; renderSkillsGrid(); }
function setWeaponSkill(key,val) { charWeaponSkillState[key]=charWeaponSkillState[key]===val?0:val; renderSkillsGrid(); }

function openCharModal(id) {
  // Players can only edit their own character
  if (!isDM() && id && currentUser.charId !== id) return;
  editingCharId = id||null;
  charSkillState={}; charWeaponSkillState={}; charHabState={}; currentArmorSel='';
  document.getElementById('modal-char-title').textContent = id ? 'Editar Personaje' : 'Nuevo Personaje';
  const char = id ? state.chars.find(c=>c.id===id) : null;
  ['name','player','class','race','align','height','age','pv','pm','gold','skillpts','backpack','notes'].forEach(f=>{
    const el=document.getElementById('cf-'+f); if(el) el.value = char?(char[f]||''):'';
  });
  ['fue','int','car','des','vida'].forEach(a=>{
    const el=document.getElementById('cf-'+a); if(el){el.value=char?(char[a]||10):10;}
  });
  if(char){ charSkillState=Object.assign({},char.skills||{}); charWeaponSkillState=Object.assign({},char.weaponSkills||{}); currentArmorSel=char.armor||''; }
  ['L','M','P'].forEach(t=>document.getElementById('armor-'+t).classList.toggle('sel',currentArmorSel===t));
  const habsList=document.getElementById('cf-habs-list'); habsList.innerHTML='';
  if(char&&char.habs) char.habs.forEach(h=>{
    const habId = 'hab-' + uid();
    const row=document.createElement('div'); row.className='hab-row'; row.dataset.habId = habId;
    const level = h.level||0;
    charHabState[habId] = level;
    row.innerHTML=`<div style="flex:1;display:flex;flex-direction:column;gap:6px">
      <input class="form-input" value="${h.name||''}" placeholder="Nombre">
      <textarea class="form-input note-area" style="min-height:60px" placeholder="Descripción…">${h.desc||''}</textarea>
    </div>
    <div class="skill-cost-btns" style="display:flex;flex-direction:column;gap:4px;min-width:80px">
      <button type="button" class="cost-btn ${level===1?'sel1':''}" data-hab-id="${habId}" data-level="1">●○○</button>
      <button type="button" class="cost-btn ${level===5?'sel5':''}" data-hab-id="${habId}" data-level="5">●●○</button>
      <button type="button" class="cost-btn ${level===15?'sel15':''}" data-hab-id="${habId}" data-level="15">●●●</button>
    </div>
      <button class="remove-btn" onclick="this.parentElement.remove()">${UI_ICONS.close}</button>`;
    row.querySelectorAll('[data-level]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const lv = parseInt(btn.dataset.level);
        charHabState[habId] = charHabState[habId] === lv ? 0 : lv;
        row.querySelectorAll('[data-level]').forEach(b => b.classList.remove('sel1','sel5','sel15'));
        if(charHabState[habId] === 1) row.querySelector('[data-level="1"]').classList.add('sel1');
        else if(charHabState[habId] === 5) row.querySelector('[data-level="5"]').classList.add('sel5');
        else if(charHabState[habId] === 15) row.querySelector('[data-level="15"]').classList.add('sel15');
      });
    });
    habsList.appendChild(row);
  });
  renderSkillsGrid();
  openModal('modal-char');
}

function saveChar() {
  const name = document.getElementById('cf-name').value.trim();
  if(!name){alert('El personaje necesita un nombre.');return;}
  const habs = Array.from(document.querySelectorAll('#cf-habs-list .hab-row')).map(row=>{
    const habId = row.dataset.habId;
    return {name:row.querySelector('input').value,desc:row.querySelector('textarea').value,level:charHabState[habId]||0};
  });
  const char = {
    id:editingCharId||uid(), name,
    player:document.getElementById('cf-player').value, class:document.getElementById('cf-class').value,
    race:document.getElementById('cf-race').value, align:document.getElementById('cf-align').value,
    height:document.getElementById('cf-height').value, age:document.getElementById('cf-age').value,
    fue:parseInt(document.getElementById('cf-fue').value)||10, int:parseInt(document.getElementById('cf-int').value)||10,
    car:parseInt(document.getElementById('cf-car').value)||10, des:parseInt(document.getElementById('cf-des').value)||10,
    vida:parseInt(document.getElementById('cf-vida').value)||10,
    pm:parseInt(document.getElementById('cf-pm').value)||0,
    gold:parseInt(document.getElementById('cf-gold').value)||0, skillpts:parseInt(document.getElementById('cf-skillpts').value)||0,
    armor:currentArmorSel, skills:Object.assign({},charSkillState), weaponSkills:Object.assign({},charWeaponSkillState),
    habs, backpack:document.getElementById('cf-backpack').value, notes:document.getElementById('cf-notes').value,
  };
  if(editingCharId){const idx=state.chars.findIndex(c=>c.id===editingCharId);state.chars[idx]=char;}
  else state.chars.push(char);
  saveState();
  closeModal('modal-char');
  renderCharList();
  showToast('Personaje guardado', 'success');
  // If player updated their own char, refresh charsheet view
  if(!isDM()) { const myChar=state.chars.find(c=>c.id===currentUser.charId); if(myChar) renderCharSheetView(myChar); }
}

function renderCharList() {
  const list = document.getElementById('pj-list'); list.innerHTML='';
  if(!isDM()) {
    // Players don't see the general list
    list.style.display='none';
    return;
  }
  list.style.display='';
  state.chars.forEach(c=>{
    const card=document.createElement('div'); card.className='entity-card';
    card.innerHTML=`
      <div class="entity-card-info">
        <span class="entity-name">${c.name}</span>
        <span class="entity-meta">${c.class||''} · ${c.race||''} · Jugador: ${c.player||'—'}</span>
        <span class="entity-meta">PV ${c.vida} | PM ${c.pm} | FUE ${c.fue} INT ${c.int} CAR ${c.car} DES ${c.des}</span>
      </div>
      <div class="entity-actions">
        <button class="btn btn-outline btn-sm" onclick="openCharModal('${c.id}')">${withIcon(UI_ICONS.edit, 'Editar')}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteChar('${c.id}')">${withIcon(UI_ICONS.close, 'Borrar')}</button>
      </div>`;
    list.appendChild(card);
  });
  refreshCombatantSelects();
}

function renderPlayerCharPanel(char) {
  // Legacy — no longer used, kept for compat
}

// Renderiza la ficha de personaje de solo lectura en la vista de jugador.
// Si el personaje aún no ha cargado (chars vacío con charId asignado)
// muestra un mensaje de espera en vez del error de "sin personaje".
function renderCharSheetView(char) {
  const view = document.getElementById('charsheet-content');
  if (!view) return;
  if (!char) {
    // Diagnostic: if user has a charId but char wasn't found, show helpful message
    const hasId = currentUser && currentUser.charId;
    const charsLoaded = state.chars.length;
    view.innerHTML = hasId && charsLoaded === 0
      ? `<div style="font-family:'Cinzel',serif;color:var(--ink-faded);padding:30px;text-align:center;font-size:.85rem;letter-spacing:2px;line-height:2">
           Cargando personaje…<br><span style="font-size:.7rem;opacity:.6">Si este mensaje persiste, recarga la página</span>
         </div>`
      : `<div style="font-family:'Cinzel',serif;color:var(--ink-faded);padding:30px;text-align:center;font-size:.85rem;letter-spacing:2px;">Sin personaje asignado</div>`;
    return;
  }
  const skillNames = {nadar:'Nadar/Bucear',cerraduras:'Abrir Cerraduras',idiomas:'Idiomas',sigilo:'Sigilo',medicina:'Medicina',brutalidad:'Brutalidad',observacion:'Observación',intimidar:'Intimidar',enganar:'Engañar',persuasion:'Persuasión',acrobacias:'Acrobacias',montar:'Montar',agarrar:'Agarrar',reflejos:'Reflejos'};
  const weaponNames = {espadas:'Espadas',dagas:'Dagas',arcos:'Arcos',mandobles:'Mandobles',hachas:'Hachas',contundentes:'Contundentes',arrojadizas:'Arrojadizas',sin_armas:'Sin armas'};
  const costLabel = v => v===15?'●●●':v===5?'●●○':v===1?'●○○':'○○○';

  const skillsHtml = Object.entries(skillNames).map(([k,l]) => {
    const v = char.skills?.[k]||0;
    return `<div class="skill-row"><span class="skill-attr"></span><label>${l}</label><span style="letter-spacing:2px;color:var(--gold);font-size:.75rem">${costLabel(v)}</span></div>`;
  }).join('');
  const weaponsHtml = Object.entries(weaponNames).map(([k,l]) => {
    const v = char.weaponSkills?.[k]||0;
    return `<div class="skill-row"><label>${l}</label><span style="letter-spacing:2px;color:var(--gold);font-size:.75rem">${costLabel(v)}</span></div>`;
  }).join('');
  const habsHtml = (char.habs||[]).map(h => {
    const desc = (h.desc||'').replace(/\n/g, '<br>');
    const level = h.level||0;
    const costLabel = lv => lv===15?'●●●':lv===5?'●●○':lv===1?'●○○':'○○○';
    return `<div style="margin-bottom:8px;display:flex;gap:12px;align-items:flex-start"><div style="flex:1"><strong style="font-family:'Cinzel',serif;font-size:.75rem;color:var(--gold)">${h.name}</strong><p style="font-size:.9rem;color:var(--ink-faded);margin-top:3px">${desc}</p></div><span style="letter-spacing:2px;color:var(--gold);font-size:.75rem;white-space:nowrap">${costLabel(level)}</span></div>`;
  }).join('');

  view.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <h2 style="font-family:'Cinzel Decorative',serif;color:var(--gold);font-size:1.1rem">${char.name}</h2>
        <button class="btn btn-gold btn-sm" onclick="openCharModal('${char.id}')">${withIcon(UI_ICONS.edit, 'Editar')}</button>
    </div>
    <div class="charsheet-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="panel">
        <div class="panel-header">Identidad</div>
        <div class="panel-body" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:.9rem">
          <div><span style="color:var(--ink-faded);font-size:.65rem;font-family:'Cinzel',serif;letter-spacing:1px;text-transform:uppercase">Clase</span><div>${char.class||'—'}</div></div>
          <div><span style="color:var(--ink-faded);font-size:.65rem;font-family:'Cinzel',serif;letter-spacing:1px;text-transform:uppercase">Raza</span><div>${char.race||'—'}</div></div>
          <div><span style="color:var(--ink-faded);font-size:.65rem;font-family:'Cinzel',serif;letter-spacing:1px;text-transform:uppercase">Alineamiento</span><div>${char.align||'—'}</div></div>
          <div><span style="color:var(--ink-faded);font-size:.65rem;font-family:'Cinzel',serif;letter-spacing:1px;text-transform:uppercase">Jugador</span><div>${char.player||'—'}</div></div>
          <div><span style="color:var(--ink-faded);font-size:.65rem;font-family:'Cinzel',serif;letter-spacing:1px;text-transform:uppercase">Altura</span><div>${char.height||'—'}</div></div>
          <div><span style="color:var(--ink-faded);font-size:.65rem;font-family:'Cinzel',serif;letter-spacing:1px;text-transform:uppercase">Edad</span><div>${char.age||'—'}</div></div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-header">Atributos y Recursos</div>
        <div class="panel-body">
          <div class="charsheet-attrs" style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px">
            ${['fue','int','car','des','vida'].map(a => {const v=char[a]||10;return `<div class="attr-box"><label>${a.toUpperCase()}</label><div style="font-family:'Cinzel',serif;font-size:1.1rem;font-weight:700;color:var(--ink)">${v}</div></div>`}).join('')}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:.9rem">
            <div><span style="color:var(--ink-faded);font-size:.65rem;font-family:'Cinzel',serif;letter-spacing:1px;text-transform:uppercase">PM</span><div style="font-family:'Cinzel',serif;font-size:1rem;color:#4a7a9b">${char.pm||0}</div></div>
            <div><span style="color:var(--ink-faded);font-size:.65rem;font-family:'Cinzel',serif;letter-spacing:1px;text-transform:uppercase">Armadura</span><div>${char.armor||'—'}</div></div>
            <div><span style="color:var(--ink-faded);font-size:.65rem;font-family:'Cinzel',serif;letter-spacing:1px;text-transform:uppercase">Oro</span><div>${char.gold||0}</div></div>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-header">Habilidades</div>
        <div class="panel-body"><div class="skills-grid">${skillsHtml}</div></div>
      </div>
      <div class="panel">
        <div class="panel-header">Armamentísticas</div>
        <div class="panel-body"><div class="skills-grid">${weaponsHtml}</div></div>
      </div>
      ${habsHtml ? `<div class="panel cs-span2" style="grid-column:span 2"><div class="panel-header">Habilidades Especiales</div><div class="panel-body">${habsHtml}</div></div>` : ''}
      ${char.backpack ? `<div class="panel"><div class="panel-header">Mochila</div><div class="panel-body" style="font-size:.95rem;white-space:pre-wrap">${char.backpack}</div></div>` : ''}
      ${char.notes ? `<div class="panel"><div class="panel-header">Notas</div><div class="panel-body" style="font-size:.95rem;white-space:pre-wrap">${char.notes}</div></div>` : ''}
    </div>`;
}

function deleteChar(id) {
  showConfirm('¿Eliminar este personaje?', () => {
  // Disassociate any user linked to it
  globalUsers.forEach(u=>{ if(u.charId===id) u.charId=null; });
  saveGlobalUsers();
  state.chars = state.chars.filter(c=>c.id!==id);
  saveState(); renderCharList(); renderUserList();
  showToast('Personaje eliminado', 'info');
  }, 'Eliminar personaje');
}

function refreshCombatantSelects() {
  document.querySelectorAll('.add-combatant-form').forEach(form=>{
    const sv=form.closest('.view'); if(!sv) return;
    const sid=sv.dataset.sessionId; if(!sid) return;
    const session=getSession(sid); if(session) renderCombatantChips(sv, session);
  });
}

// ===========================
//  ENEMY FORM
// ===========================
function openEnemyModal(id) {
  if(!isDM()) return;
  editingEnemyId=id||null; currentEnemyArmorSel='';
  document.getElementById('modal-enemy-title').textContent=id?'Editar Enemigo':'Nuevo Tipo de Enemigo';
  const e=id?state.enemies.find(x=>x.id===id):null;
  ['name','attacks','notes'].forEach(f=>{const el=document.getElementById('ef-'+f);if(el)el.value=e?(e[f]||''):''});
  ['pv','fue','int','car','des'].forEach(f=>{const el=document.getElementById('ef-'+f);if(el)el.value=e?(e[f]||10):10});
  currentEnemyArmorSel=e?(e.armor||''):'';
  ['L','M','P'].forEach(t=>document.getElementById('ef-armor-'+t).classList.toggle('sel',currentEnemyArmorSel===t));
  openModal('modal-enemy');
}
function saveEnemy() {
  const name=document.getElementById('ef-name').value.trim();
  if(!name){alert('El enemigo necesita un nombre.');return;}
  const enemy={
    id:editingEnemyId||uid(), name,
    pv:parseInt(document.getElementById('ef-pv').value)||10,
    fue:parseInt(document.getElementById('ef-fue').value)||10,
    int:parseInt(document.getElementById('ef-int').value)||10,
    car:parseInt(document.getElementById('ef-car').value)||10,
    des:parseInt(document.getElementById('ef-des').value)||10,
    armor:currentEnemyArmorSel,
    attacks:document.getElementById('ef-attacks').value,
    notes:document.getElementById('ef-notes').value,
  };
  if(editingEnemyId){const idx=state.enemies.findIndex(e=>e.id===editingEnemyId);state.enemies[idx]=enemy;}
  else state.enemies.push(enemy);
  saveState(); closeModal('modal-enemy'); renderEnemyList();
  showToast('Enemigo guardado', 'success');
}
function renderEnemyList() {
  const list=document.getElementById('enemy-list'); list.innerHTML='';
  state.enemies.forEach(e=>{
    const card=document.createElement('div'); card.className='entity-card';
    const actions=isDM()?`<button class="btn btn-outline btn-sm" onclick="openEnemyModal('${e.id}')">${withIcon(UI_ICONS.edit, 'Editar')}</button><button class="btn btn-outline btn-sm" onclick="cloneEnemy('${e.id}')" title="Clonar">${withIcon(UI_ICONS.copy, 'Clonar')}</button><button class="btn btn-danger btn-sm" onclick="deleteEnemy('${e.id}')">${withIcon(UI_ICONS.close, 'Borrar')}</button>`:'';
    card.innerHTML=`
      <div class="entity-card-info">
        <span class="entity-name">${e.name}</span>
        <span class="entity-meta">PV ${e.pv} | Armadura ${e.armor||'—'} | FUE ${e.fue} INT ${e.int} CAR ${e.car} DES ${e.des}</span>
      </div>
      <div class="entity-actions">${actions}</div>`;
    list.appendChild(card);
  });
  refreshCombatantSelects();
}
function deleteEnemy(id) {
  showConfirm('¿Eliminar este tipo de enemigo?', () => {
  state.enemies=state.enemies.filter(e=>e.id!==id);
  saveState(); renderEnemyList();
  showToast('Enemigo eliminado', 'info');
  }, 'Eliminar enemigo');
}

function cloneEnemy(id) {
  const src = state.enemies.find(e => e.id === id);
  if (!src) return;
  const clone = Object.assign({}, src, { id: uid(), name: src.name + ' (copia)' });
  state.enemies.push(clone);
  saveState();
  renderEnemyList();
  showToast('Enemigo clonado', 'success');
  // Open editor so user can rename immediately
  openEnemyModal(clone.id);
}

// ===========================
//  USER MANAGEMENT
// ===========================
function openUserModal(id) {
  editingUserId = id||null;
  document.getElementById('modal-user-title').textContent = id?'Editar Usuario':'Nuevo Usuario';
  document.getElementById('modal-user-error').textContent='';
  const u = id ? globalUsers.find(x=>x.id===id) : null;
  document.getElementById('uf-username').value = u?u.username:'';
  document.getElementById('uf-password').value = '';
  document.getElementById('uf-isdm').checked = u?u.isDM:false;
  // Populate char select
  const charSel = document.getElementById('uf-char');
  charSel.innerHTML = '<option value="">— Sin personaje —</option>';
  state.chars.forEach(c=>{ const o=document.createElement('option'); o.value=c.id; o.textContent=c.name; charSel.appendChild(o); });
  charSel.value = u?u.charId||'':'';
  // Toggle char select visibility based on isDM checkbox
  const isDMcb = document.getElementById('uf-isdm');
  const charWrap = document.getElementById('uf-char-wrap');
  charWrap.style.display = isDMcb.checked ? 'none' : '';
  isDMcb.onchange = () => { charWrap.style.display = isDMcb.checked ? 'none' : ''; };
  openModal('modal-user');
}
function saveUser() {
  const username = document.getElementById('uf-username').value.trim();
  const password = document.getElementById('uf-password').value;
  const isNewUser = !editingUserId;
  const errEl = document.getElementById('modal-user-error');
  if (!username) { errEl.textContent='El nombre de usuario no puede estar vacío.'; return; }
  // Check duplicate username
  const existing = globalUsers.find(u=>u.username===username && u.id!==editingUserId);
  if (existing) { errEl.textContent='Ese nombre de usuario ya existe.'; return; }
  if (isNewUser && !password) { errEl.textContent='La contraseña es obligatoria para nuevos usuarios.'; return; }
  const isDMchecked = document.getElementById('uf-isdm').checked;
  const charId = isDMchecked ? null : (document.getElementById('uf-char').value || null);
  if (editingUserId) {
    const u = globalUsers.find(x=>x.id===editingUserId);
    u.username = username;
    if (password) u.passwordHash = hashPassword(password);
    u.isDM = isDMchecked;
    u.charId = charId;
    // Update currentUser if editing self
    if (currentUser && currentUser.id === editingUserId) { Object.assign(currentUser, u); applyRoleUI(); }
  } else {
    globalUsers.push({ id:uid(), username, passwordHash:hashPassword(password), isDM:isDMchecked, charId });
  }
  saveGlobalUsers(); closeModal('modal-user'); renderUserList(); renderMaintLanding();
  showToast('Usuario guardado', 'success');
}
function renderUserList() {
  const list = document.getElementById('user-list'); list.innerHTML='';
  globalUsers.forEach(u=>{
    const linkedChar = u.charId ? state.chars.find(c=>c.id===u.charId) : null;
    const card=document.createElement('div'); card.className='entity-card';
    card.innerHTML=`
      <div class="entity-card-info">
        <span class="entity-name">${u.username}</span>
        <span class="entity-meta">${u.isDM?`${UI_ICONS.sword} Director de Juego`:'Jugador'}${linkedChar?' · '+linkedChar.name:''}</span>
      </div>
      <div class="entity-actions">
        <button class="btn btn-outline btn-sm" onclick="openUserModal('${u.id}')">${withIcon(UI_ICONS.edit, 'Editar')}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteUser('${u.id}')">${withIcon(UI_ICONS.close, 'Borrar')}</button>
      </div>`;
    list.appendChild(card);
  });
}
function deleteUser(id) {
  const u = globalUsers.find(x=>x.id===id);
  if (!u) return;
  if (u.id === currentUser?.id) { showToast('No puedes eliminar tu propia cuenta.', 'error'); return; }
  if (u.isDM && globalUsers.filter(x=>x.isDM).length <= 1) { showToast('Debe existir al menos un Director de Juego.', 'error'); return; }
  showConfirm(`¿Eliminar usuario "${u.username}"?`, () => {
  globalUsers = globalUsers.filter(x=>x.id!==id);
  saveGlobalUsers(); renderUserList(); renderMaintLanding();
  showToast('Usuario eliminado', 'info');
  }, 'Eliminar usuario');
}

// ===========================
//  CAMPAIGNS MANAGEMENT
// ===========================
function renderCampaignList() {
  const list = document.getElementById('campaign-list');
  if (!list) return;
  list.innerHTML = '';

  if (!campaigns.length) {
    list.innerHTML = '<div class="empty-state">No hay campañas registradas.</div>';
    return;
  }

  campaigns.forEach(c => {
    const card = document.createElement('div');
    card.className = 'entity-card';
    const isCurrent = c.id === currentCampaignId;
    const status = c.archived ? 'Archivada' : 'Activa';

    // DM can open any campaign (active or archived); non-DM only sees active ones
    const canOpen = isDM() || !c.archived;
    const switchBtn = canOpen
      ? `<button class="btn btn-outline btn-sm" onclick="switchToCampaign('${c.id}')">${isCurrent ? 'Actual' : 'Abrir'}</button>`
      : '';
    const archiveBtn = `<button class="btn btn-outline btn-sm" onclick="toggleCampaignArchived('${c.id}')">${c.archived ? 'Reactivar' : 'Archivar'}</button>`;

    card.innerHTML = `
      <div class="entity-card-info">
        <span class="entity-name">${c.name}${isCurrent ? ' · Actual' : ''}${c.archived ? ' <span style="font-size:.6rem;color:var(--text-muted);letter-spacing:1px">[ARCHIVADA]</span>' : ''}</span>
        <span class="entity-meta">ID: ${c.id} · ${status}</span>
      </div>
      <div class="entity-actions">
        ${isCurrent ? '' : switchBtn}
        ${archiveBtn}
      </div>`;
    list.appendChild(card);
  });
}

function openCampaignModal() {
  document.getElementById('camp-name').value = '';
  document.getElementById('camp-clone-current').checked = false;
  document.getElementById('modal-campaign-error').textContent = '';
  openModal('modal-campaign');
}

async function saveCampaign() {
  const name = document.getElementById('camp-name').value.trim();
  const cloneCurrent = document.getElementById('camp-clone-current').checked;
  const err = document.getElementById('modal-campaign-error');
  if (!name) { err.textContent = 'El nombre es obligatorio.'; return; }

  const id = getUniqueCampaignId(name);
  const nextState = cloneCurrent ? JSON.parse(JSON.stringify(state)) : emptyState();
  nextState.users = [];

  await setDoc(doc(db, 'campaigns', id), nextState);
  campaigns.push({ id, name, archived: false });
  await saveCampaignCatalog();

  renderCampaignSelect();
  renderCampaignList();
  renderMaintLanding();
  closeModal('modal-campaign');
  showToast('Campaña creada', 'success');
}

async function toggleCampaignArchived(campaignId) {
  const c = campaigns.find(x => x.id === campaignId);
  if (!c) return;
  const wasArchived = c.archived;
  c.archived = !c.archived;
  await saveCampaignCatalog();
  renderCampaignSelect();
  renderCampaignList();
  renderMaintLanding();
  showToast(wasArchived ? `"${c.name}" reactivada` : `"${c.name}" archivada`, 'info');
}

async function switchToCampaign(campaignId) {
  if (!campaigns.some(c => c.id === campaignId)) return;
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  sessionStorage.setItem('ljhd_campaign', campaignId);
  sessionStorage.removeItem('ljhd_user');
  currentUser = null;
  state = emptyState();
  document.querySelectorAll('#main-content .view[data-session-id]').forEach(v => v.remove());
  await loadState(campaignId);
  renderCampaignSelect();
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  document.getElementById('login-error').textContent = '';
  document.getElementById('login-screen').classList.remove('hidden');
  showToast('Selecciona un usuario para entrar en la campaña', 'info');
}

// ===========================
//  MODALS
// ===========================
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
// Expose to global scope for onclick handlers in HTML
window.openModal = openModal;
window.closeModal = closeModal;
document.querySelectorAll('.modal-overlay').forEach(overlay=>{
  overlay.addEventListener('click', e=>{ if(e.target===overlay) overlay.classList.remove('open'); });
});
// Enter key in login
document.getElementById('login-pass').addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
document.getElementById('login-user').addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('login-pass').focus(); });
// Escape key closes any open modal
document.addEventListener('keydown', e=>{
  if(e.key==='Escape'){
    const open = document.querySelector('.modal-overlay.open');
    if(open) open.classList.remove('open');
    hideEnemyTooltip();
  }
});
// Click outside enemy tooltip hides it
document.addEventListener('click', e=>{
  const tip = document.getElementById('enemy-stat-tooltip');
  if(tip && tip.classList.contains('visible') && !tip.contains(e.target) && !e.target.classList.contains('enemy-info-btn')){
    hideEnemyTooltip();
  }
});

// ===========================
//  EXPORT / IMPORT
//  exportData(): vuelca todo el estado a un JSON descargable.
//  importData(): restaura el estado desde un JSON exportado previamente;
//    fusiona los usuarios del backup con los usuarios globales actuales
//    antes de sobreescribir el estado en Firestore.
// ===========================
function exportData() {
  state.sessions.forEach(session=>{
    const view=document.getElementById('view-'+session.id); if(!view) return;
    view.querySelectorAll('[data-field]').forEach(el=>{
      if(!el.hasAttribute('readonly')) session[el.dataset.field]=el.value;
    });
  });
  const payload = {
    campaignId: currentCampaignId,
    campaignName: getCurrentCampaignName(),
    exportedAt: new Date().toISOString(),
    data: state
  };
  const json=JSON.stringify(payload,null,2);
  const blob=new Blob([json],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const safeName = slugifyCampaignName(getBrandName()) || 'campaña';
  const a=document.createElement('a'); a.href=url; a.download=`${safeName}.json`; a.click();
  URL.revokeObjectURL(url);
  showToast('Copia exportada', 'success');
}
function importData(event) {
  const file=event.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=async e=>{
    try {
      const imported=JSON.parse(e.target.result);
      const importedData = imported.data ? imported.data : imported;

      // If backup includes legacy users, merge them into global users.
      if (Array.isArray(importedData.users) && importedData.users.length) {
        globalUsers = sanitizeUsers([...(globalUsers || []), ...importedData.users]);
        await saveGlobalUsers();
      }

      state.sessions=importedData.sessions||[];
      state.chars=importedData.chars||[];
      state.enemies=importedData.enemies||[];
      state.estados=importedData.estados||[];
      state.actos=importedData.actos||[];
      state.eventos=importedData.eventos||[];
      state.playerNotes=importedData.playerNotes||{};
      _ignoreNext = true;
      await setDoc(getCurrentStateDoc(), JSON.parse(JSON.stringify(state)));
      rebuildSessionTabs();
      renderCharList(); renderEnemyList(); renderUserList(); renderCampaignList();
      switchView('maint');
      showToast('Datos importados correctamente', 'success');
    } catch(err) { alert('Error al importar: ' + err.message); }
  };
  reader.readAsText(file);
  event.target.value='';
}

// ===========================
//  LOADING OVERLAY
//  Overlay de pantalla completa (z-index:3000) creado dinámicamente la primera
//  vez que se llama, reutilizado en llamadas posteriores.
//  Visible al cargar la campaña (loadState) para evitar parpadeos de UI.
// ===========================
function showLoadingOverlay(show) {
  let el = document.getElementById('loading-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'loading-overlay';
    el.style.cssText = 'position:fixed;inset:0;z-index:3000;background:radial-gradient(ellipse at center,#293548,#1a2232);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;';
    el.innerHTML = `
      <div id="brand-loading" style="font-family:'Cinzel Decorative',serif;color:#D9BD89;font-size:2rem;text-shadow:0 0 20px rgba(217,189,137,.5);">Campaña</div>
      <div style="font-family:'Cinzel',serif;color:#A6977B;font-size:.65rem;letter-spacing:4px;text-transform:uppercase;">Conectando con la taberna…</div>
      <div style="width:48px;height:48px;border:3px solid #293548;border-top-color:#D9BD89;border-radius:50%;animation:spin .8s linear infinite;"></div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
    document.body.appendChild(el);
  }
  applyCampaignBranding();
  el.style.display = show ? 'flex' : 'none';
}

// ===========================
//  SPECTATOR
//  Modo de solo lectura para compartir en pantalla.
//  openSpectatorWindow() abre esta misma URL con parámetros
//  ?spectator=ID&campaign=ID en una pestaña nueva.
// ===========================
function renderSpectatorView(sessionId) {
  const container = document.getElementById('spectator-view');
  if (!container) return;
  const session = state.sessions.find(s => s.id === sessionId);
  container.querySelector('.spectator-session-name').textContent =
    session ? (session.name || 'Iniciativa') : 'Sesión no encontrada';
  container.querySelector('.spectator-round-num').textContent =
    session ? (session.round || 1) : '—';
  if (session) renderCombatantList(session, container);
}

function openSpectatorWindow(sessionId) {
  const params = new URLSearchParams({ spectator: sessionId, campaign: currentCampaignId || '' });
  const url = window.location.pathname + '?' + params.toString();
  window.open(url, '_blank', 'noopener,noreferrer');
}

// ===========================
//  ARRANQUE (IIFE)
//  Secuencia de inicialización al cargar la página:
//  1. Detectar modo espectador (?spectator=ID): si es cierto, mostrar
//     la vista de iniciativa en tiempo real sin login y salir.
//  2. Cargar catálogo de campañas y usuarios globales (con migración
//     automática desde el modelo legado si es necesario).
//  3. Rellenar el selector de campañas en el login.
//  4. Restaurar la sesión previa guardada en sessionStorage
//     (campdëa y usuario) para no forzar login tras un refresco.
// ===========================
// Carga el catalogo SVG y luego reemplaza los placeholders estaticos del HTML.
await loadIcons();
paintStaticIcons();

(async () => {
  // Spectator mode: show initiative-only view without login
  const qs = new URLSearchParams(window.location.search);
  const spectatorId = qs.get('spectator');
  const spectatorCampaign = qs.get('campaign');
  if (spectatorId) {
    if (!spectatorCampaign) {
      alert('Falta parametro de campaña en modo espectador.');
      return;
    }
    document.body.classList.add('spectator-mode');
    const sv = document.getElementById('spectator-view');
    sv.style.display = 'flex';
    await ensureCampaignCatalog();
    await loadState(spectatorCampaign);
    renderSpectatorView(spectatorId);
    onSnapshot(getCurrentStateDoc(), snap => {
      if (!snap.exists()) return;
      state = normalizeState(snap.data());
      renderSpectatorView(spectatorId);
    }, err => console.error('Spectator sync error:', err));
    return;
  }

  await ensureCampaignCatalog();
  await ensureGlobalUsers();
  await migrateLegacyUsersToGlobal();
  renderCampaignSelect();
  applyDeskSubtitle();

  const campaignSelect = document.getElementById('login-campaign');
  if (campaignSelect) {
    campaignSelect.addEventListener('change', async () => {
      const selected = campaignSelect.value;
      if (!selected) return;
      sessionStorage.setItem('ljhd_campaign', selected);
      await loadState(selected);
      document.getElementById('login-error').textContent = '';
    });
    if (campaignSelect.value) await loadState(campaignSelect.value);
  }

  // Restore session after page refresh
  const savedCampaign = sessionStorage.getItem('ljhd_campaign');
  const savedId = sessionStorage.getItem('ljhd_user');
  if (savedCampaign && campaigns.some(c => c.id === savedCampaign && !c.archived)) {
    await loadState(savedCampaign);
    if (campaignSelect) campaignSelect.value = savedCampaign;
  }
  if (savedCampaign && savedId) {
    const user = globalUsers.find(u => u.id === savedId);
    if (user) {
      currentUser = user;
      applyRoleUI();
      rebuildSessionTabs();
      renderCharList();
      renderEnemyList();
      renderUserList();
      renderCampaignList();
      
      // Show landing page
      switchView('landing');
      
      document.getElementById('login-screen').classList.add('hidden');
      startRealtimeSync(); // start AFTER view is rendered
      startUsersRealtimeSync();
    }
  }
  renderCampaignList();
})();

// Búsqueda en tiempo real en las listas de mantenimiento.
// Oculta las tarjetas (.entity-card) cuyo texto no incluya la consulta.
function filterList(query, listId) {
  const list = document.getElementById(listId);
  if (!list) return;
  const q = query.trim().toLowerCase();
  list.querySelectorAll('.entity-card').forEach(card => {
    card.style.display = (!q || card.textContent.toLowerCase().includes(q)) ? '' : 'none';
  });
}

// Diálogo de confirmación genérico para acciones destructivas.
// Clonar el botón "ok" elimina los event listeners previos para evitar
// que callbacks de otra acción anterior se ejecuten por acumulación.
function showConfirm(msg, onOk, title = 'Confirmar acción') {
  document.getElementById('modal-confirm-title').textContent = title;
  document.getElementById('modal-confirm-msg').textContent = msg;
  const okBtn = document.getElementById('modal-confirm-ok');
  const newBtn = okBtn.cloneNode(true); // remove old listeners
  okBtn.parentNode.replaceChild(newBtn, okBtn);
  newBtn.onclick = () => { closeModal('modal-confirm'); onOk(); };
  openModal('modal-confirm');
}

// ===========================
//  TOAST NOTIFICATIONS
//  Notificaciones efímeras en la esquina inferior derecha.
//  Tipos: 'success' (verde), 'error' (rojo), 'info' (dorado).
//  Auto-eliminadas a los 2.65s (animación CSS de 2.3s + margen).
// ===========================
function showToast(msg, type = 'success') {
  const container = document.getElementById('toast');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast-msg ' + type;
  el.textContent = msg;
  container.appendChild(el);
  // Auto-remove after animation (2.3s fade-out + 0.3s = 2.6s)
  setTimeout(() => el.remove(), 2650);
}

// ===========================
//  EXPOSE GLOBALS
//  Los módulos ES (type="module") tienen su propio scope; los handlers
//  onclick del HTML no pueden llamar funciones del módulo directamente.
//  Exponerlas en `window` (alias `_g`) las hace accesibles globalmente.
// ===========================
const _g = window;
_g.doLogin               = doLogin;
_g.doLogout              = doLogout;
_g.renderSessionActos    = renderSessionActos;
_g.switchView            = switchView;
_g.switchMaintTab        = switchMaintTab;
_g.switchMaintSection    = switchMaintSection;
_g.openNewSessionModal   = openNewSessionModal;
_g.createSession         = createSession;
_g.deleteSession         = deleteSession;
_g.openCharModal         = openCharModal;
_g.saveChar              = saveChar;
_g.deleteChar            = deleteChar;
_g.openEnemyModal        = openEnemyModal;
_g.saveEnemy             = saveEnemy;
_g.deleteEnemy           = deleteEnemy;
_g.cloneEnemy            = cloneEnemy;
_g.hideEnemyTooltip      = hideEnemyTooltip;
_g.openUserModal         = openUserModal;
_g.saveUser              = saveUser;
_g.deleteUser            = deleteUser;
_g.exportData            = exportData;
_g.importData            = importData;
_g.selectArmor           = selectArmor;
_g.selectEnemyArmor      = selectEnemyArmor;
_g.addHab                = addHab;
_g.setSkill              = setSkill;
_g.setWeaponSkill        = setWeaponSkill;
_g.applyHP               = applyHP;
_g.setTempHP             = setTempHP;
_g.setCondInput          = setCondInput;
_g.addConditionConfirm   = addConditionConfirm;
_g.closeModal            = closeModal;
_g.openModal             = openModal;
_g.renderCharSheetView   = renderCharSheetView;
_g.togglePlayerPreview   = togglePlayerPreview;
_g.renderLandingPage     = renderLandingPage;
_g.renderActiveSessions  = renderActiveSessions;
_g.addEstado             = addEstado;
_g.deleteEstado          = deleteEstado;
_g.renderEstadoList      = renderEstadoList;
_g.openActoModal         = openActoModal;
_g.saveActo              = saveActo;
_g.deleteActo            = deleteActo;
_g.clearActoImage        = clearActoImage;
_g.openEventoModal       = openEventoModal;
_g.saveEvento            = saveEvento;
_g.deleteEvento          = deleteEvento;
_g.onEventoSessionChange = onEventoSessionChange;
_g.openSpectatorWindow   = openSpectatorWindow;
_g.openPrepareCombatsModal   = openPrepareCombatsModal;
_g.savePrepareCombats        = savePrepareCombats;
_g.toggleSessionPublished    = toggleSessionPublished;
_g.openSessionEdit           = openSessionEdit;
_g.renderSessionEditView     = renderSessionEditView;
_g.toggleEditEnemy           = toggleEditEnemy;
_g.moveActo                  = moveActo;
_g.openCampaignModal         = openCampaignModal;
_g.saveCampaign              = saveCampaign;
_g.toggleCampaignArchived    = toggleCampaignArchived;
_g.switchToCampaign          = switchToCampaign;
_g.showToast                 = showToast;
_g.showConfirm               = showConfirm;
_g.filterList                = filterList;
