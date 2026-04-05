// state.js — Mutable app state + setters + helpers
import { db, doc } from './firebase.js';

// ===== MUTABLE STATE (exported as let for live-binding reads) =====
export let state        = emptyState();
export let campaigns    = [];
export let globalUsers  = [];
export let currentCampaignId = null;
export let currentUser  = null;
export let _saveTimeout = null;
export let _unsubscribe = null;
export let _usersUnsubscribe = null;
export let _ignoreNext  = false;
export let _playerPreview = false;

// ===== SETTERS =====
export function setState(v)             { state = v; }
export function setCampaigns(v)         { campaigns = v; }
export function setGlobalUsers(v)       { globalUsers = v; }
export function setCurrentCampaignId(v) { currentCampaignId = v; }
export function setCurrentUser(v)       { currentUser = v; }
export function setSaveTimeout(v)       { _saveTimeout = v; }
export function setUnsubscribe(v)       { _unsubscribe = v; }
export function setUsersUnsubscribe(v)  { _usersUnsubscribe = v; }
export function setIgnoreNext(v)        { _ignoreNext = v; }
export function setPlayerPreview(v)     { _playerPreview = v; }

// ===== STATE HELPERS =====
export function emptyState() {
  return {
    sessions: [], chars: [], enemies: [], users: [],
    estados: [], actos: [], eventos: [],
    playerNotes: {}, encounteredEnemies: []
  };
}

export function normalizeState(data) {
  return {
    sessions:          data?.sessions          || [],
    chars:             data?.chars             || [],
    enemies:           data?.enemies           || [],
    users:             data?.users             || [],
    estados:           data?.estados           || [],
    actos:             data?.actos             || [],
    eventos:           data?.eventos           || [],
    playerNotes:       data?.playerNotes       || {},
    encounteredEnemies: data?.encounteredEnemies || []
  };
}

export function getCurrentStateDoc() {
  return currentCampaignId ? doc(db, 'campaigns', currentCampaignId) : null;
}

// Returns player data normalized (notes, bestiary, inventory).
// Migrates legacy string format to new object format automatically.
export function getPlayerData(userId) {
  const raw = state.playerNotes[userId];
  if (!raw || typeof raw === 'string') {
    return { notes: (typeof raw === 'string' ? raw : ''), bestiary: {}, inventory: Array(10).fill('') };
  }
  const inv = Array.isArray(raw.inventory) ? raw.inventory : [];
  return {
    notes:     raw.notes     || '',
    bestiary:  raw.bestiary  || {},
    inventory: [...inv, ...Array(10).fill('')].slice(0, 10)
  };
}

export function isDM()     { return !!(currentUser && currentUser.isDM && !_playerPreview); }
export function isRealDM() { return !!(currentUser && currentUser.isDM); }
export function getSession(id) { return state.sessions.find(s => s.id === id); }
