// auth.js — Login, logout, role UI, player preview toggle
import { hashPassword } from './utils.js';
import {
  state, currentUser, setCurrentUser, globalUsers, _playerPreview, setPlayerPreview,
  _unsubscribe, setUnsubscribe, _usersUnsubscribe, setUsersUnsubscribe,
  emptyState, setState, isDM, isRealDM, currentCampaignId
} from './state.js';
import { campaigns } from './state.js';
import { loadState, startRealtimeSync, startUsersRealtimeSync } from './persist.js';
import { applyCampaignBranding, applyDeskSubtitle, renderCampaignSelect } from './campaigns.js';
import { showToast } from './ui.js';

export async function doLogin() {
  const campaignId = document.getElementById('login-campaign')?.value || '';
  const username   = document.getElementById('login-user').value.trim();
  const password   = document.getElementById('login-pass').value;
  const errEl      = document.getElementById('login-error');
  const hasActiveCampaigns = campaigns.some(c => !c.archived);
  if (!campaignId && hasActiveCampaigns) { errEl.textContent = 'Selecciona una campaña.'; return; }
  if (!username || !password) { errEl.textContent = 'Introduce usuario y contraseña.'; return; }
  if (campaignId && currentCampaignId !== campaignId) await loadState(campaignId);

  const hash = hashPassword(password);
  const user = globalUsers.find(u => u.username === username && u.passwordHash === hash);
  if (!user) { errEl.textContent = 'Usuario o contraseña incorrectos.'; return; }
  setCurrentUser(user);
  errEl.textContent = '';
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('login-pass').value = '';
  if (campaignId) sessionStorage.setItem('ljhd_campaign', campaignId);
  sessionStorage.setItem('ljhd_user', user.id);

  applyRoleUI();

  // Lazy-load rendering modules to avoid circular deps at init time
  const { rebuildSessionTabs, renderSessionList } = await import('./sessions.js');
  const { renderCharList }   = await import('./characters.js');
  const { renderEnemyList }  = await import('./enemies.js');
  const { renderCampaignList } = await import('./campaigns.js');
  const { renderUserList }   = await import('./users.js');
  const { renderMaintLanding, switchView } = await import('./views.js');

  rebuildSessionTabs();
  renderCharList(); renderEnemyList(); renderUserList(); renderCampaignList();

  if (!campaignId) {
    if (!user.isDM) {
      setCurrentUser(null);
      document.getElementById('login-screen').classList.remove('hidden');
      errEl.textContent = 'No hay campañas activas. Contacta al Director de Juego.';
      return;
    }
    switchView('maint');
  } else {
    switchView('landing');
    startRealtimeSync(
      async () => {
        const { rebuildSessionTabs: rb } = await import('./sessions.js');
        const { renderCharList: rcl }    = await import('./characters.js');
        const { renderEnemyList: rel }   = await import('./enemies.js');
        const { renderUserList: rul }    = await import('./users.js');
        const { renderEstadoList }  = await import('./estados.js');
        const { renderActoList }    = await import('./actos.js');
        const { renderEventoList }  = await import('./eventos.js');
        const { renderCampaignList: rca } = await import('./campaigns.js');
        const { renderCharSheetView }  = await import('./characters.js');
        const { renderSessionActos }   = await import('./session-view.js');
        const { renderActiveSessions, renderSessionList: rsl } = await import('./views.js');
        rb(); rcl(); rel();
        if (isDM()) { rul(); renderEstadoList(); renderActoList(); renderEventoList(); rca(); }
        applyRoleUI();
        document.querySelectorAll('.view[data-session-id]').forEach(view => {
          const s = state.sessions.find(x => x.id === view.dataset.sessionId);
          if (s) renderSessionActos(s, view);
        });
        const activeView = document.querySelector('.view.active');
        const onCharsheet = activeView?.id === 'view-charsheet';
        const onSessions  = activeView?.id === 'view-sessions-list';
        const onMaint     = activeView?.id === 'view-maint';
        if (onCharsheet  || (!isDM() && currentUser?.charId)) {
          const csChar = currentUser?.charId ? state.chars.find(c => c.id === currentUser.charId) : null;
          if (onCharsheet || csChar) renderCharSheetView(csChar);
        }
        if (onSessions) renderActiveSessions();
        if (onMaint)    rsl();
      },
      () => doLogout()
    );
  }
  startUsersRealtimeSync(
    async () => {
      const { renderUserList: rul } = await import('./users.js');
      const { renderMaintLanding: rml } = await import('./views.js');
      rul(); rml(); applyRoleUI();
    },
    () => doLogout()
  );
}

export async function doLogout() {
  const { _unsubscribe: u, setUnsubscribe: su, _usersUnsubscribe: uu, setUsersUnsubscribe: suu } = await import('./state.js');
  if (u) { u(); su(null); }
  if (uu) { uu(); suu(null); }
  sessionStorage.removeItem('ljhd_campaign');
  sessionStorage.removeItem('ljhd_user');
  setCurrentUser(null);
  setState(emptyState());
  document.querySelectorAll('#main-content .view[data-session-id]').forEach(v => v.remove());
  document.getElementById('login-user').value  = '';
  document.getElementById('login-pass').value  = '';
  document.getElementById('login-error').textContent = '';
  const sel = document.getElementById('login-campaign');
  if (sel) sel.value = campaigns.find(c => !c.archived)?.id || '';
  const badge = document.getElementById('campaign-badge');
  if (badge) badge.textContent = '—';
  applyCampaignBranding(); applyDeskSubtitle();
  document.getElementById('login-screen').classList.remove('hidden');
}

export function applyRoleUI() {
  const dm     = isDM();
  const realDM = isRealDM();
  applyDeskSubtitle();

  const badge = document.getElementById('user-badge');
  if (badge) badge.innerHTML = realDM
    ? (_playerPreview
        ? `<span class="role-player">👁 Vista Jugador</span>`
        : `<span class="role-dm">⚔ DM</span> &nbsp;${currentUser.username}`)
    : `${currentUser.username} &nbsp;<span class="role-player">Jugador</span>`;

  document.querySelectorAll('.dm-only-ctrl').forEach(el => { el.style.display = dm ? '' : 'none'; });
  const maintTab      = document.getElementById('tab-maint');
  const charsheetTab  = document.getElementById('tab-charsheet');
  if (maintTab)     maintTab.style.display    = dm ? '' : 'none';
  if (charsheetTab) charsheetTab.style.display = !dm ? '' : 'none';
  const togBtn = document.getElementById('preview-toggle');
  if (togBtn) togBtn.style.display = realDM ? '' : 'none';
  const panel = document.getElementById('player-char-panel');
  if (panel) panel.style.display = 'none';
}

export async function togglePlayerPreview() {
  if (!isRealDM()) return;
  setPlayerPreview(!_playerPreview);
  const btn = document.getElementById('preview-toggle');
  const lbl = document.getElementById('preview-label');
  if (btn) btn.classList.toggle('active', _playerPreview);
  if (lbl) lbl.textContent = _playerPreview ? 'Vista DM' : 'Vista jugador';
  const { rebuildSessionTabs }  = await import('./sessions.js');
  const { renderCharList }      = await import('./characters.js');
  const { renderEnemyList }     = await import('./enemies.js');
  const { switchView }          = await import('./views.js');
  rebuildSessionTabs(); renderCharList(); renderEnemyList();
  applyRoleUI(); switchView('landing');
}
