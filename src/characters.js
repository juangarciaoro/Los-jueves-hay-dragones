// characters.js — Character CRUD, skill grid, charsheet view
import { uid } from './utils.js';
import { state, isDM, currentUser, globalUsers } from './state.js';
import { saveState } from './persist.js';
import { saveGlobalUsers } from './persist.js';
import { openModal, closeModal, showConfirm, showToast } from './ui.js';
import { getSession } from './state.js';
import { renderCombatantChips } from './combat.js';

export const SKILLS = [
  { key:'nadar',       label:'Nadar / Bucear',      attr:'DES' },
  { key:'cerraduras',  label:'Abrir Cerraduras',     attr:'INT' },
  { key:'idiomas',     label:'Idiomas',              attr:'INT' },
  { key:'sigilo',      label:'Sigilo',               attr:'DES' },
  { key:'medicina',    label:'Medicina',             attr:'INT' },
  { key:'brutalidad',  label:'Brutalidad',           attr:'FUE' },
  { key:'observacion', label:'Observación',          attr:'INT' },
  { key:'intimidar',   label:'Intimidar',            attr:'CAR' },
  { key:'enganar',     label:'Engañar',              attr:'CAR' },
  { key:'persuasion',  label:'Persuasión',           attr:'CAR' },
  { key:'acrobacias',  label:'Acrobacias',           attr:'DES' },
  { key:'montar',      label:'Montar',               attr:'DES' },
  { key:'agarrar',     label:'Agarrar',              attr:'FUE' },
  { key:'reflejos',    label:'Reflejos',             attr:'DES' },
];

export const WEAPON_SKILLS = [
  { key:'espadas',       label:'Espadas' },
  { key:'dagas',         label:'Dagas' },
  { key:'arcos',         label:'Arcos' },
  { key:'mandobles',     label:'Mandobles' },
  { key:'hachas',        label:'Hachas' },
  { key:'contundentes',  label:'Armas Contundentes' },
  { key:'arrojadizas',   label:'Arrojadizas' },
  { key:'sin_armas',     label:'Sin Armas (daño /2)' },
];

export let editingCharId         = null;
export let currentArmorSel       = '';
export let charSkillState        = {};
export let charWeaponSkillState  = {};
export let charHabState          = {};

export function selectArmor(t) {
  currentArmorSel = currentArmorSel === t ? '' : t;
  ['L','M','P'].forEach(x => document.getElementById('armor-' + x).classList.toggle('sel', currentArmorSel === x));
}

export function addHab() {
  const list  = document.getElementById('cf-habs-list');
  const habId = 'hab-' + uid();
  const row   = document.createElement('div'); row.className = 'hab-row'; row.dataset.habId = habId;
  row.innerHTML = `<div style="width:100%;display:flex;flex-direction:column;gap:6px">
    <input class="form-input" placeholder="Nombre">
    <textarea class="form-input note-area" placeholder="Descripción…" style="min-height:60px"></textarea>
  </div>
  <div class="skill-cost-btns" style="display:flex;flex-direction:column;gap:4px;min-width:80px">
    <button type="button" class="cost-btn" data-hab-id="${habId}" data-level="1">●○○</button>
    <button type="button" class="cost-btn" data-hab-id="${habId}" data-level="5">●●○</button>
    <button type="button" class="cost-btn" data-hab-id="${habId}" data-level="15">●●●</button>
  </div>
  <button class="remove-btn" onclick="this.parentElement.remove()">✕</button>`;
  row.querySelectorAll('[data-level]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      const level = parseInt(btn.dataset.level);
      charHabState[habId] = charHabState[habId] === level ? 0 : level;
      row.querySelectorAll('[data-level]').forEach(b => b.classList.remove('sel1','sel5','sel15'));
      if      (charHabState[habId] === 1)  row.querySelector('[data-level="1"]').classList.add('sel1');
      else if (charHabState[habId] === 5)  row.querySelector('[data-level="5"]').classList.add('sel5');
      else if (charHabState[habId] === 15) row.querySelector('[data-level="15"]').classList.add('sel15');
    });
  });
  list.appendChild(row);
}

export function renderSkillsGrid() {
  const sg = document.getElementById('cf-skills-grid'); sg.innerHTML = '';
  SKILLS.forEach(sk => {
    const cur = charSkillState[sk.key] || 0;
    const row = document.createElement('div'); row.className = 'skill-row';
    row.innerHTML = `<span class="skill-attr">${sk.attr}</span><label>${sk.label}</label>
      <div class="skill-cost-btns">
        <button type="button" class="cost-btn ${cur===1?'sel1':''}" onclick="window._g.setSkill('${sk.key}',1)">1</button>
        <button type="button" class="cost-btn ${cur===5?'sel5':''}" onclick="window._g.setSkill('${sk.key}',5)">5</button>
        <button type="button" class="cost-btn ${cur===15?'sel15':''}" onclick="window._g.setSkill('${sk.key}',15)">15</button>
      </div>`;
    sg.appendChild(row);
  });
  const wg = document.getElementById('cf-weapon-skills-grid'); wg.innerHTML = '';
  WEAPON_SKILLS.forEach(sk => {
    const cur = charWeaponSkillState[sk.key] || 0;
    const row = document.createElement('div'); row.className = 'skill-row';
    row.innerHTML = `<span class="skill-attr"></span><label>${sk.label}</label>
      <div class="skill-cost-btns">
        <button type="button" class="cost-btn ${cur===1?'sel1':''}" onclick="window._g.setWeaponSkill('${sk.key}',1)">1</button>
        <button type="button" class="cost-btn ${cur===5?'sel5':''}" onclick="window._g.setWeaponSkill('${sk.key}',5)">5</button>
        <button type="button" class="cost-btn ${cur===15?'sel15':''}" onclick="window._g.setWeaponSkill('${sk.key}',15)">15</button>
      </div>`;
    wg.appendChild(row);
  });
}

export function setSkill(key, val) {
  charSkillState[key] = charSkillState[key] === val ? 0 : val;
  renderSkillsGrid();
}

export function setWeaponSkill(key, val) {
  charWeaponSkillState[key] = charWeaponSkillState[key] === val ? 0 : val;
  renderSkillsGrid();
}

export function openCharModal(id) {
  if (!isDM() && id && currentUser.charId !== id) return;
  editingCharId = id || null;
  charSkillState = {}; charWeaponSkillState = {}; charHabState = {}; currentArmorSel = '';
  document.getElementById('modal-char-title').textContent = id ? 'Editar Personaje' : 'Nuevo Personaje';
  const char = id ? state.chars.find(c => c.id === id) : null;
  ['name','player','class','race','align','height','age','pv','pm','gold','skillpts','notes'].forEach(f => {
    const el = document.getElementById('cf-' + f); if (el) el.value = char ? (char[f] || '') : '';
  });
  ['fue','int','car','des','vida'].forEach(a => {
    const el = document.getElementById('cf-' + a); if (el) el.value = char ? (char[a] || 10) : 10;
  });
  if (char) {
    charSkillState       = Object.assign({}, char.skills       || {});
    charWeaponSkillState = Object.assign({}, char.weaponSkills || {});
    currentArmorSel = char.armor || '';
  }
  ['L','M','P'].forEach(t => document.getElementById('armor-' + t).classList.toggle('sel', currentArmorSel === t));
  const habsList = document.getElementById('cf-habs-list'); habsList.innerHTML = '';
  if (char && char.habs) {
    char.habs.forEach(h => {
      const habId = 'hab-' + uid();
      const row   = document.createElement('div'); row.className = 'hab-row'; row.dataset.habId = habId;
      const level = h.level || 0;
      charHabState[habId] = level;
      row.innerHTML = `<div style="width:100%;display:flex;flex-direction:column;gap:6px">
        <input class="form-input" value="${h.name || ''}" placeholder="Nombre">
        <textarea class="form-input note-area" style="min-height:60px" placeholder="Descripción…">${h.desc || ''}</textarea>
      </div>
      <div class="skill-cost-btns" style="display:flex;flex-direction:column;gap:4px;min-width:80px">
        <button type="button" class="cost-btn ${level===1?'sel1':''}"  data-hab-id="${habId}" data-level="1">●○○</button>
        <button type="button" class="cost-btn ${level===5?'sel5':''}"  data-hab-id="${habId}" data-level="5">●●○</button>
        <button type="button" class="cost-btn ${level===15?'sel15':''}" data-hab-id="${habId}" data-level="15">●●●</button>
      </div>
      <button class="remove-btn" onclick="this.parentElement.remove()">✕</button>`;
      row.querySelectorAll('[data-level]').forEach(btn => {
        btn.addEventListener('click', e => {
          e.preventDefault();
          const lv = parseInt(btn.dataset.level);
          charHabState[habId] = charHabState[habId] === lv ? 0 : lv;
          row.querySelectorAll('[data-level]').forEach(b => b.classList.remove('sel1','sel5','sel15'));
          if      (charHabState[habId] === 1)  row.querySelector('[data-level="1"]').classList.add('sel1');
          else if (charHabState[habId] === 5)  row.querySelector('[data-level="5"]').classList.add('sel5');
          else if (charHabState[habId] === 15) row.querySelector('[data-level="15"]').classList.add('sel15');
        });
      });
      habsList.appendChild(row);
    });
  }
  renderSkillsGrid();
  openModal('modal-char');
}

export function saveChar() {
  const name = document.getElementById('cf-name').value.trim();
  if (!name) { alert('El personaje necesita un nombre.'); return; }
  const habs = Array.from(document.querySelectorAll('#cf-habs-list .hab-row')).map(row => {
    const habId = row.dataset.habId;
    return { name: row.querySelector('input').value, desc: row.querySelector('textarea').value, level: charHabState[habId] || 0 };
  });
  const char = {
    id:           editingCharId || uid(),
    name,
    player:       document.getElementById('cf-player').value,
    class:        document.getElementById('cf-class').value,
    race:         document.getElementById('cf-race').value,
    align:        document.getElementById('cf-align').value,
    height:       document.getElementById('cf-height').value,
    age:          document.getElementById('cf-age').value,
    fue:          parseInt(document.getElementById('cf-fue').value)      || 10,
    int:          parseInt(document.getElementById('cf-int').value)      || 10,
    car:          parseInt(document.getElementById('cf-car').value)      || 10,
    des:          parseInt(document.getElementById('cf-des').value)      || 10,
    vida:         parseInt(document.getElementById('cf-vida').value)     || 10,
    pm:           parseInt(document.getElementById('cf-pm').value)       || 0,
    gold:         parseInt(document.getElementById('cf-gold').value)     || 0,
    skillpts:     parseInt(document.getElementById('cf-skillpts').value) || 0,
    armor:        currentArmorSel,
    skills:       Object.assign({}, charSkillState),
    weaponSkills: Object.assign({}, charWeaponSkillState),
    habs,
    notes:        document.getElementById('cf-notes').value,
  };
  if (editingCharId) {
    const idx = state.chars.findIndex(c => c.id === editingCharId);
    state.chars[idx] = char;
  } else {
    state.chars.push(char);
  }
  saveState();
  closeModal('modal-char');
  renderCharList();
  showToast('Personaje guardado', 'success');
  if (!isDM()) {
    const myChar = state.chars.find(c => c.id === currentUser.charId);
    if (myChar) renderCharSheetView(myChar);
  }
}

export function renderCharList() {
  const list = document.getElementById('pj-list'); list.innerHTML = '';
  if (!isDM()) { list.style.display = 'none'; return; }
  list.style.display = '';
  state.chars.forEach(c => {
    const card = document.createElement('div'); card.className = 'entity-card';
    card.innerHTML = `
      <div class="entity-card-info">
        <span class="entity-name">${c.name}</span>
        <span class="entity-meta">${c.class||''} · ${c.race||''} · Jugador: ${c.player||'—'}</span>
        <span class="entity-meta">PV ${c.vida} | PM ${c.pm} | FUE ${c.fue} INT ${c.int} CAR ${c.car} DES ${c.des}</span>
      </div>
      <div class="entity-actions">
        <button class="btn btn-outline btn-sm" onclick="window._g.openCharModal('${c.id}')">✎ Editar</button>
        <button class="btn btn-danger btn-sm"  onclick="window._g.deleteChar('${c.id}')">✕ Borrar</button>
      </div>`;
    list.appendChild(card);
  });
  refreshCombatantSelects();
}

export function renderCharSheetView(char) {
  const view = document.getElementById('charsheet-content');
  if (!view) return;
  if (!char) {
    const hasId      = currentUser && currentUser.charId;
    const charsLoaded = state.chars.length;
    view.innerHTML = hasId && charsLoaded === 0
      ? `<div style="font-family:'Cinzel',serif;color:var(--ink-faded);padding:30px;text-align:center;font-size:.85rem;letter-spacing:2px;line-height:2">
           Cargando personaje…<br><span style="font-size:.7rem;opacity:.6">Si este mensaje persiste, recarga la página</span>
         </div>`
      : `<div style="font-family:'Cinzel',serif;color:var(--ink-faded);padding:30px;text-align:center;font-size:.85rem;letter-spacing:2px;">Sin personaje asignado</div>`;
    return;
  }
  const skillNames  = { nadar:'Nadar/Bucear', cerraduras:'Abrir Cerraduras', idiomas:'Idiomas', sigilo:'Sigilo', medicina:'Medicina', brutalidad:'Brutalidad', observacion:'Observación', intimidar:'Intimidar', enganar:'Engañar', persuasion:'Persuasión', acrobacias:'Acrobacias', montar:'Montar', agarrar:'Agarrar', reflejos:'Reflejos' };
  const weaponNames = { espadas:'Espadas', dagas:'Dagas', arcos:'Arcos', mandobles:'Mandobles', hachas:'Hachas', contundentes:'Contundentes', arrojadizas:'Arrojadizas', sin_armas:'Sin armas' };
  const costLabel   = v => v===15?'●●●':v===5?'●●○':v===1?'●○○':'○○○';
  const skillsHtml  = Object.entries(skillNames).map(([k,l]) => {
    const v = char.skills?.[k] || 0;
    return `<div class="skill-row"><span class="skill-attr"></span><label>${l}</label><span style="letter-spacing:2px;color:var(--gold);font-size:.75rem">${costLabel(v)}</span></div>`;
  }).join('');
  const weaponsHtml = Object.entries(weaponNames).map(([k,l]) => {
    const v = char.weaponSkills?.[k] || 0;
    return `<div class="skill-row"><label>${l}</label><span style="letter-spacing:2px;color:var(--gold);font-size:.75rem">${costLabel(v)}</span></div>`;
  }).join('');
  const habsHtml = (char.habs || []).map(h => {
    const desc  = (h.desc || '').replace(/\n/g, '<br>');
    const level = h.level || 0;
    return `<div style="margin-bottom:8px;display:flex;gap:12px;align-items:flex-start"><div style="flex:1"><strong style="font-family:'Cinzel',serif;font-size:.75rem;color:var(--gold)">${h.name}</strong><p style="font-size:.9rem;color:var(--ink-faded);margin-top:3px">${desc}</p></div><span style="letter-spacing:2px;color:var(--gold);font-size:.75rem;white-space:nowrap">${costLabel(level)}</span></div>`;
  }).join('');
  view.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <h2 style="font-family:'Cinzel Decorative',serif;color:var(--gold);font-size:1.1rem">${char.name}</h2>
      <button class="btn btn-gold btn-sm" onclick="window._g.openCharModal('${char.id}')">✎ Editar</button>
    </div>
    <div class="charsheet-grid">
      <div class="panel">
        <div class="panel-header">Identidad</div>
        <div class="panel-body cs-panel-identity" style="font-size:.9rem">
          ${['class','race','align','player','height','age'].map(f => {
            const labels = {class:'Clase',race:'Raza',align:'Alineamiento',player:'Jugador',height:'Altura',age:'Edad'};
            return `<div><span style="color:var(--ink-faded);font-size:.65rem;font-family:'Cinzel',serif;letter-spacing:1px;text-transform:uppercase">${labels[f]}</span><div>${char[f]||'—'}</div></div>`;
          }).join('')}
        </div>
      </div>
      <div class="panel">
        <div class="panel-header">Atributos y Recursos</div>
        <div class="panel-body">
          <div class="charsheet-attrs" style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px">
            ${['fue','int','car','des','vida'].map(a => `<div class="attr-box"><label>${a.toUpperCase()}</label><div style="font-family:'Cinzel',serif;font-size:1.1rem;font-weight:700;color:var(--ink)">${char[a]||10}</div></div>`).join('')}
          </div>
          <div class="cs-resources" style="font-size:.9rem">
            <div><span style="color:var(--ink-faded);font-size:.65rem;font-family:'Cinzel',serif;letter-spacing:1px;text-transform:uppercase">PM</span><div style="font-family:'Cinzel',serif;font-size:1rem;color:#4a7a9b">${char.pm||0}</div></div>
            <div><span style="color:var(--ink-faded);font-size:.65rem;font-family:'Cinzel',serif;letter-spacing:1px;text-transform:uppercase">Armadura</span><div>${char.armor||'—'}</div></div>
            <div><span style="color:var(--ink-faded);font-size:.65rem;font-family:'Cinzel',serif;letter-spacing:1px;text-transform:uppercase">Oro</span><div>${char.gold||0}</div></div>
          </div>
        </div>
      </div>
      <div class="panel"><div class="panel-header">Habilidades</div><div class="panel-body"><div class="skills-grid">${skillsHtml}</div></div></div>
      <div class="panel"><div class="panel-header">Armamentísticas</div><div class="panel-body"><div class="skills-grid">${weaponsHtml}</div></div></div>
      ${habsHtml ? `<div class="panel" style="grid-column:1/-1"><div class="panel-header">Habilidades Especiales</div><div class="panel-body">${habsHtml}</div></div>` : ''}
      ${char.notes    ? `<div class="panel"><div class="panel-header">Notas</div><div class="panel-body" style="font-size:.95rem;white-space:pre-wrap">${char.notes}</div></div>` : ''}
    </div>`;
}

export function deleteChar(id) {
  showConfirm('¿Eliminar este personaje?').then(ok => {
    if (!ok) return;
    globalUsers.forEach(u => { if (u.charId === id) u.charId = null; });
    saveGlobalUsers();
    state.chars = state.chars.filter(c => c.id !== id);
    saveState();
    renderCharList();
    import('./users.js').then(m => m.renderUserList());
    showToast('Personaje eliminado', 'info');
  });
}

export function refreshCombatantSelects() {
  document.querySelectorAll('.add-combatant-form').forEach(form => {
    const sv  = form.closest('.view'); if (!sv) return;
    const sid = sv.dataset.sessionId; if (!sid) return;
    const session = getSession(sid); if (session) renderCombatantChips(sv, session);
  });
}
