// combat.js — Initiative tracker, combatant cards, HP modal, conditions, enemy tooltip
import { uid } from './utils.js';
import { state, isDM, currentUser } from './state.js';
import { saveState } from './persist.js';
import { openModal, closeModal } from './ui.js';

// ===== COMBATANT CHIPS (quick-add buttons) =====
export function renderCombatantChips(clone, session) {
  const pjWrap = clone.querySelector('.chips-pj');
  const enWrap = clone.querySelector('.chips-enemy');
  if (!pjWrap || !enWrap) return;
  pjWrap.innerHTML = ''; enWrap.innerHTML = '';

  state.chars.forEach(char => {
    const alreadyIn = session.combatants.some(c => c.charId === char.id && !c.dead);
    const chip = document.createElement('button');
    chip.className = 'chip-pj' + (alreadyIn ? ' in-session' : '');
    chip.textContent = char.name; chip.disabled = alreadyIn;
    chip.onclick = () => {
      session.combatants.push({ id:uid(), name:char.name, charId:char.id, init:10, hp:char.vida||10, maxHp:char.vida||10, tempHp:0, type:'pj', dead:false, conditions:[] });
      session.combatants.sort((a,b) => b.init - a.init);
      saveState(); renderCombatantList(session, clone);
    };
    pjWrap.appendChild(chip);
  });

  const visibleEnemies = Array.isArray(session.allowedEnemies)
    ? state.enemies.filter(e => session.allowedEnemies.includes(e.id))
    : state.enemies;

  visibleEnemies.forEach(enemy => {
    const chip = document.createElement('button');
    chip.className = 'chip-enemy'; chip.textContent = enemy.name;
    chip.onclick = () => {
      const rndInit = Math.ceil(Math.random() * 20);
      session.combatants.push({ id:uid(), name:enemy.name, enemyId:enemy.id, init:rndInit, hp:enemy.pv||10, maxHp:enemy.pv||10, tempHp:0, type:'enemy', dead:false, conditions:[] });
      session.combatants.sort((a,b) => b.init - a.init);
      if (!state.encounteredEnemies.includes(enemy.id)) state.encounteredEnemies.push(enemy.id);
      saveState(); renderCombatantList(session, clone);
    };
    enWrap.appendChild(chip);
  });
}

export function addCombatantToSession(session, clone) {
  const name = clone.querySelector('.combatant-name-in').value.trim() || 'Desconocido';
  const hp   = parseInt(clone.querySelector('.combatant-hp-in').value) || 10;
  session.combatants.push({ id:uid(), name, init:Math.ceil(Math.random()*20), hp, maxHp:hp, tempHp:0, type:'custom', dead:false, conditions:[] });
  session.combatants.sort((a,b) => b.init - a.init);
  clone.querySelector('.combatant-name-in').value = '';
  saveState(); renderCombatantList(session, clone);
}

export function renderCombatantList(session, clone) {
  const dm   = isDM();
  const list = clone.querySelector('.combatant-list');
  list.innerHTML = '';
  const cards = [];
  const alive = session.combatants.filter(c => !c.dead);

  session.combatants.forEach((c, idx) => {
    const aliveIdx = alive.indexOf(c);
    const isActive = !c.dead && aliveIdx === session.activeTurn;
    const totalHp  = c.hp + (c.tempHp || 0);
    const pct      = Math.max(0, Math.min(100, (totalHp / c.maxHp) * 100));
    const barClass = pct > 60 ? 'ok' : pct > 25 ? 'low' : '';
    const card     = document.createElement('div');
    const typeClass = c.type==='pj' ? ' type-pj' : c.type==='enemy' ? ' type-enemy' : '';
    card.className = 'combatant-card' + typeClass + (isActive?' active-turn':'') + (c.dead?' dead':'');
    const showHp    = dm || c.type === 'pj';
    const hpDisplay = c.tempHp > 0 ? `${c.hp} + ${c.tempHp}T / ${c.maxHp}` : `${c.hp} / ${c.maxHp}`;
    const hpHtml    = showHp
      ? `<div class="hp-bar-wrap"><div class="hp-bar-track"><div class="hp-bar-fill ${barClass}" style="width:${pct}%"></div></div><div class="hp-text">${hpDisplay}</div></div>`
      : `<div class="hp-bar-wrap"><div class="hp-text" style="font-style:italic;opacity:.5">—</div></div>`;
    const isOwnChar = !dm && c.type==='pj' && currentUser?.charId && c.charId === currentUser.charId;
    const canControl = dm || isOwnChar;
    const initHtml   = canControl
      ? `<input class="c-init-input" type="number" value="${c.init}" min="1" max="99" title="Editar iniciativa">`
      : `<div class="c-init">${c.init}</div>`;
    card.innerHTML = `
      <div class="c-init-wrap">${initHtml}</div>
      <div class="c-name">${c.name}<span class="c-type">${c.type==='pj'?'Personaje':c.type==='enemy'?'Enemigo':''}</span></div>
      ${hpHtml}
      <div class="hp-actions${canControl?'':' player-hide'}">
        <button class="hp-btn dmg" title="Daño">−</button>
        <button class="hp-btn heal" title="Curar">+</button>
      </div>
      <div class="conditions-wrap"></div>
      <div class="dead-btns-corner ${dm?'':'player-hide'}">
        <button class="dead-btn">${c.dead?'♻':'☠'}</button>
        <button class="dead-btn" style="border-color:var(--ink-faded);color:var(--ink-faded)">✕</button>
      </div>
      ${dm && c.type==='enemy' && c.enemyId ? '<button class="enemy-info-btn" title="Ver ficha del enemigo">ⓘ</button>' : ''}
      ${!dm && c.type==='enemy' && c.enemyId && state.encounteredEnemies.includes(c.enemyId) ? '<button class="player-enemy-info-btn" title="Ver en bestiario">📖</button>' : ''}`;

    // Player bestiary shortcut
    if (!dm && c.type==='enemy' && c.enemyId && state.encounteredEnemies.includes(c.enemyId)) {
      const playerInfoBtn = card.querySelector('.player-enemy-info-btn');
      if (playerInfoBtn) {
        playerInfoBtn.addEventListener('click', e => {
          e.stopPropagation();
          const notesPopup = clone.querySelector('.popup-notes');
          const notesBtn   = clone.querySelector('.btn-popup-notes');
          const dicePopup  = clone.querySelector('.popup-dice');
          const diceBtn    = clone.querySelector('.btn-popup-dice');
          if (notesPopup) { notesPopup.style.display = 'flex'; if(notesBtn) notesBtn.classList.add('active'); }
          if (dicePopup)  { dicePopup.style.display  = 'none'; if(diceBtn)  diceBtn.classList.remove('active'); }
          const pnw = clone.querySelector('.player-notes-panel-wrap');
          if (!pnw) return;
          pnw.querySelectorAll('.pause-tab').forEach(t => t.classList.remove('active'));
          pnw.querySelectorAll('.pause-tab-panel').forEach(p => p.style.display = 'none');
          const bestiarioTab   = pnw.querySelector('[data-tab="bestiario"]');
          const bestiarioPanel = pnw.querySelector('[data-panel="bestiario"]');
          if (bestiarioTab)   bestiarioTab.classList.add('active');
          if (bestiarioPanel) bestiarioPanel.style.display = '';
          const enemy    = state.enemies.find(en => en.id === c.enemyId);
          const bestList = bestiarioPanel ? bestiarioPanel.querySelector('.bestiary-list') : null;
          if (enemy && bestList && currentUser) {
            import('./notebook.js').then(m => m.openBestiaryDetail(bestList, enemy, currentUser.id));
          }
        });
      }
    }

    // DM enemy info tooltip
    if (dm && c.type==='enemy' && c.enemyId) {
      const infoBtn = card.querySelector('.enemy-info-btn');
      if (infoBtn) {
        infoBtn.addEventListener('mouseenter', () => showEnemyTooltip(c.enemyId, infoBtn));
        infoBtn.addEventListener('mouseleave', scheduleHideEnemyTooltip);
        infoBtn.addEventListener('click', e => { e.stopPropagation(); showEnemyTooltip(c.enemyId, infoBtn); });
      }
    }

    // Conditions
    const condWrap = card.querySelector('.conditions-wrap');
    c.conditions.forEach((cond, ci) => {
      const tag = document.createElement('span'); tag.className = 'condition-tag';
      tag.textContent = cond + (canControl ? ' ✕' : '');
      if (canControl) tag.onclick = () => { c.conditions.splice(ci,1); saveState(); renderCombatantList(session, clone); };
      condWrap.appendChild(tag);
    });
    if (canControl) {
      const addBtn = document.createElement('button'); addBtn.className = 'add-cond-btn'; addBtn.textContent = '+ estado';
      addBtn.onclick = () => openCondModal(session, idx, clone);
      condWrap.appendChild(addBtn);
    }

    const initInput = card.querySelector('.c-init-input');
    if (initInput) initInput.addEventListener('change', () => { c.init = parseInt(initInput.value) || 1; saveState(); });

    if (canControl) {
      const [dmgBtn, healBtn] = card.querySelectorAll('.hp-btn');
      dmgBtn.onclick  = () => { c.hp = Math.max(0, c.hp-1); saveState(); renderCombatantList(session, clone); };
      healBtn.onclick = () => { c.hp = Math.min(c.maxHp, c.hp+1); saveState(); renderCombatantList(session, clone); };
    }
    if (dm) {
      const [deadBtn, removeBtn] = card.querySelectorAll('.dead-btn');
      deadBtn.onclick   = () => { c.dead = !c.dead; saveState(); renderCombatantList(session, clone); };
      removeBtn.onclick = () => { session.combatants.splice(idx,1); saveState(); renderCombatantList(session, clone); };
    }
    cards.push(card);
  });

  if (cards.length > 6) {
    list.classList.add('multi-col');
    for (let i = 0; i < cards.length; i += 6) {
      const col = document.createElement('div'); col.className = 'combatant-column';
      cards.slice(i, i+6).forEach(c => col.appendChild(c));
      list.appendChild(col);
    }
  } else {
    list.classList.remove('multi-col');
    cards.forEach(c => list.appendChild(c));
  }
  renderCombatantChips(clone, session);
}

// ===== ENEMY STAT TOOLTIP =====
let _tooltipHideTimer = null;

export function showEnemyTooltip(enemyId, anchor) {
  const enemy = state.enemies.find(e => e.id === enemyId); if (!enemy) return;
  const tip   = document.getElementById('enemy-stat-tooltip'); if (!tip) return;
  clearTimeout(_tooltipHideTimer);
  tip.querySelector('.est-name').textContent  = enemy.name;
  tip.querySelector('.est-pv').textContent    = enemy.pv    ?? '—';
  tip.querySelector('.est-armor').textContent = enemy.armor || '—';
  tip.querySelector('.est-fue').textContent   = enemy.fue   ?? '—';
  tip.querySelector('.est-int').textContent   = enemy.int   ?? '—';
  tip.querySelector('.est-car').textContent   = enemy.car   ?? '—';
  tip.querySelector('.est-des').textContent   = enemy.des   ?? '—';
  const attacksEl   = tip.querySelector('.est-attacks');
  const attacksWrap = tip.querySelector('.est-attacks-wrap');
  const attacks = (enemy.attacks || '').trim();
  attacksEl.textContent = attacks; attacksWrap.style.display = attacks ? '' : 'none';
  const notesEl   = tip.querySelector('.est-notes');
  const notesWrap = tip.querySelector('.est-notes-wrap');
  const notes = (enemy.notes || '').trim();
  notesEl.textContent = notes; notesWrap.style.display = notes ? '' : 'none';
  const rect = anchor.getBoundingClientRect();
  const tipW = 280, margin = 8;
  let left = rect.right + margin;
  if (left + tipW > window.innerWidth - margin) left = rect.left - tipW - margin;
  if (left < margin) left = margin;
  tip.style.left = left + 'px'; tip.style.top = rect.top + 'px'; tip.style.maxWidth = tipW + 'px';
  tip.removeAttribute('aria-hidden'); tip.classList.add('visible');
  tip.onmouseenter = () => clearTimeout(_tooltipHideTimer);
  tip.onmouseleave = scheduleHideEnemyTooltip;
}

export function scheduleHideEnemyTooltip() {
  clearTimeout(_tooltipHideTimer);
  _tooltipHideTimer = setTimeout(hideEnemyTooltip, 150);
}

export function hideEnemyTooltip() {
  const tip = document.getElementById('enemy-stat-tooltip'); if (!tip) return;
  tip.classList.remove('visible'); tip.setAttribute('aria-hidden', 'true');
}

// ===== HP MODAL =====
let hpRef = null;

export function openHpModal(session, idx, clone) {
  hpRef = {session, idx, clone};
  const c = session.combatants[idx];
  document.getElementById('modal-hp-title').textContent   = `PV — ${c.name}`;
  document.getElementById('hp-current-display').textContent = `${c.hp} / ${c.maxHp}`;
  document.getElementById('temp-hp-display').textContent    = c.tempHp || 0;
  document.getElementById('hp-amount-in').value             = 1;
  document.getElementById('temp-hp-amount-in').value        = c.tempHp || 0;
  openModal('modal-hp');
}

export function applyHP(dir, exact) {
  if (!hpRef) return;
  const {session, idx, clone} = hpRef;
  const c = session.combatants[idx];
  const amount = parseInt(document.getElementById('hp-amount-in').value) || 1;
  if (exact) {
    c.hp = Math.max(0, Math.min(c.maxHp, amount));
  } else if (dir === -1) {
    c.tempHp -= amount;
    if (c.tempHp < 0) { c.hp += c.tempHp; c.tempHp = 0; }
    c.hp = Math.max(0, Math.min(c.maxHp, c.hp));
  } else if (dir === 1) {
    c.hp = Math.max(0, Math.min(c.maxHp, c.hp + amount));
  }
  document.getElementById('hp-current-display').textContent = `${c.hp} / ${c.maxHp}`;
  document.getElementById('temp-hp-display').textContent    = c.tempHp || 0;
  saveState(); renderCombatantList(session, clone);
}

export function setTempHP() {
  if (!hpRef) return;
  const {session, idx, clone} = hpRef;
  const c = session.combatants[idx];
  c.tempHp = Math.max(0, parseInt(document.getElementById('temp-hp-amount-in').value) || 0);
  document.getElementById('temp-hp-display').textContent = c.tempHp;
  saveState(); renderCombatantList(session, clone);
}

// ===== CONDITION MODAL =====
let condRef = null;

export function openCondModal(session, idx, clone) {
  condRef = {session, idx, clone};
  document.getElementById('cond-input').value = '';
  renderCondChips();
  openModal('modal-cond');
}

export function renderCondChips() {
  const wrap = document.getElementById('cond-chips'); if (!wrap) return;
  wrap.innerHTML = '';
  const lista = state.estados.length
    ? state.estados
    : [{nombre:'Envenenado'},{nombre:'Aturdido'},{nombre:'Asustado'},{nombre:'Ralentizado'},{nombre:'Paralizado'},{nombre:'Cegado'},{nombre:'Atrapado'},{nombre:'Sangrando'}];
  lista.forEach(e => {
    const btn = document.createElement('button'); btn.className = 'condition-tag'; btn.textContent = e.nombre;
    btn.onclick = () => { document.getElementById('cond-input').value = e.nombre; };
    wrap.appendChild(btn);
  });
}

export function setCondInput(v) { document.getElementById('cond-input').value = v; }

export function addConditionConfirm() {
  if (!condRef) return;
  const {session, idx, clone} = condRef;
  const v = document.getElementById('cond-input').value.trim();
  if (v) { session.combatants[idx].conditions.push(v); saveState(); }
  closeModal('modal-cond');
  renderCombatantList(session, clone);
}
