// enemies.js — Enemy CRUD management
import { uid } from './utils.js';
import { state, isDM } from './state.js';
import { saveState } from './persist.js';
import { openModal, closeModal, showConfirm, showToast } from './ui.js';
import { ICONS } from './icons.js';
import { refreshCombatantSelects } from './characters.js';

export let editingEnemyId       = null;
export let currentEnemyArmorSel = '';

export function selectEnemyArmor(t) {
  currentEnemyArmorSel = currentEnemyArmorSel === t ? '' : t;
  ['L','M','P'].forEach(x => document.getElementById('ef-armor-' + x).classList.toggle('sel', currentEnemyArmorSel === x));
}

export function openEnemyModal(id) {
  if (!isDM()) return;
  editingEnemyId = id || null; currentEnemyArmorSel = '';
  document.getElementById('modal-enemy-title').textContent = id ? 'Editar Enemigo' : 'Nuevo Tipo de Enemigo';
  const e = id ? state.enemies.find(x => x.id === id) : null;
  ['name','attacks','notes'].forEach(f => { const el = document.getElementById('ef-' + f); if (el) el.value = e ? (e[f] || '') : ''; });
  ['pv','fue','int','car','des'].forEach(f => { const el = document.getElementById('ef-' + f); if (el) el.value = e ? (e[f] || 10) : 10; });
  currentEnemyArmorSel = e ? (e.armor || '') : '';
  ['L','M','P'].forEach(t => document.getElementById('ef-armor-' + t).classList.toggle('sel', currentEnemyArmorSel === t));
  openModal('modal-enemy');
}

export function saveEnemy() {
  const name = document.getElementById('ef-name').value.trim();
  if (!name) { alert('El enemigo necesita un nombre.'); return; }
  const enemy = {
    id:      editingEnemyId || uid(),
    name,
    pv:      parseInt(document.getElementById('ef-pv').value)  || 10,
    fue:     parseInt(document.getElementById('ef-fue').value) || 10,
    int:     parseInt(document.getElementById('ef-int').value) || 10,
    car:     parseInt(document.getElementById('ef-car').value) || 10,
    des:     parseInt(document.getElementById('ef-des').value) || 10,
    armor:   currentEnemyArmorSel,
    attacks: document.getElementById('ef-attacks').value,
    notes:   document.getElementById('ef-notes').value,
  };
  if (editingEnemyId) {
    const idx = state.enemies.findIndex(e => e.id === editingEnemyId);
    state.enemies[idx] = enemy;
  } else {
    state.enemies.push(enemy);
  }
  saveState();
  closeModal('modal-enemy');
  renderEnemyList();
  showToast('Enemigo guardado', 'success');
}

export function renderEnemyList() {
  const list = document.getElementById('enemy-list'); list.innerHTML = '';
  state.enemies.forEach(e => {
    const card    = document.createElement('div'); card.className = 'entity-card';
    const actions = isDM()
      ? `<button class="btn btn-outline btn-sm" onclick="window._g.openEnemyModal('${e.id}')">${ICONS.pencil} Editar</button><button class="btn btn-outline btn-sm" onclick="window._g.cloneEnemy('${e.id}')" title="Clonar">${ICONS.copy} Clonar</button><button class="btn btn-danger btn-sm" onclick="window._g.deleteEnemy('${e.id}')">${ICONS.x} Borrar</button>`
      : '';
    card.innerHTML = `
      <div class="entity-card-info">
        <span class="entity-name">${e.name}</span>
        <span class="entity-meta">PV ${e.pv} | Armadura ${e.armor||'—'} | FUE ${e.fue} INT ${e.int} CAR ${e.car} DES ${e.des}</span>
      </div>
      <div class="entity-actions">${actions}</div>`;
    list.appendChild(card);
  });
  refreshCombatantSelects();
}

export function deleteEnemy(id) {
  showConfirm('¿Eliminar este tipo de enemigo?').then(ok => {
    if (!ok) return;
    state.enemies = state.enemies.filter(e => e.id !== id);
    saveState();
    renderEnemyList();
    showToast('Enemigo eliminado', 'info');
  });
}

export function cloneEnemy(id) {
  const src = state.enemies.find(e => e.id === id); if (!src) return;
  const cloned = Object.assign({}, src, { id: uid(), name: src.name + ' (copia)' });
  state.enemies.push(cloned);
  saveState();
  renderEnemyList();
  showToast('Enemigo clonado', 'success');
  openEnemyModal(cloned.id);
}
