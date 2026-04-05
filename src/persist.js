// persist.js — Firestore sync: saveState, loadState, startRealtimeSync, startUsersRealtimeSync
import { db, CAMPAIGNS_INDEX_DOC, APP_USERS_DOC, doc, getDoc, setDoc, onSnapshot } from './firebase.js';
import {
  state, setState, currentUser, setCurrentUser, globalUsers, setGlobalUsers,
  currentCampaignId, setCurrentCampaignId, _ignoreNext, setIgnoreNext,
  _unsubscribe, setUnsubscribe, _usersUnsubscribe, setUsersUnsubscribe,
  _saveTimeout, setSaveTimeout,
  campaigns, setCampaigns,
  normalizeState, emptyState, getCurrentStateDoc
} from './state.js';
import { setSaveIndicator, showLoadingOverlay } from './ui.js';
import { sanitizeUsers } from './users.js';

// Debounced Firestore write (1.5s). Clones state to remove circular refs.
export function saveState() {
  const stateDoc = getCurrentStateDoc();
  if (!stateDoc) return;
  clearTimeout(_saveTimeout);
  setSaveIndicator('saving');
  setSaveTimeout(setTimeout(async () => {
    try {
      setIgnoreNext(true);
      await setDoc(stateDoc, JSON.parse(JSON.stringify(state)));
      setSaveIndicator('saved');
    } catch (e) { console.error('Firestore write:', e); setSaveIndicator(''); }
  }, 1500));
}

// Full campaign state load. Shows loading overlay while waiting.
export async function loadState(campaignId) {
  setCurrentCampaignId(campaignId);
  const stateDoc = getCurrentStateDoc();
  if (!stateDoc) return;
  showLoadingOverlay(true);
  try {
    const snap = await getDoc(stateDoc);
    setState(snap.exists() ? normalizeState(snap.data()) : emptyState());
  } catch (e) { console.error('Firestore read:', e); }
  showLoadingOverlay(false);
}

// Loads campaign catalog from Firestore, migrating from legacy format if needed.
export async function ensureCampaignCatalog() {
  const { LEGACY_STATE_DOC } = await import('./firebase.js');
  const indexSnap = await getDoc(CAMPAIGNS_INDEX_DOC);
  if (indexSnap.exists() && Array.isArray(indexSnap.data().campaigns) && indexSnap.data().campaigns.length) {
    setCampaigns(indexSnap.data().campaigns);
    return;
  }

  const legacySnap = await getDoc(LEGACY_STATE_DOC);
  const defaultId   = 'principal';
  const defaultName = 'Campaña Principal';
  const migrated    = legacySnap.exists() ? normalizeState(legacySnap.data()) : emptyState();
  const migratedUsers = sanitizeUsers(migrated.users || []);

  await setDoc(doc(db, 'campaigns', defaultId), JSON.parse(JSON.stringify(migrated)));
  setCampaigns([{ id: defaultId, name: defaultName, archived: false }]);
  await saveCampaignCatalog();
  await ensureGlobalUsers(migratedUsers);
}

export async function saveCampaignCatalog() {
  const { campaigns: c } = await import('./state.js');
  await setDoc(CAMPAIGNS_INDEX_DOC, { campaigns: c }, { merge: true });
}

export async function ensureGlobalUsers(seedUsers = []) {
  const usersSnap = await getDoc(APP_USERS_DOC);
  if (usersSnap.exists() && Array.isArray(usersSnap.data().users) && usersSnap.data().users.length) {
    setGlobalUsers(sanitizeUsers(usersSnap.data().users));
    return;
  }
  let seed = Array.isArray(seedUsers) ? [...seedUsers] : [];
  if (!seed.length && campaigns.length) {
    const first = campaigns.find(c => !c.archived) || campaigns[0];
    if (first?.id) {
      const snap = await getDoc(doc(db, 'campaigns', first.id));
      if (snap.exists()) seed = Array.isArray(snap.data().users) ? snap.data().users : [];
    }
  }
  setGlobalUsers(sanitizeUsers(seed));
  await saveGlobalUsers();
}

export async function saveGlobalUsers() {
  const { globalUsers: u } = await import('./state.js');
  setGlobalUsers(sanitizeUsers(u));
  await setDoc(APP_USERS_DOC, { users: u }, { merge: true });
}

export async function migrateLegacyUsersToGlobal() {
  const { LEGACY_STATE_DOC: LCD } = await import('./firebase.js');
  const candidates = [];
  try {
    const s = await getDoc(LCD);
    if (s.exists() && Array.isArray(s.data().users)) candidates.push(...s.data().users);
  } catch (e) { console.error('Legacy users migration read error:', e); }
  for (const c of campaigns) {
    if (!c?.id) continue;
    try {
      const snap = await getDoc(doc(db, 'campaigns', c.id));
      if (snap.exists() && Array.isArray(snap.data().users)) candidates.push(...snap.data().users);
    } catch (e) { console.error('Campaign users migration read error:', c.id, e); }
  }
  if (!candidates.length) return;
  const before  = sanitizeUsers(globalUsers);
  const merged  = sanitizeUsers([...before, ...candidates]);
  if (merged.length !== before.length) {
    setGlobalUsers(merged);
    await saveGlobalUsers();
  }
}

// Real-time Firestore listener. Calls onStateChange() on external updates.
// Calls onLogout() when the current user is no longer in globalUsers.
export function startRealtimeSync(onStateChange, onLogout) {
  if (_unsubscribe) _unsubscribe();
  const stateDoc = getCurrentStateDoc();
  if (!stateDoc) return;
  setUnsubscribe(onSnapshot(stateDoc, snap => {
    if (_ignoreNext) { setIgnoreNext(false); return; }
    if (!snap.exists()) return;
    setState(normalizeState(snap.data()));
    if (currentUser && !globalUsers.find(u => u.id === currentUser.id)) {
      onLogout?.(); return;
    }
    if (currentUser) setCurrentUser(globalUsers.find(u => u.id === currentUser.id) || currentUser);
    onStateChange?.();
  }, err => { console.error('Firestore onSnapshot error:', err); }));
}

// Real-time listener for globalUsers. Calls onChangeCallback() on update.
export function startUsersRealtimeSync(onChangeCallback, onLogout) {
  if (_usersUnsubscribe) _usersUnsubscribe();
  setUsersUnsubscribe(onSnapshot(APP_USERS_DOC, snap => {
    if (!snap.exists()) return;
    const data = snap.data();
    setGlobalUsers(sanitizeUsers(data.users || []));
    if (currentUser && !globalUsers.find(u => u.id === currentUser.id)) { onLogout?.(); return; }
    if (currentUser) setCurrentUser(globalUsers.find(u => u.id === currentUser.id) || currentUser);
    onChangeCallback?.();
  }, err => { console.error('Users onSnapshot error:', err); }));
}
