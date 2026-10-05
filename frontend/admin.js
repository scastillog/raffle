const $ = (id) => document.getElementById(id);
const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const TOKEN_KEY = 'rifa-admin-token';
const MODE_LABEL = { libre: 'Eligió 2', pareja: 'Pareja', azar: 'Azar' };

const state = { data: null, filter: 'pendiente' };

function token() {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function setToken(value) {
  try { value ? sessionStorage.setItem(TOKEN_KEY, value) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/admin/login') {
    logout();
    throw new Error('Tu sesión venció. Entra de nuevo.');
  }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function showPanel(visible) {
  $('login-card').classList.toggle('hidden', visible);
  $('panel').classList.toggle('hidden', !visible);
}

let expiryInterval = null;

function logout() {
  if (expiryInterval) clearInterval(expiryInterval);
  setToken(null);
  showPanel(false);
}

const fmtDate = (ms) => new Date(ms).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });

function renderStats({ stats, info }) {
  const items = [
    ['Pagados', stats.pagados],
    ['Pendientes de pago', stats.pendientes],
    ['Números vendidos', `${stats.numerosVendidos} / ${info.totalNumbers}`],
    ['Recaudado', cop.format(stats.recaudado)],
    ['Premio', cop.format(info.prize)],
    ['Balance', cop.format(stats.recaudado - info.prize)],
  ];
  $('stats').replaceChildren(
    ...items.map(([label, value]) => {
      const div = document.createElement('div');
      div.className = 'stat';
      div.textContent = label;
      const b = document.createElement('b');
      b.textContent = value;
      div.append(b);
      return div;
    }),
  );
}

function cell(text, className) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function actionButton(label, className, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn small ${className}`;
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

function visibleTickets() {
  const q = $('search').value.trim().toLowerCase();
  return state.data.tickets.filter((t) => {
    if (state.filter !== 'todos' && t.status !== state.filter) return false;
    if (!q) return true;
    return [t.id, t.orderId ?? '', t.name, t.phone, t.verificationCode ?? '', ...t.numbers].some((v) => v.toLowerCase().includes(q));
  });
}

const confirmable = (t) => t.status === 'pendiente' || t.status === 'vencido';

// Tickets of the same order still waiting for payment, keyed by orderId.
function pendingByOrder() {
  const map = new Map();
  for (const t of state.data.tickets) {
    if (!t.orderId || !confirmable(t)) continue;
    map.set(t.orderId, [...(map.get(t.orderId) ?? []), t]);
  }
  return map;
}

function renderRows() {
  const orders = pendingByOrder();
  const rows = visibleTickets().map((t) => {
    const tr = document.createElement('tr');
    const badge = document.createElement('span');
    badge.className = `badge ${t.status}`;
    badge.textContent = t.status;
    const statusTd = document.createElement('td');
    statusTd.append(badge);

    const phoneTd = document.createElement('td');
    const wa = document.createElement('a');
    wa.href = `https://wa.me/57${t.phone}`;
    wa.target = '_blank';
    wa.rel = 'noopener';
    wa.textContent = t.phone;
    phoneTd.append(wa);

    const actions = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'row-actions';
    const orderPending = t.orderId ? orders.get(t.orderId) ?? [] : [];
    if (confirmable(t) && orderPending.length > 1) {
      wrap.append(actionButton(`Confirmar pedido (${orderPending.length})`, '', () => confirmOrder(t.orderId, orderPending)));
    }
    if (confirmable(t)) {
      wrap.append(actionButton(orderPending.length > 1 ? 'Solo este' : 'Confirmar pago', orderPending.length > 1 ? 'secondary' : '', () => act(t, 'confirmar')));
    }
    if (t.status !== 'cancelado') {
      wrap.append(actionButton('Cancelar', 'danger', () => act(t, 'cancelar')));
    }
    actions.append(wrap);

    tr.append(
      cell(t.id),
      cell(t.orderId ?? '—'),
      cell(t.numbers.join(' · '), 'nums'),
      cell(t.name, 'name'),
      phoneTd,
      cell(MODE_LABEL[t.mode] ?? t.mode),
      statusTd,
      cell(fmtDate(t.createdAt)),
      actions,
    );
    return tr;
  });
  $('rows').replaceChildren(...rows);
  $('empty').classList.toggle('hidden', rows.length > 0);
}

function renderWinner(winner) {
  const box = $('winner-current');
  box.classList.toggle('hidden', !winner);
  box.replaceChildren();
  if (!winner) return;
  const p = document.createElement('p');
  p.textContent = winner.ticket
    ? `Ganador: número ${winner.number} (lotería ${winner.lotteryNumber}, ${winner.drawDate}) – ${winner.ticket.name}, ${winner.ticket.phone}, boleto ${winner.ticket.id}.`
    : `Resultado: número ${winner.number} (lotería ${winner.lotteryNumber}, ${winner.drawDate}) – no fue vendido, premio desierto.`;
  const undo = actionButton('Borrar resultado y reabrir ventas', 'secondary', async () => {
    if (!confirm('¿Borrar el resultado registrado? Las ventas se reabren.')) return;
    await api('DELETE', '/api/admin/ganador').catch((e) => alert(e.message));
    refresh();
  });
  box.append(p, undo);
}

function renderVerificationCode(vCode) {
  if (!vCode || !vCode.code) return;
  $('admin-verify-code').textContent = vCode.code;

  if (expiryInterval) clearInterval(expiryInterval);

  function updateExpiry() {
    const remainingMs = vCode.expiresAt - Date.now();
    if (remainingMs <= 0) {
      $('code-expiry-text').textContent = 'Código expirado. Actualizando...';
      refresh();
      return;
    }
    const minutes = Math.floor(remainingMs / 60000);
    const seconds = Math.floor((remainingMs % 60000) / 1000);
    $('code-expiry-text').textContent = `Expira en: ${minutes}m ${seconds < 10 ? '0' : ''}${seconds}s`;
  }

  updateExpiry();
  expiryInterval = setInterval(updateExpiry, 1000);
}

async function refresh() {
  $('panel-error').textContent = '';
  try {
    state.data = await api('GET', '/api/admin/boletos');
    renderStats(state.data);
    renderVerificationCode(state.data.verificationCode);
    renderRows();
    renderWinner(state.data.winner);
  } catch (err) {
    $('panel-error').textContent = err.message;
  }
}

async function act(ticket, action) {
  const verb = action === 'confirmar' ? 'confirmar el pago de' : 'CANCELAR';
  if (!confirm(`¿Seguro que quieres ${verb} el boleto ${ticket.id} (${ticket.numbers.join(' y ')}) de ${ticket.name}?`)) return;
  try {
    await api('POST', `/api/admin/boletos/${ticket.id}/${action}`);
  } catch (err) {
    alert(err.message);
  }
  refresh();
}

async function confirmOrder(orderId, tickets) {
  const total = cop.format(tickets.length * state.data.info.ticketPrice);
  const list = tickets.map((t) => `${t.id} (${t.numbers.join(' y ')})`).join('\n');
  if (!confirm(`¿Confirmar el pago del pedido ${orderId} de ${tickets[0].name}? ${tickets.length} boletos, ${total}:\n${list}`)) return;
  try {
    await api('POST', `/api/admin/pedidos/${orderId}/confirmar`);
  } catch (err) {
    alert(err.message);
  }
  refresh();
}

function exportCsv() {
  const header = ['codigo', 'pedido', 'numero1', 'numero2', 'nombre', 'celular', 'modo', 'codigo_verificacion', 'estado', 'creado'];
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = state.data.tickets.map((t) =>
    [t.id, t.orderId ?? '', t.numbers[0], t.numbers[1], t.name, t.phone, t.mode, t.verificationCode ?? '', t.status, new Date(t.createdAt).toISOString()].map(esc).join(','),
  );
  const blob = new Blob([`﻿${header.join(',')}\n${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `boletos-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  try {
    const { token: t } = await api('POST', '/api/admin/login', { password: $('password').value });
    setToken(t);
    $('password').value = '';
    showPanel(true);
    refresh();
  } catch (err) {
    $('login-error').textContent = err.message;
  }
});

$('winner-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('winner-error').textContent = '';
  const lotteryNumber = $('lottery-number').value.trim();
  if (!confirm(`¿Registrar ${lotteryNumber} como resultado? El número ganador será ${lotteryNumber.slice(-3)}.`)) return;
  try {
    await api('POST', '/api/admin/ganador', { lotteryNumber, drawDate: $('lottery-date').value });
    refresh();
  } catch (err) {
    $('winner-error').textContent = err.message;
  }
});

$('filters').addEventListener('click', (e) => {
  const filter = e.target.closest('button')?.dataset.filter;
  if (!filter) return;
  state.filter = filter;
  for (const b of $('filters').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.filter === filter));
  }
  renderRows();
});

$('search').addEventListener('input', () => state.data && renderRows());
$('refresh').addEventListener('click', refresh);
$('export').addEventListener('click', () => state.data && exportCsv());
$('logout').addEventListener('click', logout);

$('copy-code-btn').addEventListener('click', async () => {
  const code = $('admin-verify-code').textContent.trim();
  if (!code || code === '------') return;
  try {
    await navigator.clipboard.writeText(code);
    $('code-copy-feedback').textContent = '¡Copiado!';
    setTimeout(() => { $('code-copy-feedback').textContent = ''; }, 2500);
  } catch {
    $('code-copy-feedback').textContent = 'Error al copiar';
    setTimeout(() => { $('code-copy-feedback').textContent = ''; }, 2500);
  }
});

$('share-link-btn').addEventListener('click', async () => {
  const code = $('admin-verify-code').textContent.trim();
  if (!/^\d{6}$/.test(code)) return;
  const link = `${location.origin}/?code=${code}`;
  try {
    await navigator.clipboard.writeText(link);
    $('code-copy-feedback').textContent = '¡Enlace copiado!';
  } catch {
    $('code-copy-feedback').textContent = 'Error al copiar';
  }
  setTimeout(() => { $('code-copy-feedback').textContent = ''; }, 2500);
});

$('regen-code-btn').addEventListener('click', async () => {
  if (!confirm('¿Generar un nuevo código de 6 dígitos ahora? El código anterior tendrá unos minutos de gracia.')) return;
  try {
    const res = await api('POST', '/api/admin/codigo/regenerar');
    if (res && res.code) {
      state.data.verificationCode = res;
      renderVerificationCode(res);
      $('code-copy-feedback').textContent = '¡Nuevo código generado!';
      setTimeout(() => { $('code-copy-feedback').textContent = ''; }, 2500);
    }
  } catch (err) {
    alert(err.message);
  }
});

if (token()) {
  showPanel(true);
  refresh();
}
