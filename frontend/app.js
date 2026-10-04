const PAIR_OFFSET = 500;
const $ = (id) => document.getElementById(id);
const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const pad = (n) => String(n).padStart(3, '0');
const pairOf = (n) => pad((Number(n) + PAIR_OFFSET) % 1000);

function errorMessage(res, data) {
  if (data.error) return data.error;
  if (res.status === 429) return 'Hay muchas solicitudes en este momento. Espera unos segundos e intenta de nuevo.';
  return `Error ${res.status}. Intenta de nuevo.`;
}

const plural = (n, one, many) => (n === 1 ? one : many);

const modeHelp = (mode, q) => ({
  libre: `Toca ${2 * q} números disponibles en la tabla.`,
  pareja: `Toca ${q} ${plural(q, 'número', 'números')} y te damos también ${plural(q, 'su pareja', 'sus parejas')} (+${PAIR_OFFSET}). Ej: 123 va con 623.`,
  azar: `Te asignamos ${2 * q} números disponibles al azar cuando reserves.`,
})[mode];

// `selected` holds what the buyer tapped: every number in libre, only the first of each pair in pareja.
const state = { info: null, taken: {}, mode: 'libre', quantity: 1, hundred: 0, selected: [] };

const selectionLimit = () => (state.mode === 'pareja' ? state.quantity : 2 * state.quantity);
const partners = () => (state.mode === 'pareja' ? state.selected.map(pairOf) : []);
const allNumbers = () => (state.mode === 'pareja' ? state.selected.flatMap((n) => [n, pairOf(n)]) : state.selected);

function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function renderChips(container, numbers, slots = 2) {
  container.replaceChildren();
  let pair;
  for (let i = 0; i < slots; i++) {
    if (i % 2 === 0) {
      pair = document.createElement('span');
      pair.className = 'chip-pair';
      container.append(pair);
    }
    const chip = document.createElement('span');
    chip.className = numbers[i] ? 'chip' : 'chip empty';
    chip.textContent = numbers[i] ?? (state.mode === 'azar' ? '?' : '___');
    pair.append(chip);
  }
}

function canBuy() {
  return state.mode === 'azar' || state.selected.length === selectionLimit();
}

function buyLabel() {
  const q = state.quantity;
  const total = state.info ? ` · ${cop.format(q * state.info.ticketPrice)}` : '';
  return `Reservar ${q} ${plural(q, 'boleto', 'boletos')}${total}`;
}

function renderSelection() {
  renderChips($('chips'), allNumbers(), 2 * state.quantity);
  const total = state.info ? cop.format(state.quantity * state.info.ticketPrice) : '';
  $('pick-count').textContent = `${allNumbers().length} de ${2 * state.quantity} números`;
  $('pick-total').textContent = total;
  $('buy-btn').textContent = buyLabel();
  $('buy-btn').disabled = !canBuy();
}

function renderHundreds() {
  const tabs = $('hundreds');
  tabs.replaceChildren();
  for (let h = 0; h < 10; h++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${pad(h * 100)}–${pad(h * 100 + 99)}`;
    b.setAttribute('aria-pressed', String(h === state.hundred));
    b.onclick = () => { state.hundred = h; renderHundreds(); renderGrid(); };
    tabs.append(b);
  }
}

function renderGrid() {
  const grid = $('grid');
  grid.replaceChildren();
  const selectedPartners = partners();
  for (let i = state.hundred * 100; i < state.hundred * 100 + 100; i++) {
    const n = pad(i);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'num';
    b.textContent = n;
    const status = state.taken[n];
    // In pareja mode a number is only selectable if its partner is free too.
    const blocked = status || (state.mode === 'pareja' && state.taken[pairOf(n)]);
    if (status) b.classList.add(status);
    if (blocked) {
      b.disabled = true;
      b.title = status ? `Número ${status}` : `Su pareja ${pairOf(n)} no está disponible`;
    }
    if (state.selected.includes(n)) b.classList.add('selected');
    if (selectedPartners.includes(n)) {
      b.classList.add('partner');
      b.disabled = true;
      b.title = 'Es la pareja de un número que ya elegiste';
    }
    b.onclick = () => toggle(n);
    grid.append(b);
  }
}

function toggle(n) {
  if (state.selected.includes(n)) {
    state.selected = state.selected.filter((x) => x !== n);
  } else if (!partners().includes(n)) {
    state.selected = [...state.selected, n].slice(-selectionLimit());
  }
  renderGrid();
  renderSelection();
}

function renderTexts() {
  $('mode-question').textContent = `¿Cómo quieres elegir tus ${2 * state.quantity} números?`;
  $('mode-help').textContent = modeHelp(state.mode, state.quantity);
}

function setQuantity(q) {
  state.quantity = q;
  state.selected = state.selected.slice(0, selectionLimit());
  for (const b of $('qty-tabs').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.qty) === q));
  }
  renderTexts();
  renderGrid();
  renderSelection();
}

function setMode(mode) {
  state.mode = mode;
  state.selected = [];
  for (const b of $('mode-tabs').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  }
  renderTexts();
  $('picker').classList.toggle('hidden', mode === 'azar');
  renderGrid();
  renderSelection();
}

function renderInfo(info) {
  document.title = info.name;
  $('raffle-name').textContent = info.name;
  $('prize').textContent = cop.format(info.prize);
  $('price').textContent = cop.format(info.ticketPrice);
  $('lottery').textContent = info.lottery;
  $('draw-date').textContent = formatDate(info.drawDate);
}

function renderProgress() {
  const values = Object.values(state.taken);
  const sold = values.filter((s) => s === 'vendido').length;
  const reserved = values.length - sold;
  const free = state.info.totalNumbers - values.length;
  $('progress-text').textContent = `${free} números disponibles · ${sold} vendidos · ${reserved} reservados`;
  $('progress-bar').style.width = `${(values.length / state.info.totalNumbers) * 100}%`;
}

function renderWinner(winner) {
  if (!winner) return;
  $('winner-card').classList.remove('hidden');
  $('buy-card').classList.add('hidden');
  $('w-date').textContent = formatDate(winner.drawDate);
  $('w-lottery').textContent = winner.lotteryNumber;
  $('w-number').textContent = winner.number;
  $('w-text').textContent = winner.name
    ? `¡Felicitaciones a ${winner.name} (${winner.phone})! Ganó ${cop.format(state.info.prize)}.`
    : 'Este número no fue vendido. El premio queda desierto.';
}

async function load() {
  const res = await fetch('/api/estado', { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errorMessage(res, data));
  state.info = data.info;
  state.taken = data.taken;
  // Drop any selection that someone else took meanwhile.
  state.selected = state.selected.filter((n) => !state.taken[n] && !(state.mode === 'pareja' && state.taken[pairOf(n)]));
  renderInfo(data.info);
  renderProgress();
  renderGrid();
  renderSelection();
  renderWinner(data.winner);
}

function showDone(order) {
  const info = order.info;
  const count = order.tickets.length;
  $('buy-card').classList.add('hidden');
  $('done-card').classList.remove('hidden');
  $('d-title').textContent = `✅ ¡${plural(count, 'Boleto reservado', 'Boletos reservados')}!`;
  const list = $('d-tickets');
  list.replaceChildren();
  for (const t of order.tickets) {
    const row = document.createElement('div');
    row.className = 'ticket-row';
    const label = document.createElement('span');
    label.append('Código del boleto: ');
    const id = document.createElement('b');
    id.textContent = t.id;
    label.append(id);
    const chips = document.createElement('div');
    chips.className = 'chips';
    renderChips(chips, t.numbers);
    row.append(label, chips);
    list.append(row);
  }
  $('d-hours').textContent = info.reservationHours;
  $('d-price').textContent = cop.format(count * info.ticketPrice);
  $('d-payment').textContent = info.paymentInstructions;
  const detail = order.tickets.map((t) => `${t.id} (${t.numbers.join(' y ')})`).join(', ');
  const msg = `Hola, pagué ${plural(count, 'el boleto', 'los boletos')} ${detail} de la rifa. Adjunto el comprobante.`;
  $('d-whatsapp').href = `https://wa.me/${info.whatsappNumber}?text=${encodeURIComponent(msg)}`;
  $('done-card').scrollIntoView({ behavior: 'smooth' });
}

$('qty-tabs').addEventListener('click', (e) => {
  const qty = Number(e.target.closest('button')?.dataset.qty);
  if (qty) setQuantity(qty);
});

$('mode-tabs').addEventListener('click', (e) => {
  const mode = e.target.closest('button')?.dataset.mode;
  if (mode) setMode(mode);
});

$('buy-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('buy-error').textContent = '';
  const btn = $('buy-btn');
  btn.disabled = true;
  btn.textContent = 'Reservando…';
  try {
    const code = $('code').value.trim();
    if (!/^\d{6}$/.test(code)) {
      throw new Error('Ingresa el código de verificación de 6 dígitos.');
    }
    const numbers = state.mode === 'azar' ? [] : state.selected;
    const res = await fetch('/api/boletos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: state.mode,
        numbers,
        quantity: state.quantity,
        name: $('name').value,
        phone: $('phone').value,
        code,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(errorMessage(res, data));
    showDone(data);
    state.selected = [];
    $('code').value = sharedCode;
    load().catch(() => { });
  } catch (err) {
    $('buy-error').textContent = err.message || 'No se pudo reservar. Intenta de nuevo.';
    load().catch(() => { });
  } finally {
    btn.textContent = buyLabel();
    btn.disabled = !canBuy();
  }
});

$('d-again').addEventListener('click', () => {
  $('done-card').classList.add('hidden');
  $('buy-card').classList.remove('hidden');
  $('code').value = sharedCode;
  setMode(state.mode);
});

// A shared link like /?code=123456 pre-fills the purchase code (kept for later purchases in this visit),
// then the param is dropped from the address bar so it isn't re-shared by accident.
const sharedCode = (() => {
  const code = (new URLSearchParams(location.search).get('code') ?? '').trim();
  if (!/^\d{6}$/.test(code)) return '';
  const url = new URL(location.href);
  url.searchParams.delete('code');
  history.replaceState(null, '', url);
  return code;
})();
$('code').value = sharedCode;

renderHundreds();
setMode('libre');
load().catch((err) => { $('progress-text').textContent = `Error cargando la rifa: ${err.message}`; });
setInterval(() => load().catch(() => { }), 30000);
