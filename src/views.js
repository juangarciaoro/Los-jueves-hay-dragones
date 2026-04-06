// views.js — Navigation, landing, maint landing, active sessions
import { state, globalUsers, campaigns, currentUser, isDM, currentCampaignId } from './state.js';
import { ICONS } from './icons.js';

// exported mutable for session-edit view
export let _editSessionId = null;
export function setEditSessionId(v) { _editSessionId = v; }

export function updateBreadcrumbs(viewId) {
  const current   = document.getElementById('breadcrumb-current');
  const separator = document.getElementById('breadcrumb-separator');
  if (!current) return;
  let label = '—', show = false;
  if (viewId === 'maint') {
    label = isDM() ? `${ICONS.settings} Mantenimiento` : `${ICONS.scroll} Hoja de Usuario`; show = true;
  } else if (viewId === 'sessions-list') {
    label = `${ICONS.bookOpen} Sesiones`; show = true;
  } else if (viewId === 'session-edit') {
    const s = state.sessions.find(x => x.id === _editSessionId);
    label = s ? `${ICONS.pencil} ${s.name}` : `${ICONS.pencil} Preparar sesión`; show = true;
  } else if (viewId === 'charsheet') {
    label = `${ICONS.scroll} Hoja de Personaje`; show = true;
  } else {
    const session = state.sessions.find(s => s.id === viewId);
    if (session) { label = session.name; show = true; }
  }
  current.innerHTML = label;
  separator.style.display = show ? '' : 'none';
  current.style.display   = show ? '' : 'none';
}

export async function switchView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById('view-' + viewId);
  if (target) target.classList.add('active');

  if (viewId === 'landing') {
    renderLandingPage();
  } else if (viewId === 'maint') {
    document.getElementById('maint-landing').style.display  = '';
    document.getElementById('maint-content').style.display  = 'none';
    renderMaintLanding();
  } else if (viewId === 'sessions-list') {
    renderActiveSessions();
  } else if (viewId === 'session-edit') {
    const { renderSessionEditView } = await import('./sessions.js');
    renderSessionEditView();
  } else if (viewId === 'charsheet') {
    const { renderCharSheetView } = await import('./characters.js');
    let csChar = null;
    if (currentUser?.charId) csChar = state.chars.find(c => c.id === currentUser.charId) || null;
    renderCharSheetView(csChar);
  }
  updateBreadcrumbs(viewId);
}

export function switchMaintTab(name, btn) {
  document.querySelectorAll('.maint-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.maint-section').forEach(s => s.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const sec = document.getElementById('maint-' + name);
  if (sec) sec.classList.add('active');
}

export function switchMaintSection(name, btn) {
  document.getElementById('maint-landing').style.display  = 'none';
  document.getElementById('maint-content').style.display  = '';
  document.querySelectorAll('.maint-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.maint-section').forEach(s => s.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const sec = document.getElementById('maint-' + name);
  if (sec) sec.classList.add('active');
  const sectionNames = {
    personajes: `${ICONS.user} Personajes`,
    sesiones:   `${ICONS.scroll} Sesiones`,
    enemigos:   `${ICONS.skull} Tipos de Enemigos`,
    usuarios:   `${ICONS.users} Usuarios`,
    campanas:   `${ICONS.castle} Campañas`,
    estados:    `${ICONS.zap} Estados`,
    actos:      `${ICONS.sword} Actos`,
    eventos:    `${ICONS.dices} Eventos Aleatorios`,
    backup:     `${ICONS.save} Copia de Seguridad`
  };
  const current   = document.getElementById('breadcrumb-current');
  const separator = document.getElementById('breadcrumb-separator');
  if (current) { current.innerHTML = sectionNames[name] || name; separator.style.display = ''; current.style.display = ''; }
}

export function renderMaintLanding() {
  const container = document.getElementById('maint-landing-buttons');
  if (!container) return;
  container.innerHTML = '';
  const sections = [
    {id:'sesiones',   name:'Sesiones',           icon:ICONS.scroll,    dmOnly:true},
    {id:'actos',      name:'Actos',               icon:ICONS.sword,     dmOnly:true},
    {id:'eventos',    name:'Eventos Aleatorios',  icon:ICONS.dices,     dmOnly:true},
    {id:'enemigos',   name:'Tipos de Enemigos',   icon:ICONS.skull,     alwaysShow:true},
    {id:'estados',    name:'Estados',             icon:ICONS.zap,       dmOnly:true},
    {id:'personajes', name:'Personajes',          icon:ICONS.swords,    alwaysShow:true},
    {id:'usuarios',   name:'Usuarios',            icon:ICONS.shield,    dmOnly:true},
    {id:'campanas',   name:'Campañas',            icon:ICONS.castle,    dmOnly:true},
    {id:'backup',     name:'Copia de Seguridad',  icon:ICONS.keyRound,  dmOnly:true}
  ];
  const counts = {
    personajes: state.chars.length,    sesiones: state.sessions.length,
    enemigos:   state.enemies.length,  usuarios: globalUsers.length,
    campanas:   campaigns.filter(c => !c.archived).length,
    estados:    state.estados.length,  actos: state.actos.length,
    eventos:    state.eventos.length
  };
  sections.forEach(section => {
    if (section.dmOnly && !isDM()) return;
    const count  = counts[section.id];
    const badge  = count !== undefined
      ? `<span style="font-family:'Cinzel',serif;font-size:.58rem;color:var(--text-muted);letter-spacing:1px;">(${count})</span>` : '';
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

export function initMaintView() { renderMaintLanding(); }

export function renderLandingPage() {
  const container = document.getElementById('landing-buttons');
  if (!container) return;
  container.innerHTML = '';
  const dm = isDM();
  const btn1 = document.createElement('button');
  btn1.className = 'landing-card';
  if (dm) {
    btn1.innerHTML = `<span class="card-icon">${ICONS.hammer}</span><span class="card-label">Mantenimiento</span>`;
    btn1.onclick = () => switchView('maint');
  } else {
    btn1.innerHTML = `<span class="card-icon">${ICONS.scroll}</span><span class="card-label">Hoja de Usuario</span>`;
    btn1.onclick = () => switchView('charsheet');
  }
  container.appendChild(btn1);
  const btn2 = document.createElement('button');
  btn2.className = 'landing-card';
  btn2.innerHTML = `<span class="card-icon">${ICONS.bookOpen}</span><span class="card-label">Sesiones</span>`;
  btn2.onclick = () => switchView('sessions-list');
  container.appendChild(btn2);
}

export function renderActiveSessions() {
  const list = document.getElementById('active-sessions-list');
  if (!list) return;
  list.innerHTML = '';
  const sorted = [...state.sessions].filter(s => isDM() || s.published).reverse();
  if (!sorted.length) {
    list.innerHTML = '<div class="empty-state">No hay sesiones disponibles en este momento.</div>';
    return;
  }
  sorted.forEach(session => {
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
