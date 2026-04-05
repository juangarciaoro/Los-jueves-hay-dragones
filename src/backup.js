// backup.js — Export / Import campaign data
import { state, currentCampaignId, globalUsers, setGlobalUsers, setIgnoreNext, getCurrentStateDoc } from './state.js';
import { saveGlobalUsers } from './persist.js';
import { sanitizeUsers } from './users.js';
import { getCurrentCampaignName, getBrandName } from './campaigns.js';
import { slugifyCampaignName } from './utils.js';
import { showToast } from './ui.js';
import { setDoc } from './firebase.js';

export function exportData() {
  // Flush open text fields before serializing
  state.sessions.forEach(session => {
    const view = document.getElementById('view-' + session.id); if (!view) return;
    view.querySelectorAll('[data-field]').forEach(el => {
      if (!el.hasAttribute('readonly')) session[el.dataset.field] = el.value;
    });
  });
  const payload = {
    campaignId:   currentCampaignId,
    campaignName: getCurrentCampaignName(),
    exportedAt:   new Date().toISOString(),
    data:         state
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const safeName = slugifyCampaignName(getBrandName()) || 'campaña';
  const a = document.createElement('a'); a.href = url; a.download = `${safeName}.json`; a.click();
  URL.revokeObjectURL(url);
  showToast('Copia exportada', 'success');
}

export async function importData(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const imported     = JSON.parse(e.target.result);
      const importedData = imported.data ? imported.data : imported;

      // Merge any legacy users from backup into global users
      if (Array.isArray(importedData.users) && importedData.users.length) {
        const merged = sanitizeUsers([...(globalUsers || []), ...importedData.users]);
        setGlobalUsers(merged);
        await saveGlobalUsers();
      }

      state.sessions    = importedData.sessions    || [];
      state.chars       = importedData.chars       || [];
      state.enemies     = importedData.enemies     || [];
      state.estados     = importedData.estados     || [];
      state.actos       = importedData.actos       || [];
      state.eventos     = importedData.eventos     || [];
      state.playerNotes = importedData.playerNotes || {};

      setIgnoreNext(true);
      await setDoc(getCurrentStateDoc(), JSON.parse(JSON.stringify(state)));

      // Rebuild all UI
      const [sessions, chars, enemies, users, campaigns, views] = await Promise.all([
        import('./sessions.js'),
        import('./characters.js'),
        import('./enemies.js'),
        import('./users.js'),
        import('./campaigns.js'),
        import('./views.js'),
      ]);
      sessions.rebuildSessionTabs();
      chars.renderCharList();
      enemies.renderEnemyList();
      users.renderUserList();
      campaigns.renderCampaignList();
      views.switchView('maint');
      showToast('Datos importados correctamente', 'success');
    } catch (err) {
      alert('Error al importar: ' + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}
