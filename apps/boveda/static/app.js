'use strict';
/* Bóveda Bryan — cliente de conocimiento cero.
   Todo se cifra y descifra en el navegador (AES-256-GCM). El servidor solo ve bloques opacos:
   ni el contenido ni los nombres de los archivos salen de aquí sin cifrar. */

const ITER = 600000;
const MAX_FILE = 200 * 1024 * 1024;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const enc = new TextEncoder();
const dec = new TextDecoder();

const store = {
  get(k, d) { try { const v = localStorage.getItem('bv.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('bv.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};

const S = {
  vk: null, token: null, slot: null, index: null, version: 0,
  folder: 'root', q: '',
  view: store.get('view', 'grid'), sort: store.get('sort', 'name'), autolock: store.get('autolock', 5),
  thumbs: new Map(), lastAct: Date.now(), hiddenAt: 0,
};

/* ---------------- iconos ---------------- */
const ICONS = {
  vault: '<rect x="3" y="4" width="18" height="15" rx="2.5"/><circle cx="12" cy="11.5" r="3.6"/><path d="M12 7.9v1M12 14.1v1M8.4 11.5h1M14.6 11.5h1M6.5 19v1.6M17.5 19v1.6"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.2h7.5A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  folderPlus: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.2h7.5A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><path d="M12 10.5v6M9 13.5h6"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/>',
  video: '<rect x="2" y="5" width="15" height="14" rx="2.5"/><path d="M17 10l5-3v10l-5-3"/>',
  note: '<path d="M5 3h14a1 1 0 0 1 1 1v11l-5 6H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M15 21v-5a1 1 0 0 1 1-1h4M8 8h8M8 12h5"/>',
  upload: '<path d="M21 15v3a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-3"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  download: '<path d="M21 15v3a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-3"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  more: '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>',
  trash: '<path d="M3 6h18M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6M19 6l-.9 13.1A2 2 0 0 1 16.1 21H7.9a2 2 0 0 1-2-1.9L5 6M10 11v6M14 11v6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  move: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.2h7.5A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><path d="M10 13.5h6M13.5 11l2.5 2.5-2.5 2.5"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  chevL: '<path d="M15 18l-6-6 6-6"/>',
  chevR: '<path d="M9 18l6-6-6-6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M16 7l3 3M18.5 4.5l2 2"/>',
  home: '<path d="M3 10.5L12 3l9 7.5"/><path d="M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><path d="M10 21v-6h4v6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  idcard: '<rect x="2" y="5" width="20" height="14" rx="2.5"/><circle cx="8" cy="11" r="2"/><path d="M5 16c.6-1.5 1.7-2.2 3-2.2s2.4.7 3 2.2M14 10h5M14 14h3"/>',
  briefcase: '<rect x="2" y="7" width="20" height="13" rx="2.5"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M2 13h20"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20M6 15h4"/>',
  car: '<path d="M3 16.5V12l2.2-5.2A2 2 0 0 1 7 5.5h10a2 2 0 0 1 1.8 1.3L21 12v4.5a1 1 0 0 1-1 1h-1M5 17.5H4a1 1 0 0 1-1-1M3 12h18M9 17.5h6"/><circle cx="7" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  cap: '<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 2 9 2 12 0v-5M22 10v5"/>',
  box: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  plane: '<path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
};
const I = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.file}</svg>`;

const COLORS = ['gold', 'blue', 'rose', 'green', 'orange', 'teal', 'violet', 'slate'];
const FICONS = ['folder', 'idcard', 'briefcase', 'heart', 'card', 'home', 'car', 'cap', 'plane', 'box', 'image', 'note', 'key', 'shield', 'star'];
const DEFAULT_FOLDERS = [
  ['Identidad', 'idcard', 'gold'], ['Trabajo y CV', 'briefcase', 'blue'], ['Salud', 'heart', 'rose'],
  ['Finanzas', 'card', 'green'], ['Hogar', 'home', 'orange'], ['Vehículo', 'car', 'teal'],
  ['Estudios', 'cap', 'violet'], ['Otros', 'box', 'slate'],
];
const KIND_ICON = { image: 'image', pdf: 'file', doc: 'file', sheet: 'file', note: 'note', video: 'video', audio: 'file', text: 'file', file: 'file' };
const MIMES = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  heic: 'image/heic', txt: 'text/plain', md: 'text/plain', csv: 'text/csv', json: 'application/json', mp4: 'video/mp4',
  mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', odt: 'application/vnd.oasis.opendocument.text',
};

/* ---------------- utilidades ---------------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ext = n => (n.includes('.') ? n.split('.').pop() : '').slice(0, 4).toUpperCase();
const guessMime = n => MIMES[ext(n).toLowerCase()] || 'application/octet-stream';
const fmtDate = t => new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
function fmtSize(b) {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return (b / 1024 ** i).toLocaleString('es-ES', { maximumFractionDigits: i ? 1 : 0 }) + ' ' + u[i];
}
function kind(it) {
  if (it.type === 'note') return 'note';
  const m = it.mime || '', n = it.name || '';
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (/sheet|excel|csv/.test(m) || /\.(xlsx?|ods|csv)$/i.test(n)) return 'sheet';
  if (/word|document|rtf/.test(m) || /\.(docx?|odt|rtf)$/i.test(n)) return 'doc';
  if (m.startsWith('text/') || /json|xml/.test(m)) return 'text';
  return 'file';
}
function greet() {
  const h = new Date().getHours();
  return h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
}
function saveFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function copyText(text, sensitive) {
  try {
    await navigator.clipboard.writeText(text);
    toast(sensitive ? 'Copiado · se borrará del portapapeles en 30 s' : 'Copiado');
    if (sensitive) setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 30000);
  } catch { toast('No se pudo copiar', 'err'); }
}

/* ---------------- criptografía ---------------- */
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const toHex = u8 => Array.from(u8, b => b.toString(16).padStart(2, '0')).join('');
const fromHex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
const newId = () => toHex(rnd(16));
const normRc = s => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

// PBKDF2 -> 512 bits: los primeros 256 cifran la clave de la bóveda, los otros 256 son el token para el servidor.
async function derive(secret, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, 512));
  const kek = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['wrapKey', 'unwrapKey']);
  return { kek, token: toHex(bits.slice(32)) };
}
async function makeSlot(secret, vk) {
  const salt = rnd(16), iv = rnd(12);
  const { kek, token } = await derive(secret, salt, ITER);
  const wrapped = new Uint8Array(await crypto.subtle.wrapKey('raw', vk, kek, { name: 'AES-GCM', iv }));
  const authHash = toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', fromHex(token))));
  return { slot: { salt: b64(salt), iter: ITER, iv: b64(iv), wrapped: b64(wrapped), authHash }, token };
}
async function seal(u8) {
  const iv = rnd(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, S.vk, u8));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return out;
}
async function unseal(u8) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.slice(0, 12) }, S.vk, u8.slice(12)));
}
function genRecovery() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (const b of rnd(25)) s += A[b % 32];
  return s.match(/.{5}/g).join('-');
}

/* ---------------- API ---------------- */
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (S.token) headers['X-Vault-Auth'] = S.token;
  const r = await fetch(path, { ...opts, headers, cache: 'no-store' });
  if (r.status === 401 && S.vk) { lock('La sesión ya no es válida. Vuelve a desbloquear.'); throw new Error('Sesión no válida'); }
  return r;
}
async function putBlob(id, data) {
  const r = await api('/api/blob/' + id, { method: 'PUT', body: data, headers: { 'Content-Type': 'application/octet-stream' } });
  if (!r.ok) throw new Error('No se pudo subir (' + r.status + ')');
}
async function getBlob(id) {
  const r = await api('/api/blob/' + id);
  if (!r.ok) throw new Error('No se pudo descargar (' + r.status + ')');
  return unseal(new Uint8Array(await r.arrayBuffer()));
}
function delBlob(id) { if (id) api('/api/blob/' + id, { method: 'DELETE' }).catch(() => {}); }
async function getVault() { return (await fetch('/api/vault', { cache: 'no-store' })).json(); }
async function checkToken(token) {
  const r = await fetch('/api/auth', { method: 'POST', headers: { 'X-Vault-Auth': token } });
  if (r.status === 429) { const j = await r.json(); throw new Error(`Demasiados intentos. Espera ${Math.ceil(j.retry / 60)} min.`); }
  return r.ok;
}

async function loadIndex() {
  const r = await api('/api/index');
  if (!r.ok) throw new Error('No se pudo leer la bóveda (' + r.status + ')');
  S.version = +r.headers.get('X-Version') || 0;
  const buf = new Uint8Array(await r.arrayBuffer());
  S.index = buf.length ? JSON.parse(dec.decode(await unseal(buf))) : null;
}
async function saveIndex() {
  const body = await seal(enc.encode(JSON.stringify(S.index)));
  const r = await api('/api/index', { method: 'PUT', body, headers: { 'X-Base-Version': String(S.version), 'Content-Type': 'application/octet-stream' } });
  if (r.status === 409) { const e = new Error('conflict'); e.conflict = true; throw e; }
  if (!r.ok) throw new Error('No se pudo guardar (' + r.status + ')');
  S.version = (await r.json()).version;
}
// Aplica un cambio al índice y lo guarda; si otro dispositivo lo cambió, recarga y reintenta.
async function mutate(fn) {
  for (let i = 0; i < 3; i++) {
    const snapshot = JSON.stringify(S.index);
    fn(S.index);
    try { await saveIndex(); render(); return; } catch (e) {
      S.index = JSON.parse(snapshot);
      if (!e.conflict) { render(); throw e; }
      await loadIndex();
    }
  }
  throw new Error('No se pudo guardar: la bóveda cambió en otro dispositivo. Inténtalo de nuevo.');
}
const emptyIndex = () => ({ v: 1, folders: DEFAULT_FOLDERS.map(([name, icon, color]) => ({ id: newId(), name, parent: 'root', icon, color })), items: [] });

async function createVault(pw) {
  const vk = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const rc = genRecovery();
  const p = await makeSlot(pw, vk), r = await makeSlot(normRc(rc), vk);
  const res = await fetch('/api/vault/init', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slots: { password: p.slot, recovery: r.slot } }) });
  if (!res.ok) throw new Error(res.status === 409 ? 'La bóveda ya existe. Recarga la página.' : 'No se pudo crear (' + res.status + ')');
  Object.assign(S, { vk, token: p.token, slot: 'password', version: 0, index: emptyIndex() });
  await saveIndex();
  return rc;
}
async function tryUnlock(secret, slotName) {
  const slot = (await getVault()).slots[slotName];
  const { kek, token } = await derive(secret, unb64(slot.salt), slot.iter);
  if (!await checkToken(token)) throw new Error(slotName === 'password' ? 'Contraseña incorrecta' : 'Código de recuperación incorrecto');
  const vk = await crypto.subtle.unwrapKey('raw', unb64(slot.wrapped), kek, { name: 'AES-GCM', iv: unb64(slot.iv) }, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  Object.assign(S, { vk, token, slot: slotName });
  await loadIndex();
  if (!S.index) { S.index = emptyIndex(); await saveIndex(); }
}
async function putSlot(name, secret) {
  const { slot, token } = await makeSlot(secret, S.vk);
  const r = await api('/api/vault/slot/' + name, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(slot) });
  if (!r.ok) throw new Error('No se pudo guardar (' + r.status + ')');
  if (name === S.slot) S.token = token;
}

/* ---------------- índice ---------------- */
const F = id => S.index.folders.find(f => f.id === id);
const getItem = id => S.index.items.find(i => i.id === id);
const isFolderId = id => !!(S.index && F(id));
const targetFolder = () => (isFolderId(S.folder) ? S.folder : 'root');
const childFolders = id => S.index.folders.filter(f => f.parent === id);
const itemsIn = id => S.index.items.filter(i => i.folder === id);
function descendants(id) {
  const out = [];
  const walk = p => childFolders(p).forEach(f => { out.push(f.id); walk(f.id); });
  walk(id);
  return out;
}
function pathOf(id) {
  const p = [];
  for (let f = F(id); f; f = F(f.parent)) p.unshift(f);
  return p;
}
function countIn(id) {
  const ids = new Set([id, ...descendants(id)]);
  return S.index.items.filter(i => ids.has(i.folder)).length;
}
function sortItems(arr) {
  const byName = (a, b) => a.name.localeCompare(b.name, 'es', { numeric: true });
  const by = {
    name: byName, date: (a, b) => b.modified - a.modified,
    size: (a, b) => (b.size || 0) - (a.size || 0), type: (a, b) => kind(a).localeCompare(kind(b)) || byName(a, b),
  };
  return [...arr].sort(by[S.sort] || byName);
}

/* ---------------- pantallas de acceso ---------------- */
function renderLock(mode, msg) {
  closeAll();
  const setup = mode === 'setup', rec = mode === 'recovery';
  $('#app').innerHTML = `
  <div class="lockscreen">
    <div class="lock-card">
      <div class="lock-logo">${I('vault')}</div>
      <h1>Bóveda <span>Bryan</span></h1>
      <p class="muted">${setup ? 'Crea tu contraseña maestra. Todo se cifra en tu dispositivo antes de subirse.' : rec ? 'Introduce tu código de recuperación.' : 'Tus documentos, cifrados de extremo a extremo.'}</p>
      <form id="lockForm" autocomplete="on">
        <input type="text" name="username" autocomplete="username" value="bryan" class="sr" tabindex="-1" aria-hidden="true">
        <div class="field">
          <input class="inp" id="pw1" name="password" type="${rec ? 'text' : 'password'}" required
            ${rec ? 'autocapitalize="characters" spellcheck="false" autocomplete="off"' : `autocomplete="${setup ? 'new-password' : 'current-password'}"`}
            placeholder="${rec ? 'XXXXX-XXXXX-XXXXX-XXXXX-XXXXX' : 'Contraseña maestra'}">
          ${rec ? '' : `<button type="button" class="eye" aria-label="Mostrar contraseña">${I('eye')}</button>`}
        </div>
        ${setup ? `<div class="field"><input class="inp" id="pw2" type="password" autocomplete="new-password" placeholder="Repite la contraseña" required></div>
          <div class="meter"><i></i></div><p class="hint" id="hint">Mínimo 12 caracteres. Mejor una frase larga que solo tú conozcas.</p>` : ''}
        <button class="btn primary block" id="go">${I(setup ? 'shield' : 'key')}<span>${setup ? 'Crear bóveda' : 'Desbloquear'}</span></button>
        <div class="err" id="err"></div>
      </form>
      ${setup ? '' : `<button class="link" id="swap">${rec ? 'Usar la contraseña maestra' : '¿Olvidaste la contraseña? Usar código de recuperación'}</button>`}
    </div>
    <div class="lock-foot">${I('shield')} AES-256-GCM · PBKDF2-SHA256 600.000 · Conocimiento cero</div>
  </div>`;
  $('#go').style.marginTop = '14px';
  $('#err').textContent = msg || '';
  const pw1 = $('#pw1');
  $('.eye')?.addEventListener('click', () => { pw1.type = pw1.type === 'password' ? 'text' : 'password'; pw1.focus(); });
  $('#swap')?.addEventListener('click', () => renderLock(rec ? 'unlock' : 'recovery'));
  if (setup) {
    pw1.addEventListener('input', () => {
      const v = pw1.value;
      const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter(r => r.test(v)).length;
      const score = v.length < 12 ? Math.min(1, v.length / 12) * .3 : Math.min(1, .4 + (v.length - 12) / 20 + classes * .1);
      const bar = $('.meter i');
      bar.style.width = Math.round(score * 100) + '%';
      bar.style.background = score < .4 ? 'var(--danger)' : score < .75 ? 'var(--gold)' : 'var(--ok)';
      $('#hint').textContent = v.length < 12 ? `Faltan ${12 - v.length} caracteres.` : score < .75 ? 'Aceptable. Más larga = más segura.' : 'Contraseña fuerte.';
    });
  }
  $('#lockForm').addEventListener('submit', async e => {
    e.preventDefault();
    const go = $('#go'), err = $('#err'), v1 = pw1.value;
    err.textContent = '';
    if (setup && v1.length < 12) { err.textContent = 'Mínimo 12 caracteres.'; return; }
    if (setup && v1 !== $('#pw2').value) { err.textContent = 'Las contraseñas no coinciden.'; return; }
    const label = $('span', go), orig = label.textContent;
    go.disabled = true; go.classList.add('busy');
    label.textContent = setup ? 'Generando claves…' : 'Descifrando…';
    try {
      if (setup) { renderRecovery(await createVault(v1)); return; }
      await tryUnlock(rec ? normRc(v1) : v1, rec ? 'recovery' : 'password');
      if (rec) forceNewPassword(); else enterApp();
    } catch (x) {
      err.textContent = x.message || 'Error';
      go.disabled = false; go.classList.remove('busy'); label.textContent = orig;
      const f = $('#lockForm'); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
      pw1.select();
    }
  });
  pw1.focus();
}

function recoveryCodeHtml(rc) {
  return `<div class="rc">${esc(rc)}</div>
    <div class="row"><button class="btn ghost" data-rc="copy">${I('copy')}<span>Copiar</span></button>
    <button class="btn ghost" data-rc="dl">${I('download')}<span>Descargar .txt</span></button></div>`;
}
function wireRecoveryButtons(root, rc) {
  $('[data-rc="copy"]', root).onclick = () => copyText(rc);
  $('[data-rc="dl"]', root).onclick = () => saveFile(new Blob([
    `Bóveda Bryan — código de recuperación\n\n${rc}\n\nGenerado: ${new Date().toLocaleString('es-ES')}\n` +
    'Guárdalo FUERA de la bóveda (impreso o en tu gestor de contraseñas).\n'], { type: 'text/plain' }), 'boveda-codigo-recuperacion.txt');
}
function renderRecovery(rc) {
  $('#app').innerHTML = `
  <div class="lockscreen"><div class="lock-card wide">
    <div class="lock-logo ok">${I('key')}</div>
    <h1>Código de <span>recuperación</span></h1>
    <p class="muted">Es la <b>única</b> forma de entrar si olvidas la contraseña. Guárdalo fuera de la bóveda: impreso o en tu gestor de contraseñas. Solo se muestra ahora.</p>
    ${recoveryCodeHtml(rc)}
    <label class="check"><input type="checkbox" id="ok"><span>Lo he guardado en un lugar seguro</span></label>
    <button class="btn primary block" id="go" disabled>${I('check')}<span>Entrar en mi bóveda</span></button>
  </div></div>`;
  wireRecoveryButtons($('#app'), rc);
  $('#ok').onchange = e => { $('#go').disabled = !e.target.checked; };
  $('#go').onclick = enterApp;
}
function passwordFields(withCurrent) {
  return `<input type="text" autocomplete="username" value="bryan" class="sr" tabindex="-1" aria-hidden="true">
    ${withCurrent ? '<label class="lbl">Contraseña actual</label><input class="inp p0" type="password" autocomplete="current-password">' : ''}
    <label class="lbl">Nueva contraseña</label><input class="inp p1" type="password" autocomplete="new-password" placeholder="Mínimo 12 caracteres">
    <label class="lbl">Repítela</label><input class="inp p2" type="password" autocomplete="new-password">
    <div class="err"></div>`;
}
function forceNewPassword() {
  const m = modal({ title: 'Crea una nueva contraseña', cls: 'narrow', dismiss: false });
  m.body.innerHTML = `<p class="ptext">Has entrado con el código de recuperación. Elige una nueva contraseña maestra.</p>${passwordFields(false)}`;
  const err = $('.err', m.body);
  const save = btn('Guardar y entrar', 'primary', 'check', async () => {
    const p1 = $('.p1', m.body).value;
    if (p1.length < 12) { err.textContent = 'Mínimo 12 caracteres.'; return; }
    if (p1 !== $('.p2', m.body).value) { err.textContent = 'No coinciden.'; return; }
    save.disabled = true;
    try { await putSlot('password', p1); m.close(); enterApp(); toast('Contraseña cambiada. Te recomiendo generar un código de recuperación nuevo en Ajustes.', 'ok', 6000); } catch (x) { err.textContent = x.message; save.disabled = false; }
  });
  m.foot.append(save);
  setTimeout(() => $('.p1', m.body).focus(), 60);
}

/* ---------------- aplicación ---------------- */
function enterApp() {
  S.folder = 'root'; S.q = ''; S.lastAct = Date.now();
  buildShell();
  render();
  setupInbox();
}

function buildShell() {
  $('#app').innerHTML = `
  <div class="shell">
    <aside class="side" id="side">
      <div class="brand"><div class="logo">${I('vault')}</div><div><b>Bóveda</b><small>Bryan</small></div></div>
      <nav id="nav"></nav>
      <div class="side-foot"><div id="usage"></div><div class="e2e">${I('shield')}Cifrado de extremo a extremo</div></div>
    </aside>
    <div class="scrim" id="scrim"></div>
    <main class="main">
      <header class="top">
        <button class="icon-btn only-m" id="menuBtn" aria-label="Menú">${I('menu')}</button>
        <label class="search">${I('search')}<input id="q" type="search" placeholder="Buscar en la bóveda…" autocomplete="off" enterkeyhint="search"><kbd>/</kbd></label>
        <div class="top-actions">
          <select class="sel" id="sort" aria-label="Ordenar">
            <option value="name">Nombre</option><option value="date">Fecha</option><option value="size">Tamaño</option><option value="type">Tipo</option>
          </select>
          <button class="icon-btn" id="viewBtn" aria-label="Cambiar vista"></button>
          <button class="icon-btn" id="setBtn" aria-label="Ajustes">${I('settings')}</button>
          <button class="lock-btn" id="lockBtn" title="Bloquear ahora">${I('lock')}<span id="lockLeft"></span></button>
        </div>
      </header>
      <div class="bar">
        <div class="crumbs" id="crumbs"></div>
        <div class="bar-actions">
          <button class="btn ghost" id="newFolder">${I('folderPlus')}<span>Carpeta</span></button>
          <button class="btn ghost" id="newNote">${I('note')}<span>Nota</span></button>
          <button class="btn primary" id="upBtn">${I('upload')}<span>Subir</span></button>
        </div>
      </div>
      <section class="content" id="content"></section>
    </main>
    <div class="drop" id="drop"><div>${I('upload')}<b>Suelta para cifrar y guardar</b><span id="dropTo"></span></div></div>
    <button class="fab only-m" id="fab" aria-label="Añadir">${I('plus')}</button>
  </div>`;

  const q = $('#q');
  let qt;
  q.addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => { S.q = q.value.trim(); render(); }, 140); });
  $('#sort').value = S.sort;
  $('#sort').onchange = e => { S.sort = e.target.value; store.set('sort', S.sort); render(); };
  $('#viewBtn').onclick = () => { S.view = S.view === 'grid' ? 'list' : 'grid'; store.set('view', S.view); render(); };
  $('#setBtn').onclick = settingsDialog;
  $('#lockBtn').onclick = () => lock();
  $('#upBtn').onclick = () => $('#picker').click();
  $('#newFolder').onclick = () => folderDialog();
  $('#newNote').onclick = () => noteDialog();
  $('#menuBtn').onclick = () => { $('#side').classList.add('open'); $('#scrim').classList.add('on'); };
  $('#scrim').onclick = closeDrawer;
  $('#fab').onclick = () => menu($('#fab'), [
    { icon: 'upload', label: 'Subir fotos o archivos', run: () => $('#picker').click() },
    { icon: 'note', label: 'Nueva nota', run: () => noteDialog() },
    { icon: 'folderPlus', label: 'Nueva carpeta', run: () => folderDialog() },
  ]);

  const nav = (e) => {
    const g = e.target.closest('[data-go]');
    if (g) return go(g.dataset.go);
    if (e.target.closest('#navAdd')) folderDialog();
  };
  $('#nav').addEventListener('click', nav);
  $('#crumbs').addEventListener('click', nav);

  const c = $('#content');
  c.addEventListener('click', e => {
    const more = e.target.closest('[data-more]');
    if (more) { e.stopPropagation(); return itemMenu(getItem(more.dataset.more), more); }
    const mf = e.target.closest('[data-more-folder]');
    if (mf) { e.stopPropagation(); return folderMenu(F(mf.dataset.moreFolder), mf); }
    const act = e.target.closest('[data-action]');
    if (act) return ACTIONS[act.dataset.action]?.();
    const ft = e.target.closest('[data-folder]');
    if (ft) return go(ft.dataset.folder);
    const card = e.target.closest('.card[data-id]');
    if (card) openItem(getItem(card.dataset.id), card);
  });
  c.addEventListener('contextmenu', e => {
    const card = e.target.closest('.card[data-id]'), ft = e.target.closest('[data-folder]');
    if (!card && !ft) return;
    e.preventDefault();
    const at = { x: e.clientX, y: e.clientY };
    card ? itemMenu(getItem(card.dataset.id), at) : folderMenu(F(ft.dataset.folder), at);
  });
  c.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.card, .ftile')) e.target.click(); });
  c.addEventListener('dragstart', e => {
    const card = e.target.closest('.card[data-id]'), ft = e.target.closest('.ftile[data-folder]');
    const v = card ? { t: 'item', id: card.dataset.id } : ft ? { t: 'folder', id: ft.dataset.folder } : null;
    if (!v) return;
    e.dataTransfer.setData('application/x-boveda', JSON.stringify(v));
    e.dataTransfer.effectAllowed = 'move';
  });
}
const ACTIONS = { upload: () => $('#picker').click(), 'new-folder': () => folderDialog(), 'new-note': () => noteDialog() };

function closeDrawer() { $('#side')?.classList.remove('open'); $('#scrim')?.classList.remove('on'); }
function go(id) {
  S.folder = id; S.q = '';
  const q = $('#q'); if (q) q.value = '';
  closeDrawer(); render();
  $('#content').scrollTop = 0;
}

function render() {
  if (!S.index || !$('#content')) return;
  if (!['root', 'recent', 'notes'].includes(S.folder) && !F(S.folder)) S.folder = 'root';
  renderNav(); renderCrumbs(); renderContent();
  const n = S.index.items.length, b = S.index.items.reduce((a, i) => a + (i.size || 0), 0);
  $('#usage').innerHTML = `<b>${n}</b> elementos · <b>${fmtSize(b)}</b>`;
  $('#viewBtn').innerHTML = I(S.view === 'grid' ? 'list' : 'grid');
}
function renderNav() {
  const inside = fid => S.folder === fid || pathOf(S.folder).some(p => p.id === fid);
  const notes = S.index.items.filter(i => i.type === 'note').length;
  const on = id => (!S.q && S.folder === id ? 'on' : '');
  $('#nav').innerHTML = `
    <button class="nav-i ${on('root')}" data-go="root" data-drop="root">${I('home')}<span>Inicio</span></button>
    <button class="nav-i ${on('recent')}" data-go="recent">${I('clock')}<span>Recientes</span></button>
    <button class="nav-i ${on('notes')}" data-go="notes">${I('note')}<span>Notas</span><em>${notes}</em></button>
    <div class="nav-h">Carpetas</div>
    ${childFolders('root').map(f => `<button class="nav-i fold c-${esc(f.color || 'slate')} ${!S.q && inside(f.id) ? 'on' : ''}" data-go="${f.id}" data-drop="${f.id}">${I(f.icon || 'folder')}<span>${esc(f.name)}</span><em>${countIn(f.id)}</em></button>`).join('')}
    <button class="nav-i add" id="navAdd">${I('plus')}<span>Nueva carpeta</span></button>`;
}
function renderCrumbs() {
  const parts = [`<button data-go="root" data-drop="root">${I('home')}<span>Inicio</span></button>`];
  if (S.q) parts.push(`<span class="cur">Resultados de “${esc(S.q)}”</span>`);
  else if (S.folder === 'recent') parts.push('<span class="cur">Recientes</span>');
  else if (S.folder === 'notes') parts.push('<span class="cur">Notas</span>');
  else {
    const p = pathOf(S.folder);
    p.forEach((f, i) => parts.push(i === p.length - 1
      ? `<span class="cur">${esc(f.name)}</span>`
      : `<button data-go="${f.id}" data-drop="${f.id}">${esc(f.name)}</button>`));
  }
  $('#crumbs').innerHTML = parts.join(`<i class="sep">${I('chevR')}</i>`);
}

const section = (title, inner, folders) => `<section class="sec">${title ? `<h4>${esc(title)}</h4>` : ''}<div class="${folders ? 'ftiles' : 'items'}">${inner}</div></section>`;
const folderTiles = (fs, addTile) => fs.map(f => `
  <div class="ftile c-${esc(f.color || 'slate')}" data-folder="${f.id}" data-drop="${f.id}" draggable="true" tabindex="0">
    <div class="ficon">${I(f.icon || 'folder')}</div>
    <div class="fmeta"><b>${esc(f.name)}</b><span>${countIn(f.id)} elementos</span></div>
    <button class="more" data-more-folder="${f.id}" aria-label="Opciones de carpeta">${I('more')}</button>
  </div>`).join('') + (addTile ? `<button class="ftile add" data-action="new-folder">${I('plus')}<span>Nueva carpeta</span></button>` : '');
function itemsHtml(items, showPath) {
  return items.map(it => {
    const k = kind(it);
    const path = showPath ? (pathOf(it.folder).map(f => f.name).join(' / ') || 'Inicio') + ' · ' : '';
    const vis = k === 'note'
      ? `<div class="note-mask">${I('note')}<span>•••• ••••</span></div>`
      : `${I(KIND_ICON[k])}<b class="ext">${esc(ext(it.name) || k.toUpperCase())}</b>`;
    return `<div class="card k-${k}" data-id="${it.id}" draggable="true" tabindex="0">
      <div class="thumb">${it.thumb ? `<img alt="" data-thumb="${it.thumb}">` : ''}<div class="ph">${vis}</div></div>
      <div class="meta"><div class="name" title="${esc(it.name)}">${esc(it.name)}</div>
      <div class="sub">${esc(path)}${k === 'note' ? 'Nota' : fmtSize(it.size)} · ${fmtDate(it.modified)}</div></div>
      <button class="more" data-more="${it.id}" aria-label="Opciones">${I('more')}</button></div>`;
  }).join('');
}
const emptyState = () => `<div class="empty">${I('upload')}<b>Esta carpeta está vacía</b>
  <span>Arrastra archivos aquí o pulsa «Subir». Se cifran antes de salir de tu dispositivo.</span>
  <button class="btn primary" data-action="upload">${I('upload')}<span>Subir archivos</span></button></div>`;

function renderContent() {
  const c = $('#content');
  c.className = 'content ' + S.view;
  let html = '';
  if (S.q) {
    const q = S.q.toLowerCase();
    const fs = S.index.folders.filter(f => f.name.toLowerCase().includes(q));
    const its = sortItems(S.index.items.filter(i => i.name.toLowerCase().includes(q) || (i.type === 'note' && (i.text || '').toLowerCase().includes(q))));
    if (fs.length) html += section('Carpetas', folderTiles(fs), true);
    if (its.length) html += section('Archivos y notas', itemsHtml(its, true));
    if (!fs.length && !its.length) html = `<div class="empty">${I('search')}<b>Sin resultados</b><span>Nada coincide con “${esc(S.q)}”.</span></div>`;
  } else if (S.folder === 'root') {
    const total = S.index.items.reduce((a, i) => a + (i.size || 0), 0);
    const recent = [...S.index.items].sort((a, b) => b.modified - a.modified).slice(0, 6);
    const loose = sortItems(itemsIn('root'));
    html += `<div class="hero"><div><h2>${greet()}, Bryan</h2><p>${S.index.items.length} elementos · ${fmtSize(total)} cifrados</p></div>
      <div class="hero-badge">${I('shield')}<span>Cifrado AES-256 en tu dispositivo</span></div></div>`;
    html += section('Carpetas', folderTiles(childFolders('root'), true), true);
    if (recent.length) html += section('Recientes', itemsHtml(recent, true));
    if (loose.length) html += section('Sueltos en Inicio', itemsHtml(loose));
    if (!S.index.items.length) html += emptyState();
  } else if (S.folder === 'recent' || S.folder === 'notes') {
    const its = S.folder === 'recent'
      ? [...S.index.items].sort((a, b) => b.modified - a.modified).slice(0, 48)
      : sortItems(S.index.items.filter(i => i.type === 'note'));
    html = its.length ? section('', itemsHtml(its, true))
      : `<div class="empty">${I(S.folder === 'notes' ? 'note' : 'clock')}<b>${S.folder === 'notes' ? 'Aún no hay notas' : 'Nada reciente'}</b>
         <span>${S.folder === 'notes' ? 'Guarda datos sueltos como el número de la Seguridad Social, IBAN o pólizas.' : 'Lo que subas aparecerá aquí.'}</span>
         ${S.folder === 'notes' ? `<button class="btn primary" data-action="new-note">${I('plus')}<span>Nueva nota</span></button>` : ''}</div>`;
  } else {
    const fs = childFolders(S.folder), its = sortItems(itemsIn(S.folder));
    if (fs.length) html += section('Subcarpetas', folderTiles(fs), true);
    if (its.length) html += section(fs.length ? 'Archivos' : '', itemsHtml(its));
    if (!fs.length && !its.length) html = emptyState();
  }
  c.innerHTML = html;
  lazyThumbs(c);
}

let io;
function lazyThumbs(root) {
  io?.disconnect();
  io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { io.unobserve(e.target); loadThumb(e.target); }
  }), { rootMargin: '300px' });
  $$('img[data-thumb]', root).forEach(img => io.observe(img));
}
async function loadThumb(img) {
  const id = img.dataset.thumb;
  try {
    let url = S.thumbs.get(id);
    if (!url) {
      const d = await getBlob(id);
      if (!S.vk) return;
      url = URL.createObjectURL(new Blob([d], { type: 'image/jpeg' }));
      S.thumbs.set(id, url);
    }
    img.onload = () => img.closest('.thumb')?.classList.add('has-img');
    img.src = url;
  } catch { /* sin miniatura */ }
}

/* ---------------- subir ---------------- */
async function makeThumb(file) {
  const bmp = await createImageBitmap(file);
  const sc = Math.min(1, 420 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * sc); cv.height = Math.round(bmp.height * sc);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close?.();
  const b = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.82));
  return b ? new Uint8Array(await b.arrayBuffer()) : null;
}
async function uploadFiles(files, folder) {
  const list = [...files];
  if (!list.length || !S.vk) return;
  const t = progressToast(`Cifrando ${list.length} archivo(s)…`);
  const added = [];
  try {
    for (const [n, f] of list.entries()) {
      S.lastAct = Date.now();
      t.update(`Cifrando y subiendo ${n + 1} de ${list.length}: ${f.name}`, n / list.length);
      if (f.size > MAX_FILE) { toast(`${f.name}: supera los 200 MB`, 'err'); continue; }
      const mime = f.type || guessMime(f.name);
      let thumb = null;
      if (mime.startsWith('image/')) {
        try { const tb = await makeThumb(f); if (tb) { thumb = newId(); await putBlob(thumb, await seal(tb)); } } catch { thumb = null; }
      }
      const blob = newId();
      await putBlob(blob, await seal(new Uint8Array(await f.arrayBuffer())));
      const now = Date.now();
      added.push({ id: newId(), type: 'file', name: f.name, mime, size: f.size, folder, blob, thumb, created: now, modified: now });
    }
    if (added.length) await mutate(ix => ix.items.push(...added));
    t.done(added.length ? `${added.length} archivo(s) guardado(s) en la bóveda` : '');
  } catch (x) {
    added.forEach(a => { delBlob(a.blob); delBlob(a.thumb); });
    t.done('Error al subir: ' + x.message, 'err');
  }
}

/* ---------------- abrir / descargar ---------------- */
async function downloadItem(it) {
  try {
    const d = await getBlob(it.blob);
    saveFile(new Blob([d], { type: it.mime || 'application/octet-stream' }), it.name);
  } catch (x) { toast(x.message, 'err'); }
}
function openItem(it, card) {
  if (!it) return;
  if (it.type === 'note') return noteDialog(it);
  const group = card ? $$('.card[data-id]', card.parentElement).map(c => getItem(c.dataset.id)).filter(x => x && x.type !== 'note') : [it];
  showViewer(group, Math.max(0, group.findIndex(x => x.id === it.id)));
}
function showViewer(group, start) {
  let url = null, cur = start, ticket = 0;
  const keys = e => {
    if (e.key === 'ArrowLeft') show(cur - 1);
    if (e.key === 'ArrowRight') show(cur + 1);
  };
  const m = modal({
    title: '', cls: 'viewer',
    onClose: () => { if (url) URL.revokeObjectURL(url); document.removeEventListener('keydown', keys); },
  });
  m.head.append(
    btn('Abrir', 'ghost sm', 'eye', () => url && window.open(url, '_blank', 'noopener')),
    btn('Descargar', 'ghost sm', 'download', () => downloadItem(group[cur])),
  );
  m.body.innerHTML = `<div class="stage"></div>${group.length > 1 ? `<button class="nav prev" aria-label="Anterior">${I('chevL')}</button><button class="nav next" aria-label="Siguiente">${I('chevR')}</button>` : ''}`;
  const stage = $('.stage', m.body);
  async function show(i) {
    cur = (i + group.length) % group.length;
    const it = group[cur], my = ++ticket;
    $('h3', m.el).textContent = it.name;
    stage.innerHTML = '<div class="spin"></div>';
    if (url) { URL.revokeObjectURL(url); url = null; }
    try {
      const data = await getBlob(it.blob);
      if (my !== ticket) return;
      url = URL.createObjectURL(new Blob([data], { type: it.mime || 'application/octet-stream' }));
      const k = kind(it);
      if (k === 'image') stage.innerHTML = `<img src="${url}" alt="">`;
      else if (k === 'pdf') stage.innerHTML = `<iframe src="${url}" title="${esc(it.name)}"></iframe>`;
      else if (k === 'video') stage.innerHTML = `<video src="${url}" controls playsinline></video>`;
      else if (k === 'audio') stage.innerHTML = `<audio src="${url}" controls></audio>`;
      else if (k === 'text') { stage.innerHTML = '<pre></pre>'; $('pre', stage).textContent = dec.decode(data.slice(0, 2e6)); }
      else stage.innerHTML = `<div class="noprev">${I('file')}<b>${esc(it.name)}</b><span>${fmtSize(it.size)} · Sin vista previa. Usa «Descargar».</span></div>`;
    } catch (x) {
      if (my === ticket) stage.innerHTML = `<div class="noprev">${I('close')}<b>No se pudo abrir</b><span>${esc(x.message)}</span></div>`;
    }
  }
  $('.prev', m.body)?.addEventListener('click', () => show(cur - 1));
  $('.next', m.body)?.addEventListener('click', () => show(cur + 1));
  if (group.length > 1) {
    document.addEventListener('keydown', keys);
    let x0 = null;
    stage.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    stage.addEventListener('touchend', e => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 60) show(cur + (dx < 0 ? 1 : -1));
    });
  }
  show(cur);
}

/* ---------------- notas ---------------- */
function noteDialog(it) {
  const isNew = !it;
  const m = modal({ title: isNew ? 'Nueva nota' : 'Nota', backdrop: false });
  m.body.innerHTML = `<input class="inp ntitle" maxlength="120" placeholder="Título (ej. Nº Seguridad Social)">
    <textarea class="inp ntext" rows="9" spellcheck="false" placeholder="Número de la SS, IBAN, nº de póliza, matrícula…"></textarea>
    <p class="hint">${I('shield')}Se cifra en tu dispositivo antes de guardarse.</p>`;
  const t = $('.ntitle', m.body), x = $('.ntext', m.body);
  t.value = it?.name || ''; x.value = it?.text || '';
  const save = btn('Guardar', 'primary', 'check', async () => {
    const name = t.value.trim() || 'Nota sin título', text = x.value, now = Date.now(), size = enc.encode(text).length;
    save.disabled = true;
    try {
      if (isNew) await mutate(ix => ix.items.push({ id: newId(), type: 'note', name, text, size, folder: targetFolder(), created: now, modified: now }));
      else await mutate(ix => { const y = ix.items.find(z => z.id === it.id); if (y) Object.assign(y, { name, text, size, modified: now }); });
      m.close(); toast('Nota guardada');
    } catch (e) { save.disabled = false; toast(e.message, 'err'); }
  });
  m.foot.append(btn('Copiar texto', 'ghost', 'copy', () => copyText(x.value, true)), btn('Cancelar', 'ghost', null, m.close), save);
  setTimeout(() => (isNew ? t : x).focus(), 60);
}

/* ---------------- menús ---------------- */
function menu(anchor, entries) {
  closeMenu();
  const root = $('#ctx');
  const m = document.createElement('div');
  m.className = 'ctx';
  m.innerHTML = entries.map((en, i) => en === '-' ? '<hr>'
    : `<button data-i="${i}" class="${en.danger ? 'danger' : ''}">${I(en.icon)}<span>${esc(en.label)}</span></button>`).join('');
  root.append(m);
  root.classList.add('open');
  m.addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    closeMenu();
    entries[+b.dataset.i].run();
  });
  if (matchMedia('(max-width: 860px)').matches) { m.classList.add('sheet'); root.classList.add('dim'); return; }
  const r = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const w = m.offsetWidth, h = m.offsetHeight;
  let x = Math.min(r.left, innerWidth - w - 8), y = r.bottom + 6;
  if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 6);
  m.style.left = Math.max(8, x) + 'px';
  m.style.top = y + 'px';
}
function closeMenu() { const root = $('#ctx'); root.innerHTML = ''; root.classList.remove('open', 'dim'); }
function itemMenu(it, anchor) {
  if (!it) return;
  const note = it.type === 'note';
  menu(anchor, [
    { icon: note ? 'edit' : 'eye', label: note ? 'Abrir y editar' : 'Abrir', run: () => openItem(it, anchor instanceof Element ? anchor.closest('.card') : null) },
    note ? { icon: 'copy', label: 'Copiar contenido', run: () => copyText(it.text || '', true) }
      : { icon: 'download', label: 'Descargar', run: () => downloadItem(it) },
    { icon: 'edit', label: 'Renombrar', run: () => renameItem(it) },
    { icon: 'move', label: 'Mover a…', run: () => moveDialog('item', it) },
    '-',
    { icon: 'trash', label: 'Eliminar', danger: true, run: () => deleteItem(it) },
  ]);
}
function folderMenu(f, anchor) {
  if (!f) return;
  menu(anchor, [
    { icon: 'folder', label: 'Abrir', run: () => go(f.id) },
    { icon: 'edit', label: 'Editar nombre, color e icono', run: () => folderDialog(f) },
    { icon: 'move', label: 'Mover a…', run: () => moveDialog('folder', f) },
    '-',
    { icon: 'trash', label: 'Eliminar carpeta', danger: true, run: () => deleteFolder(f) },
  ]);
}

/* ---------------- diálogos ---------------- */
function btn(label, cls, icon, onClick) {
  const b = document.createElement('button');
  b.className = 'btn ' + cls;
  b.innerHTML = (icon ? I(icon) : '') + `<span>${esc(label)}</span>`;
  b.onclick = onClick;
  return b;
}
function modal({ title, cls = '', dismiss = true, backdrop = true, onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'mwrap';
  wrap.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">
    <div class="mh"><h3></h3><div class="mh-a"></div>${dismiss ? `<button class="icon-btn" data-x aria-label="Cerrar">${I('close')}</button>` : ''}</div>
    <div class="mb"></div><div class="mf"></div></div>`;
  $('h3', wrap).textContent = title;
  $('#modals').append(wrap);
  requestAnimationFrame(() => wrap.classList.add('in'));
  let closed = false;
  const m = {
    el: wrap, body: $('.mb', wrap), foot: $('.mf', wrap), head: $('.mh-a', wrap),
    close() { if (closed) return; closed = true; wrap.remove(); onClose?.(); },
  };
  wrap._m = m;
  wrap.dataset.dismiss = dismiss ? '1' : '';
  if (dismiss) {
    $('[data-x]', wrap).onclick = m.close;
    if (backdrop) wrap.addEventListener('mousedown', e => { if (e.target === wrap) m.close(); });
  }
  return m;
}
function closeAll() { $$('#modals .mwrap').forEach(w => w._m?.close()); closeMenu(); }
function ask({ title, label, value = '', ok = 'Guardar' }) {
  return new Promise(res => {
    const m = modal({ title, cls: 'narrow', onClose: () => res(null) });
    m.body.innerHTML = `<label class="lbl">${esc(label)}</label><input class="inp askv" maxlength="200">`;
    const inp = $('.askv', m.body);
    inp.value = value;
    const done = () => { const v = inp.value.trim(); if (!v) return inp.focus(); res(v); m.close(); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') done(); });
    m.foot.append(btn('Cancelar', 'ghost', null, m.close), btn(ok, 'primary', 'check', done));
    setTimeout(() => { inp.focus(); const dot = value.lastIndexOf('.'); inp.setSelectionRange(0, dot > 0 ? dot : value.length); }, 60);
  });
}
function confirmDlg({ title, text, ok = 'Eliminar', danger = true }) {
  return new Promise(res => {
    const m = modal({ title, cls: 'narrow', onClose: () => res(false) });
    m.body.innerHTML = `<p class="ptext">${esc(text)}</p>`;
    m.foot.append(btn('Cancelar', 'ghost', null, m.close), btn(ok, danger ? 'danger' : 'primary', danger ? 'trash' : 'check', () => { res(true); m.close(); }));
  });
}
function folderDialog(f) {
  const isNew = !f;
  const st = { color: f?.color || 'gold', icon: f?.icon || 'folder' };
  const m = modal({ title: isNew ? 'Nueva carpeta' : 'Editar carpeta', cls: 'narrow' });
  m.body.innerHTML = `<div class="fprev"></div>
    <label class="lbl">Nombre</label><input class="inp fname" maxlength="60" placeholder="Ej. Contratos">
    <label class="lbl">Color</label><div class="swatches">${COLORS.map(c => `<button class="sw c-${c}" data-c="${c}" aria-label="${c}"></button>`).join('')}</div>
    <label class="lbl">Icono</label><div class="icons">${FICONS.map(i => `<button class="ib" data-ic="${i}" aria-label="${i}">${I(i)}</button>`).join('')}</div>`;
  const inp = $('.fname', m.body);
  inp.value = f?.name || '';
  const paint = () => {
    const p = $('.fprev', m.body);
    p.className = 'fprev c-' + st.color;
    p.innerHTML = `<div class="ficon">${I(st.icon)}</div><b></b>`;
    $('b', p).textContent = inp.value || 'Nueva carpeta';
    $$('.sw', m.body).forEach(b => b.classList.toggle('on', b.dataset.c === st.color));
    $$('.ib', m.body).forEach(b => b.classList.toggle('on', b.dataset.ic === st.icon));
  };
  m.body.addEventListener('click', e => {
    const s = e.target.closest('[data-c]'); if (s) { st.color = s.dataset.c; paint(); }
    const ic = e.target.closest('[data-ic]'); if (ic) { st.icon = ic.dataset.ic; paint(); }
  });
  inp.addEventListener('input', paint);
  paint();
  const save = async () => {
    const name = inp.value.trim();
    if (!name) return inp.focus();
    try {
      if (isNew) {
        const parent = targetFolder();
        await mutate(ix => ix.folders.push({ id: newId(), name, parent, icon: st.icon, color: st.color }));
        toast('Carpeta creada');
      } else {
        await mutate(ix => { const x = ix.folders.find(y => y.id === f.id); if (x) Object.assign(x, { name, icon: st.icon, color: st.color }); });
      }
      m.close();
    } catch (e) { toast(e.message, 'err'); }
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  m.foot.append(btn('Cancelar', 'ghost', null, m.close), btn(isNew ? 'Crear' : 'Guardar', 'primary', 'check', save));
  setTimeout(() => inp.focus(), 60);
}
async function renameItem(it) {
  const name = await ask({ title: 'Renombrar', label: 'Nuevo nombre', value: it.name });
  if (!name || name === it.name) return;
  await mutate(ix => { const x = ix.items.find(y => y.id === it.id); if (x) x.name = name; });
}
function moveDialog(type, obj) {
  const m = modal({ title: 'Mover a…', cls: 'narrow' });
  const banned = type === 'folder' ? new Set([obj.id, ...descendants(obj.id)]) : new Set();
  const cur = type === 'folder' ? obj.parent : obj.folder;
  const rows = [];
  const walk = (p, d) => childFolders(p).forEach(f => { if (banned.has(f.id)) return; rows.push([f, d]); walk(f.id, d + 1); });
  walk('root', 1);
  m.body.innerHTML = `<div class="tree">
    <button data-t="root" class="${cur === 'root' ? 'cur' : ''}">${I('home')}<span>Inicio</span></button>
    ${rows.map(([f, d]) => `<button data-t="${f.id}" class="c-${esc(f.color || 'slate')} lvl${Math.min(d, 4)} ${cur === f.id ? 'cur' : ''}">${I(f.icon || 'folder')}<span>${esc(f.name)}</span></button>`).join('')}
  </div>`;
  m.body.addEventListener('click', e => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    m.close();
    if (b.dataset.t !== cur) moveTo(type, obj.id, b.dataset.t);
  });
}
async function moveTo(type, id, target) {
  if (type === 'folder' && (id === target || descendants(id).includes(target))) return;
  if (type === 'item' && getItem(id)?.folder === target) return;
  try {
    await mutate(ix => {
      if (type === 'folder') { const f = ix.folders.find(x => x.id === id); if (f) f.parent = target; }
      else { const i = ix.items.find(x => x.id === id); if (i) i.folder = target; }
    });
    toast('Movido a ' + (target === 'root' ? 'Inicio' : F(target)?.name));
  } catch (e) { toast(e.message, 'err'); }
}
async function deleteItem(it) {
  if (!await confirmDlg({ title: 'Eliminar', text: `¿Eliminar «${it.name}» de la bóveda? No se puede deshacer.` })) return;
  try {
    await mutate(ix => { ix.items = ix.items.filter(x => x.id !== it.id); });
    delBlob(it.blob); delBlob(it.thumb);
    toast('Eliminado');
  } catch (e) { toast(e.message, 'err'); }
}
async function deleteFolder(f) {
  const ids = new Set([f.id, ...descendants(f.id)]);
  const its = S.index.items.filter(i => ids.has(i.folder));
  const text = its.length ? `Se eliminará «${f.name}» con ${its.length} elemento(s) dentro. No se puede deshacer.` : `¿Eliminar la carpeta «${f.name}»?`;
  if (!await confirmDlg({ title: 'Eliminar carpeta', text })) return;
  try {
    await mutate(ix => { ix.folders = ix.folders.filter(x => !ids.has(x.id)); ix.items = ix.items.filter(i => !ids.has(i.folder)); });
    its.forEach(i => { delBlob(i.blob); delBlob(i.thumb); });
    toast('Carpeta eliminada');
  } catch (e) { toast(e.message, 'err'); }
}

function settingsDialog() {
  const m = modal({ title: 'Ajustes', cls: 'narrow' });
  m.body.innerHTML = `
    <label class="lbl">Bloqueo automático por inactividad</label>
    <select class="inp al">${[1, 2, 5, 10, 15, 30].map(n => `<option value="${n}">${n} min</option>`).join('')}</select>
    <div class="set-row"><div><b>Contraseña maestra</b><span>Cambia la contraseña de desbloqueo.</span></div><div class="a1"></div></div>
    <div class="set-row"><div><b>Código de recuperación</b><span>Genera uno nuevo e invalida el anterior.</span></div><div class="a2"></div></div>
    <div class="set-info">${I('shield')}<div><b>Cómo se protege tu bóveda</b>
      Cada archivo, nota y nombre se cifra con AES-256-GCM en este dispositivo. La clave se deriva de tu contraseña
      (PBKDF2-SHA256, 600.000 iteraciones) y nunca sale del navegador. El servidor solo almacena datos cifrados y solo es accesible por Tailscale.</div></div>`;
  const al = $('.al', m.body);
  al.value = String(S.autolock);
  al.onchange = () => { S.autolock = +al.value; store.set('autolock', S.autolock); toast('Guardado'); };
  $('.a1', m.body).append(btn('Cambiar', 'ghost sm', 'key', () => { m.close(); changePwDialog(); }));
  $('.a2', m.body).append(btn('Generar', 'ghost sm', 'shield', () => { m.close(); newRecoveryDialog(); }));
}
function changePwDialog() {
  const m = modal({ title: 'Cambiar contraseña', cls: 'narrow', backdrop: false });
  m.body.innerHTML = passwordFields(true);
  const err = $('.err', m.body);
  const save = btn('Cambiar', 'primary', 'check', async () => {
    const [p0, p1, p2] = ['.p0', '.p1', '.p2'].map(s => $(s, m.body).value);
    if (p1.length < 12) { err.textContent = 'Mínimo 12 caracteres.'; return; }
    if (p1 !== p2) { err.textContent = 'Las contraseñas nuevas no coinciden.'; return; }
    save.disabled = true; err.textContent = 'Comprobando…';
    try {
      const s = (await getVault()).slots.password;
      const { token } = await derive(p0, unb64(s.salt), s.iter);
      if (!await checkToken(token)) throw new Error('La contraseña actual no es correcta.');
      await putSlot('password', p1);
      m.close(); toast('Contraseña cambiada');
    } catch (x) { err.textContent = x.message; save.disabled = false; }
  });
  m.foot.append(btn('Cancelar', 'ghost', null, m.close), save);
  setTimeout(() => $('.p0', m.body).focus(), 60);
}
async function newRecoveryDialog() {
  if (!await confirmDlg({ title: 'Nuevo código de recuperación', text: 'El código anterior dejará de funcionar. ¿Continuar?', ok: 'Generar', danger: false })) return;
  try {
    const rc = genRecovery();
    await putSlot('recovery', normRc(rc));
    const m = modal({ title: 'Nuevo código de recuperación', cls: 'narrow', backdrop: false });
    m.body.innerHTML = `<p class="ptext">Guárdalo fuera de la bóveda. No se volverá a mostrar.</p>${recoveryCodeHtml(rc)}`;
    wireRecoveryButtons(m.body, rc);
    m.foot.append(btn('Lo he guardado', 'primary', 'check', m.close));
  } catch (x) { toast(x.message, 'err'); }
}

/* ---------------- bandeja de entrada (WhatsApp) ----------------
   El servidor cifra lo que llega por WhatsApp con la clave PÚBLICA de la bóveda (ECDH P-256 + HKDF + AES-GCM).
   La clave privada vive cifrada dentro del índice: solo aquí, desbloqueada, se puede abrir y pasar a la bóveda. */
const INBOX_INFO = enc.encode('boveda-inbox-v1');
let inboxBusy = false;
async function setupInbox() {
  try {
    if (!S.index.inbox) {
      const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
      const pub = b64(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
      const priv = b64(await seal(new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey))));
      await mutate(ix => { if (!ix.inbox) ix.inbox = { pub, priv }; });
    }
    const srv = await fetch('/api/inbox/key', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (!srv || srv.pub !== S.index.inbox.pub) {
      await api('/api/inbox/key', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pub: S.index.inbox.pub }) });
    }
    const pk = await unseal(unb64(S.index.inbox.priv));
    S.inboxKey = await crypto.subtle.importKey('pkcs8', pk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    await processInbox();
  } catch (e) { console.warn('Bandeja de entrada:', e); }
}
async function openInboxBlob(blob) {
  if (dec.decode(blob.slice(0, 4)) !== 'BVI1') throw new Error('formato desconocido');
  const eph = await crypto.subtle.importKey('raw', blob.slice(4, 69), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: eph }, S.inboxKey, 256);
  const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: INBOX_INFO }, hk,
    { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.slice(69, 81) }, key, blob.slice(81)));
  const ml = new DataView(pt.buffer, pt.byteOffset).getUint32(0);
  return { meta: JSON.parse(dec.decode(pt.slice(4, 4 + ml))), data: pt.slice(4 + ml) };
}
async function processInbox() {
  if (!S.vk || !S.inboxKey || inboxBusy) return;
  inboxBusy = true;
  try {
    const list = await (await api('/api/inbox')).json();
    if (!list.length) return;
    const added = [], done = [];
    for (const e of list) {
      try {
        const r = await api('/api/inbox/' + e.id);
        if (!r.ok) continue;
        const { meta, data } = await openInboxBlob(new Uint8Array(await r.arrayBuffer()));
        const mime = meta.mime || guessMime(meta.name || '');
        let thumb = null;
        if (mime.startsWith('image/')) {
          try { const tb = await makeThumb(new Blob([data], { type: mime })); if (tb) { thumb = newId(); await putBlob(thumb, await seal(tb)); } } catch { thumb = null; }
        }
        const blob = newId();
        await putBlob(blob, await seal(data));
        const t = (meta.received || Date.now() / 1000) * 1000;
        added.push({ id: newId(), type: 'file', name: meta.name || 'WhatsApp', mime, size: data.length, blob, thumb, created: t, modified: t });
        done.push(e.id);
      } catch (x) { console.warn('Bandeja: no se pudo abrir', e.id, x); }
    }
    if (added.length) {
      await mutate(ix => {
        let f = ix.folders.find(x => x.name === 'Recibido por WhatsApp' && x.parent === 'root');
        if (!f) { f = { id: newId(), name: 'Recibido por WhatsApp', parent: 'root', icon: 'note', color: 'green' }; ix.folders.push(f); }
        ix.items.push(...added.map(a => ({ ...a, folder: f.id })));
      });
      toast(`📥 ${added.length} archivo(s) de WhatsApp guardado(s) en «Recibido por WhatsApp»`, 'ok', 5000);
    }
    for (const id of done) await api('/api/inbox/' + id, { method: 'DELETE' }).catch(() => {});
  } catch (e) { console.warn('Bandeja:', e); } finally { inboxBusy = false; }
}

/* ---------------- avisos ---------------- */
function toast(msg, type = 'ok', ms = 2800) {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = `${I(type === 'err' ? 'close' : 'check')}<span></span>`;
  $('span', t).textContent = msg;
  $('#toasts').append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, ms);
}
function progressToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast prog in';
  t.innerHTML = `${I('upload')}<div><span></span><i><b></b></i></div>`;
  const span = $('span', t), bar = $('i b', t);
  span.textContent = msg;
  $('#toasts').append(t);
  return {
    update(m, p) { span.textContent = m; bar.style.width = Math.round(p * 100) + '%'; },
    done(m, type = 'ok') { t.remove(); if (m) toast(m, type, type === 'err' ? 5000 : 2800); },
  };
}

/* ---------------- bloqueo ---------------- */
function lock(msg) {
  Object.assign(S, { vk: null, token: null, slot: null, index: null, version: 0, inboxKey: null });
  S.thumbs.forEach(u => URL.revokeObjectURL(u));
  S.thumbs.clear();
  io?.disconnect();
  renderLock('unlock', msg);
}

/* ---------------- eventos globales ---------------- */
function wireGlobal() {
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => addEventListener(ev, () => { S.lastAct = Date.now(); }, { passive: true }));
  setInterval(() => {
    if (!S.vk) return;
    const left = S.autolock * 60000 - (Date.now() - S.lastAct);
    if (left <= 0) { lock('Bloqueada por inactividad'); return; }
    const el = $('#lockLeft');
    if (!el) return;
    const s = Math.ceil(left / 1000);
    el.textContent = s <= 60 ? `${s} s` : `${Math.ceil(s / 60)} min`;
    $('#lockBtn').classList.toggle('warn', s <= 30);
  }, 1000);
  setInterval(() => { if (S.vk && !document.hidden) processInbox(); }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) S.hiddenAt = Date.now();
    else if (S.vk && S.hiddenAt && Date.now() - S.hiddenAt > 60000) lock('Bloqueada al salir de la app');
  });

  $('#picker').addEventListener('change', e => { uploadFiles(e.target.files, targetFolder()); e.target.value = ''; });
  $('#ctx').addEventListener('click', e => { if (e.target.id === 'ctx') closeMenu(); });
  addEventListener('resize', closeMenu);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($('#ctx').classList.contains('open')) return closeMenu();
      const ws = $$('#modals .mwrap'), top = ws[ws.length - 1];
      if (top) { if (top.dataset.dismiss) top._m.close(); return; }
      if (S.q && $('#q')) { $('#q').value = ''; S.q = ''; render(); }
      return;
    }
    if (e.key === '/' && S.vk && !e.target.matches('input, textarea, select') && !$$('#modals .mwrap').length) {
      e.preventDefault(); $('#q')?.focus();
    }
  });

  // Arrastrar archivos del sistema para subirlos, y elementos internos para moverlos.
  const types = e => [...(e.dataTransfer?.types || [])];
  const hasFiles = e => types(e).includes('Files');
  const internal = e => types(e).includes('application/x-boveda');
  let depth = 0;
  const hideDrop = () => { depth = 0; $('#drop')?.classList.remove('on'); };
  addEventListener('dragenter', e => {
    if (!S.vk || !hasFiles(e) || $$('#modals .mwrap').length) return;
    depth++;
    $('#drop').classList.add('on');
    $('#dropTo').textContent = 'en ' + (isFolderId(S.folder) ? F(S.folder).name : 'Inicio');
  });
  addEventListener('dragleave', e => { if (hasFiles(e) && --depth <= 0) hideDrop(); });
  addEventListener('dragover', e => {
    if (hasFiles(e)) { e.preventDefault(); return; }
    if (!internal(e)) return;
    const t = e.target.closest?.('[data-drop]');
    $$('.drop-hl').forEach(x => x !== t && x.classList.remove('drop-hl'));
    if (t) { e.preventDefault(); t.classList.add('drop-hl'); }
  });
  addEventListener('drop', e => {
    if (hasFiles(e)) {
      e.preventDefault(); hideDrop();
      if (S.vk && !$$('#modals .mwrap').length) uploadFiles(e.dataTransfer.files, targetFolder());
      return;
    }
    const t = e.target.closest?.('[data-drop]');
    $$('.drop-hl').forEach(x => x.classList.remove('drop-hl'));
    if (!t || !internal(e)) return;
    e.preventDefault();
    const v = JSON.parse(e.dataTransfer.getData('application/x-boveda'));
    moveTo(v.t, v.id, t.dataset.drop);
  });
  addEventListener('dragend', () => $$('.drop-hl').forEach(x => x.classList.remove('drop-hl')));
  addEventListener('unhandledrejection', e => { if (S.vk) toast(e.reason?.message || 'Error inesperado', 'err'); });
}

async function boot() {
  wireGlobal();
  if (!window.isSecureContext || !crypto?.subtle) {
    $('#app').innerHTML = '<div class="fatal">Abre la bóveda por HTTPS a través de Tailscale.</div>';
    return;
  }
  try {
    const r = await fetch('/api/vault', { cache: 'no-store' });
    renderLock(r.status === 404 ? 'setup' : 'unlock');
  } catch {
    $('#app').innerHTML = '<div class="fatal">No se puede conectar con la bóveda.</div>';
  }
}
boot();
