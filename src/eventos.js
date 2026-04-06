// eventos.js — Random encounter events: create/edit/delete, session-acto tree
import { uid } from './utils.js';
import { state } from './state.js';
import { _editSessionId } from './views.js';
import { saveState } from './persist.js';
import { openModal, closeModal, showConfirm, showToast } from './ui.js';

export let editingEventoId = null;

export const EVENTO_CAT_COLORS = { Tensión:'#c86e1e', Combate:'#a02020', Social:'#3ca050', Entorno:'#3a7ab8' };

export function renderEventoList() {
  const list = document.getElementById('evento-list');
  if (!list) return;
  list.innerHTML = '';
  if (state.eventos.length === 0) {
    list.innerHTML = '<div class="empty-state">No hay eventos aleatorios definidos.</div>';
    return;
  }
  const sessionIds = [...new Set(state.eventos.map(e => e.sessionId))];
  sessionIds.forEach(sid => {
    const session       = state.sessions.find(s => s.id === sid);
    const sessionEventos = state.eventos.filter(e => e.sessionId === sid);
    const sessionNode   = document.createElement('div'); sessionNode.className = 'tree-session';
    const sessionHeader = document.createElement('div'); sessionHeader.className = 'tree-session-header';
    sessionHeader.innerHTML = `<span class="tree-toggle">▾</span><span class="tree-session-name">${session ? session.name : sid}</span><span class="tree-count">${sessionEventos.length} evento${sessionEventos.length !== 1 ? 's' : ''}</span>`;
    const sessionChildren = document.createElement('div'); sessionChildren.className = 'tree-children';
    sessionHeader.addEventListener('click', () => {
      const collapsed = sessionChildren.classList.toggle('collapsed');
      sessionHeader.querySelector('.tree-toggle').textContent = collapsed ? '▸' : '▾';
    });
    sessionNode.appendChild(sessionHeader);
    const actoIds = [...new Set(sessionEventos.map(e => e.actoId || '__none__'))];
    actoIds.forEach(aid => {
      const acto        = aid !== '__none__' ? state.actos.find(a => a.id === aid) : null;
      const actoEventos = sessionEventos.filter(e => (e.actoId || '__none__') === aid);
      const actoNode    = document.createElement('div'); actoNode.className = 'tree-acto';
      const actoHeader  = document.createElement('div'); actoHeader.className = 'tree-acto-header';
      actoHeader.innerHTML = `<span class="tree-toggle">▾</span><span class="tree-acto-name">${acto ? acto.title : '— Sin acto —'}</span><span class="tree-count">${actoEventos.length}</span>`;
      const actoChildren = document.createElement('div'); actoChildren.className = 'tree-children';
      actoHeader.addEventListener('click', () => {
        const collapsed = actoChildren.classList.toggle('collapsed');
        actoHeader.querySelector('.tree-toggle').textContent = collapsed ? '▸' : '▾';
      });
      actoNode.appendChild(actoHeader);
      actoEventos.forEach(e => {
        const color = EVENTO_CAT_COLORS[e.categoria] || 'var(--text-muted)';
        const row = document.createElement('div'); row.className = 'tree-leaf entity-card';
        row.innerHTML = `
          <div class="entity-card-info">
            <span class="entity-name">${e.title}</span>
            <span class="evento-cat-badge" style="color:${color}">${e.categoria}</span>
          </div>
          <div class="entity-actions">
            <button class="btn btn-outline btn-sm" onclick="window._g.openEventoModal('${e.id}')">✎ Editar</button>
            <button class="btn btn-danger btn-sm"  onclick="window._g.deleteEvento('${e.id}')">✕ Borrar</button>
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

export function openEventoModal(id, preSessionId, preActoId) {
  editingEventoId = id || null;
  const e = id ? state.eventos.find(x => x.id === id) : null;
  document.getElementById('modal-evento-title').textContent = id ? 'Editar Evento' : 'Nuevo Evento Aleatorio';
  const sSel = document.getElementById('ef2-session');
  sSel.innerHTML = '<option value="">— Selecciona sesión —</option>';
  state.sessions.forEach(s => {
    const o   = document.createElement('option');
    o.value   = s.id; o.textContent = s.name;
    const selId = e ? e.sessionId : preSessionId;
    if (selId === s.id) o.selected = true;
    sSel.appendChild(o);
  });
  const resolvedSessionId = e ? e.sessionId : preSessionId;
  const resolvedActoId    = e ? e.actoId    : preActoId;
  populateEventoActos(resolvedSessionId, resolvedActoId);
  document.getElementById('ef2-cat').value     = e ? e.categoria : 'Tensión';
  document.getElementById('ef2-title').value   = e ? e.title : '';
  document.getElementById('ef2-public').value  = e ? (e.public  || '') : '';
  document.getElementById('ef2-private').value = e ? (e.private || '') : '';
  openModal('modal-evento');
}

export function onEventoSessionChange() {
  const sessionId = document.getElementById('ef2-session').value;
  populateEventoActos(sessionId, null);
}

export function populateEventoActos(sessionId, selectedActoId) {
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

export function saveEvento() {
  const sessionId = document.getElementById('ef2-session').value;
  const actoId    = document.getElementById('ef2-acto').value;
  const title     = document.getElementById('ef2-title').value.trim();
  if (!sessionId || !title) return;
  const obj = {
    sessionId,
    actoId:    actoId || null,
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
  if (_editSessionId) import('./sessions.js').then(m => m.renderSessionEditView());
}

export function deleteEvento(id) {
  showConfirm('¿Eliminar este evento?').then(ok => {
    if (!ok) return;
    const idx = state.eventos.findIndex(e => e.id === id);
    if (idx === -1) return;
    state.eventos.splice(idx, 1);
    saveState();
    renderEventoList();
    if (_editSessionId) import('./sessions.js').then(m => m.renderSessionEditView());
    showToast('Evento eliminado', 'info');
  });
}
