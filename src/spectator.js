// spectator.js — Read-only initiative display for secondary screens
import { state, setState, getCurrentStateDoc, normalizeState, currentCampaignId } from './state.js';
import { renderCombatantList } from './combat.js';
import { onSnapshot } from './firebase.js';

export function renderSpectatorView(sessionId) {
  const container = document.getElementById('spectator-view'); if (!container) return;
  const session   = state.sessions.find(s => s.id === sessionId);
  container.querySelector('.spectator-session-name').textContent =
    session ? (session.name || 'Iniciativa') : 'Sesión no encontrada';
  container.querySelector('.spectator-round-num').textContent =
    session ? (session.round || 1) : '—';
  if (session) renderCombatantList(session, container);
}

export function openSpectatorWindow(sessionId) {
  const params = new URLSearchParams({ spectator: sessionId, campaign: currentCampaignId || '' });
  const url    = window.location.pathname + '?' + params.toString();
  window.open(url, '_blank', 'noopener,noreferrer');
}

// Called during boot when ?spectator=ID is detected
export async function initSpectatorMode(spectatorId, spectatorCampaign) {
  if (!spectatorCampaign) {
    alert('Falta parámetro de campaña en modo espectador.');
    return;
  }
  document.body.classList.add('spectator-mode');
  const sv = document.getElementById('spectator-view');
  sv.style.display = 'flex';

  const { ensureCampaignCatalog, loadState } = await import('./persist.js');
  await ensureCampaignCatalog();
  await loadState(spectatorCampaign);
  renderSpectatorView(spectatorId);

  onSnapshot(getCurrentStateDoc(), snap => {
    if (!snap.exists()) return;
    setState(normalizeState(snap.data()));
    renderSpectatorView(spectatorId);
  }, err => console.error('Spectator sync error:', err));
}
