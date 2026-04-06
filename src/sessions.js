// sessions.js — Session list, tabs, edit view, prepare combats
import { uid } from './utils.js';
import { state, isDM, campaigns } from './state.js';
import { saveState } from './persist.js';
import { showToast, showConfirm, openModal, closeModal } from './ui.js';
import { buildSessionView } from './session-view.js';
import { renderActoList } from './actos.js';
import { renderEventoList } from './eventos.js';
import { switchView, updateBreadcrumbs, _editSessionId, setEditSessionId } from './views.js';
import { renderCombatantChips } from './combat.js';
import { ICONS } from './icons.js';

const EDIT_CAT_COLORS = { 'Tensión':'#c86e1e','Combate':'#a02020','Social':'#3ca050','Entorno':'#3a7ab8' };
const EDIT_CAT_BG     = { 'Tensión':'rgba(200,110,30,0.15)','Combate':'rgba(160,32,32,0.15)','Social':'rgba(60,160,80,0.15)','Entorno':'rgba(58,122,184,0.15)' };

let _prepareCombatsSessionId = null;
let _prepareCombatsSelected  = new Set();

export function rebuildSessionTabs() {
  const activeView = document.querySelector('#main-content .view.active');
  const activeId   = activeView ? (activeView.dataset.sessionId || activeView.id.replace('view-', '')) : null;
  const isMenuView = !activeId || ['landing','sessions-list','maint','charsheet'].includes(activeId);

  document.querySelectorAll('#main-content .view[data-session-id]').forEach(v => v.remove());
  state.sessions.forEach(session => {
    if (!isDM() && !session.published) return;
    buildSessionView(session);
  });
  if (!isMenuView && activeId) {
    const restored = document.getElementById('view-' + activeId);
    if (restored) {
      document.querySelectorAll('#main-content .view').forEach(v => v.classList.remove('active'));
      restored.classList.add('active');
      updateBreadcrumbs(activeId);
    }
  }
  renderSessionList();
}

export function renderSessionList() {
  const list = document.getElementById('session-maint-list');
  if (!list) return;
  list.innerHTML = '';
  if (state.sessions.length === 0) { list.innerHTML = '<div class="empty-state">No hay sesiones creadas.</div>'; return; }

  const sorted = [...state.sessions].reverse();
  const itemsPerPage = 10;
  const totalPages   = Math.ceil(sorted.length / itemsPerPage);
  let currentPage    = parseInt(sessionStorage.getItem('session_list_page') || '1');
  if (currentPage > totalPages) currentPage = 1;
  const pageSessions = sorted.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  pageSessions.forEach(session => {
    const card      = document.createElement('div');
    const dm        = isDM();
    const published = !!session.published;
    card.className  = 'entity-card ' + (published ? 'session-card--published' : 'session-card--unpublished');
    const pubBtn    = published
      ? `<button class="btn btn-sm btn-published"   onclick="toggleSessionPublished('${session.id}')">${ICONS.globe} Publicada</button>`
      : `<button class="btn btn-sm btn-unpublished" onclick="toggleSessionPublished('${session.id}')">${ICONS.lock} No publicada</button>`;
    const actions   = dm
      ? `${pubBtn}
         <button class="btn btn-outline btn-sm" onclick="openSessionEdit('${session.id}')">${ICONS.pencil} Preparar</button>
         <button class="btn btn-outline btn-sm" onclick="switchView('${session.id}')">Abrir</button>
         <button class="btn btn-danger btn-sm"  onclick="deleteSession('${session.id}')">${ICONS.x} Borrar</button>`
      : `<button class="btn btn-outline btn-sm" onclick="switchView('${session.id}')">Abrir</button>`;
    const actosCount   = state.actos.filter(a => a.sessionId === session.id).length;
    const eventosCount = state.eventos.filter(e => e.sessionId === session.id).length;
    const counters     = dm ? `<span class="session-card-counters">${actosCount} acto${actosCount!==1?'s':''} &middot; ${eventosCount} evento${eventosCount!==1?'s':''}</span>` : '';
    card.innerHTML = `
      <div class="entity-card-info">
        <span class="entity-name">${session.name}</span>
        <span class="entity-meta">${session.title || ''}</span>${counters}
      </div>
      <div class="entity-actions">${actions}</div>`;
    list.appendChild(card);
  });
  if (totalPages > 1) {
    const pagDiv = document.createElement('div');
    pagDiv.style.cssText = 'display:flex;gap:6px;justify-content:center;margin-top:16px;flex-wrap:wrap';
    for (let p = 1; p <= totalPages; p++) {
      const btn = document.createElement('button');
      btn.className = `btn btn-outline btn-sm${p===currentPage?' active':''}`;
      if (p===currentPage) btn.style.cssText = 'background:rgba(166,151,123,.3);border-color:var(--gold)';
      btn.textContent = p;
      btn.onclick = () => { sessionStorage.setItem('session_list_page', p); renderSessionList(); };
      pagDiv.appendChild(btn);
    }
    list.appendChild(pagDiv);
  }
}

export function deleteSession(id) {
  showConfirm('¿Eliminar sesión? Esta acción no se puede deshacer.').then(ok => {
    if (!ok) return;
    const idx = state.sessions.findIndex(s => s.id === id);
    if (idx === -1) return;
    const wasActive = document.querySelector('.view.active')?.dataset.sessionId === id;
    state.sessions.splice(idx, 1);
    saveState(); rebuildSessionTabs();
    if (wasActive) switchView('maint');
    showToast('Sesión eliminada', 'info');
  });
}

export function openNewSessionModal() {
  const input = document.getElementById('new-session-name');
  input.value = `Sesión ${state.sessions.length + 1}`;
  input.onkeydown = e => { if (e.key === 'Enter') createSession(); };
  openModal('modal-new-session');
  setTimeout(() => input.select(), 80);
}

export function createSession() {
  const name = document.getElementById('new-session-name').value.trim() || `Sesión ${state.sessions.length + 1}`;
  const session = { id:uid(), name, title:'', diary:'', dm_notes:'', quick_notes:'', combatants:[], round:1, activeTurn:0, rollHistory:[], published:false };
  state.sessions.push(session);
  saveState(); closeModal('modal-new-session');
  buildSessionView(session); renderSessionList();
  openSessionEdit(session.id);
  showToast('Sesión creada', 'success');
}

export function openPrepareCombatsModal(sessionId) {
  const session = state.sessions.find(s => s.id === sessionId);
  if (!session) return;
  _prepareCombatsSessionId = sessionId;
  _prepareCombatsSelected  = new Set(session.allowedEnemies || []);
  const title = document.getElementById('modal-prepare-combats-title');
  if (title) title.innerHTML = `${ICONS.swords} Preparar Combates — ${session.name}`;
  const wrap  = document.getElementById('prepare-combats-chips');
  const empty = document.getElementById('prepare-combats-empty');
  wrap.innerHTML = '';
  if (!state.enemies.length) {
    wrap.style.display = 'none'; empty.style.display = '';
  } else {
    wrap.style.display = ''; empty.style.display = 'none';
    state.enemies.forEach(enemy => {
      const chip = document.createElement('button');
      chip.className = 'chip-enemy-prep' + (_prepareCombatsSelected.has(enemy.id) ? ' selected' : '');
      chip.textContent = enemy.name; chip.dataset.enemyId = enemy.id;
      chip.onclick = () => {
        if (_prepareCombatsSelected.has(enemy.id)) { _prepareCombatsSelected.delete(enemy.id); chip.classList.remove('selected'); }
        else { _prepareCombatsSelected.add(enemy.id); chip.classList.add('selected'); }
      };
      wrap.appendChild(chip);
    });
  }
  openModal('modal-prepare-combats');
}

export function savePrepareCombats() {
  const session = state.sessions.find(s => s.id === _prepareCombatsSessionId);
  if (!session) { closeModal('modal-prepare-combats'); return; }
  session.allowedEnemies = [..._prepareCombatsSelected];
  saveState(); closeModal('modal-prepare-combats');
  showToast('Combates guardados', 'success');
  const container = document.getElementById('view-' + session.id);
  if (container) renderCombatantChips(container, session);
}

export function toggleSessionPublished(id) {
  const session = state.sessions.find(s => s.id === id);
  if (!session) return;
  session.published = !session.published;
  saveState(); renderSessionList();
  showToast(session.published ? 'Sesión publicada' : 'Sesión ocultada', 'info');
}

export function openSessionEdit(sessionId) {
  setEditSessionId(sessionId);
  renderSessionEditView();
  switchView('session-edit');
}

export function renderSessionEditView() {
  const session = state.sessions.find(s => s.id === _editSessionId);
  const wrap    = document.getElementById('session-edit-content');
  if (!session || !wrap) return;

  const actos = state.actos.filter(a => a.sessionId === session.id).sort((a,b) => (a.order??0)-(b.order??0));

  let html = `
    <div class="se-header">
      <button class="btn btn-outline btn-sm" onclick="switchView('maint');switchMaintSection('sesiones',null)">← Sesiones</button>
      <span class="se-session-name">${session.name}</span>
      <span style="font-family:'Crimson Text',serif;font-size:.9rem;color:var(--text-muted)">${actos.length} acto${actos.length!==1?'s':''} · ${state.eventos.filter(e=>e.sessionId===session.id).length} eventos</span>
    </div>`;

  if (actos.length === 0) html += `<div style="font-family:'Crimson Text',serif;font-size:1rem;color:var(--text-muted);padding:20px 0">Esta sesión no tiene actos todavía.</div>`;
  wrap.innerHTML = html;

  actos.forEach(acto => {
    const eventos  = state.eventos.filter(e => e.actoId === acto.id);
    const block    = document.createElement('div'); block.className = 'se-acto-block'; block.dataset.actoId = acto.id;
    const isFirst  = actos.indexOf(acto) === 0;
    const isLast   = actos.indexOf(acto) === actos.length - 1;
    const actoHeader = document.createElement('div'); actoHeader.className = 'se-acto-header';
    actoHeader.innerHTML = `
      <span class="se-acto-title">${ICONS.scroll} ${acto.title}</span>
      <span style="font-family:'Crimson Text',serif;font-size:.82rem;color:var(--text-muted)">${eventos.length} evento${eventos.length!==1?'s':''}</span>
      <button class="btn btn-outline btn-xs" ${isFirst?'disabled':''} onclick="moveActo('${acto.id}',-1)">▲</button>
      <button class="btn btn-outline btn-xs" ${isLast?'disabled':''} onclick="moveActo('${acto.id}',1)">▼</button>
      <button class="btn btn-outline btn-sm" onclick="openActoModal('${acto.id}','${session.id}')">${ICONS.pencil} Editar</button>
      <button class="btn btn-danger btn-sm" onclick="deleteActo('${acto.id}')">${ICONS.x} Borrar</button>`;
    block.appendChild(actoHeader);

    const evList = document.createElement('div'); evList.className = 'se-events-list';
    if (!eventos.length) evList.innerHTML = `<div style="font-family:'Crimson Text',serif;font-style:italic;color:var(--text-muted);font-size:.88rem;padding:6px 0">Sin eventos. Añade el primero.</div>`;
    eventos.forEach(ev => {
      const color = EDIT_CAT_COLORS[ev.categoria] || 'var(--text-muted)';
      const bg    = EDIT_CAT_BG[ev.categoria]     || 'transparent';
      const row   = document.createElement('div'); row.className = 'se-event-row'; row.style.borderLeftColor = color;
      row.innerHTML = `
        <span class="se-event-cat" style="color:${color};background:${bg}">${ev.categoria}</span>
        <span class="se-event-title">${ev.title}</span>
        <button class="btn btn-outline btn-sm" onclick="openEventoModal('${ev.id}','${session.id}','${acto.id}')">${ICONS.pencil}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteEvento('${ev.id}')">${ICONS.x}</button>`;
      evList.appendChild(row);
    });
    block.appendChild(evList);
    const addEvRow = document.createElement('div'); addEvRow.className = 'se-add-row';
    addEvRow.innerHTML = `<button class="btn btn-outline btn-sm" onclick="openEventoModal(null,'${session.id}','${acto.id}')">＋ Añadir evento a este acto</button>`;
    block.appendChild(addEvRow);
    wrap.appendChild(block);
  });

  const addActo = document.createElement('div'); addActo.className = 'se-add-acto-row';
  addActo.innerHTML = `<button class="btn btn-gold btn-sm" onclick="openActoModal(null,'${session.id}')">＋ Añadir acto a esta sesión</button>`;
  wrap.appendChild(addActo);

  const allowedSet = new Set(session.allowedEnemies || []);
  const enemiesSection = document.createElement('div'); enemiesSection.className = 'se-enemies-section';
  const eTitle = document.createElement('div'); eTitle.className = 'se-enemies-title'; eTitle.innerHTML = ICONS.swords + ' Enemigos de la sesión';
  enemiesSection.appendChild(eTitle);
  const eChips = document.createElement('div'); eChips.className = 'se-enemies-chips';
  if (!state.enemies.length) {
    eChips.innerHTML = '<span class="empty-state" style="display:inline">No hay enemigos registrados.</span>';
  } else {
    state.enemies.forEach(en => {
      const chip = document.createElement('button');
      chip.className = 'chip-enemy-prep' + (allowedSet.has(en.id) ? ' selected' : '');
      chip.textContent = en.name; chip.onclick = () => toggleEditEnemy(en.id);
      eChips.appendChild(chip);
    });
  }
  enemiesSection.appendChild(eChips);
  wrap.appendChild(enemiesSection);
}

export function moveActo(actoId, dir) {
  const acto = state.actos.find(a => a.id === actoId); if (!acto) return;
  const siblings = state.actos.filter(a => a.sessionId === acto.sessionId).sort((a,b) => (a.order??0)-(b.order??0));
  siblings.forEach((a, i) => { a.order = i; });
  const idx     = siblings.indexOf(acto);
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= siblings.length) return;
  siblings[idx].order = swapIdx; siblings[swapIdx].order = idx;
  saveState(); renderActoList();
  if (_editSessionId) renderSessionEditView();
}

export function toggleEditEnemy(enemyId) {
  const session = state.sessions.find(s => s.id === _editSessionId); if (!session) return;
  const set = new Set(session.allowedEnemies || []);
  if (set.has(enemyId)) set.delete(enemyId); else set.add(enemyId);
  session.allowedEnemies = [...set];
  saveState(); renderSessionEditView();
}
