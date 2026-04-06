// main.js — Entry point: boot, event listeners, window._g assignments
import {
  state, campaigns, globalUsers,
  currentUser, setCurrentUser,
  _unsubscribe, setUnsubscribe,
  _usersUnsubscribe, setUsersUnsubscribe,
  normalizeState, getCurrentStateDoc
} from './state.js';
import {
  ensureCampaignCatalog, ensureGlobalUsers, migrateLegacyUsersToGlobal,
  loadState, startRealtimeSync, startUsersRealtimeSync
} from './persist.js';
import { renderCampaignSelect, applyDeskSubtitle, renderCampaignList, getBrandName, openCampaignModal, saveCampaign, toggleCampaignArchived, switchToCampaign } from './campaigns.js';
import { doLogin, doLogout, applyRoleUI, togglePlayerPreview } from './auth.js';
import { switchView, switchMaintTab, switchMaintSection, renderMaintLanding, renderLandingPage, renderActiveSessions, setEditSessionId } from './views.js';
import { rebuildSessionTabs, renderSessionList, deleteSession, openNewSessionModal, createSession, openPrepareCombatsModal, savePrepareCombats, toggleSessionPublished, openSessionEdit, renderSessionEditView, moveActo, toggleEditEnemy } from './sessions.js';
import { renderSessionActos, openGalleryLightbox } from './session-view.js';
import { renderCombatantList, hideEnemyTooltip, applyHP, setTempHP, setCondInput, addConditionConfirm } from './combat.js';
import { openCharModal, saveChar, deleteChar, selectArmor, addHab, setSkill, setWeaponSkill, renderCharSheetView, renderCharList } from './characters.js';
import { openEnemyModal, saveEnemy, deleteEnemy, cloneEnemy, selectEnemyArmor, renderEnemyList } from './enemies.js';
import { openUserModal, saveUser, deleteUser, renderUserList } from './users.js';
import { exportData, importData } from './backup.js';
import { addEstado, deleteEstado, renderEstadoList } from './estados.js';
import { openActoModal, saveActo, deleteActo, clearActoImage } from './actos.js';
import { openEventoModal, saveEvento, deleteEvento, onEventoSessionChange } from './eventos.js';
import { openSpectatorWindow } from './spectator.js';
import { openModal, closeModal, showLoadingOverlay, showToast, showConfirm } from './ui.js';
import { filterList } from './utils.js';

// ===========================
//  BOOT
// ===========================
(async () => {
  const qs              = new URLSearchParams(window.location.search);
  const spectatorId     = qs.get('spectator');
  const spectatorCampaign = qs.get('campaign');

  if (spectatorId) {
    const { initSpectatorMode } = await import('./spectator.js');
    await initSpectatorMode(spectatorId, spectatorCampaign);
    return;
  }

  try {
    await ensureCampaignCatalog();
    await ensureGlobalUsers();
    await migrateLegacyUsersToGlobal();
  } catch (e) {
    console.error('Error al conectar con la base de datos:', e);
    const errEl = document.getElementById('login-error');
    if (errEl) errEl.textContent = 'Error de conexión. Comprueba tu red e intenta de nuevo.';
  }
  renderCampaignSelect();
  applyDeskSubtitle();

  const campaignSelect = document.getElementById('login-campaign');
  if (campaignSelect) {
    campaignSelect.addEventListener('change', async () => {
      const selected = campaignSelect.value;
      if (!selected) return;
      sessionStorage.setItem('ljhd_campaign', selected);
      await loadState(selected);
      document.getElementById('login-error').textContent = '';
    });
    if (campaignSelect.value) await loadState(campaignSelect.value);
  }

  // Restore session after page refresh
  const savedCampaign = sessionStorage.getItem('ljhd_campaign');
  const savedId       = sessionStorage.getItem('ljhd_user');
  if (savedCampaign && campaigns.some(c => c.id === savedCampaign && !c.archived)) {
    await loadState(savedCampaign);
    if (campaignSelect) campaignSelect.value = savedCampaign;
  }
  if (savedCampaign && savedId) {
    const user = globalUsers.find(u => u.id === savedId);
    if (user) {
      setCurrentUser(user);

      // onStateChange callback for startRealtimeSync
      // (persist.js already called setState before invoking this)
      function onStateChange() {
        rebuildSessionTabs();
        renderCharList();
        renderEnemyList();
        renderUserList();
        renderCampaignList();
        // Refresh open session views
        document.querySelectorAll('.view[data-session-id]').forEach(view => {
          const s = state.sessions.find(x => x.id === view.dataset.sessionId);
          if (s) renderCombatantList(s, view);
        });
      }
      function onLogout() { doLogout(); }

      applyRoleUI();
      rebuildSessionTabs();
      renderCharList();
      renderEnemyList();
      renderUserList();
      renderCampaignList();
      switchView('landing');
      document.getElementById('login-screen').classList.add('hidden');
      startRealtimeSync(onStateChange, onLogout);
      startUsersRealtimeSync(
        newUsers => { /* users updated; renderUserList picks from globalUsers */ renderUserList(); },
        onLogout
      );
    }
  }
  renderCampaignList();
})();

// ===========================
//  GLOBAL EVENT LISTENERS
// ===========================
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });
});

document.getElementById('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
document.getElementById('login-user').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('login-pass').focus(); });

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const open = document.querySelector('.modal-overlay.open');
    if (open) open.classList.remove('open');
    hideEnemyTooltip();
  }
});

document.addEventListener('click', e => {
  const tip = document.getElementById('enemy-stat-tooltip');
  if (tip && tip.classList.contains('visible') && !tip.contains(e.target) && !e.target.classList.contains('enemy-info-btn')) {
    hideEnemyTooltip();
  }
});

// ===========================
//  window._g — Expose for HTML onclick handlers (static + dynamic)
//  window._g === window so bare `doLogin()` calls in HTML work without a namespace prefix
// ===========================
window._g    = window;
const _g     = window;
_g.doLogin               = doLogin;
_g.doLogout              = doLogout;
_g.renderSessionActos    = renderSessionActos;
_g.switchView            = switchView;
_g.switchMaintTab        = switchMaintTab;
_g.switchMaintSection    = switchMaintSection;
_g.openNewSessionModal   = openNewSessionModal;
_g.createSession         = createSession;
_g.deleteSession         = deleteSession;
_g.openCharModal         = openCharModal;
_g.saveChar              = saveChar;
_g.deleteChar            = deleteChar;
_g.openEnemyModal        = openEnemyModal;
_g.saveEnemy             = saveEnemy;
_g.deleteEnemy           = deleteEnemy;
_g.cloneEnemy            = cloneEnemy;
_g.hideEnemyTooltip      = hideEnemyTooltip;
_g.openUserModal         = openUserModal;
_g.saveUser              = saveUser;
_g.deleteUser            = deleteUser;
_g.exportData            = exportData;
_g.importData            = importData;
_g.selectArmor           = selectArmor;
_g.selectEnemyArmor      = selectEnemyArmor;
_g.addHab                = addHab;
_g.setSkill              = setSkill;
_g.setWeaponSkill        = setWeaponSkill;
_g.applyHP               = applyHP;
_g.setTempHP             = setTempHP;
_g.setCondInput          = setCondInput;
_g.addConditionConfirm   = addConditionConfirm;
_g.closeModal            = closeModal;
_g.openModal             = openModal;
_g.renderCharSheetView   = renderCharSheetView;
_g.togglePlayerPreview   = togglePlayerPreview;
_g.renderLandingPage     = renderLandingPage;
_g.renderActiveSessions  = renderActiveSessions;
_g.addEstado             = addEstado;
_g.deleteEstado          = deleteEstado;
_g.renderEstadoList      = renderEstadoList;
_g.openActoModal         = openActoModal;
_g.saveActo              = saveActo;
_g.deleteActo            = deleteActo;
_g.clearActoImage        = clearActoImage;
_g.openEventoModal       = openEventoModal;
_g.saveEvento            = saveEvento;
_g.deleteEvento          = deleteEvento;
_g.onEventoSessionChange = onEventoSessionChange;
_g.openSpectatorWindow   = openSpectatorWindow;
_g.openPrepareCombatsModal  = openPrepareCombatsModal;
_g.savePrepareCombats       = savePrepareCombats;
_g.toggleSessionPublished   = toggleSessionPublished;
_g.openSessionEdit          = openSessionEdit;
_g.renderSessionEditView    = renderSessionEditView;
_g.toggleEditEnemy          = toggleEditEnemy;
_g.moveActo                 = moveActo;
_g.openCampaignModal        = openCampaignModal;
_g.saveCampaign             = saveCampaign;
_g.toggleCampaignArchived   = toggleCampaignArchived;
_g.switchToCampaign         = switchToCampaign;
_g.showToast                = showToast;
_g.showConfirm              = showConfirm;
_g.filterList               = filterList;
