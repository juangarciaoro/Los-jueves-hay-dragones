// estados.js — Custom combat conditions maintenance
import { uid } from './utils.js';
import { state } from './state.js';
import { saveState } from './persist.js';
import { showConfirm, showToast } from './ui.js';
import { ICONS } from './icons.js';

export function renderEstadoList() {
  const list = document.getElementById('estado-list');
  if (!list) return;
  list.innerHTML = '';
  if (state.estados.length === 0) {
    list.innerHTML = '<div class="empty-state">No hay estados definidos. Los estados predeterminados del sistema se usarán en el gestor de iniciativa.</div>';
    return;
  }
  state.estados.forEach(e => {
    const card = document.createElement('div');
    card.className = 'entity-card';
    card.innerHTML = `
      <div class="entity-card-info">
        <span class="entity-name">${e.nombre}</span>
      </div>
      <div class="entity-actions">
        <button class="btn btn-danger btn-sm" onclick="window._g.deleteEstado('${e.id}')">${ICONS.x} Borrar</button>
      </div>`;
    list.appendChild(card);
  });
}

export function addEstado() {
  const input  = document.getElementById('nuevo-estado-input');
  const nombre = input ? input.value.trim() : '';
  if (!nombre) return;
  if (state.estados.some(e => e.nombre.toLowerCase() === nombre.toLowerCase())) {
    if (input) input.value = '';
    return;
  }
  state.estados.push({ id: uid(), nombre });
  saveState();
  if (input) input.value = '';
  renderEstadoList();
}

export function deleteEstado(id) {
  const idx = state.estados.findIndex(e => e.id === id);
  if (idx === -1) return;
  showConfirm('¿Eliminar este estado?').then(ok => {
    if (!ok) return;
    state.estados.splice(idx, 1);
    saveState();
    renderEstadoList();
    showToast('Estado eliminado', 'info');
  });
}
