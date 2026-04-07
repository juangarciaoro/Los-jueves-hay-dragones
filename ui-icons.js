// ui-icons.js
// Indice de iconos: cada clave apunta a un SVG individual dentro de /svg.
// La app carga esos ficheros al arrancar y luego reutiliza el marcado cacheado.

export const UI_ICON_PATHS = {
  // Navegacion y estado
  home: 'svg/home.svg',
  back: 'svg/back.svg',
  eye: 'svg/eye.svg',
  globe: 'svg/globe.svg',
  lock: 'svg/lock.svg',
  warning: 'svg/warning.svg',

  // Acciones
  plus: 'svg/plus.svg',
  edit: 'svg/edit.svg',
  close: 'svg/close.svg',
  trash: 'svg/trash.svg',
  refresh: 'svg/refresh.svg',
  sort: 'svg/sort.svg',
  next: 'svg/next.svg',
  up: 'svg/up.svg',
  down: 'svg/down.svg',
  chevronRight: 'svg/chevron-right.svg',
  chevronDown: 'svg/chevron-down.svg',
  copy: 'svg/copy.svg',

  // Fantasia medieval
  sword: 'svg/sword.svg',
  helm: 'svg/helm.svg',
  shield: 'svg/shield.svg',
  castle: 'svg/castle.svg',
  horn: 'svg/horn.svg',
  spark: 'svg/spark.svg',
  mask: 'svg/mask.svg',
  skull: 'svg/skull.svg',
  leaf: 'svg/leaf.svg',
  chat: 'svg/chat.svg',

  // Documentos y utilidades
  scroll: 'svg/scroll.svg',
  book: 'svg/book.svg',
  quill: 'svg/quill.svg',
  gear: 'svg/gear.svg',
  key: 'svg/key.svg',
  camera: 'svg/camera.svg',
  monitor: 'svg/monitor.svg',
  dice: 'svg/dice.svg',
  users: 'svg/users.svg'
};

// Cache de SVGs cargados para que app.js pueda seguir usandolos como strings.
export const UI_ICONS = {};

function normalizeSvgMarkup(svgText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName === 'parsererror') return svgText;

  svg.classList.add('ui-icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.removeAttribute('width');
  svg.removeAttribute('height');

  return svg.outerHTML;
}

export async function loadIcons() {
  const entries = Object.entries(UI_ICON_PATHS);
  await Promise.all(entries.map(async ([name, path]) => {
    if (UI_ICONS[name]) return;
    const res = await fetch(path);
    if (!res.ok) throw new Error(`No se pudo cargar el icono ${name} desde ${path}`);
    UI_ICONS[name] = normalizeSvgMarkup(await res.text());
  }));
  return UI_ICONS;
}

// Inyecta iconos declarativos en el HTML mediante data-ui-icon="clave".
export function paintStaticIcons(root = document) {
  root.querySelectorAll('[data-ui-icon]').forEach(node => {
    const name = node.dataset.uiIcon;
    const svg = UI_ICONS[name];
    if (!svg) return;
    node.innerHTML = svg;
    node.classList.add('ui-icon-slot');
  });
}
