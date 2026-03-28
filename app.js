// ===========================
//  FIREBASE
// ===========================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.8.1/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot }
  from "https://www.gstatic.com/firebasejs/11.8.1/firebase-firestore.js";

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
const STATE_DOC = doc(db, 'campaign', 'state');

// ===========================
//  STATE
// ===========================
let state = { sessions:[], chars:[], enemies:[], users:[], estados:[], actos:[], eventos:[], playerNotes:{} };
let currentUser  = null;
let _saveTimeout = null;
let _unsubscribe = null;
let _ignoreNext  = false;
let _playerPreview = false; // DM preview mode as player

// ===========================
//  PERSIST (Firestore)
// ===========================
function saveState() {
  clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(async () => {
    try {
      _ignoreNext = true;
      await setDoc(STATE_DOC, JSON.parse(JSON.stringify(state)));
    } catch(e) { console.error('Firestore write:', e); }
  }, 1500);
}

async function loadState() {
  showLoadingOverlay(true);
  try {
    const snap = await getDoc(STATE_DOC);
    if (snap.exists()) {
      const data = snap.data();
      state.sessions = data.sessions || [];
      state.chars    = data.chars    || [];
      state.enemies  = data.enemies  || [];
      state.users    = data.users    || [];
      state.estados  = data.estados  || [];
      state.actos    = data.actos    || [];
      state.eventos  = data.eventos  || [];
      state.playerNotes = data.playerNotes || {};
    }
  } catch(e) { console.error('Firestore read:', e); }
  if (!state.users.some(u => u.isDM)) {
    state.users.push({ id: uid(), username: 'dm', passwordHash: hashPassword('dm1234'), isDM: true, charId: null });
    await setDoc(STATE_DOC, JSON.parse(JSON.stringify(state)));
  }
  showLoadingOverlay(false);
}

function startRealtimeSync() {
  if (_unsubscribe) _unsubscribe();
  _unsubscribe = onSnapshot(STATE_DOC, snap => {
    if (_ignoreNext) { _ignoreNext = false; return; }
    if (!snap.exists()) return;
    const data = snap.data();
    state.sessions = data.sessions || [];
    state.chars    = data.chars    || [];
    state.enemies  = data.enemies  || [];
    state.users    = data.users    || [];
    state.estados  = data.estados  || [];
    state.actos    = data.actos    || [];
    state.eventos  = data.eventos  || [];
    state.playerNotes = data.playerNotes || {};
    if (currentUser && !state.users.find(u => u.id === currentUser.id)) { doLogout(); return; }
    if (currentUser) currentUser = state.users.find(u => u.id === currentUser.id) || currentUser;
    rebuildSessionTabs();
    renderCharList();
    renderEnemyList();
    if (isDM()) {
      renderUserList(); renderEstadoList(); renderActoList(); renderEventoList();
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

// Simple hash (not cryptographic, but enough for local use)
function hashPassword(pw) {
  let h = 0;
  for (let i = 0; i < pw.length; i++) { h = Math.imul(31, h) + pw.charCodeAt(i) | 0; }
  return 'h' + Math.abs(h).toString(36);
}

// ===========================
//  HELPERS
// ===========================
function uid() { return Math.random().toString(36).slice(2,10); }
function isDM() { return currentUser && currentUser.isDM && !_playerPreview; }
function isRealDM() { return currentUser && currentUser.isDM; }
function getSession(id) { return state.sessions.find(s => s.id === id); }

// ===========================
//  LOGIN / LOGOUT
// ===========================
function doLogin() {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  if (!username || !password) { errEl.textContent = 'Introduce usuario y contraseña.'; return; }
  const hash = hashPassword(password);
  const user = state.users.find(u => u.username === username && u.passwordHash === hash);
  if (!user) { errEl.textContent = 'Usuario o contraseña incorrectos.'; return; }
  currentUser = user;
  errEl.textContent = '';
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('login-pass').value = '';
  sessionStorage.setItem('ljhd_user', user.id);
  applyRoleUI();
  rebuildSessionTabs();
  renderCharList();
  renderEnemyList();
  renderUserList();
  
  // Show landing page first
  switchView('landing');
  
  startRealtimeSync(); // start AFTER view is rendered
}

function doLogout() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  sessionStorage.removeItem('ljhd_user');
  currentUser = null;
  document.querySelectorAll('#main-content .view[data-session-id]').forEach(v => v.remove());
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  document.getElementById('login-error').textContent = '';
  document.getElementById('login-screen').classList.remove('hidden');
}

function applyRoleUI() {
  const dm = isDM();
  const realDM = isRealDM();
  // Badge
  const badge = document.getElementById('user-badge');
  badge.innerHTML = realDM
    ? (_playerPreview
        ? `<span class="role-player">👁 Vista Jugador</span>`
        : `<span class="role-dm">⚔ DM</span> &nbsp;${currentUser.username}`)
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
      label = isDM() ? '⚙ Mantenimiento' : '📜 Hoja de Usuario';
    } else {
      label = isDM() ? '⚙ Mantenimiento' : '📜 Hoja de Usuario';
    }
    show = true;
  } else if (viewId === 'sessions-list') {
    label = '📖 Sesiones';
    show = true;
  } else if (viewId === 'charsheet') {
    label = '📜 Hoja de Personaje';
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
    personajes: '👤 Personajes',
    sesiones: '📖 Sesiones',
    enemigos: '👹 Tipos de Enemigos',
    usuarios: '👥 Usuarios',
    estados: '⚡ Estados',
    actos: '📜 Actos',
    eventos: '🎲 Eventos Aleatorios',
    backup: '💾 Copia de Seguridad'
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
    { id: 'personajes', name: 'Personajes', icon: '👤', alwaysShow: true },
    { id: 'sesiones', name: 'Sesiones', icon: '📖', dmOnly: true },
    { id: 'enemigos', name: 'Tipos de Enemigos', icon: '👹', alwaysShow: true },
    { id: 'usuarios', name: 'Usuarios', icon: '👥', dmOnly: true },
    { id: 'estados', name: 'Estados', icon: '⚡', dmOnly: true },
    { id: 'actos', name: 'Actos', icon: '📜', dmOnly: true },
    { id: 'eventos', name: 'Eventos Aleatorios', icon: '🎲', dmOnly: true },
    { id: 'backup', name: 'Copia de Seguridad', icon: '💾', dmOnly: true }
  ];
  
  sections.forEach(section => {
    if (section.dmOnly && !isDM()) return;
    
    const btn = document.createElement('button');
    btn.className = 'landing-card';
    btn.innerHTML = `<span class="card-icon">${section.icon}</span><span class="card-label">${section.name}</span>`;
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
    btn1.innerHTML = '<span class="card-icon">⚙️</span><span class="card-label">Mantenimiento</span>';
    btn1.onclick = () => switchView('maint');
  } else {
    btn1.innerHTML = '<span class="card-icon">📜</span><span class="card-label">Hoja de Usuario</span>';
    btn1.onclick = () => switchView('charsheet');
  }
  container.appendChild(btn1);
  
  // Button 2: Sesiones
  const btn2 = document.createElement('button');
  btn2.className = 'landing-card';
  btn2.innerHTML = '<span class="card-icon">📖</span><span class="card-label">Sesiones</span>';
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
    list.innerHTML = '<div style="padding:20px;color:var(--ink-faded);text-align:center">No hay sesiones en este momento.</div>';
    return;
  }
  
  // Sort by most recent first; players only see published sessions
  const sortedSessions = [...activeSessions]
    .filter(s => isDM() || s.published)
    .reverse();

  if (sortedSessions.length === 0) {
    list.innerHTML = '<div style="padding:20px;color:var(--ink-faded);text-align:center">No hay sesiones disponibles en este momento.</div>';
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
//  SESSIONS
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
    list.innerHTML = '<div style="padding:10px;color:var(--ink-faded);">No hay sesiones creadas.</div>';
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
    const activeView = document.querySelector('#main-content .view.active');
    const isActive = activeView && (activeView.dataset.sessionId === session.id || activeView.id === 'view-' + session.id);
    const icon = isActive ? '🔴' : '⚪';
    
    const card = document.createElement('div');
    card.className = 'entity-card';
    
    const dm = isDM();
    const isPublished = !!session.published;
    const pubBtn = isPublished
      ? `<button class="btn btn-sm btn-published" onclick="toggleSessionPublished('${session.id}')">🌐 Publicada</button>`
      : `<button class="btn btn-sm btn-unpublished" onclick="toggleSessionPublished('${session.id}')">🔒 No publicada</button>`;
    const actionBtns = dm
      ? `${pubBtn}
         <button class="btn btn-outline btn-sm" onclick="switchView('${session.id}')">Abrir</button>
         <button class="btn btn-outline btn-sm" onclick="openPrepareCombatsModal('${session.id}')">⚔ Combates</button>
         <button class="btn btn-danger btn-sm" onclick="deleteSession('${session.id}')">Borrar</button>`
      : `<button class="btn btn-outline btn-sm" onclick="switchView('${session.id}')">Abrir</button>`;
    
    card.innerHTML = `
      <div class="entity-card-info">
        <span style="font-size:1.2rem;margin-right:8px">${icon}</span>
        <span class="entity-name">${session.name}</span>
        <span class="entity-meta">${(session.title || '')}</span>
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
      btn.style.cssText = p === currentPage ? 'background:rgba(180,130,0,.3);border-color:var(--gold)' : '';
      btn.textContent = p;
      btn.onclick = () => { sessionStorage.setItem('session_list_page', p); renderSessionList(); };
      pagDiv.appendChild(btn);
    }
    list.appendChild(pagDiv);
  }
}

function deleteSession(id) {
  if (!confirm('¿Eliminar sesión? Esta acción no se puede deshacer.')) return;
  const idx = state.sessions.findIndex(s => s.id === id);
  if (idx === -1) return;
  const wasActive = document.querySelector('.view.active')?.dataset.sessionId === id;
  state.sessions.splice(idx, 1);
  saveState();
  rebuildSessionTabs();
  if (wasActive) {
    switchView('maint');
  }
  showToast('Sesión eliminada', 'info');
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
  if (title) title.textContent = `⚔ Preparar Combates — ${session.name}`;

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
  switchView(session.id);
  renderSessionList();
  showToast('Sesión creada', 'success');
}



function buildSessionView(session) {
  console.log('[buildSessionView] building view for session:', session.id);
  const template = document.getElementById('session-view-template');
  console.log('[buildSessionView] template found:', template ? 'YES' : 'NO');
  if (!template) { console.error('[buildSessionView] template not found!'); return; }
  
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
    el.value = session[field] || '';
    if (!el.hasAttribute('readonly')) {
      el.addEventListener('input', () => { session[field] = el.value; saveState(); });
    }
  });

  // DM-only sections
  if (!dm) {
    clone.querySelectorAll('.dm-only-ctrl').forEach(el => el.style.display = 'none');
    // Show player notes panel
    const pnw = clone.querySelector('.player-notes-panel-wrap');
    if (pnw) pnw.style.display = '';
    // Bind player notes (global per-user, shared across all sessions)
    const pnArea = clone.querySelector('[data-field="player_note"]');
    if (pnArea && currentUser) {
      pnArea.value = state.playerNotes[currentUser.id] || '';
      pnArea.addEventListener('input', () => {
        state.playerNotes[currentUser.id] = pnArea.value;
        saveState();
      });
    }
  }

  // Popup buttons
  const notesBtn    = clone.querySelector('.btn-popup-notes');
  const notesPopup  = clone.querySelector('.popup-notes');
  const diceBtn     = clone.querySelector('.btn-popup-dice');
  const dicePopup   = clone.querySelector('.popup-dice');

  notesBtn.textContent = dm ? '🗒' : '📝';
  notesBtn.title       = dm ? 'Notas del DM' : 'Mi Cuaderno';
  const notesPopupTitle = clone.querySelector('.popup-notes-title');
  if (notesPopupTitle) notesPopupTitle.textContent = dm ? '🗒 Notas del DM' : '📝 Mi Cuaderno';

  function openPopup(popup, btn) {
    popup.style.display = 'flex';
    btn.classList.add('active');
  }
  function closePopup(popup, btn) {
    popup.style.display = 'none';
    btn.classList.remove('active');
  }
  notesBtn.addEventListener('click', () => {
    if (notesPopup.style.display === 'none') { openPopup(notesPopup, notesBtn); closePopup(dicePopup, diceBtn); }
    else closePopup(notesPopup, notesBtn);
  });
  clone.querySelector('.btn-close-notes').addEventListener('click', () => closePopup(notesPopup, notesBtn));
  notesPopup.addEventListener('click', e => { if (e.target === notesPopup) closePopup(notesPopup, notesBtn); });

  diceBtn.addEventListener('click', () => {
    if (dicePopup.style.display === 'none') { openPopup(dicePopup, diceBtn); closePopup(notesPopup, notesBtn); }
    else closePopup(dicePopup, diceBtn);
  });
  clone.querySelector('.btn-close-dice').addEventListener('click', () => closePopup(dicePopup, diceBtn));
  dicePopup.addEventListener('click', e => { if (e.target === dicePopup) closePopup(dicePopup, diceBtn); });

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
  clone.querySelector('.clear-dice-btn').addEventListener('click', () => {
    session.rollHistory = [];
    saveState();
    rollHistory.innerHTML = '';
    rollDisplay.textContent = '—';
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

  console.log('[buildSessionView] appending clone to main-content. Clone id:', clone.id, 'display before:', clone.style.display, 'classList:', clone.className);
  document.getElementById('main-content').appendChild(clone);
  console.log('[buildSessionView] view appended successfully');
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
    const diary = clone.querySelector('[data-field="diary"]');
    if (diary) {
      diary.value = diary.value ? diary.value + '\n\n' + text : text;
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
    pubBtn.textContent = '📢 Publicar';
    pubBtn.addEventListener('click', () => {
      const text = acto.public || '';
      if (!text) return;
      const diary = clone.querySelector('[data-field="diary"]');
      if (diary) {
        diary.value = diary.value ? diary.value + '\n\n' + text : text;
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
    const badge = e.secret ? ' <span class="roll-badge secret">🔒</span>' : (e.isDMroll ? ' <span class="roll-badge dm">🎭</span>' : '');
    d.innerHTML = `<span><span class="ru">${e.user||'?'}</span>${badge}<span class="rl">${e.label}</span></span><span class="rv">${e.rolls.length>1?'['+e.rolls.join(',')+'] = ':''}${e.total}</span>`;
    el.appendChild(d);
  });
}

// ===========================
//  COMBATANTS
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
        <button class="dead-btn" style="border-color:var(--ink-faded);color:var(--ink-faded)">✕</button>
      </div>`;

    // Conditions
    const condWrap = card.querySelector('.conditions-wrap');
    c.conditions.forEach((cond, ci) => {
      const tag = document.createElement('span'); tag.className = 'condition-tag';
      tag.textContent = cond + (canControl ? ' ✕' : '');
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
//  HP MODAL
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
// ===========================
function renderEstadoList() {
  const list = document.getElementById('estado-list');
  if (!list) return;
  list.innerHTML = '';
  if (state.estados.length === 0) {
    list.innerHTML = '<div style="padding:14px;color:var(--text-muted);font-family:\'Crimson Text\',serif">No hay estados definidos. Los estados predeterminados del sistema se usarán en el gestor de iniciativa.</div>';
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
        <button class="btn btn-danger btn-sm" onclick="deleteEstado('${e.id}')">✕ Eliminar</button>
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
  state.estados.splice(idx, 1);
  saveState();
  renderEstadoList();
}

// ===========================
//  ACTOS MAINTENANCE
// ===========================
let editingActoId = null;

function renderActoList() {
  const list = document.getElementById('acto-list');
  if (!list) return;
  list.innerHTML = '';
  if (state.actos.length === 0 && state.sessions.length === 0) {
    list.innerHTML = '<div style="padding:14px;color:var(--text-muted);font-family:\'Crimson Text\',serif">No hay actos definidos.</div>';
    return;
  }

  // Group actos by session; show all sessions that have actos
  const sessionIds = [...new Set(state.actos.map(a => a.sessionId))];
  if (sessionIds.length === 0) {
    list.innerHTML = '<div style="padding:14px;color:var(--text-muted);font-family:\'Crimson Text\',serif">No hay actos definidos.</div>';
    return;
  }

  sessionIds.forEach(sid => {
    const session = state.sessions.find(s => s.id === sid);
    const actos = state.actos.filter(a => a.sessionId === sid);

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

    actos.forEach(a => {
      const row = document.createElement('div');
      row.className = 'tree-leaf entity-card';
      row.innerHTML = `
        <div class="entity-card-info">
          <span class="entity-name">${a.title}</span>
        </div>
        <div class="entity-actions">
          <button class="btn btn-outline btn-sm" onclick="openActoModal('${a.id}')">✎ Editar</button>
          <button class="btn btn-danger btn-sm" onclick="deleteActo('${a.id}')">✕ Eliminar</button>
        </div>`;
      childWrap.appendChild(row);
    });

    sessionNode.appendChild(childWrap);
    list.appendChild(sessionNode);
  });
}

function openActoModal(id) {
  editingActoId = id || null;
  const a = id ? state.actos.find(x => x.id === id) : null;
  document.getElementById('modal-acto-title').textContent = id ? 'Editar Acto' : 'Nuevo Acto';
  // Populate session dropdown
  const sel = document.getElementById('af-session');
  sel.innerHTML = '<option value="">— Selecciona sesión —</option>';
  state.sessions.forEach(s => {
    const o = document.createElement('option');
    o.value = s.id; o.textContent = s.name;
    if (a && a.sessionId === s.id) o.selected = true;
    sel.appendChild(o);
  });
  document.getElementById('af-title').value = a ? a.title : '';
  document.getElementById('af-public').value = a ? (a.public || '') : '';
  document.getElementById('af-private').value = a ? (a.private || '') : '';
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
    private: document.getElementById('af-private').value.trim()
  };
  if (editingActoId) {
    const idx = state.actos.findIndex(a => a.id === editingActoId);
    if (idx !== -1) state.actos[idx] = { id: editingActoId, ...obj };
  } else {
    state.actos.push({ id: uid(), ...obj });
  }
  saveState();
  closeModal('modal-acto');
  renderActoList();
  showToast('Acto guardado', 'success');
  document.querySelectorAll('.view[data-session-id]').forEach(view => {
    const s = state.sessions.find(x => x.id === view.dataset.sessionId);
    if (s) renderSessionActos(s, view);
  });
}

function deleteActo(id) {
  if (!confirm('¿Eliminar acto? Los eventos asociados perderán su referencia.')) return;
  const idx = state.actos.findIndex(a => a.id === id);
  if (idx === -1) return;
  state.actos.splice(idx, 1);
  saveState();
  renderActoList();
  document.querySelectorAll('.view[data-session-id]').forEach(view => {
    const s = state.sessions.find(x => x.id === view.dataset.sessionId);
    if (s) renderSessionActos(s, view);
  });
}

// ===========================
//  EVENTOS ALEATORIOS
// ===========================
let editingEventoId = null;

const EVENTO_CAT_COLORS = { Tensión:'#c86e1e', Combate:'#a02020', Social:'#3ca050', Entorno:'#3a7ab8' };

function renderEventoList() {
  const list = document.getElementById('evento-list');
  if (!list) return;
  list.innerHTML = '';
  if (state.eventos.length === 0) {
    list.innerHTML = '<div style="padding:14px;color:var(--text-muted);font-family:\'Crimson Text\',serif">No hay eventos aleatorios definidos.</div>';
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
            <button class="btn btn-outline btn-sm" onclick="openEventoModal('${e.id}')">✎ Editar</button>
            <button class="btn btn-danger btn-sm" onclick="deleteEvento('${e.id}')">✕ Eliminar</button>
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

function openEventoModal(id) {
  editingEventoId = id || null;
  const e = id ? state.eventos.find(x => x.id === id) : null;
  document.getElementById('modal-evento-title').textContent = id ? 'Editar Evento' : 'Nuevo Evento Aleatorio';
  // Session dropdown
  const sSel = document.getElementById('ef2-session');
  sSel.innerHTML = '<option value="">— Selecciona sesión —</option>';
  state.sessions.forEach(s => {
    const o = document.createElement('option');
    o.value = s.id; o.textContent = s.name;
    if (e && e.sessionId === s.id) o.selected = true;
    sSel.appendChild(o);
  });
  // Populate acto dropdown for current session
  populateEventoActos(e ? e.sessionId : null, e ? e.actoId : null);
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
}

function deleteEvento(id) {
  const idx = state.eventos.findIndex(e => e.id === id);
  if (idx === -1) return;
  state.eventos.splice(idx, 1);
  saveState();
  renderEventoList();
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
  <button class="remove-btn" onclick="this.parentElement.remove()">✕</button>`;
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
    <button class="remove-btn" onclick="this.parentElement.remove()">✕</button>`;
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
  // If player updated their own char, refresh player panel
  if(!isDM()) { const myChar=state.chars.find(c=>c.id===currentUser.charId); if(myChar) renderPlayerCharPanel(myChar); }
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
        <span class="entity-meta">PV ${c.pv} | PM ${c.pm} | FUE ${c.fue} INT ${c.int} CAR ${c.car} DES ${c.des}</span>
      </div>
      <div class="entity-actions">
        <button class="btn btn-outline btn-sm" onclick="openCharModal('${c.id}')">Editar</button>
        <button class="btn btn-danger btn-sm" onclick="deleteChar('${c.id}')">Borrar</button>
      </div>`;
    list.appendChild(card);
  });
  refreshCombatantSelects();
}

function renderPlayerCharPanel(char) {
  // Legacy — no longer used, kept for compat
}

function renderCharSheetView(char) {
  console.log('[renderCharSheetView] called with:', char ? char.name : 'null');
  const view = document.getElementById('charsheet-content');
  console.log('[renderCharSheetView] view element:', view);
  if (!view) { console.error('[renderCharSheetView] #charsheet-content NOT FOUND in DOM'); return; }
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
      <button class="btn btn-gold btn-sm" onclick="openCharModal('${char.id}')">✎ Editar</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
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
          <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px">
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
      ${habsHtml ? `<div class="panel" style="grid-column:span 2"><div class="panel-header">Habilidades Especiales</div><div class="panel-body">${habsHtml}</div></div>` : ''}
      ${char.backpack ? `<div class="panel"><div class="panel-header">Mochila</div><div class="panel-body" style="font-size:.95rem;white-space:pre-wrap">${char.backpack}</div></div>` : ''}
      ${char.notes ? `<div class="panel"><div class="panel-header">Notas</div><div class="panel-body" style="font-size:.95rem;white-space:pre-wrap">${char.notes}</div></div>` : ''}
    </div>`;
}

function deleteChar(id) {
  if(!confirm('¿Eliminar este personaje?')) return;
  // Disassociate any user linked to it
  state.users.forEach(u=>{ if(u.charId===id) u.charId=null; });
  state.chars = state.chars.filter(c=>c.id!==id);
  saveState(); renderCharList(); renderUserList();
  showToast('Personaje eliminado', 'info');
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
    const actions=isDM()?`<button class="btn btn-outline btn-sm" onclick="openEnemyModal('${e.id}')">Editar</button><button class="btn btn-outline btn-sm" onclick="cloneEnemy('${e.id}')" title="Clonar">⧉ Clonar</button><button class="btn btn-danger btn-sm" onclick="deleteEnemy('${e.id}')">Borrar</button>`:'';
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
  if(!confirm('¿Eliminar este tipo de enemigo?')) return;
  state.enemies=state.enemies.filter(e=>e.id!==id);
  saveState(); renderEnemyList();
  showToast('Enemigo eliminado', 'info');
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
  const u = id ? state.users.find(x=>x.id===id) : null;
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
  const existing = state.users.find(u=>u.username===username && u.id!==editingUserId);
  if (existing) { errEl.textContent='Ese nombre de usuario ya existe.'; return; }
  if (isNewUser && !password) { errEl.textContent='La contraseña es obligatoria para nuevos usuarios.'; return; }
  const isDMchecked = document.getElementById('uf-isdm').checked;
  const charId = isDMchecked ? null : (document.getElementById('uf-char').value || null);
  if (editingUserId) {
    const u = state.users.find(x=>x.id===editingUserId);
    u.username = username;
    if (password) u.passwordHash = hashPassword(password);
    u.isDM = isDMchecked;
    u.charId = charId;
    // Update currentUser if editing self
    if (currentUser && currentUser.id === editingUserId) { Object.assign(currentUser, u); applyRoleUI(); }
  } else {
    state.users.push({ id:uid(), username, passwordHash:hashPassword(password), isDM:isDMchecked, charId });
  }
  saveState(); closeModal('modal-user'); renderUserList();
  showToast('Usuario guardado', 'success');
}
function renderUserList() {
  const list = document.getElementById('user-list'); list.innerHTML='';
  state.users.forEach(u=>{
    const linkedChar = u.charId ? state.chars.find(c=>c.id===u.charId) : null;
    const card=document.createElement('div'); card.className='entity-card';
    card.innerHTML=`
      <div class="entity-card-info">
        <span class="entity-name">${u.username}</span>
        <span class="entity-meta">${u.isDM?'⚔ Director de Juego':'Jugador'}${linkedChar?' · '+linkedChar.name:''}</span>
      </div>
      <div class="entity-actions">
        <button class="btn btn-outline btn-sm" onclick="openUserModal('${u.id}')">Editar</button>
        <button class="btn btn-danger btn-sm" onclick="deleteUser('${u.id}')">Borrar</button>
      </div>`;
    list.appendChild(card);
  });
}
function deleteUser(id) {
  const u = state.users.find(x=>x.id===id);
  if (!u) return;
  if (u.id === currentUser?.id) { alert('No puedes eliminar tu propia cuenta.'); return; }
  // Prevent deleting the last DM
  if (u.isDM && state.users.filter(x=>x.isDM).length <= 1) { alert('Debe existir al menos un Director de Juego.'); return; }
  if (!confirm(`¿Eliminar usuario "${u.username}"?`)) return;
  state.users = state.users.filter(x=>x.id!==id);
  saveState(); renderUserList();
  showToast('Usuario eliminado', 'info');
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

// ===========================
//  EXPORT / IMPORT
// ===========================
function exportData() {
  state.sessions.forEach(session=>{
    const view=document.getElementById('view-'+session.id); if(!view) return;
    view.querySelectorAll('[data-field]').forEach(el=>{
      if(!el.hasAttribute('readonly')) session[el.dataset.field]=el.value;
    });
  });
  const json=JSON.stringify(state,null,2);
  const blob=new Blob([json],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='los_jueves_hay_dragones.json'; a.click();
  URL.revokeObjectURL(url);
  showToast('Copia exportada', 'success');
}
function importData(event) {
  const file=event.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=async e=>{
    try {
      const imported=JSON.parse(e.target.result);
      state.sessions=imported.sessions||[];
      state.chars=imported.chars||[];
      state.enemies=imported.enemies||[];
      state.users=imported.users||[];
      _ignoreNext = true;
      await setDoc(STATE_DOC, JSON.parse(JSON.stringify(state)));
      rebuildSessionTabs();
      renderCharList(); renderEnemyList(); renderUserList();
      switchView('maint');
      showToast('Datos importados correctamente', 'success');
    } catch(err) { alert('Error al importar: ' + err.message); }
  };
  reader.readAsText(file);
  event.target.value='';
}

// ===========================
//  LOADING OVERLAY
// ===========================
function showLoadingOverlay(show) {
  let el = document.getElementById('loading-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'loading-overlay';
    el.style.cssText = 'position:fixed;inset:0;z-index:3000;background:radial-gradient(ellipse at center,#2d1a00,#0d0700);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;';
    el.innerHTML = `
      <div style="font-family:'UnifrakturMaguntia',cursive;color:#d4a017;font-size:2rem;text-shadow:0 0 20px rgba(180,130,0,.5);">Los Jueves Hay Dragones</div>
      <div style="font-family:'Cinzel',serif;color:#c9b07a;font-size:.65rem;letter-spacing:4px;text-transform:uppercase;">Conectando con la taberna…</div>
      <div style="width:48px;height:48px;border:3px solid #2d1a00;border-top-color:#d4a017;border-radius:50%;animation:spin .8s linear infinite;"></div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
    document.body.appendChild(el);
  }
  el.style.display = show ? 'flex' : 'none';
}

// ===========================
//  SPECTATOR
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
  const url = window.location.pathname + '?spectator=' + encodeURIComponent(sessionId);
  window.open(url, '_blank', 'noopener,noreferrer');
}

// ===========================
//  INIT
// ===========================
(async () => {
  // Spectator mode: show initiative-only view without login
  const spectatorId = new URLSearchParams(window.location.search).get('spectator');
  if (spectatorId) {
    document.body.classList.add('spectator-mode');
    const sv = document.getElementById('spectator-view');
    sv.style.display = 'flex';
    await loadState();
    renderSpectatorView(spectatorId);
    onSnapshot(STATE_DOC, snap => {
      if (!snap.exists()) return;
      const data = snap.data();
      state.sessions = data.sessions || [];
      state.chars    = data.chars    || [];
      state.enemies  = data.enemies  || [];
      state.estados  = data.estados  || [];
      renderSpectatorView(spectatorId);
    }, err => console.error('Spectator sync error:', err));
    return;
  }

  await loadState();
  // Restore session after page refresh
  const savedId = sessionStorage.getItem('ljhd_user');
  if (savedId) {
    const user = state.users.find(u => u.id === savedId);
    if (user) {
      currentUser = user;
      applyRoleUI();
      rebuildSessionTabs();
      renderCharList();
      renderEnemyList();
      renderUserList();
      
      // Show landing page
      switchView('landing');
      
      document.getElementById('login-screen').classList.add('hidden');
      startRealtimeSync(); // start AFTER view is rendered
    }
  }
})();

// ===========================
//  TOAST NOTIFICATIONS
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
//  EXPOSE GLOBALS (required for type="module" scope)
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
_g.openEventoModal       = openEventoModal;
_g.saveEvento            = saveEvento;
_g.deleteEvento          = deleteEvento;
_g.onEventoSessionChange = onEventoSessionChange;
_g.openSpectatorWindow   = openSpectatorWindow;
_g.openPrepareCombatsModal   = openPrepareCombatsModal;
_g.savePrepareCombats        = savePrepareCombats;
_g.toggleSessionPublished    = toggleSessionPublished;
_g.showToast                 = showToast;