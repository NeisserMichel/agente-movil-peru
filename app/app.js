/* Agente Móvil Perú · App de créditos (cliente + administrador) */
{
const C = window.AMP_CONFIG || {};
const DEMO = !C.SUPABASE_URL || !C.SUPABASE_ANON_KEY;
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => new Intl.NumberFormat('es-PE', {style:'currency', currency:'PEN'}).format(+n || 0);
const r2 = n => Math.round((+n + Number.EPSILON) * 100) / 100;
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,10); };
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + +n); return d.toISOString().slice(0,10); };
const fdate = iso => iso ? new Date(String(iso).length > 10 ? iso : iso + 'T12:00:00').toLocaleDateString('es-PE', {day:'2-digit', month:'short', year:'numeric'}) : '—';
const fwhen = iso => new Date(iso).toLocaleString('es-PE', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'});
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
const wa = (phone, text) => `https://wa.me/${String(phone || '').replace(/\D/g,'').replace(/^(?!51)(\d{9})$/, '51$1')}?text=${encodeURIComponent(text)}`;

/* ---------- Cálculo del crédito (interés simple diario) ---------- */
function calc(amount, ratePct, days) {
  const interest = r2(amount * ratePct / 100 * days);
  const total = r2(+amount + interest);
  const tea = days > 0 ? (Math.pow(1 + ratePct / 100 * days, 360 / days) - 1) * 100 : 0;
  return { interest, total, tea };
}
const paidOf = l => r2((l.payments || []).reduce((s, p) => s + +p.amount, 0));
const balanceOf = l => r2(Math.max(0, (+l.total_to_pay || 0) - paidOf(l)));
const isOverdue = l => l.status === 'depositado' && l.due_date && l.due_date < todayISO();

/* =================================================================
   BACKEND 1: SUPABASE (producción)
   ================================================================= */
function supabaseBackend() {
  let sb, me = null;
  const ready = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.min.js';
    s.onload = () => { sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY); res(); };
    s.onerror = () => rej(new Error('No se pudo cargar Supabase. Revisa tu conexión.'));
    document.head.appendChild(s);
  });
  const chk = ({ data, error }) => { if (error) throw new Error(traducir(error.message)); return data; };
  const loadMe = async () => {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return (me = null);
    me = chk(await sb.from('profiles').select('*').eq('id', session.user.id).single());
    return me;
  };
  return {
    async current() { await ready; return loadMe(); },
    async signUp({ email, password, full_name, dni, phone }) {
      await ready;
      const d = chk(await sb.auth.signUp({ email, password, options: { data: { full_name, dni, phone } } }));
      if (!d.session) return { needsConfirm: true };
      return loadMe();
    },
    async signIn(email, password) { await ready; chk(await sb.auth.signInWithPassword({ email, password })); return loadMe(); },
    async signOut() { await ready; await sb.auth.signOut(); me = null; },
    async resetPassword(email) { await ready; chk(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] })); },
    async updatePassword(password) { await ready; chk(await sb.auth.updateUser({ password })); },
    async createLoan(v) { chk(await sb.from('loans').insert(v)); },
    async listLoans() {
      return chk(await sb.from('loans').select('*, payments(*), client:profiles(full_name,email,phone,dni)').order('created_at', { ascending: false }));
    },
    async updateLoan(id, patch) { chk(await sb.from('loans').update(patch).eq('id', id)); },
    async addPayment(loan_id, amount, note, paid_on) { chk(await sb.from('payments').insert({ loan_id, amount, note, paid_on })); },
    async listClients() { return chk(await sb.from('profiles').select('*').eq('role', 'cliente').order('created_at', { ascending: false })); },
    async listNotifications() { return chk(await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)); },
    async markAllRead() { chk(await sb.from('notifications').update({ read: true }).eq('user_id', me.id).eq('read', false)); },
    onChange(cb) {
      if (!me) return () => {};
      const ch = sb.channel('amp-' + me.id)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + me.id }, p => cb(p.new))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'loans' }, () => cb(null))
        .subscribe();
      return () => sb.removeChannel(ch);
    },
    onRecovery(cb) { ready.then(() => sb.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') cb(); })); }
  };
}
function traducir(m) {
  const t = {
    'Invalid login credentials': 'Correo o contraseña incorrectos.',
    'User already registered': 'Ese correo ya está registrado. Ingresa con tu contraseña.',
    'Email not confirmed': 'Confirma tu correo: te enviamos un enlace.',
    'Password should be at least 6 characters': 'La contraseña debe tener al menos 6 caracteres.'
  };
  for (const k in t) if (m.includes(k)) return t[k];
  return m;
}

/* =================================================================
   BACKEND 2: DEMO (todo en este navegador, para probar)
   ================================================================= */
function demoBackend() {
  const KEY = 'amp_demo_v1', SKEY = 'amp_demo_session';
  let mem = null, memSession = null;
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return mem; } };
  const write = db => { mem = db; try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} listeners.forEach(f => f(null)); };
  const getS = () => { try { return localStorage.getItem(SKEY); } catch { return memSession; } };
  const setS = v => { memSession = v; try { v ? localStorage.setItem(SKEY, v) : localStorage.removeItem(SKEY); } catch {} };
  const listeners = new Set();
  const seed = () => {
    const now = Date.now(), iso = t => new Date(t).toISOString();
    const db = { seq: 100, users: [
      { id: 'u-admin', email: 'admin@agentemovil.pe', pass: 'admin123', full_name: 'Administrador', role: 'admin', phone: '999999999', created_at: iso(now - 9e8) },
      { id: 'u-maria', email: 'maria@ejemplo.pe', pass: 'cliente123', full_name: 'María Quispe Huamán', dni: '45678912', phone: '987654321', role: 'cliente', created_at: iso(now - 6e8) },
      { id: 'u-jose', email: 'jose@ejemplo.pe', pass: 'cliente123', full_name: 'José Mamani Rojas', dni: '41237788', phone: '912345678', role: 'cliente', created_at: iso(now - 5e8) }
    ], loans: [], payments: [], notifications: [] };
    const start = addDays(todayISO(), -12), c = calc(800, 0.3, 30);
    db.loans.push({ id: 1, client_id: 'u-jose', requested_amount: 800, requested_days: 30, purpose: 'Mercadería para mi bodega', status: 'depositado',
      approved_amount: 800, daily_rate: 0.3, term_days: 30, total_interest: c.interest, total_to_pay: c.total, start_date: start, due_date: addDays(start, 30),
      created_at: iso(now - 13 * 864e5), decided_at: iso(now - 12 * 864e5) });
    db.payments.push({ id: 1, loan_id: 1, amount: 300, paid_on: addDays(start, 7), note: 'Yape', created_at: iso(now - 5 * 864e5) });
    db.loans.push({ id: 2, client_id: 'u-maria', requested_amount: 1500, requested_days: 30, purpose: 'Capital de trabajo', status: 'pendiente', created_at: iso(now - 36e5) });
    db.notifications.push({ id: 1, user_id: 'u-admin', title: 'Nueva solicitud de préstamo', body: 'María Quispe Huamán solicitó un préstamo por S/ 1,500.00 a 30 días.', loan_id: 2, read: false, created_at: iso(now - 36e5) });
    return db;
  };
  let db = read(); if (!db) { db = seed(); write(db); }
  const load = () => (db = read() || db);
  const save = () => { db.seq++; write(db); };
  const pub = u => u && (({ pass, ...rest }) => rest)(u);
  const meU = () => { load(); return db.users.find(u => u.id === getS()); };
  const notify = (user_id, title, body, loan_id) => db.notifications.push({ id: ++db.seq, user_id, title, body, loan_id, read: false, created_at: new Date().toISOString() });
  const wait = () => new Promise(r => setTimeout(r, 200));
  try { addEventListener('storage', e => { if (e.key === KEY) { load(); listeners.forEach(f => f(null)); } }); } catch {}
  return {
    demo: true,
    async current() { return pub(meU()) || null; },
    async signUp({ email, password, full_name, dni, phone }) {
      await wait(); load(); email = email.trim().toLowerCase();
      if (db.users.some(u => u.email === email)) throw new Error('Ese correo ya está registrado. Ingresa con tu contraseña.');
      const u = { id: 'u-' + (++db.seq), email, pass: password, full_name, dni, phone, role: 'cliente', created_at: new Date().toISOString() };
      db.users.push(u); save(); setS(u.id); return pub(u);
    },
    async signIn(email, password) {
      await wait(); load();
      const u = db.users.find(x => x.email === email.trim().toLowerCase() && x.pass === password);
      if (!u) throw new Error('Correo o contraseña incorrectos.');
      setS(u.id); return pub(u);
    },
    async signOut() { setS(null); },
    async resetPassword() { throw new Error('En modo demo no se envían correos.'); },
    async updatePassword() {},
    async createLoan(v) {
      await wait(); const me = meU(); const id = ++db.seq;
      db.loans.push({ id, client_id: me.id, ...v, status: 'pendiente', created_at: new Date().toISOString() });
      db.users.filter(u => u.role === 'admin').forEach(a => notify(a.id, 'Nueva solicitud de préstamo',
        `${me.full_name || me.email} solicitó un préstamo por ${money(v.requested_amount)} a ${v.requested_days} días.`, id));
      save();
    },
    async listLoans() {
      const me = meU(); const all = me.role === 'admin' ? db.loans : db.loans.filter(l => l.client_id === me.id);
      return all.map(l => ({ ...l, payments: db.payments.filter(p => p.loan_id === l.id), client: pub(db.users.find(u => u.id === l.client_id)) }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async updateLoan(id, patch) {
      await wait(); load(); const l = db.loans.find(x => x.id === id); const old = l.status; Object.assign(l, patch);
      if (patch.status && patch.status !== old) {
        const m = { depositado: ['¡Tu crédito fue aprobado y depositado!', `Se depositaron ${money(l.approved_amount)}. Total a pagar: ${money(l.total_to_pay)} hasta el ${fdate(l.due_date)}.`],
          rechazado: ['Tu solicitud no fue aprobada', l.admin_note || 'Comunícate con nosotros para más información.'],
          pagado: ['Crédito cancelado. ¡Gracias!', 'Tu préstamo quedó totalmente pagado.'] }[l.status];
        if (m) notify(l.client_id, m[0], m[1], l.id);
      }
      save();
    },
    async addPayment(loan_id, amount, note, paid_on) { await wait(); load(); db.payments.push({ id: ++db.seq, loan_id, amount, note, paid_on, created_at: new Date().toISOString() }); save(); },
    async listClients() { load(); return db.users.filter(u => u.role === 'cliente').map(pub).sort((a, b) => b.created_at.localeCompare(a.created_at)); },
    async listNotifications() { const me = meU(); return db.notifications.filter(n => n.user_id === me.id).sort((a, b) => b.created_at.localeCompare(a.created_at)); },
    async markAllRead() { const me = meU(); db.notifications.forEach(n => { if (n.user_id === me.id) n.read = true; }); save(); },
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    onRecovery() {},
    reset() { try { localStorage.removeItem(KEY); localStorage.removeItem(SKEY); } catch {} mem = null; db = seed(); write(db); setS(null); }
  };
}

const api = DEMO ? demoBackend() : supabaseBackend();

/* =================================================================
   ESTADO Y UTILIDADES DE INTERFAZ
   ================================================================= */
const S = { me: null, loans: [], notes: [], clients: [], tab: 'pendientes', authTab: 'login', unsub: null };
const app = $('#app');

function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.role = 'status'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3800);
}
function sheet(html, onMount) {
  closeSheet();
  const bg = document.createElement('div'); bg.className = 'sheet-bg'; bg.id = 'sheet';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) closeSheet(); });
  document.body.appendChild(bg); onMount && onMount(bg); const f = bg.querySelector('input,button.x'); f && f.focus();
}
function closeSheet() { $('#sheet')?.remove(); }
addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

function osNotify(n) {
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification(n.title, { body: n.body || '', icon: 'icon-192.png' }); } catch {}
}
function askOsPermission() {
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch {}
}

const logo = `<img src="logo.png" alt="Agente Móvil">`;
const bell = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>`;
const exitI = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>`;
const demoBar = () => DEMO ? `<div class="demo">Modo demo: los datos viven solo en este navegador. <button class="btn ghost small" data-act="reset" style="min-height:32px;margin-left:6px">Reiniciar demo</button></div>` : '';
const statusChip = l => isOverdue(l) ? `<span class="status s-vencido">Vencido</span>` :
  `<span class="status s-${l.status}">${{ pendiente: 'En evaluación', depositado: 'Depositado', rechazado: 'Rechazado', pagado: 'Pagado' }[l.status]}</span>`;

async function refresh() {
  [S.loans, S.notes] = await Promise.all([api.listLoans(), api.listNotifications()]);
  if (S.me.role === 'admin') S.clients = await api.listClients();
  render();
}
function subscribe() {
  S.unsub && S.unsub();
  S.unsub = api.onChange(n => {
    if (n) { toast(n.title); osNotify(n); }
    refresh().catch(() => {});
  });
}

/* =================================================================
   PANTALLA: INGRESO / REGISTRO
   ================================================================= */
function renderAuth() {
  const reg = S.authTab === 'reg';
  app.innerHTML = `${demoBar()}
  <div class="auth-hero">${logo}
    <h1>${esc(C.EMPRESA || 'Agente Móvil Perú')}</h1><p>Solicita tu crédito desde el celular y recibe la respuesta aquí mismo.</p></div>
  <div class="wrap"><div class="card auth-card">
    <div class="seg" role="tablist">
      <button role="tab" aria-selected="${!reg}" data-auth="login">Ingresar</button>
      <button role="tab" aria-selected="${reg}" data-auth="reg">Crear cuenta</button></div>
    <form id="authf" novalidate>
      ${reg ? `<label for="fn">Nombres y apellidos</label><input id="fn" required autocomplete="name">
      <div class="row2"><div><label for="dni">DNI</label><input id="dni" inputmode="numeric" maxlength="8" required></div>
      <div><label for="ph">Celular</label><input id="ph" inputmode="tel" maxlength="9" required autocomplete="tel"></div></div>` : ''}
      <label for="em">Correo electrónico</label><input id="em" type="email" required autocomplete="email">
      <label for="pw">Contraseña</label><input id="pw" type="password" required minlength="6" autocomplete="${reg ? 'new-password' : 'current-password'}">
      ${reg ? `<label style="display:flex;gap:10px;align-items:flex-start;font-weight:400"><input id="tc" type="checkbox" style="width:22px;min-height:22px;margin-top:2px"> Acepto el tratamiento de mis datos personales (Ley 29733) para evaluar mi solicitud.</label>` : ''}
      <p class="err" id="aerr"></p>
      <button class="btn block" id="asub">${reg ? 'Crear mi cuenta' : 'Ingresar'}</button>
      ${!reg && !DEMO ? `<p style="text-align:center;margin:14px 0 0"><a href="#" data-act="forgot">¿Olvidaste tu contraseña?</a></p>` : ''}
    </form></div>
    ${isStandalone() ? '' : `<div class="card"><h3>Lleva la app en tu celular</h3><p class="hint">Instálala gratis y entra con un toque desde tu pantalla de inicio.</p>
      <div class="actions"><button class="btn ghost" data-act="install">Instalar la app</button></div></div>`}
    ${DEMO ? `<div class="card"><h3>Probar la demo</h3><p class="hint">Entra con un toque como cada tipo de usuario:</p>
      <div class="actions"><button class="btn ghost" data-demo="admin@agentemovil.pe|admin123">Administrador</button>
      <button class="btn ghost" data-demo="maria@ejemplo.pe|cliente123">Cliente (María)</button>
      <button class="btn ghost" data-demo="jose@ejemplo.pe|cliente123">Cliente (José)</button></div></div>` : ''}
  </div>`;
  $('#authf').addEventListener('submit', async e => {
    e.preventDefault(); const err = $('#aerr'); err.textContent = '';
    const email = $('#em').value.trim(), password = $('#pw').value;
    try {
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Escribe un correo válido.');
      if (password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
      $('#asub').disabled = true;
      let me;
      if (reg) {
        const full_name = $('#fn').value.trim(), dni = $('#dni').value.trim(), phone = $('#ph').value.trim();
        if (full_name.length < 5) throw new Error('Escribe tus nombres y apellidos.');
        if (!/^\d{8}$/.test(dni)) throw new Error('El DNI debe tener 8 dígitos.');
        if (!/^9\d{8}$/.test(phone)) throw new Error('El celular debe tener 9 dígitos y empezar con 9.');
        if (!$('#tc').checked) throw new Error('Debes aceptar el tratamiento de datos.');
        me = await api.signUp({ email, password, full_name, dni, phone });
        if (me && me.needsConfirm) { S.authTab = 'login'; renderAuth(); toast('Te enviamos un correo para confirmar tu cuenta.'); return; }
      } else me = await api.signIn(email, password);
      await enter(me);
    } catch (x) { err.textContent = x.message; $('#asub').disabled = false; }
  });
}

async function enter(me) {
  S.me = me; S.tab = 'pendientes';
  await refresh(); subscribe(); askOsPermission();
}

/* =================================================================
   PANTALLA: CLIENTE
   ================================================================= */
function header(sub) {
  const unread = S.notes.filter(n => !n.read).length;
  return `${demoBar()}<header class="top"><div class="row">
    <div class="brand">${logo}</div>
    <div style="display:flex;gap:8px"><button class="iconbtn" data-act="notes" aria-label="Notificaciones">${bell}${unread ? `<span class="badge">${unread}</span>` : ''}</button>
    <button class="iconbtn" data-act="logout" aria-label="Cerrar sesión">${exitI}</button></div></div>
    <div class="hello"><h1>Hola, ${esc((S.me.full_name || S.me.email).split(' ')[0])}</h1><p>${sub}</p></div></header>`;
}

function renderClient() {
  const active = S.loans.find(l => l.status === 'depositado');
  const pending = S.loans.find(l => l.status === 'pendiente');
  let hero = '';
  if (active) {
    const paid = paidOf(active), bal = balanceOf(active), left = daysBetween(todayISO(), active.due_date);
    hero = `<section class="voucher" aria-label="Crédito activo">
      <span class="stamp">${isOverdue(active) ? 'VENCIDO' : 'DEPOSITADO'}</span>
      <div class="hint">Saldo por pagar</div><div class="big num">${money(bal)}</div>
      <div class="hint">${left >= 0 ? `Vence el ${fdate(active.due_date)} · faltan ${left} días` : `Venció el ${fdate(active.due_date)} · hace ${-left} días`}</div>
      <div class="bar" aria-label="Pagado ${Math.round(paid / active.total_to_pay * 100)}%"><i style="width:${Math.min(100, paid / active.total_to_pay * 100)}%"></i></div>
      <div class="grid2"><div class="kv"><div class="k">Monto depositado</div><div class="v">${money(active.approved_amount)}</div></div>
      <div class="kv"><div class="k">Total a pagar</div><div class="v">${money(active.total_to_pay)}</div></div>
      <div class="kv"><div class="k">Interés diario</div><div class="v">${(+active.daily_rate).toFixed(2)}%</div></div>
      <div class="kv"><div class="k">Ya pagaste</div><div class="v">${money(paid)}</div></div></div>
      <div class="actions"><button class="btn ghost" data-loan="${active.id}">Ver detalle</button>
      <a class="btn" href="${wa(C.WHATSAPP, `Hola, soy ${S.me.full_name}. Quiero coordinar el pago de mi crédito #${active.id}.`)}" target="_blank" rel="noopener">Coordinar pago</a></div></section>`;
  } else if (pending) {
    hero = `<section class="voucher"><span class="stamp" style="border-color:var(--bd);color:var(--bd)">EN EVALUACIÓN</span>
      <div class="hint">Solicitaste</div><div class="big num">${money(pending.requested_amount)}</div>
      <div class="hint">a ${pending.requested_days} días · enviado ${fwhen(pending.created_at)}</div>
      <p style="margin:14px 0 0">Estamos revisando tu solicitud. Te avisaremos aquí apenas sea aprobada y depositada.</p></section>`;
  } else {
    hero = `<section class="voucher"><div class="hint">¿Necesitas efectivo?</div><div class="big num" style="font-size:34px;white-space:normal">Pide tu crédito en 1 minuto</div>
      <p style="margin:10px 0 0">Desde ${money(C.MONTO_MIN)} hasta ${money(C.MONTO_MAX)}. Respuesta en esta misma app.</p>
      <div class="actions"><button class="btn block" data-act="request">Solicitar crédito</button></div></section>`;
  }
  app.innerHTML = header(active ? 'Este es tu crédito activo.' : pending ? 'Tu solicitud está en camino.' : 'Bienvenido a tu cuenta.') +
  `<main class="wrap">${hero}
    ${(active || pending) ? `<div class="card"><button class="btn block ghost" data-act="request" ${pending ? 'disabled' : ''}>Solicitar otro crédito</button>
      ${pending ? '<p class="hint" style="text-align:center">Podrás pedir otro cuando respondamos tu solicitud actual.</p>' : ''}</div>` : ''}
    <div class="card"><h2>Mis créditos</h2>
      ${S.loans.length ? `<ul class="list" style="margin-top:8px">${S.loans.map(l => `<li class="item" data-loan="${l.id}" tabindex="0">
        <div><div class="who">Crédito #${l.id}</div><div class="sub">${fdate(l.created_at)} · ${l.term_days || l.requested_days} días</div></div>
        <div style="text-align:right"><div class="amt">${money(l.approved_amount || l.requested_amount)}</div>${statusChip(l)}</div></li>`).join('')}</ul>`
      : `<p class="empty">Aún no tienes créditos.</p>`}</div></main>`;
}

function openRequest() {
  let amount = Math.min(C.MONTO_MAX, Math.max(C.MONTO_MIN, 500)), days = 30;
  const plazos = C.PLAZOS || [7, 15, 30];
  sheet(`<div class="head"><h2>Solicitar crédito</h2><button class="x" data-close aria-label="Cerrar">×</button></div>
    <form id="reqf" novalidate>
    <label for="amt">¿Cuánto necesitas?</label>
    <div class="amtbig num" id="amtv">${money(amount)}</div>
    <input class="range" id="amtr" type="range" min="${C.MONTO_MIN}" max="${C.MONTO_MAX}" step="50" value="${amount}" aria-label="Monto">
    <input id="amt" type="number" inputmode="decimal" min="${C.MONTO_MIN}" max="${C.MONTO_MAX}" step="any" value="${amount}" style="margin-top:10px">
    <label>¿En cuántos días pagarías?</label>
    <div class="chips" id="dch">${plazos.map(d => `<button type="button" class="chip" data-d="${d}" aria-pressed="${d === days}">${d} días</button>`).join('')}</div>
    <label for="pur">¿Para qué lo usarás? <span class="hint">(opcional)</span></label>
    <input id="pur" maxlength="120" placeholder="Ej. mercadería, estudios, emergencia">
    <div class="calc" id="est"></div>
    <p class="err" id="rerr"></p>
    <button class="btn block" id="rsub">Enviar solicitud</button></form>`, bg => {
    const rates = C.TASAS_DIARIAS || [0.2, 0.3];
    const upd = () => {
      $('#amtv', bg).textContent = money(amount);
      const lo = calc(amount, Math.min(...rates), days), hi = calc(amount, Math.max(...rates), days);
      $('#est', bg).innerHTML = `<div class="line"><span>Interés referencial</span><b>${Math.min(...rates)}% – ${Math.max(...rates)}% diario</b></div>
        <div class="line"><span>Total estimado a pagar</span><b>${money(lo.total)} – ${money(hi.total)}</b></div>
        <p class="hint">Es un estimado. La tasa y el monto final te los confirmamos al aprobar.</p>`;
    };
    $('#amtr', bg).oninput = e => { amount = +e.target.value; $('#amt', bg).value = amount; upd(); };
    $('#amt', bg).oninput = e => { amount = +e.target.value || 0; $('#amtr', bg).value = amount; upd(); };
    $('#dch', bg).onclick = e => { const b = e.target.closest('[data-d]'); if (!b) return; days = +b.dataset.d;
      bg.querySelectorAll('#dch .chip').forEach(c => c.setAttribute('aria-pressed', c === b)); upd(); };
    upd();
    $('#reqf', bg).onsubmit = async e => {
      e.preventDefault(); const err = $('#rerr', bg);
      if (amount < C.MONTO_MIN || amount > C.MONTO_MAX) { err.textContent = `El monto debe estar entre ${money(C.MONTO_MIN)} y ${money(C.MONTO_MAX)}.`; return; }
      $('#rsub', bg).disabled = true;
      try {
        await api.createLoan({ requested_amount: r2(amount), requested_days: days, purpose: $('#pur', bg).value.trim() || null });
        closeSheet(); await refresh(); toast('Solicitud enviada. Te avisaremos aquí.');
      } catch (x) { err.textContent = x.message; $('#rsub', bg).disabled = false; }
    };
  });
}

/* =================================================================
   PANTALLA: ADMINISTRADOR
   ================================================================= */
function renderAdmin() {
  const pend = S.loans.filter(l => l.status === 'pendiente');
  const act = S.loans.filter(l => l.status === 'depositado');
  const hist = S.loans.filter(l => l.status === 'pagado' || l.status === 'rechazado');
  const capital = act.reduce((s, l) => s + +l.approved_amount, 0);
  const porCobrar = act.reduce((s, l) => s + balanceOf(l), 0);
  const ganado = S.loans.filter(l => l.status === 'pagado' || l.status === 'depositado').reduce((s, l) => s + +(l.total_interest || 0), 0);
  const venc = act.filter(isOverdue).length;
  const tabs = [['pendientes', `Solicitudes (${pend.length})`], ['activos', `Activos (${act.length})`], ['historial', 'Historial'], ['clientes', `Clientes (${S.clients.length})`]];
  const row = l => `<li class="item" data-loan="${l.id}" tabindex="0">
    <div><div class="who">${esc(l.client?.full_name || l.client?.email)}</div>
    <div class="sub">#${l.id} · ${l.status === 'pendiente' ? `pidió ${l.requested_days} días · ${fwhen(l.created_at)}` :
      l.status === 'depositado' ? `vence ${fdate(l.due_date)} · saldo ${money(balanceOf(l))}` : fdate(l.decided_at || l.created_at)}</div></div>
    <div style="text-align:right"><div class="amt">${money(l.approved_amount || l.requested_amount)}</div>${statusChip(l)}</div></li>`;
  let body;
  if (S.tab === 'clientes') body = S.clients.length ? `<ul class="list">${S.clients.map(c => {
      const n = S.loans.filter(l => l.client_id === c.id).length;
      return `<li class="item" style="cursor:default"><div><div class="who">${esc(c.full_name || c.email)}</div>
      <div class="sub">DNI ${esc(c.dni || '—')} · ${esc(c.email)}</div></div>
      <div style="text-align:right"><div class="sub">${n} crédito${n === 1 ? '' : 's'}</div>
      ${c.phone ? `<a href="${wa(c.phone, 'Hola ' + (c.full_name || '') + ', te escribimos de ' + C.EMPRESA + '.')}" target="_blank" rel="noopener">WhatsApp ${esc(c.phone)}</a>` : ''}</div></li>`; }).join('')}</ul>`
    : `<p class="empty">Todavía no hay clientes registrados.</p>`;
  else {
    const list = { pendientes: pend, activos: act.sort((a, b) => a.due_date.localeCompare(b.due_date)), historial: hist }[S.tab];
    body = list.length ? `<ul class="list">${list.map(row).join('')}</ul>` :
      `<p class="empty">${{ pendientes: 'No hay solicitudes nuevas. Te avisaremos cuando llegue una.', activos: 'No hay créditos activos.', historial: 'Sin historial todavía.' }[S.tab]}</p>`;
  }
  app.innerHTML = header(pend.length ? `Tienes ${pend.length} solicitud${pend.length > 1 ? 'es' : ''} por revisar.` : 'Panel de administración.') +
  `<main class="wrap wide">
    <div class="stats" style="margin-top:14px">
      <div class="stat"><div class="k">Capital prestado</div><div class="v">${money(capital)}</div></div>
      <div class="stat"><div class="k">Por cobrar</div><div class="v">${money(porCobrar)}</div></div>
      <div class="stat"><div class="k">Intereses (activos + pagados)</div><div class="v">${money(ganado)}</div></div>
      <div class="stat"><div class="k">Vencidos</div><div class="v" style="color:${venc ? 'var(--bad)' : 'inherit'}">${venc}</div></div></div>
    <div class="tabs" role="tablist">${tabs.map(([k, t]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${t}</button>`).join('')}</div>
    <div class="card" style="margin-top:8px">${body}</div></main>`;
}

function openEvaluate(l) {
  const rates = C.TASAS_DIARIAS || [0.2, 0.3];
  let rate = rates[0];
  sheet(`<div class="head"><h2>Evaluar solicitud #${l.id}</h2><button class="x" data-close aria-label="Cerrar">×</button></div>
    <div class="card" style="margin-top:8px"><div class="who" style="font-weight:600">${esc(l.client?.full_name)}</div>
      <div class="hint">DNI ${esc(l.client?.dni || '—')} · ${esc(l.client?.email)} · ${esc(l.client?.phone || '')}</div>
      <p style="margin:10px 0 0">Pidió <b>${money(l.requested_amount)}</b> a <b>${l.requested_days} días</b>${l.purpose ? ` · “${esc(l.purpose)}”` : ''}</p>
      ${l.client?.phone ? `<a class="btn ghost small" style="margin-top:10px" target="_blank" rel="noopener" href="${wa(l.client.phone, `Hola ${l.client.full_name}, recibimos tu solicitud de ${money(l.requested_amount)} en ${C.EMPRESA}.`)}">Escribir por WhatsApp</a>` : ''}</div>
    <form id="evf" novalidate>
    <div class="row2"><div><label for="am">Monto a prestar (S/)</label><input id="am" type="number" inputmode="decimal" step="any" min="1" value="${l.requested_amount}"></div>
    <div><label for="dd">Plazo (días)</label><input id="dd" type="number" inputmode="numeric" min="1" max="365" value="${l.requested_days}"></div></div>
    <label>Interés diario</label>
    <div class="chips" id="rch">${rates.map(r => `<button type="button" class="chip" data-r="${r}" aria-pressed="${r === rate}">${r}%</button>`).join('')}
      <input id="rc" type="number" step="any" min="0" max="5" placeholder="Otra %" style="width:110px;min-height:44px" aria-label="Otra tasa diaria"></div>
    <label for="sd">Fecha de depósito</label><input id="sd" type="date" value="${todayISO()}">
    <label for="nt">Nota para el cliente <span class="hint">(opcional)</span></label><input id="nt" maxlength="200" placeholder="Ej. Depositado a tu Yape 987…">
    <div class="calc" id="cc"></div>
    <p class="err" id="everr"></p>
    <div class="actions"><button type="button" class="btn ghost" id="rej">Rechazar</button>
    <button class="btn ok" id="apr">Confirmar aprobación y depósito</button></div></form>`, bg => {
    const v = () => ({ amount: +$('#am', bg).value || 0, days: +$('#dd', bg).value || 0, start: $('#sd', bg).value || todayISO() });
    const upd = () => {
      const { amount, days, start } = v(), c = calc(amount, rate, days), cap = +C.TASA_MAXIMA_TEA || 0;
      $('#cc', bg).innerHTML = `<div class="line"><span>Capital</span><b>${money(amount)}</b></div>
        <div class="line"><span>Interés (${rate}% × ${days} días)</span><b>${money(c.interest)}</b></div>
        <div class="line"><span>Vence el</span><b>${fdate(addDays(start, days))}</b></div>
        <div class="line total"><span>Total a pagar</span><b>${money(c.total)}</b></div>
        <div class="line"><span class="hint">Tasa efectiva anual equivalente (TEA)</span><b class="hint">${c.tea.toFixed(1)}%</b></div>
        ${cap && c.tea > cap ? `<div class="alert bad">Esta tasa equivale a ${c.tea.toFixed(1)}% efectivo anual y supera el tope del BCRP configurado (${cap}%). Cobrar por encima del tope puede ser ilegal. Revisa la tasa o consulta a tu abogado.</div>` : ''}`;
    };
    $('#rch', bg).addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (!b) return; rate = +b.dataset.r; $('#rc', bg).value = '';
      bg.querySelectorAll('#rch .chip').forEach(c => c.setAttribute('aria-pressed', c === b)); upd(); });
    $('#rc', bg).oninput = e => { const x = +e.target.value; if (x > 0) { rate = x; bg.querySelectorAll('#rch .chip').forEach(c => c.setAttribute('aria-pressed', 'false')); } upd(); };
    ['am', 'dd', 'sd'].forEach(id => $('#' + id, bg).oninput = upd); upd();
    $('#evf', bg).onsubmit = async e => {
      e.preventDefault(); const { amount, days, start } = v(), err = $('#everr', bg);
      if (amount <= 0 || days <= 0 || rate <= 0) { err.textContent = 'Revisa el monto, el plazo y la tasa.'; return; }
      const c = calc(amount, rate, days); $('#apr', bg).disabled = true;
      try {
        await api.updateLoan(l.id, { status: 'depositado', approved_amount: r2(amount), daily_rate: rate, term_days: days, total_interest: c.interest,
          total_to_pay: c.total, start_date: start, due_date: addDays(start, days), admin_note: $('#nt', bg).value.trim() || null, decided_at: new Date().toISOString() });
        closeSheet(); await refresh(); toast('Crédito aprobado. El cliente ya fue notificado.');
      } catch (x) { err.textContent = x.message; $('#apr', bg).disabled = false; }
    };
    $('#rej', bg).onclick = () => {
      const b = $('#rej', bg);
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = '¿Seguro? Toca otra vez'; return; }
      api.updateLoan(l.id, { status: 'rechazado', admin_note: $('#nt', bg).value.trim() || null, decided_at: new Date().toISOString() })
        .then(() => { closeSheet(); return refresh(); }).then(() => toast('Solicitud rechazada.')).catch(x => $('#everr', bg).textContent = x.message);
    };
  });
}

function openLoan(l) {
  const admin = S.me.role === 'admin';
  if (admin && l.status === 'pendiente') return openEvaluate(l);
  const paid = paidOf(l), bal = balanceOf(l);
  const pays = (l.payments || []).slice().sort((a, b) => (a.paid_on || '').localeCompare(b.paid_on || ''));
  sheet(`<div class="head"><h2>Crédito #${l.id}</h2><button class="x" data-close aria-label="Cerrar">×</button></div>
    ${statusChip(l)} ${admin ? `<span class="hint">· ${esc(l.client?.full_name)} · DNI ${esc(l.client?.dni || '—')}</span>` : ''}
    ${l.status === 'pendiente' ? `<div class="calc"><div class="line"><span>Solicitado</span><b>${money(l.requested_amount)}</b></div>
      <div class="line"><span>Plazo pedido</span><b>${l.requested_days} días</b></div><p class="hint">Estamos evaluando tu solicitud.</p></div>` :
    l.status === 'rechazado' ? `<div class="alert bad">${esc(l.admin_note || 'La solicitud no fue aprobada.')}</div>` :
    `<div class="calc"><div class="line"><span>Depositado el</span><b>${fdate(l.start_date)}</b></div>
      <div class="line"><span>Monto</span><b>${money(l.approved_amount)}</b></div>
      <div class="line"><span>Interés ${(+l.daily_rate).toFixed(2)}% diario × ${l.term_days} días</span><b>${money(l.total_interest)}</b></div>
      <div class="line"><span>Vence el</span><b>${fdate(l.due_date)}</b></div>
      <div class="line total"><span>Total a pagar</span><b>${money(l.total_to_pay)}</b></div>
      <div class="line"><span>Pagado</span><b>${money(paid)}</b></div>
      <div class="line"><span>Saldo</span><b style="color:${bal > 0 ? 'var(--red-ink)' : 'var(--ok)'}">${money(bal)}</b></div></div>
      ${l.admin_note ? `<p class="hint">Nota: ${esc(l.admin_note)}</p>` : ''}
      <h3 style="margin-top:18px">Pagos</h3>
      ${pays.length ? `<table><tbody>${pays.map(p => `<tr><td>${fdate(p.paid_on)}</td><td>${esc(p.note || '')}</td><td class="r">${money(p.amount)}</td></tr>`).join('')}</tbody></table>` : `<p class="hint">Aún no hay pagos registrados.</p>`}
      ${admin && l.status === 'depositado' ? `<form id="payf" class="card" novalidate><h3>Registrar pago</h3>
        <div class="row2"><div><label for="pa">Monto (S/)</label><input id="pa" type="number" inputmode="decimal" step="any" min="0.01" value="${bal.toFixed(2)}"></div>
        <div><label for="pd">Fecha</label><input id="pd" type="date" value="${todayISO()}"></div></div>
        <label for="pn">Medio / nota</label><input id="pn" placeholder="Yape, Plin, efectivo…" maxlength="80">
        <p class="err" id="perr"></p><button class="btn block">Guardar pago</button></form>
        <div class="actions">${l.client?.phone ? `<a class="btn ghost" target="_blank" rel="noopener" href="${wa(l.client.phone, `Hola ${l.client.full_name}, te recordamos que tu crédito #${l.id} vence el ${fdate(l.due_date)}. Saldo: ${money(bal)}.`)}">Recordar por WhatsApp</a>` : ''}
        <button class="btn ghost" id="mpaid">Marcar como pagado</button></div>` : ''}`}`, bg => {
    const f = $('#payf', bg);
    if (f) f.onsubmit = async e => {
      e.preventDefault(); const a = r2(+$('#pa', bg).value);
      if (!(a > 0)) { $('#perr', bg).textContent = 'Escribe un monto válido.'; return; }
      try {
        await api.addPayment(l.id, a, $('#pn', bg).value.trim() || null, $('#pd', bg).value || todayISO());
        if (a >= bal - 0.004) await api.updateLoan(l.id, { status: 'pagado', paid_at: new Date().toISOString() });
        closeSheet(); await refresh(); toast(a >= bal - 0.004 ? 'Pago registrado. Crédito cancelado.' : 'Pago registrado.');
      } catch (x) { $('#perr', bg).textContent = x.message; }
    };
    const mp = $('#mpaid', bg);
    if (mp) mp.onclick = async () => {
      if (mp.dataset.sure !== '1') { mp.dataset.sure = '1'; mp.textContent = bal > 0 ? `Queda ${money(bal)}. ¿Confirmar?` : '¿Confirmar?'; return; }
      await api.updateLoan(l.id, { status: 'pagado', paid_at: new Date().toISOString() }); closeSheet(); await refresh(); toast('Crédito marcado como pagado.');
    };
  });
}

function openNotes() {
  sheet(`<div class="head"><h2>Notificaciones</h2><button class="x" data-close aria-label="Cerrar">×</button></div>
    ${S.notes.length ? S.notes.map(n => `<div class="notif ${n.read ? '' : 'unread'}" ${n.loan_id ? `data-loan="${n.loan_id}" style="cursor:pointer"` : ''}>
      <div class="t">${esc(n.title)}</div><div>${esc(n.body || '')}</div><div class="d">${fwhen(n.created_at)}</div></div>`).join('') : '<p class="empty">No tienes notificaciones.</p>'}
    ${'Notification' in window && Notification.permission === 'default' ? `<button class="btn ghost block" style="margin-top:14px" data-act="perm">Activar avisos en este dispositivo</button>` : ''}`);
  if (S.notes.some(n => !n.read)) api.markAllRead().then(() => { S.notes.forEach(n => n.read = true); const b = $('.top .badge'); b && b.remove(); }).catch(() => {});
}

/* ---------- Instalar la app en el celular ---------- */
let deferredInstall = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
addEventListener('appinstalled', () => { deferredInstall = null; closeSheet(); toast('¡App instalada! Búscala en tu pantalla de inicio.'); });
const isStandalone = () => { try { return /AgenteMovilApp/.test(navigator.userAgent) || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch { return false; } };
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
function openInstall() {
  sheet(`<div class="head"><h2>Instalar la app</h2><button class="x" data-close aria-label="Cerrar">×</button></div>
    <div style="text-align:center;margin:8px 0 14px"><img src="icon-192.png" alt="" width="84" height="84" style="border-radius:20px"></div>
    ${isIOS ? `<div class="calc"><b>En iPhone (Safari):</b>
      <div class="line"><span>1. Toca el botón Compartir (el cuadrado con la flecha hacia arriba).</span></div>
      <div class="line"><span>2. Elige “Agregar a inicio”.</span></div>
      <div class="line"><span>3. Toca “Agregar”. El ícono aparecerá en tu pantalla.</span></div></div>
      <p class="hint">Debe abrirse en Safari; desde otros navegadores de iPhone no se puede instalar.</p>`
    : `<a class="btn block" href="../agente-movil.apk" download>Descargar la app (APK)</a>
      <div class="calc"><b>En Android:</b>
      <div class="line"><span>1. Toca el botón y espera la descarga.</span></div>
      <div class="line"><span>2. Abre el archivo agente-movil.apk.</span></div>
      <div class="line"><span>3. Si tu celular lo pide, permite “instalar apps de esta fuente” y toca Instalar.</span></div></div>
      <button class="btn ghost block" id="doinst" style="margin-top:12px">Instalar sin descargar</button>
      <p class="err" id="insterr"></p>`}`, bg => {
    const b = $('#doinst', bg);
    if (b) b.onclick = async () => {
      if (!deferredInstall) { $('#insterr', bg).textContent = 'Tu navegador no lo permite ahora. Usa el botón de descarga, o el menú ⋮ de Chrome → “Instalar app”.'; return; }
      deferredInstall.prompt(); try { await deferredInstall.userChoice; } catch {} deferredInstall = null;
    };
  });
}

function openForgot() {
  sheet(`<div class="head"><h2>Recuperar contraseña</h2><button class="x" data-close aria-label="Cerrar">×</button></div>
    <form id="fgf" novalidate><label for="fe">Tu correo</label><input id="fe" type="email" required><p class="err" id="fer"></p>
    <button class="btn block">Enviarme un enlace</button></form>`, bg => {
    $('#fgf', bg).onsubmit = async e => { e.preventDefault();
      try { await api.resetPassword($('#fe', bg).value.trim()); closeSheet(); toast('Revisa tu correo para crear una nueva contraseña.'); }
      catch (x) { $('#fer', bg).textContent = x.message; } };
  });
}
function openNewPassword() {
  sheet(`<div class="head"><h2>Nueva contraseña</h2></div><form id="npf" novalidate><label for="np">Escribe tu nueva contraseña</label>
    <input id="np" type="password" minlength="6" required><p class="err" id="nperr"></p><button class="btn block">Guardar</button></form>`, bg => {
    $('#npf', bg).onsubmit = async e => { e.preventDefault(); const p = $('#np', bg).value;
      if (p.length < 6) { $('#nperr', bg).textContent = 'Mínimo 6 caracteres.'; return; }
      try { await api.updatePassword(p); closeSheet(); toast('Contraseña actualizada.'); } catch (x) { $('#nperr', bg).textContent = x.message; } };
  });
}

/* =================================================================
   RENDER Y EVENTOS
   ================================================================= */
function render() {
  if (!S.me) return renderAuth();
  S.me.role === 'admin' ? renderAdmin() : renderClient();
}

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act],[data-auth],[data-tab],[data-loan],[data-demo]');
  if (!t) return;
  if (t.dataset.auth) { S.authTab = t.dataset.auth; return renderAuth(); }
  if (t.dataset.tab) { S.tab = t.dataset.tab; return renderAdmin(); }
  if (t.dataset.demo) { const [u, p] = t.dataset.demo.split('|'); try { await enter(await api.signIn(u, p)); } catch (x) { toast(x.message); } return; }
  if (t.dataset.loan) { const l = S.loans.find(x => String(x.id) === t.dataset.loan); if (l) { closeSheet(); openLoan(l); } return; }
  const a = t.dataset.act;
  if (a === 'request') openRequest();
  if (a === 'notes') openNotes();
  if (a === 'install') openInstall();
  if (a === 'forgot') { e.preventDefault(); openForgot(); }
  if (a === 'perm') { askOsPermission(); closeSheet(); }
  if (a === 'logout') { document.querySelectorAll('.toast').forEach(x => x.remove()); S.unsub && S.unsub(); await api.signOut(); S.me = null; S.authTab = 'login'; render(); }
  if (a === 'reset' && api.reset) {
    if (t.dataset.sure !== '1') { t.dataset.sure = '1'; t.textContent = '¿Borrar todo? Toca otra vez'; return; }
    S.unsub && S.unsub(); api.reset(); S.me = null; render(); toast('Demo reiniciada.');
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.item[data-loan]')) e.target.click(); });

(async () => {
  app.innerHTML = '<p class="empty" style="padding-top:30vh">Cargando…</p>';
  api.onRecovery(openNewPassword);
  try { const me = await api.current(); if (me) await enter(me); else render(); }
  catch (x) { render(); toast(x.message); }
  if (location.hash === '#instalar' && !isStandalone()) openInstall();
  try { if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js'); } catch {}
})();
}
