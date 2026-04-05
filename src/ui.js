// ui.js — DOM helpers: modal, toast, confirm dialog, loading overlay, save indicator

// ===== MODAL =====
export function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.add('open'); el.style.display = 'flex'; }
}

export function closeModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.remove('open'); el.style.display = 'none'; }
}

// ===== SAVE INDICATOR =====
export function setSaveIndicator(status) {
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

// ===== LOADING OVERLAY =====
export function showLoadingOverlay(show) {
  const el = document.getElementById('loading-overlay');
  if (!el) return;
  el.style.display = show ? 'flex' : 'none';
}

// ===== TOAST =====
export function showToast(msg, type = 'info') {
  const container = document.getElementById('toast');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast-msg ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 2700);
}

// ===== CONFIRM DIALOG =====
// Returns a Promise that resolves true (confirm) or false (cancel).
export function showConfirm(msg) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.style.zIndex = '600';
    overlay.innerHTML = `
      <div class="modal" style="max-width:380px">
        <div class="modal-header">Confirmar</div>
        <div class="modal-body" style="font-family:'Crimson Text',serif;font-size:1rem;color:var(--text)">${msg}</div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="_conf-cancel">Cancelar</button>
          <button class="btn btn-danger"  id="_conf-ok">Eliminar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector('#_conf-ok').addEventListener('click', () => close(true));
    overlay.querySelector('#_conf-cancel').addEventListener('click', () => close(false));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
  });
}
