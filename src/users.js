// users.js — Global user management + CRUD
import { uid, hashPassword } from './utils.js';
import { state, globalUsers, setGlobalUsers, currentUser } from './state.js';
import { showToast, showConfirm, openModal, closeModal } from './ui.js';
import { ICONS } from './icons.js';
// NOTE: saveGlobalUsers is imported from persist.js at function-call time via dynamic import
// to avoid a circular dependency (persist.js imports sanitizeUsers from this module).

// ===== NORMALIZE / SANITIZE =====
export function normalizeUser(u) {
  return {
    id:           u?.id             || uid(),
    username:     (u?.username      || '').trim(),
    passwordHash: u?.passwordHash   || hashPassword('dm1234'),
    isDM:         !!u?.isDM,
    charId:       u?.charId         || null
  };
}

export function sanitizeUsers(users) {
  const seen = new Set();
  const out  = [];
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

// ===== CRUD =====
let editingUserId = null;

export function openUserModal(id) {
  editingUserId = id || null;
  const u = id ? globalUsers.find(x => x.id === id) : null;
  document.getElementById('modal-user-title').textContent = id ? 'Editar Usuario' : 'Nuevo Usuario';
  document.getElementById('uf-username').value = u?.username || '';
  document.getElementById('uf-password').value = '';
  document.getElementById('uf-is-dm').checked  = u ? !!u.isDM : false;
  const sel = document.getElementById('uf-char');
  if (sel) {
    sel.innerHTML = '<option value="">— Sin personaje —</option>';
    (state.chars || []).forEach(c => {
      const o = document.createElement('option');
      o.value = c.id; o.textContent = c.name;
      if (u?.charId === c.id) o.selected = true;
      sel.appendChild(o);
    });
  }
  openModal('modal-user');
}

export function saveUser() {
  const username = document.getElementById('uf-username').value.trim();
  const pwRaw    = document.getElementById('uf-password').value;
  const isDM     = document.getElementById('uf-is-dm').checked;
  const charId   = document.getElementById('uf-char')?.value || null;
  if (!username) { showToast('El nombre de usuario es obligatorio', 'error'); return; }

  const duplicate = globalUsers.find(u => u.username.toLowerCase() === username.toLowerCase() && u.id !== editingUserId);
  if (duplicate) { showToast('Ya existe un usuario con ese nombre', 'error'); return; }

  if (editingUserId) {
    const existing = globalUsers.find(u => u.id === editingUserId);
    if (!existing) return;
    existing.username = username;
    if (pwRaw) existing.passwordHash = hashPassword(pwRaw);
    existing.isDM   = isDM;
    existing.charId = charId || null;
  } else {
    globalUsers.push({ id: uid(), username, passwordHash: hashPassword(pwRaw || 'dm1234'), isDM, charId: charId || null });
  }

  import('./persist.js').then(m => m.saveGlobalUsers());
  closeModal('modal-user');
  renderUserList();
  showToast('Usuario guardado', 'success');
}

export function renderUserList() {
  const list = document.getElementById('user-list');
  if (!list) return;
  list.innerHTML = '';
  if (!globalUsers.length) {
    list.innerHTML = '<div class="empty-state">No hay usuarios registrados.</div>';
    return;
  }
  globalUsers.forEach(u => {
    const card = document.createElement('div');
    card.className = 'entity-card';
    card.innerHTML = `
      <div class="entity-card-info">
        <span class="entity-name">${u.username}</span>
        <span class="entity-meta">${u.isDM ? `${ICONS.swords} DM` : `${ICONS.shield} Jugador`}</span>
      </div>
      <div class="entity-actions">
        <button class="btn btn-outline btn-sm" onclick="openUserModal('${u.id}')">${ICONS.pencil} Editar</button>
        <button class="btn btn-danger btn-sm" ${u.id === currentUser?.id ? 'disabled title="No puedes eliminarte a ti mismo"' : `onclick="deleteUser('${u.id}')"`}>${ICONS.x} Borrar</button>
      </div>`;
    list.appendChild(card);
  });
}

export function deleteUser(id) {
  if (id === currentUser?.id) { showToast('No puedes eliminarte a ti mismo', 'error'); return; }
  showConfirm('¿Eliminar usuario?').then(ok => {
    if (!ok) return;
    const idx = globalUsers.findIndex(u => u.id === id);
    if (idx === -1) return;
    globalUsers.splice(idx, 1);
    import('./persist.js').then(m => m.saveGlobalUsers());
    renderUserList();
    showToast('Usuario eliminado', 'info');
  });
}
