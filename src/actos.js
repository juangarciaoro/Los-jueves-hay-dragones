// actos.js — Actos (acts) maintenance: create/edit/delete, image upload, accordion
import { uid } from './utils.js';
import { state } from './state.js';
import { _editSessionId } from './views.js';
import { saveState } from './persist.js';
import { openModal, closeModal, showConfirm, showToast } from './ui.js';

export let editingActoId     = null;
export let _editingActoImage = null;

export const EDIT_CAT_COLORS = { Tensión:'#c86e1e', Combate:'#a02020', Social:'#3ca050', Entorno:'#3a7ab8' };
export const EDIT_CAT_BG     = { Tensión:'rgba(200,110,30,.12)', Combate:'rgba(160,32,32,.12)', Social:'rgba(60,160,80,.10)', Entorno:'rgba(58,122,184,.12)' };

export function renderActoList() {
  const list = document.getElementById('acto-list');
  if (!list) return;
  list.innerHTML = '';
  const sessionIds = [...new Set(state.actos.map(a => a.sessionId))];
  if (sessionIds.length === 0) {
    list.innerHTML = '<div class="empty-state">No hay actos definidos.</div>';
    return;
  }
  sessionIds.forEach(sid => {
    const session = state.sessions.find(s => s.id === sid);
    const actos   = state.actos.filter(a => a.sessionId === sid).sort((a,b) => (a.order??0) - (b.order??0));
    const sessionNode   = document.createElement('div'); sessionNode.className = 'tree-session';
    const sessionHeader = document.createElement('div'); sessionHeader.className = 'tree-session-header';
    sessionHeader.innerHTML = `<span class="tree-toggle">▾</span><span class="tree-session-name">${session ? session.name : sid}</span><span class="tree-count">${actos.length} acto${actos.length !== 1 ? 's' : ''}</span>`;
    const childWrap = document.createElement('div'); childWrap.className = 'tree-children';
    sessionHeader.addEventListener('click', () => {
      const collapsed = childWrap.classList.toggle('collapsed');
      sessionHeader.querySelector('.tree-toggle').textContent = collapsed ? '▸' : '▾';
    });
    sessionNode.appendChild(sessionHeader);
    actos.forEach((a, idx) => {
      const isFirst = idx === 0;
      const isLast  = idx === actos.length - 1;
      const row = document.createElement('div'); row.className = 'tree-leaf entity-card';
      row.innerHTML = `
        <div class="entity-card-info">
          <span class="entity-name">${a.title}</span>
        </div>
        <div class="entity-actions">
          <button class="btn btn-outline btn-xs" ${isFirst?'disabled':''} onclick="window._g.moveActo('${a.id}',-1)">▲</button>
          <button class="btn btn-outline btn-xs" ${isLast?'disabled':''} onclick="window._g.moveActo('${a.id}',1)">▼</button>
          <button class="btn btn-outline btn-sm" onclick="window._g.openActoModal('${a.id}')">✎ Editar</button>
          <button class="btn btn-danger btn-sm" onclick="window._g.deleteActo('${a.id}')">✕ Borrar</button>
        </div>`;
      childWrap.appendChild(row);
    });
    sessionNode.appendChild(childWrap);
    list.appendChild(sessionNode);
  });
}

export function openActoModal(id, preSessionId) {
  editingActoId     = id || null;
  _editingActoImage = null;
  const a = id ? state.actos.find(x => x.id === id) : null;
  document.getElementById('modal-acto-title').textContent = id ? 'Editar Acto' : 'Nuevo Acto';
  const sel = document.getElementById('af-session');
  sel.innerHTML = '<option value="">— Selecciona sesión —</option>';
  state.sessions.forEach(s => {
    const o   = document.createElement('option');
    o.value   = s.id; o.textContent = s.name;
    const selId = a ? a.sessionId : preSessionId;
    if (selId === s.id) o.selected = true;
    sel.appendChild(o);
  });
  document.getElementById('af-title').value   = a ? a.title : '';
  document.getElementById('af-public').value  = a ? (a.public  || '') : '';
  document.getElementById('af-private').value = a ? (a.private || '') : '';
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
  document.getElementById('af-img-drop').onclick = e => {
    if (!e.target.closest('#af-img-clear')) _fileInput.click();
  };
  openModal('modal-acto');
}

export function saveActo() {
  const sessionId = document.getElementById('af-session').value;
  const title     = document.getElementById('af-title').value.trim();
  if (!sessionId || !title) return;
  const obj = {
    sessionId, title,
    public:  document.getElementById('af-public').value.trim(),
    private: document.getElementById('af-private').value.trim(),
    image:   _editingActoImage || null
  };
  if (editingActoId) {
    const idx = state.actos.findIndex(a => a.id === editingActoId);
    if (idx !== -1) {
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
  // Refresh session edit view + open session views
  if (_editSessionId) import('./sessions.js').then(m => m.renderSessionEditView());
  document.querySelectorAll('.view[data-session-id]').forEach(view => {
    const s = state.sessions.find(x => x.id === view.dataset.sessionId);
    if (s) import('./session-view.js').then(m => { m.renderSessionActos(s, view); m.renderSessionGallery(s, view); });
  });
}

export function deleteActo(id) {
  showConfirm('¿Eliminar acto? Los eventos asociados perderán su referencia.').then(ok => {
    if (!ok) return;
    const idx = state.actos.findIndex(a => a.id === id);
    if (idx === -1) return;
    state.sessions.forEach(s => {
      if (s.publishedImages) s.publishedImages = s.publishedImages.filter(i => i.actoId !== id);
    });
    state.actos.splice(idx, 1);
    saveState();
    renderActoList();
    if (_editSessionId) import('./sessions.js').then(m => m.renderSessionEditView());
    document.querySelectorAll('.view[data-session-id]').forEach(view => {
      const s = state.sessions.find(x => x.id === view.dataset.sessionId);
      if (s) import('./session-view.js').then(m => m.renderSessionGallery(s, view));
    });
    showToast('Acto eliminado', 'info');
  });
}

export function handleActoImageSelect(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
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
      document.getElementById('af-img-preview').src          = data;
      document.getElementById('af-img-preview').style.display = '';
      document.getElementById('af-img-placeholder').style.display = 'none';
      document.getElementById('af-img-clear').style.display   = '';
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

export function clearActoImage() {
  _editingActoImage = null;
  document.getElementById('af-img-preview').src              = '';
  document.getElementById('af-img-preview').style.display    = 'none';
  document.getElementById('af-img-placeholder').style.display = '';
  document.getElementById('af-img-clear').style.display      = 'none';
  document.getElementById('af-image').value = '';
}
