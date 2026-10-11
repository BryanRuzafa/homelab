'use strict';
/* Agenda Bryan — calendario, agenda, por hacer e ideas. Lo mismo que mandas por WhatsApp, aquí. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const store = {
  get(k, d) { try { const v = localStorage.getItem('ag.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ag.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};
const S = {
  tab: store.get('tab', 'hoy'), items: [], log: [], status: {}, sig: '',
  month: null, sel: null, showDone: store.get('showDone', false), fin: null, finMonth: null,
};

const ICONS = {
  cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M19 19v2H6"/>',
  check: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8 12l3 3 5-6"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5.1A8 8 0 1 1 21 12z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  tick: '<path d="M5 12l5 5 9-10"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
  left: '<path d="M15 18l-6-6 6-6"/>', right: '<path d="M9 18l6-6-6-6"/>',
  flame: '<path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-5 5-5 8-1-1-2-2-2-4-2 2-2 4-2 8 0 4 3 7 7 7z"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
  cloud: '<path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 7.9z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  euro: '<path d="M17.5 6.5A7 7 0 1 0 17.5 17.5"/><path d="M4 10h9M4 14h9"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  wallet: '<path d="M20 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5"/><circle cx="16.5" cy="13.5" r="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
const I = (n, c = '') => `<svg class="ic ${c}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = s => esc(s).replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
const plain = s => String(s).replace(/\*([^*\n]+)\*/g, '$1');

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const KIND = {
  event: { label: 'Calendario', icon: 'cal', letter: 'C' }, agenda: { label: 'Agenda', icon: 'book', letter: 'A' },
  todo: { label: 'Por hacer', icon: 'check', letter: 'P' }, idea: { label: 'Ideas', icon: 'bulb', letter: 'I' },
};
const TABS = [
  ['hoy', 'Hoy', 'sun', ''], ['cal', 'Calendario', 'cal', 'event'], ['agenda', 'Agenda', 'book', 'agenda'],
  ['todo', 'Por hacer', 'check', 'todo'], ['idea', 'Ideas', 'bulb', 'idea'], ['fin', 'Finanzas', 'euro', 'fin'], ['chat', 'WhatsApp', 'chat', ''],
];

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayISO = () => S.status.today || iso(new Date());
const daysTo = s => Math.round((parseISO(s) - parseISO(todayISO())) / 864e5);
const fmtShort = s => { const d = parseISO(s); return `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}`; };
function dueBadge(it) {
  if (!it.date) return '<span class="due">Sin fecha</span>';
  const n = daysTo(it.date);
  if (it.done) return `<span class="due">${fmtShort(it.date)}</span>`;
  if (n < 0) return `<span class="due over">Vencida · ${-n} d</span>`;
  if (n === 0) return `<span class="due today">Hoy${it.time ? ' · ' + it.time : ''}</span>`;
  if (n === 1) return `<span class="due soon">Mañana</span>`;
  if (n <= 3) return `<span class="due soon">En ${n} días</span>`;
  return `<span class="due">${fmtShort(it.date)}${n <= 14 ? ` · ${n} d` : ''}</span>`;
}

/* ---------------- API ---------------- */
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, cache: 'no-store' });
  if (r.status === 401) throw new Error('Abre la agenda a través de Tailscale.');
  if (!r.ok) throw new Error('Error ' + r.status);
  return r.json();
}
async function refresh(force) {
  const [items, status] = await Promise.all([api('/api/items'), api('/api/status')]);
  const log = S.tab === 'chat' ? await api('/api/log?limit=200') : S.log;
  const fin = S.tab === 'fin' ? await api('/api/finance' + (S.finMonth ? '?month=' + S.finMonth : '')) : S.fin;
  const sig = JSON.stringify([items, log, fin, status.whatsapp_last, status.google_last_sync]);
  S.status = status;
  if (!force && sig === S.sig) return;
  Object.assign(S, { items, log, fin, sig });
  render();
}
function toast(msg, err) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), err ? 5000 : 3600);
}

/* ---------------- estructura ---------------- */
function shell() {
  const now = new Date();
  $('#app').innerHTML = `
    <header class="head">
      <div class="today"><b class="dnum">${now.getDate()}</b><div><span class="dname">${['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][now.getDay()]}</span><span class="dmon">${MESES[now.getMonth()]} ${now.getFullYear()}</span></div></div>
      <div class="status" id="status"></div>
    </header>
    <form class="cmd" id="cmdForm" autocomplete="off">
      ${I('arrow')}
      <input id="cmd" placeholder="Apunta algo: C mañana dentista 12, A 15 entrega #forense, P comprar pan…" enterkeyhint="send">
      <button class="send" id="sendBtn" disabled><span>Apuntar</span></button>
    </form>
    <div class="preview" id="preview"></div>
    <nav class="tabs" id="tabs"></nav>
    <main id="view"></main>`;
  const inp = $('#cmd');
  let t;
  inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(previewCmd, 180); });
  $('#cmdForm').addEventListener('submit', async e => {
    e.preventDefault();
    const text = effectiveText(inp.value);
    if (!text) return;
    $('#sendBtn').disabled = true;
    try {
      const r = await api('/api/command', { method: 'POST', body: JSON.stringify({ text, source: 'web' }) });
      toast(plain(r.reply), !r.ok);
      if (r.ok) { inp.value = ''; previewCmd(); }
      await refresh(true);
    } catch (x) { toast(x.message, true); }
    $('#sendBtn').disabled = !inp.value.trim();
  });
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { S.tab = b.dataset.tab; store.set('tab', S.tab); S.sig = ''; refresh(true); } });
  $('#view').addEventListener('click', onViewClick);
  previewCmd();
}
// En las pestañas de lista no hace falta poner la letra: "comprar pan" en Por hacer = "P comprar pan".
function effectiveText(v) {
  v = v.trim();
  if (!v) return '';
  if (/^[caipgs]!?(\s|$|!)/i.test(v) || /^(hoy|mañana|manana|semana|pendientes|lista|ideas|agenda|hecho|borrar|ayuda|gastos|fijos|suscripciones|\?)/i.test(v)) return v;
  const k = { cal: 'C', agenda: 'A', todo: 'P', idea: 'I', fin: 'G' }[S.tab];
  return k ? `${k} ${v}` : v;
}
async function previewCmd() {
  const inp = $('#cmd'), pv = $('#preview');
  const raw = inp.value.trim();
  $('#sendBtn').disabled = !raw;
  const keys = `<div class="keys"><span class="key k-event"><b>C</b> calendario</span><span class="key k-agenda"><b>A</b> agenda</span><span class="key k-todo"><b>P</b> por hacer</span><span class="key k-idea"><b>I</b> ideas</span><span class="key k-exp"><b>G</b> gasto</span><span class="key k-fin"><b>S</b> fijo</span></div>`;
  if (!raw) { pv.innerHTML = keys; return; }
  try {
    const p = await api('/api/parse', { method: 'POST', body: JSON.stringify({ text: effectiveText(raw) }) });
    if (inp.value.trim() !== raw) return;
    if (p.cmd === 'add') {
      const it = p.item, k = KIND[it.kind];
      const when = it.date ? fmtShort(it.date) + (it.time ? ` · ${it.time}${it.end_time && it.kind === 'event' ? '–' + it.end_time : ''}` : (it.kind === 'event' ? ' · todo el día' : '')) : (it.kind === 'agenda' ? 'sin fecha' : '');
      pv.innerHTML = `<span class="pill k-${it.kind}">${I(k.icon)}${k.label}</span><b>${esc(it.title)}</b>${when ? `<span>· ${esc(when)}</span>` : ''}${it.tag ? `<span class="tag k-${it.kind}">#${esc(it.tag)}</span>` : ''}${it.urgent ? '<span class="fire">🔥 urgente</span>' : ''}`;
    } else if (p.cmd === 'expense') {
      const e = p.expense;
      pv.innerHTML = `<span class="pill k-exp">${I('wallet')}Gasto</span><b>${esc(e.concept)}</b><span>· ${eur(e.amount)} · ${esc(e.category)} · ${fmtShort(e.date)}</span>`;
    } else if (p.cmd === 'sub') {
      const x = p.sub;
      pv.innerHTML = `<span class="pill k-fin">${I('repeat')}Gasto fijo</span><b>${esc(x.name)}</b><span>· ${eur(x.amount)} ${x.period}${x.billing_day ? ' · día ' + x.billing_day : ''}</span>`;
    } else if (p.cmd === 'error') pv.innerHTML = `<span class="err">⚠️ ${esc(p.msg)}</span>`;
    else if (p.cmd === 'unknown') pv.innerHTML = `<span class="err">Empieza con C, A, P o I</span>${keys}`;
    else pv.innerHTML = `<span>Comando: <b>${esc(raw.split(' ')[0].toUpperCase())}</b> (te respondo aquí)</span>`;
  } catch { pv.innerHTML = keys; }
}

function render() {
  const open = k => S.items.filter(i => i.kind === k && !i.done).length;
  const wa = S.status.whatsapp_last, g = S.status.google_last_sync;
  const ago = s => { if (!s) return 'sin conectar'; const m = Math.round((Date.now() - new Date(s.replace(' ', 'T'))) / 6e4); return m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`; };
  $('#status').innerHTML = `<span class="chip"><i class="dot ${wa ? 'on' : 'off'}"></i>${wa ? 'Último WhatsApp ' + ago(wa) : 'WhatsApp sin mensajes aún'}</span><span class="chip"><i class="dot ${g ? 'on' : 'off'}"></i>${g ? 'Google Calendar sincronizado ' + ago(g) : 'Google Calendar sin conectar'}</span>`;
  $('#tabs').innerHTML = TABS.map(([id, label, icon, kind]) => {
    const n = kind && kind !== 'event' ? open(kind) : 0;
    return `<button class="tab ${kind ? 'k-' + kind : ''} ${S.tab === id ? 'on' : ''}" data-tab="${id}">${I(icon)}<span>${label}</span>${n ? `<em>${n}</em>` : ''}</button>`;
  }).join('');
  const v = $('#view');
  ({ hoy: viewToday, cal: viewCal, agenda: viewAgenda, todo: viewTodo, idea: viewIdeas, fin: viewFin, chat: viewChat }[S.tab] || viewToday)(v);
}

/* ---------------- filas ---------------- */
function rowHtml(it, o = {}) {
  const k = it.kind, checkable = k === 'todo' || k === 'agenda';
  const lead = checkable ? `<button class="chk" data-act="toggle" aria-label="Marcar">${I('tick')}</button>`
    : k === 'event' ? `<span class="time">${it.time || 'Día'}</span>` : '';
  const meta = [];
  if (k === 'agenda') meta.push(dueBadge(it));
  if (k === 'event' && o.showDate) meta.push(`<span>${fmtShort(it.date)}${it.end_time && it.time ? ` · hasta ${it.end_time}` : ''}</span>`);
  if (k === 'event' && !o.showDate && it.end_time && it.time) meta.push(`<span>hasta ${it.end_time}</span>`);
  if (it.tag) meta.push(`<span class="tag">#${esc(it.tag)}</span>`);
  if (it.notes) meta.push(`<span>${esc(it.notes.split('\n')[0].slice(0, 60))}</span>`);
  if (it.source === 'whatsapp') meta.push(`<span title="Desde WhatsApp">${I('phone', 'src')}</span>`);
  if (it.source === 'google' || it.gcal_id) meta.push(`<span title="Google Calendar">${I('cloud', 'src')}</span>`);
  return `<div class="it k-${k} ${it.done ? 'done' : ''}" data-id="${it.id}">
    ${lead}
    <div class="body"><div class="t">${it.urgent && !it.done ? '<span class="fire">🔥</span> ' : ''}${esc(it.title)}</div>${meta.length ? `<div class="m">${meta.join('')}</div>` : ''}</div>
    <div class="acts">${k === 'todo' ? `<button class="ib ${it.urgent ? 'on' : ''}" data-act="urgent" title="Urgente">${I('flame')}</button>` : ''}
      <button class="ib" data-act="edit" title="Editar">${I('edit')}</button><button class="ib" data-act="del" title="Eliminar">${I('trash')}</button></div>
  </div>`;
}
const listHtml = (arr, o) => `<div class="list">${arr.map(i => rowHtml(i, o)).join('')}</div>`;
const emptyHtml = (emoji, text) => `<div class="empty"><b>${emoji}</b>${text}</div>`;
const byWhen = (a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.time || '').localeCompare(b.time || '') || b.urgent - a.urgent;

async function onViewClick(e) {
  const fm = e.target.closest('[data-fmonth]');
  if (fm) { shiftFinMonth(+fm.dataset.fmonth); return; }
  const fn = e.target.closest('[data-fnew]');
  if (fn) { fn.dataset.fnew === 'sub' ? subDialog() : expDialog(); return; }
  const fa = e.target.closest('[data-fact]');
  if (fa) { finAction(fa.dataset.fact, fa.closest('[data-ftype]')); return; }
  const nav = e.target.closest('[data-month]');
  if (nav) { shiftMonth(+nav.dataset.month); return; }
  const day = e.target.closest('[data-day]');
  if (day) { S.sel = day.dataset.day; render(); return; }
  const go = e.target.closest('[data-go]');
  if (go) { S.tab = go.dataset.go; store.set('tab', S.tab); render(); return; }
  const add = e.target.closest('[data-prefill]');
  if (add) { const i = $('#cmd'); i.value = add.dataset.prefill; i.focus(); previewCmd(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (e.target.closest('[data-showdone]')) { S.showDone = !S.showDone; store.set('showDone', S.showDone); render(); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const it = S.items.find(x => x.id === +a.closest('[data-id]').dataset.id);
  if (!it) return;
  try {
    if (a.dataset.act === 'toggle') { await api('/api/items/' + it.id, { method: 'PATCH', body: JSON.stringify({ done: !it.done }) }); if (!it.done) toast('✅ ' + it.title); }
    else if (a.dataset.act === 'urgent') await api('/api/items/' + it.id, { method: 'PATCH', body: JSON.stringify({ urgent: !it.urgent }) });
    else if (a.dataset.act === 'totodo') { await api('/api/items/' + it.id, { method: 'PATCH', body: JSON.stringify({ kind: 'todo' }) }); toast('Movida a Por hacer'); }
    else if (a.dataset.act === 'del') { if (!confirm(`¿Eliminar «${it.title}»?`)) return; await api('/api/items/' + it.id, { method: 'DELETE' }); }
    else if (a.dataset.act === 'edit') return editDialog(it);
    await refresh(true);
  } catch (x) { toast(x.message, true); }
}

/* ---------------- vistas ---------------- */
function viewToday(v) {
  const t = todayISO(), tm = iso(new Date(parseISO(t).getTime() + 864e5)), wk = iso(new Date(parseISO(t).getTime() + 7 * 864e5));
  const ev = S.items.filter(i => i.kind === 'event');
  const evToday = ev.filter(i => i.date === t).sort(byWhen), evTom = ev.filter(i => i.date === tm).sort(byWhen);
  const ag = S.items.filter(i => i.kind === 'agenda' && !i.done && i.date && i.date <= wk).sort(byWhen);
  const todos = S.items.filter(i => i.kind === 'todo' && !i.done).sort((a, b) => b.urgent - a.urgent || a.id - b.id);
  const h = new Date().getHours();
  const hi = h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
  v.innerHTML = `
    <div class="hello"><h2>${hi}, Bryan</h2><p>${evToday.length ? `Hoy tienes ${evToday.length} cosa${evToday.length > 1 ? 's' : ''} en el calendario` : 'Hoy no tienes nada en el calendario'}${ag.filter(a => daysTo(a.date) <= 0).length ? ', y hay entregas para hoy o vencidas.' : '.'}</p></div>
    <div class="grid3">
      <section class="box k-event"><h3>${I('cal')}Calendario<em><button data-go="cal">Ver el mes</button></em></h3>
        <div class="sub">Hoy</div>${evToday.length ? listHtml(evToday) : emptyHtml('🌤️', 'Nada programado')}
        <div class="sub">Mañana</div>${evTom.length ? listHtml(evTom) : emptyHtml('', 'Nada programado')}</section>
      <section class="box k-agenda"><h3>${I('book')}Entregas<em>esta semana</em></h3>
        ${ag.length ? listHtml(ag) : emptyHtml('🎉', 'Nada que entregar esta semana')}</section>
      <section class="box k-todo"><h3>${I('check')}Por hacer<em><button data-go="todo">Ver la lista</button></em></h3>
        ${todos.length ? listHtml(todos.slice(0, 10)) : emptyHtml('💪', 'Todo hecho')}</section>
    </div>`;
}

function shiftMonth(n) { const [y, m] = S.month; const d = new Date(y, m + n, 1); S.month = [d.getFullYear(), d.getMonth()]; render(); }
function viewCal(v) {
  if (!S.month) { const d = parseISO(todayISO()); S.month = [d.getFullYear(), d.getMonth()]; }
  if (!S.sel) S.sel = todayISO();
  const [y, m] = S.month;
  const first = new Date(y, m, 1), start = new Date(y, m, 1 - ((first.getDay() + 6) % 7));
  const dated = S.items.filter(i => i.date && (i.kind === 'event' || i.kind === 'agenda'));
  const byDay = {};
  dated.forEach(i => { (byDay[i.date] ||= []).push(i); });
  Object.values(byDay).forEach(a => a.sort((p, q) => (p.kind === 'event' ? 0 : 1) - (q.kind === 'event' ? 0 : 1) || byWhen(p, q)));
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), k = iso(d), list = byDay[k] || [];
    if (i >= 35 && d.getMonth() !== m) break;
    cells += `<button class="day ${d.getMonth() !== m ? 'out' : ''} ${k === todayISO() ? 'today' : ''} ${k === S.sel ? 'sel' : ''}" data-day="${k}">
      <span class="n">${d.getDate()}</span>${list.slice(0, 3).map(x => `<span class="ev k-${x.kind}">${x.kind === 'event' && x.time ? x.time + ' ' : x.kind === 'agenda' ? '📚 ' : ''}${esc(x.title)}</span>`).join('')}
      ${list.length > 3 ? `<span class="more-ev">+${list.length - 3} más</span>` : ''}</button>`;
  }
  const sel = (byDay[S.sel] || []);
  const [sy, sm, sd] = S.sel.split('-');
  v.innerHTML = `
    <div class="cal-head"><h2>${MESES[m]} ${y}</h2>
      <button class="nav-btn" data-month="-1" aria-label="Mes anterior">${I('left')}</button>
      <button class="nav-btn" data-month="0" id="todayBtn">Hoy</button>
      <button class="nav-btn" data-month="1" aria-label="Mes siguiente">${I('right')}</button></div>
    <div class="cal-wrap">
      <div><div class="cal">${['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map(d => `<div class="dow">${d}</div>`).join('')}${cells}</div></div>
      <aside class="box dayside k-event"><h3>${I('cal')}${fmtShort(S.sel)}<em>${daysTo(S.sel) === 0 ? 'hoy' : daysTo(S.sel) === 1 ? 'mañana' : ''}</em></h3>
        ${sel.length ? listHtml(sel) : emptyHtml('', 'Día libre')}
        <div class="mf"><button class="btn" data-prefill="A ${+sd}/${+sm} ">${I('book')}Entrega</button><button class="btn primary" data-prefill="C ${+sd}/${+sm} ">${I('cal')}Evento este día</button></div>
      </aside>
    </div>`;
  $('#todayBtn').addEventListener('click', e => { e.stopPropagation(); S.month = null; S.sel = todayISO(); render(); });
}

function viewAgenda(v) {
  const ag = S.items.filter(i => i.kind === 'agenda');
  const open = ag.filter(i => !i.done).sort(byWhen);
  const groups = [
    ['⚠️ Vencidas', open.filter(i => i.date && daysTo(i.date) < 0)],
    ['Esta semana', open.filter(i => i.date && daysTo(i.date) >= 0 && daysTo(i.date) <= 7)],
    ['Más adelante', open.filter(i => i.date && daysTo(i.date) > 7)],
    ['Sin fecha', open.filter(i => !i.date)],
  ];
  if (S.showDone) groups.push(['Completadas', ag.filter(i => i.done).sort((a, b) => (b.done_at || '').localeCompare(a.done_at || ''))]);
  v.innerHTML = `<div class="bar"><h2>Agenda y deberes</h2><button class="btn" data-showdone>${S.showDone ? 'Ocultar' : 'Ver'} completadas</button><button class="btn primary" data-prefill="A ">${I('book')}Nueva entrega</button></div>
    ${open.length || S.showDone ? groups.filter(g => g[1].length).map(([t, a]) => `<div class="sub">${t}</div>${listHtml(a)}`).join('') : `<div class="box">${emptyHtml('🎉', 'No tienes entregas pendientes.<br>Escribe por ejemplo: <b>A 15 entrega análisis forense #forense</b>')}</div>`}`;
}

function viewTodo(v) {
  const td = S.items.filter(i => i.kind === 'todo');
  const open = td.filter(i => !i.done);
  const groups = [['🔥 Urgentes', open.filter(i => i.urgent)], ['Pendientes', open.filter(i => !i.urgent)]];
  if (S.showDone) groups.push(['Hechas', td.filter(i => i.done).sort((a, b) => (b.done_at || '').localeCompare(a.done_at || '')).slice(0, 50)]);
  v.innerHTML = `<div class="bar"><h2>Por hacer</h2><button class="btn" data-showdone>${S.showDone ? 'Ocultar' : 'Ver'} hechas</button><button class="btn primary" data-prefill="">${I('check')}Nueva tarea</button></div>
    ${open.length || S.showDone ? groups.filter(g => g[1].length).map(([t, a]) => `<div class="sub">${t}</div>${listHtml(a)}`).join('') : `<div class="box">${emptyHtml('💪', 'Nada pendiente. En esta pestaña puedes escribir arriba directamente, sin la P.')}</div>`}`;
}

function viewIdeas(v) {
  const ideas = S.items.filter(i => i.kind === 'idea' && !i.done).sort((a, b) => b.id - a.id);
  v.innerHTML = `<div class="bar"><h2>Ideas</h2><button class="btn primary" data-prefill="">${I('bulb')}Nueva idea</button></div>
    ${ideas.length ? `<div class="ideas">${ideas.map(i => `<div class="idea k-idea" data-id="${i.id}"><p>${esc(i.title)}</p>${i.notes ? `<p class="m">${esc(i.notes)}</p>` : ''}
      <div class="m"><span>${fmtShort(i.created_at.slice(0, 10))}${i.tag ? ` · <span class="tag">#${esc(i.tag)}</span>` : ''}${i.source === 'whatsapp' ? ' · WhatsApp' : ''}</span>
      <span><button class="ib" data-act="totodo" title="Convertir en tarea">${I('check')}</button><button class="ib" data-act="edit" title="Editar">${I('edit')}</button><button class="ib" data-act="del" title="Eliminar">${I('trash')}</button></span></div></div>`).join('')}</div>`
      : `<div class="box">${emptyHtml('💡', 'Aún no hay ideas. Mándalas por WhatsApp con <b>I</b> delante.')}</div>`}`;
}

function viewChat(v) {
  const t = s => s.slice(11, 16), d = s => s.slice(0, 10);
  let last = '';
  const msgs = S.log.map(l => {
    const sep = d(l.at) !== last ? `<div class="msg blocked">${fmtShort(d(l.at))}</div>` : '';
    last = d(l.at);
    const cls = l.direction === 'in' ? 'in' : l.direction === 'out' ? 'out' : 'blocked';
    return sep + `<div class="msg ${cls}">${l.source === 'web' && cls !== 'blocked' ? '<span class="via">web</span>' : ''}${md(l.text)}<small>${t(l.at)}</small></div>`;
  }).join('');
  v.innerHTML = `<div class="bar"><h2>Conversación con el asistente</h2></div>
    <div class="chat" id="chat">${msgs || emptyHtml('💬', 'Aún no hay mensajes. Escríbele al asistente por WhatsApp.')}</div>
    <div class="help">
      <div class="k-event"><b>C</b>Calendario (Google)<code>C mañana dentista 12</code><code>C martes 15 cena 21:30</code><code>C 20/10 cumple Ana</code></div>
      <div class="k-agenda"><b>A</b>Agenda / deberes<code>A 15 entrega análisis forense #forense</code><code>A viernes práctica 3</code></div>
      <div class="k-todo"><b>P</b>Por hacer (P! urgente)<code>P comprar cables</code><code>P! renovar DNI</code></div>
      <div class="k-idea"><b>I</b>Ideas<code>I app para controlar gastos</code></div>
      <div><b>⌘</b>Consultas<code>HOY · MAÑANA · SEMANA</code><code>PENDIENTES · AGENDA · IDEAS</code><code>HECHO 12 · BORRAR 12</code></div>
    </div>`;
  const c = $('#chat'); c.scrollTop = c.scrollHeight;
}

/* ---------------- finanzas ---------------- */
const eur = c => (c / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
const PERIOD_LABEL = { mensual: '/mes', anual: '/año', trimestral: '/trimestre', semanal: '/semana' };
const MESES_C = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthLabel = ym => { const [y, m] = ym.split('-').map(Number); return `${MESES_C[m - 1]} ${y}`; };
function shiftFinMonth(n) {
  const [y, m] = (S.finMonth || S.fin.month).split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  S.finMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  refresh(true);
}
function viewFin(v) {
  const f = S.fin;
  if (!f) { v.innerHTML = emptyHtml('⏳', 'Cargando…'); return; }
  const t = f.totals, maxCat = Math.max(1, ...Object.values(t.by_category));
  const isNow = f.month === todayISO().slice(0, 7);
  const subs = f.subs.map(s => `
    <div class="frow ${s.active ? '' : 'off'}" data-ftype="sub" data-fid="${s.id}">
      <button class="sw ${s.active ? 'on' : ''}" data-fact="toggle" title="${s.active ? 'Activa' : 'Pausada'}" aria-label="Activar o pausar"><i></i></button>
      <div class="body"><div class="t">${esc(s.name)}</div>
        <div class="m"><span class="tag">${esc(s.category)}</span>${s.next_charge ? `<span>Próximo cobro: ${fmtShort(s.next_charge)}${daysTo(s.next_charge) <= 3 ? ` <b class="soon">(${daysTo(s.next_charge) === 0 ? 'hoy' : daysTo(s.next_charge) === 1 ? 'mañana' : 'en ' + daysTo(s.next_charge) + ' días'})</b>` : ''}</span>` : ''}</div></div>
      <div class="amt"><b>${eur(s.amount)}</b><small>${PERIOD_LABEL[s.period]}${s.period !== 'mensual' ? ` · ${eur(s.monthly)}/mes` : ''}</small></div>
      <div class="acts"><button class="ib" data-fact="edit" title="Editar">${I('edit')}</button><button class="ib" data-fact="del" title="Eliminar">${I('trash')}</button></div>
    </div>`).join('');
  const exps = f.expenses.map(e => `
    <div class="frow" data-ftype="exp" data-fid="${e.id}">
      <span class="fdate">${e.date.slice(8)}/${e.date.slice(5, 7)}</span>
      <div class="body"><div class="t">${esc(e.concept)}</div><div class="m"><span class="tag">${esc(e.category)}</span>${e.source === 'whatsapp' ? `<span title="Desde WhatsApp">${I('phone', 'src')}</span>` : ''}</div></div>
      <div class="amt"><b>${eur(e.amount)}</b></div>
      <div class="acts"><button class="ib" data-fact="edit" title="Editar">${I('edit')}</button><button class="ib" data-fact="del" title="Eliminar">${I('trash')}</button></div>
    </div>`).join('');
  const cats = Object.entries(t.by_category).map(([k, c]) => `
    <div class="cat"><span>${esc(k)}</span><i><b style-w="${Math.round(c / maxCat * 100)}"></b></i><em>${eur(c)}</em></div>`).join('');
  v.innerHTML = `
    <div class="bar"><h2>Finanzas</h2>
      <div class="monthnav"><button class="nav-btn" data-fmonth="-1" aria-label="Mes anterior">${I('left')}</button><span>${monthLabel(f.month)}</span>
      <button class="nav-btn" data-fmonth="1" aria-label="Mes siguiente" ${isNow ? 'disabled' : ''}>${I('right')}</button></div></div>
    <div class="fstats">
      <div class="fstat k-fin"><span>${I('repeat')}Gastos fijos al mes</span><b>${eur(t.fixed_month)}</b><small>${eur(t.fixed_year)} al año · ${t.active_subs} activos</small></div>
      <div class="fstat k-exp"><span>${I('wallet')}Gastado en ${MESES_C[+f.month.slice(5) - 1]}</span><b>${eur(t.spent_month)}</b><small>${f.expenses.length} movimientos</small></div>
      <div class="fstat k-total"><span>${I('euro')}Total del mes</span><b>${eur(t.total_month)}</b><small>fijos + gastos</small></div>
    </div>
    <div class="fgrid">
      <section class="box k-fin"><h3>${I('repeat')}Gastos fijos y suscripciones<em><button class="btn primary sm" data-fnew="sub">${I('plus')}Añadir</button></em></h3>
        ${subs ? `<div class="list">${subs}</div><div class="ftotal"><span>Total mensual (activas)</span><b>${eur(t.fixed_month)}</b></div>` : emptyHtml('🔁', 'Añade tus suscripciones y gastos fijos.<br>También por WhatsApp: <b>S Netflix 12,99 día 15</b>')}
      </section>
      <section class="box k-exp"><h3>${I('wallet')}Gastos de ${monthLabel(f.month)}<em><button class="btn primary sm" data-fnew="exp">${I('plus')}Añadir</button></em></h3>
        ${cats ? `<div class="cats">${cats}</div>` : ''}
        ${exps ? `<div class="list">${exps}</div>` : emptyHtml('💸', 'Sin gastos este mes.<br>Por WhatsApp: <b>G 12,50 cena</b> o una nota de voz')}
      </section>
    </div>`;
  $$('[style-w]', v).forEach(b => { b.style.width = b.getAttribute('style-w') + '%'; });
}
async function finAction(act, el) {
  const type = el.dataset.ftype, id = +el.dataset.fid;
  const list = type === 'sub' ? S.fin.subs : S.fin.expenses, it = list.find(x => x.id === id);
  if (!it) return;
  const url = `/api/${type === 'sub' ? 'subs' : 'expenses'}/${id}`;
  try {
    if (act === 'edit') return type === 'sub' ? subDialog(it) : expDialog(it);
    if (act === 'toggle') await api(url, { method: 'PATCH', body: JSON.stringify({ active: !it.active }) });
    if (act === 'del') { if (!confirm(`¿Eliminar «${it.name || it.concept}»?`)) return; await api(url, { method: 'DELETE' }); }
    await refresh(true);
  } catch (x) { toast(x.message, true); }
}
function formModal(title, html, onSave, onDelete) {
  const w = document.createElement('div');
  w.className = 'mwrap';
  w.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3></h3><form class="fform">${html}
    <div class="err"></div><div class="mf">${onDelete ? `<button type="button" class="btn danger" data-x="del">${I('trash')}Eliminar</button>` : ''}
    <button type="button" class="btn" data-x="cancel">Cancelar</button><button class="btn primary">Guardar</button></div></form></div>`;
  $('h3', w).textContent = title;
  $('#modals').append(w);
  const close = () => w.remove();
  w.addEventListener('mousedown', e => { if (e.target === w) close(); });
  w.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  w.addEventListener('click', async e => {
    const b = e.target.closest('[data-x]');
    if (!b) return;
    if (b.dataset.x === 'cancel') return close();
    if (b.dataset.x === 'del' && confirm('¿Eliminar?')) { try { await onDelete(); close(); await refresh(true); } catch (x) { toast(x.message, true); } }
  });
  $('form', w).addEventListener('submit', async e => {
    e.preventDefault();
    try { await onSave(w); close(); await refresh(true); } catch (x) { $('.err', w).textContent = x.message; }
  });
  setTimeout(() => $('input', w)?.focus(), 50);
  return w;
}
const amountIn = c => (c / 100).toFixed(2).replace('.', ',');
function subDialog(s) {
  const cats = [...new Set(['Suscripciones', 'Hogar', 'Tecnología', 'Salud', 'Transporte', 'Estudios', 'Ocio', ...S.fin.subs.map(x => x.category)])];
  const w = formModal(s ? 'Editar gasto fijo' : 'Nuevo gasto fijo', `
    <label class="lbl">Nombre</label><input class="inp f-name" required maxlength="120" placeholder="Netflix, gimnasio, móvil…">
    <div class="row2"><div><label class="lbl">Precio (€)</label><input class="inp f-amount" required inputmode="decimal" placeholder="12,99"></div>
      <div><label class="lbl">Periodicidad</label><select class="inp f-period"><option value="mensual">Mensual</option><option value="anual">Anual</option><option value="trimestral">Trimestral</option><option value="semanal">Semanal</option></select></div></div>
    <div class="row2"><div><label class="lbl">Día de cobro</label><input class="inp f-day" type="number" min="1" max="31" placeholder="opcional"></div>
      <div><label class="lbl">Mes (si es anual)</label><select class="inp f-month"><option value="">—</option>${MESES_C.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}</select></div></div>
    <label class="lbl">Categoría</label><input class="inp f-cat" list="subcats" maxlength="60"><datalist id="subcats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <label class="lbl">Notas</label><textarea class="inp f-notes" placeholder="Cuenta, método de pago, cuándo darla de baja…"></textarea>
    <label class="check"><input type="checkbox" class="f-active"> Activa (cuenta en el total)</label>`,
  async w => {
    const g = c => $(c, w).value;
    const body = { name: g('.f-name'), amount: g('.f-amount'), period: g('.f-period'), billing_day: g('.f-day') || null,
      billing_month: g('.f-month') || null, category: g('.f-cat') || 'Suscripciones', notes: g('.f-notes'), active: $('.f-active', w).checked };
    if (!/^\d+([.,]\d{1,2})?$/.test(body.amount.trim())) throw new Error('Precio no válido (ej. 12,99)');
    await api(s ? '/api/subs/' + s.id : '/api/subs', { method: s ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    toast(s ? 'Guardado' : '🔁 Gasto fijo añadido');
  }, s ? () => api('/api/subs/' + s.id, { method: 'DELETE' }) : null);
  const f = c => $(c, w);
  f('.f-name').value = s?.name || ''; f('.f-amount').value = s ? amountIn(s.amount) : ''; f('.f-period').value = s?.period || 'mensual';
  f('.f-day').value = s?.billing_day || ''; f('.f-month').value = s?.billing_month || ''; f('.f-cat').value = s?.category || 'Suscripciones';
  f('.f-notes').value = s?.notes || ''; f('.f-active').checked = s ? !!s.active : true;
}
function expDialog(x) {
  const w = formModal(x ? 'Editar gasto' : 'Nuevo gasto', `
    <label class="lbl">Concepto</label><input class="inp f-concept" required maxlength="200" placeholder="Cena, gasolina, libro…">
    <div class="row2"><div><label class="lbl">Importe (€)</label><input class="inp f-amount" required inputmode="decimal" placeholder="12,50"></div>
      <div><label class="lbl">Fecha</label><input class="inp f-date" type="date" required></div></div>
    <label class="lbl">Categoría</label><select class="inp f-cat">${S.fin.categories.map(c => `<option>${esc(c)}</option>`).join('')}</select>
    <label class="lbl">Notas</label><textarea class="inp f-notes"></textarea>`,
  async w => {
    const g = c => $(c, w).value;
    const body = { concept: g('.f-concept'), amount: g('.f-amount'), date: g('.f-date'), category: g('.f-cat'), notes: g('.f-notes') };
    if (!/^\d+([.,]\d{1,2})?$/.test(body.amount.trim())) throw new Error('Importe no válido (ej. 12,50)');
    await api(x ? '/api/expenses/' + x.id : '/api/expenses', { method: x ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    toast(x ? 'Guardado' : '💸 Gasto apuntado');
  }, x ? () => api('/api/expenses/' + x.id, { method: 'DELETE' }) : null);
  const f = c => $(c, w);
  f('.f-concept').value = x?.concept || ''; f('.f-amount').value = x ? amountIn(x.amount) : ''; f('.f-date').value = x?.date || todayISO();
  if (x && !S.fin.categories.includes(x.category)) f('.f-cat').insertAdjacentHTML('afterbegin', `<option>${esc(x.category)}</option>`);
  f('.f-cat').value = x?.category || 'Otros'; f('.f-notes').value = x?.notes || '';
}

/* ---------------- editar ---------------- */
function editDialog(it) {
  const w = document.createElement('div');
  w.className = 'mwrap';
  w.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3>Editar</h3>
    <label class="lbl">Título</label><input class="inp f-title" maxlength="300">
    <label class="lbl">Lista</label><select class="inp f-kind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
    <div class="row3"><div><label class="lbl">Fecha</label><input class="inp f-date" type="date"></div><div><label class="lbl">Hora</label><input class="inp f-time" type="time"></div><div><label class="lbl">Fin</label><input class="inp f-end" type="time"></div></div>
    <label class="lbl">Etiqueta</label><input class="inp f-tag" maxlength="40" placeholder="ej. forense">
    <label class="lbl">Notas</label><textarea class="inp f-notes"></textarea>
    <label class="check"><input type="checkbox" class="f-urgent"> 🔥 Urgente</label>
    <div class="mf"><button class="btn danger" data-x="del">${I('trash')}Eliminar</button><button class="btn" data-x="cancel">Cancelar</button><button class="btn primary" data-x="save">Guardar</button></div></div>`;
  $('#modals').append(w);
  const f = c => $(c, w);
  f('.f-title').value = it.title; f('.f-kind').value = it.kind; f('.f-date').value = it.date || ''; f('.f-time').value = it.time || '';
  f('.f-end').value = it.end_time || ''; f('.f-tag').value = it.tag || ''; f('.f-notes').value = it.notes || ''; f('.f-urgent').checked = !!it.urgent;
  const close = () => w.remove();
  w.addEventListener('mousedown', e => { if (e.target === w) close(); });
  w.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  w.addEventListener('click', async e => {
    const b = e.target.closest('[data-x]');
    if (!b) return;
    try {
      if (b.dataset.x === 'cancel') return close();
      if (b.dataset.x === 'del') { if (!confirm(`¿Eliminar «${it.title}»?`)) return; await api('/api/items/' + it.id, { method: 'DELETE' }); }
      if (b.dataset.x === 'save') {
        const title = f('.f-title').value.trim();
        if (!title) return f('.f-title').focus();
        await api('/api/items/' + it.id, { method: 'PATCH', body: JSON.stringify({
          title, kind: f('.f-kind').value, date: f('.f-date').value || null, time: f('.f-time').value || null,
          end_time: f('.f-end').value || null, tag: f('.f-tag').value.trim().replace(/^#/, '') || null,
          notes: f('.f-notes').value, urgent: f('.f-urgent').checked }) });
      }
      close(); await refresh(true);
    } catch (x) { toast(x.message, true); }
  });
  setTimeout(() => f('.f-title').focus(), 50);
}

/* ---------------- arranque ---------------- */
(async function boot() {
  shell();
  try { await refresh(true); } catch (x) { $('#view').innerHTML = `<div class="box">${emptyHtml('🔒', esc(x.message))}</div>`; return; }
  setInterval(() => { if (!document.hidden && !$('.mwrap')) refresh().catch(() => {}); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh().catch(() => {}); });
  document.addEventListener('keydown', e => { if (e.key === '/' && !e.target.matches('input,textarea,select')) { e.preventDefault(); $('#cmd').focus(); } });
})();
