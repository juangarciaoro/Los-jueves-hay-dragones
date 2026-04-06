// campaigns.js — Campaign catalog + branding + CRUD
import { getUniqueCampaignId } from './utils.js';
import { db, doc, setDoc, CAMPAIGNS_INDEX_DOC } from './firebase.js';
import { campaigns, currentCampaignId, currentUser, isDM } from './state.js';
import { showToast, openModal, closeModal } from './ui.js';
import { ICONS } from './icons.js';

export function getCurrentCampaignName() {
  const c = campaigns.find(x => x.id === currentCampaignId);
  return c ? c.name : '—';
}

function getSelectedCampaignName() {
  const sel = document.getElementById('login-campaign');
  if (!sel || sel.selectedIndex < 0) return '';
  return sel.options[sel.selectedIndex]?.textContent?.trim() || '';
}

export function getBrandName() {
  const current = getCurrentCampaignName();
  if (current && current !== '—') return current;
  return getSelectedCampaignName() || 'Campaña';
}

export function applyCampaignBranding() {
  const brand = getBrandName();
  ['brand-login','brand-header','brand-landing','brand-spectator','brand-loading'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = brand;
  });
  document.title = brand;
}

export function getDeskSubtitle() {
  if (!currentUser) return 'Mesa del Director de Juego';
  return isDM() ? 'Mesa del Director de Juego' : 'Mesa de Jugador';
}

export function applyDeskSubtitle() {
  const text = currentUser ? getDeskSubtitle() : 'Mesa del Director de Juego';
  const loginSub   = document.getElementById('brand-sub-login');
  const headerSub  = document.getElementById('brand-sub-header');
  const landingSub = document.getElementById('brand-sub-landing');
  if (loginSub)   loginSub.textContent   = 'Mesa del Director de Juego';
  if (headerSub)  headerSub.textContent  = text;
  if (landingSub) landingSub.textContent = text;
}

export function renderCampaignSelect() {
  const sel = document.getElementById('login-campaign');
  if (!sel) return;
  const available = campaigns.filter(c => !c.archived);
  sel.innerHTML = '';
  if (!available.length) {
    const o = document.createElement('option');
    o.value = ''; o.textContent = 'No hay campañas activas'; sel.appendChild(o);
    sel.disabled = true;
    const hint = document.getElementById('login-no-campaigns-hint');
    if (hint) hint.style.display = '';
    applyCampaignBranding(); return;
  }
  const hint = document.getElementById('login-no-campaigns-hint');
  if (hint) hint.style.display = 'none';
  sel.disabled = false;
  available.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.name; sel.appendChild(o);
  });
  const saved = sessionStorage.getItem('ljhd_campaign');
  if (saved && available.some(c => c.id === saved)) sel.value = saved;
  else sel.value = available[0].id;
  applyCampaignBranding();
}

// ===== CAMPAIGN CRUD =====
let editingCampaignId = null;

export function renderCampaignList() {
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
    const isActive = c.id === currentCampaignId;
    card.innerHTML = `
      <div class="entity-card-info">
        <span class="entity-name">${c.name}${isActive ? ' <span style="color:var(--gold-light);font-size:.7rem">(activa)</span>':''}</span>
        <span class="entity-meta">${c.archived ? `${ICONS.archive} Archivada` : `${ICONS.map} Activa`}</span>
      </div>
      <div class="entity-actions">
        ${!isActive ? `<button class="btn btn-outline btn-sm" onclick="switchToCampaign('${c.id}')">Cambiar</button>` : ''}
        <button class="btn btn-outline btn-sm" onclick="openCampaignModal('${c.id}')">${ICONS.pencil} Editar</button>
        <button class="btn btn-outline btn-sm" onclick="toggleCampaignArchived('${c.id}')">${c.archived?'Restaurar':'Archivar'}</button>
      </div>`;
    list.appendChild(card);
  });
}

export function openCampaignModal(id) {
  editingCampaignId = id || null;
  const c = id ? campaigns.find(x => x.id === id) : null;
  document.getElementById('modal-campaign-title').textContent = id ? 'Editar Campaña' : 'Nueva Campaña';
  document.getElementById('camp-name').value = c?.name || '';
  openModal('modal-campaign');
}

export async function saveCampaign() {
  const name = document.getElementById('camp-name').value.trim();
  if (!name) { showToast('El nombre es obligatorio', 'error'); return; }
  if (editingCampaignId) {
    const c = campaigns.find(x => x.id === editingCampaignId);
    if (c) c.name = name;
  } else {
    const newId = getUniqueCampaignId(name, campaigns.map(c => c.id));
    campaigns.push({ id: newId, name, archived: false });
    // Create an empty state document for the new campaign
    await setDoc(doc(db, 'campaigns', newId), JSON.parse(JSON.stringify({ sessions:[], chars:[], enemies:[], users:[], estados:[], actos:[], eventos:[], playerNotes:{}, encounteredEnemies:[] })));
  }
  const { saveCampaignCatalog } = await import('./persist.js');
  await saveCampaignCatalog();
  closeModal('modal-campaign');
  renderCampaignList();
  renderCampaignSelect();
  showToast('Campaña guardada', 'success');
}

export async function toggleCampaignArchived(id) {
  const c = campaigns.find(x => x.id === id);
  if (!c) return;
  c.archived = !c.archived;
  const { saveCampaignCatalog } = await import('./persist.js');
  await saveCampaignCatalog();
  renderCampaignList();
  renderCampaignSelect();
  showToast(c.archived ? 'Campaña archivada' : 'Campaña restaurada', 'info');
}

export async function switchToCampaign(id) {
  if (id === currentCampaignId) return;
  const { loadState, startRealtimeSync } = await import('./persist.js');
  const { _unsubscribe, setUnsubscribe } = await import('./state.js');
  if (_unsubscribe) { _unsubscribe(); setUnsubscribe(null); }
  await loadState(id);
  sessionStorage.setItem('ljhd_campaign', id);
  const badge = document.getElementById('campaign-badge');
  if (badge) badge.textContent = getCurrentCampaignName();
  applyCampaignBranding();
  const { rebuildSessionTabs, renderSessionList } = await import('./sessions.js');
  const { renderCharList } = await import('./characters.js');
  const { renderEnemyList } = await import('./enemies.js');
  const { renderMaintLanding } = await import('./views.js');
  rebuildSessionTabs(); renderCharList(); renderEnemyList();
  renderCampaignList(); renderMaintLanding();
  startRealtimeSync(
    () => { rebuildSessionTabs(); renderCharList(); renderEnemyList(); },
    () => import('./auth.js').then(m => m.doLogout())
  );
  showToast(`Campaña activa: ${getCurrentCampaignName()}`, 'success');
}
