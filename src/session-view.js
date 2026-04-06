// session-view.js — Build full session view from template, wire all events
import { state, isDM, currentUser, getPlayerData } from './state.js';
import { saveState } from './persist.js';
import { renderCombatantChips, renderCombatantList, addCombatantToSession } from './combat.js';
import { renderBestiaryList, renderInventoryPanel } from './notebook.js';
import { ICONS } from './icons.js';

// openSpectatorWindow imported lazily to avoid circular deps
function openSpectatorWindow(sid) {
  import('./spectator.js').then(m => m.openSpectatorWindow(sid));
}

// ===========================
//  BUILD SESSION VIEW
// ===========================
export function buildSessionView(session) {
  const template = document.getElementById('session-view-template');
  if (!template) return;
  const clone = template.cloneNode(true);
  clone.id = 'view-' + session.id;
  clone.removeAttribute('style');
  clone.classList.add('view');
  clone.dataset.sessionId = session.id;

  const dm = isDM();

  // Grid layout: players don't have the actos column
  if (!dm) clone.querySelector('.session-grid').classList.add('player-grid');

  // Diary read-only for players
  const diaryArea = clone.querySelector('[data-field="diary"]');
  const titleInput = clone.querySelector('[data-session-name]');
  if (titleInput) titleInput.value = session.name || '';
  const roLabel = clone.querySelector('#diary-ro-label');
  if (!dm) {
    diaryArea.setAttribute('readonly', true);
    if (roLabel) roLabel.style.display = 'inline';
  } else {
    if (roLabel) roLabel.style.display = 'none';
  }

  // Bind text fields
  clone.querySelectorAll('[data-field]').forEach(el => {
    const field = el.dataset.field;
    el.value = session[field] || '';
    if (!el.hasAttribute('readonly')) {
      el.addEventListener('input', () => { session[field] = el.value; saveState(); });
    }
  });

  // DM-only sections
  if (!dm) {
    clone.querySelectorAll('.dm-only-ctrl').forEach(el => el.style.display = 'none');
    const pnw = clone.querySelector('.player-notes-panel-wrap');
    if (pnw) pnw.style.display = '';

    // Tab switching
    const tabs   = pnw ? pnw.querySelectorAll('.pause-tab') : [];
    const panels = pnw ? pnw.querySelectorAll('.pause-tab-panel') : [];
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        panels.forEach(p => p.style.display = 'none');
        tab.classList.add('active');
        pnw.querySelector(`[data-panel="${tab.dataset.tab}"]`).style.display = '';
      });
    });

    // Notas tab
    const pnArea = clone.querySelector('[data-field="player_note"]');
    if (pnArea && currentUser) {
      const pd0 = getPlayerData(currentUser.id);
      pnArea.value = pd0.notes;
      pnArea.addEventListener('input', () => {
        const pd = getPlayerData(currentUser.id);
        pd.notes = pnArea.value;
        state.playerNotes[currentUser.id] = pd;
        saveState();
      });
    }

    // Inventario tab
    const invGrid = pnw ? pnw.querySelector('.inventory-grid') : null;
    if (invGrid && currentUser) renderInventoryPanel(invGrid, currentUser.id);

    // Bestiario tab
    const bestList = pnw ? pnw.querySelector('.bestiary-list') : null;
    if (bestList && currentUser) renderBestiaryList(bestList, currentUser.id);
  }

  // Popup buttons
  const notesBtn   = clone.querySelector('.btn-popup-notes');
  const notesPopup = clone.querySelector('.popup-notes');
  const diceBtn    = clone.querySelector('.btn-popup-dice');
  const dicePopup  = clone.querySelector('.popup-dice');

  notesBtn.innerHTML = dm ? ICONS.notebook : ICONS.bookOpen;
  notesBtn.title       = dm ? 'Notas del DM' : 'Cuaderno';
  const notesPopupTitle = clone.querySelector('.popup-notes-title');
  if (notesPopupTitle) notesPopupTitle.innerHTML = dm ? `${ICONS.notebook} Notas del DM` : `${ICONS.bookOpen} Cuaderno del Aventurero`;

  function openPopup(popup, btn)  { popup.style.display = 'flex'; btn.classList.add('active'); }
  function closePopup(popup, btn) { popup.style.display = 'none'; btn.classList.remove('active'); }

  notesBtn.addEventListener('click', () => {
    if (notesPopup.style.display === 'none') { openPopup(notesPopup, notesBtn); closePopup(dicePopup, diceBtn); }
    else closePopup(notesPopup, notesBtn);
  });
  clone.querySelector('.btn-close-notes').addEventListener('click', () => closePopup(notesPopup, notesBtn));
  notesPopup.addEventListener('click', e => { if (e.target === notesPopup) closePopup(notesPopup, notesBtn); });

  diceBtn.addEventListener('click', () => {
    if (dicePopup.style.display === 'none') { openPopup(dicePopup, diceBtn); closePopup(notesPopup, notesBtn); }
    else closePopup(dicePopup, diceBtn);
  });
  clone.querySelector('.btn-close-dice').addEventListener('click', () => closePopup(dicePopup, diceBtn));
  dicePopup.addEventListener('click', e => { if (e.target === dicePopup) closePopup(dicePopup, diceBtn); });

  // Dice buttons
  const rollDisplay = clone.querySelector('.result-rolls');
  const rollHistory = clone.querySelector('.roll-history');
  const secretLabel = clone.querySelector('.dice-secret-label');
  if (dm && secretLabel) secretLabel.style.display = 'none';
  renderRollHistory(session, rollHistory);
  clone.querySelectorAll('.dice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sides = parseInt(btn.dataset.sides);
      const qty   = Math.min(20, Math.max(1, parseInt(clone.querySelector('.dice-qty').value) || 1));
      const rolls = Array.from({length: qty}, () => Math.ceil(Math.random() * sides));
      const total = rolls.reduce((a,b) => a+b, 0);
      const secret  = clone.querySelector('.dice-secret-chk').checked;
      const isDMroll = isDM();
      const entry = { label:`${qty}d${sides}`, rolls, total, user: currentUser?.username || '?', secret, isDMroll };
      session.rollHistory.unshift(entry);
      if (session.rollHistory.length > 60) session.rollHistory.pop();
      saveState();
      renderRollDisplay(rollDisplay, entry);
      renderRollHistory(session, rollHistory);
    });
  });
  clone.querySelector('.clear-dice-btn').addEventListener('click', () => {
    session.rollHistory = [];
    saveState();
    rollHistory.innerHTML = '';
    rollDisplay.textContent = '—';
  });

  // Initiative controls
  clone.querySelector('.round-num').textContent = session.round;
  if (dm) {
    clone.querySelector('.next-turn-btn').addEventListener('click', () => {
      const alive = session.combatants.filter(c => !c.dead);
      if (!alive.length) return;
      session.activeTurn = (session.activeTurn + 1) % alive.length;
      if (session.activeTurn === 0) session.round++;
      clone.querySelector('.round-num').textContent = session.round;
      saveState();
      renderCombatantList(session, clone);
    });
    clone.querySelector('.reset-combat-btn').addEventListener('click', () => {
      session.activeTurn = 0; session.round = 1;
      clone.querySelector('.round-num').textContent = 1;
      saveState();
      renderCombatantList(session, clone);
    });
    clone.querySelector('.sort-init-btn').addEventListener('click', () => {
      session.combatants.sort((a,b) => b.init - a.init);
      session.activeTurn = 0;
      saveState();
      renderCombatantList(session, clone);
    });
    clone.querySelector('.clear-npcs-btn').addEventListener('click', () => {
      session.combatants = session.combatants.filter(c => c.type === 'pj');
      session.activeTurn = 0;
      saveState();
      renderCombatantList(session, clone);
    });
    renderCombatantChips(clone, session);
    clone.querySelector('.add-combatant-btn').addEventListener('click', () => addCombatantToSession(session, clone));
    renderSessionActos(session, clone);
    wireSessionEventos(session, clone);
    const spectatorBtn = clone.querySelector('.btn-spectator');
    if (spectatorBtn) spectatorBtn.addEventListener('click', () => openSpectatorWindow(session.id));
  }
  renderCombatantList(session, clone);
  renderSessionGallery(session, clone);
  document.getElementById('main-content').appendChild(clone);
}

// ===========================
//  SESSION EVENTOS WIRE
// ===========================
export function wireSessionEventos(session, clone) {
  const COLORS = { Tensión:'#c86e1e', Combate:'#a02020', Social:'#3ca050', Entorno:'#3a7ab8' };

  function getOpenActo() {
    const openHeader = Array.from(clone.querySelectorAll('.actos-accordion .acto-header'))
      .find(h => h.querySelector('.acto-toggle').textContent.trim() === '\u25bc');
    if (!openHeader) return null;
    const titleText = openHeader.querySelector('.acto-title').textContent.trim();
    return state.actos.find(a => a.sessionId === session.id && a.title === titleText) || null;
  }

  function showEvento(evento) {
    const empty   = clone.querySelector('.evr-empty');
    const content = clone.querySelector('.evr-content');
    if (!evento) {
      empty.style.display = '';
      content.style.display = 'none';
      empty.textContent = 'No hay eventos de esta categoría para el acto seleccionado.';
      return;
    }
    empty.style.display = 'none';
    content.style.display = '';
    const color = COLORS[evento.categoria] || 'var(--text-muted)';
    const badge = clone.querySelector('.evr-cat-badge');
    badge.textContent = evento.categoria;
    badge.style.color = color;
    clone.querySelector('.evr-title').textContent  = evento.title;
    clone.querySelector('.evr-public').value  = evento.public  || '';
    clone.querySelector('.evr-private').value = evento.private || '';
  }

  clone.querySelectorAll('.evt-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat  = btn.dataset.cat;
      const acto = getOpenActo();
      if (!acto) {
        const empty   = clone.querySelector('.evr-empty');
        const content = clone.querySelector('.evr-content');
        empty.style.display = ''; content.style.display = 'none';
        empty.textContent = 'Despliega un acto primero.';
        return;
      }
      let pool = state.eventos.filter(e => e.sessionId === session.id && e.actoId === acto.id);
      if (cat !== 'Todos') pool = pool.filter(e => e.categoria === cat);
      if (!pool.length) { showEvento(null); return; }
      showEvento(pool[Math.floor(Math.random() * pool.length)]);
    });
  });

  clone.querySelector('.evr-pub-btn').addEventListener('click', () => {
    const text = clone.querySelector('.evr-public').value;
    if (!text) return;
    const diary = clone.querySelector('[data-field="diary"]');
    if (diary) {
      diary.value = diary.value ? diary.value + '\n\n' + text : text;
      session.diary = diary.value;
      saveState();
    }
  });
}

// ===========================
//  SESSION ACTOS ACCORDION
// ===========================
export function renderSessionActos(session, clone) {
  const accordion = clone.querySelector('.actos-accordion');
  if (!accordion) return;
  accordion.innerHTML = '';
  const sessionActos = state.actos.filter(a => a.sessionId === session.id);
  if (sessionActos.length === 0) {
    accordion.innerHTML = '<div style="padding:8px 2px;color:var(--text-muted);font-family:\'Crimson Text\',serif;font-style:italic;font-size:.9rem">No hay actos para esta sesión.</div>';
    return;
  }
  sessionActos.forEach(acto => {
    const item = document.createElement('div');
    item.className = 'acto-item';
    const header = document.createElement('div');
    header.className = 'acto-header';
    header.innerHTML = `<span class="acto-toggle">&#9658;</span><span class="acto-title">${acto.title}</span>`;
    const body = document.createElement('div');
    body.className = 'acto-body';
    body.style.display = 'none';

    // Contenido público + botón publicar
    const pubRow   = document.createElement('div');
    pubRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
    const pubLabel = document.createElement('label');
    pubLabel.className = 'flabel'; pubLabel.style.margin = '0';
    pubLabel.textContent = 'Contenido Público';
    const pubBtn = document.createElement('button');
    pubBtn.className = 'btn btn-outline btn-sm'; pubBtn.innerHTML = `${ICONS.megaphone} Publicar`;
    pubBtn.addEventListener('click', () => {
      const text = acto.public || '';
      if (!text) return;
      const diary = clone.querySelector('[data-field="diary"]');
      if (diary) {
        diary.value = diary.value ? diary.value + '\n\n' + text : text;
        session.diary = diary.value;
        saveState();
      }
    });
    pubRow.appendChild(pubLabel); pubRow.appendChild(pubBtn);
    const pubArea = document.createElement('textarea');
    pubArea.className = 'note-area'; pubArea.style.minHeight = '80px';
    pubArea.readOnly = true; pubArea.value = acto.public || '';

    // Contenido privado
    const privLabel = document.createElement('label');
    privLabel.className = 'flabel'; privLabel.textContent = 'Contenido Privado';
    const privArea = document.createElement('textarea');
    privArea.className = 'note-area'; privArea.style.minHeight = '80px';
    privArea.readOnly = true; privArea.value = acto.private || '';

    body.appendChild(pubRow); body.appendChild(pubArea);
    body.appendChild(privLabel); body.appendChild(privArea);

    // Imagen del acto
    if (acto.image) {
      const imgRow = document.createElement('div');
      imgRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;';
      const imgLabel = document.createElement('label');
      imgLabel.className = 'flabel'; imgLabel.style.margin = '0';
      imgLabel.textContent = 'Imagen'; imgLabel.insertAdjacentHTML('afterbegin', ICONS.image + ' ');
      imgRow.appendChild(imgLabel);
      if (isDM()) {
        const imgPubBtn = document.createElement('button');
        imgPubBtn.className = 'btn btn-outline btn-sm';
        imgPubBtn.innerHTML = `${ICONS.camera} Publicar imagen`;
        imgPubBtn.addEventListener('click', () => publishActoImage(session, acto, clone));
        imgRow.appendChild(imgPubBtn);
      }
      const thumbnail = document.createElement('img');
      thumbnail.src = acto.image; thumbnail.alt = acto.title;
      thumbnail.className = 'acto-img-thumb';
      thumbnail.addEventListener('click', () => openGalleryLightbox(acto.image, acto.title));
      body.appendChild(imgRow); body.appendChild(thumbnail);
    }

    header.addEventListener('click', () => {
      const open = body.style.display !== 'none';
      accordion.querySelectorAll('.acto-body').forEach(b => {
        b.style.display = 'none';
        b.previousElementSibling.querySelector('.acto-toggle').innerHTML = '&#9658;';
      });
      if (!open) {
        body.style.display = '';
        header.querySelector('.acto-toggle').innerHTML = '&#9660;';
      }
    });
    item.appendChild(header); item.appendChild(body);
    accordion.appendChild(item);
  });
}

// ===========================
//  DICE HELPERS
// ===========================
export function renderRollDisplay(el, entry) {
  if (entry.rolls.length === 1) {
    el.innerHTML = `<span class="result-total">${entry.total}</span>`;
  } else {
    el.innerHTML = `<span style="font-size:1.1rem;color:var(--ink-faded)">[${entry.rolls.join(', ')}]</span> <span style="color:var(--ink-faded);font-size:.9rem">=</span> <span class="result-total">${entry.total}</span>`;
  }
}

export function renderRollHistory(session, el) {
  el.innerHTML = '';
  const dm = isDM();
  session.rollHistory.forEach(e => {
    if (e.isDMroll && !dm) return;
    if (e.secret && !dm && e.user !== currentUser?.username) return;
    const d = document.createElement('div'); d.className = 'roll-entry';
    const badge = e.secret ? ` <span class="roll-badge secret">${ICONS.lock}</span>` : (e.isDMroll ? ` <span class="roll-badge dm">${ICONS.crown}</span>` : '');
    d.innerHTML = `<span><span class="ru">${e.user||'?'}</span>${badge}<span class="rl">${e.label}</span></span><span class="rv">${e.rolls.length>1?'['+e.rolls.join(',')+'] = ':''}${e.total}</span>`;
    el.appendChild(d);
  });
}

// ===========================
//  GALLERY
// ===========================
export function publishActoImage(session, acto, clone) {
  if (!acto.image) return;
  if (!session.publishedImages) session.publishedImages = [];
  session.publishedImages = session.publishedImages.filter(i => i.actoId !== acto.id);
  import('./utils.js').then(({uid}) => {
    session.publishedImages.push({ id: uid(), actoId: acto.id, src: acto.image, caption: acto.title });
    saveState();
    renderSessionGallery(session, clone);
    import('./ui.js').then(m => m.showToast('Imagen publicada en el diario', 'success'));
  });
}

export function renderSessionGallery(session, clone) {
  const wrap = clone.querySelector('.diary-gallery-wrap');
  const grid = clone.querySelector('.diary-gallery-grid');
  if (!wrap || !grid) return;
  const imgs = session.publishedImages || [];
  if (!imgs.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  grid.innerHTML = '';
  imgs.forEach(entry => {
    const item   = document.createElement('div');
    item.className = 'diary-gallery-item';
    const imgEl  = document.createElement('img');
    imgEl.src = entry.src; imgEl.alt = entry.caption || '';
    imgEl.className = 'diary-gallery-img'; imgEl.title = entry.caption || '';
    imgEl.addEventListener('click', () => openGalleryLightbox(entry.src, entry.caption));
    item.appendChild(imgEl);
    if (entry.caption) {
      const cap = document.createElement('div');
      cap.className = 'diary-gallery-caption'; cap.textContent = entry.caption;
      item.appendChild(cap);
    }
    if (isDM()) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-danger btn-xs diary-gallery-remove';
      removeBtn.innerHTML = ICONS.x; removeBtn.title = 'Retirar del diario';
      removeBtn.addEventListener('click', e => {
        e.stopPropagation();
        session.publishedImages = session.publishedImages.filter(i => i.id !== entry.id);
        saveState();
        renderSessionGallery(session, clone);
      });
      item.appendChild(removeBtn);
    }
    grid.appendChild(item);
  });
}

export function openGalleryLightbox(src, caption) {
  let overlay = document.getElementById('gallery-lightbox');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'gallery-lightbox';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;cursor:pointer;';
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <img src="${src}" style="max-width:90vw;max-height:80vh;border-radius:6px;object-fit:contain;" alt="${caption || ''}">
    ${caption ? `<div style="color:#fff;font-family:'Crimson Text',serif;font-size:1.05rem;opacity:.85">${caption}</div>` : ''}
    <div style="color:#aaa;font-size:.78rem;">Clic para cerrar</div>`;
  overlay.style.display = 'flex';
}
