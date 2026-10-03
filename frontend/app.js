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

const MODE_HELP = {
  libre: 'Toca 2 números disponibles en la tabla.',
  pareja: `Toca 1 número y te damos también su pareja (+${PAIR_OFFSET}). Ej: 123 va con 623.`,
  azar: 'Te asignamos 2 números disponibles al azar cuando reserves.',
};

const state = { info: null, taken: {}, mode: 'libre', hundred: 0, selected: [] };

function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function renderChips(container, numbers, slots = 2) {
  container.replaceChildren();
  for (let i = 0; i < slots; i++) {
    const chip = document.createElement('span');
    chip.className = numbers[i] ? 'chip' : 'chip empty';
    chip.textContent = numbers[i] ?? (state.mode === 'azar' ? '?' : '___');
    container.append(chip);
  }
}

function canBuy() {
  return state.mode === 'azar' || state.selected.length === 2;
}

function renderSelection() {
  renderChips($('chips'), state.selected);
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
    if (state.mode === 'pareja' && state.selected[1] === n) b.classList.add('partner');
    b.onclick = () => toggle(n);
    grid.append(b);
  }
}

function toggle(n) {
  if (state.mode === 'pareja') {
    state.selected = state.selected[0] === n ? [] : [n, pairOf(n)];
  } else if (state.selected.includes(n)) {
    state.selected = state.selected.filter((x) => x !== n);
  } else {
    state.selected = [...state.selected, n].slice(-2);
  }
  renderGrid();
  renderSelection();
}

function setMode(mode) {
  state.mode = mode;
  state.selected = [];
  for (const b of $('mode-tabs').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  }
  $('mode-help').textContent = MODE_HELP[mode];
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
  state.selected = state.selected.filter((n) => !state.taken[n]);
  if (state.mode === 'pareja' && state.selected.length < 2) state.selected = [];
  renderInfo(data.info);
  renderProgress();
  renderGrid();
  renderSelection();
  renderWinner(data.winner);
}

function showDone(ticket) {
  const info = ticket.info;
  $('buy-card').classList.add('hidden');
  $('done-card').classList.remove('hidden');
  $('d-id').textContent = ticket.id;
  renderChips($('d-chips'), ticket.numbers);
  $('d-hours').textContent = info.reservationHours;
  $('d-price').textContent = cop.format(info.ticketPrice);
  $('d-payment').textContent = info.paymentInstructions;
  const msg = `Hola, pagué el boleto ${ticket.id} de la rifa con los números ${ticket.numbers.join(' y ')}. Adjunto el comprobante.`;
  $('d-whatsapp').href = `https://wa.me/${info.whatsappNumber}?text=${encodeURIComponent(msg)}`;
  $('done-card').scrollIntoView({ behavior: 'smooth' });
}

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
    const numbers = state.mode === 'libre' ? state.selected : state.mode === 'pareja' ? state.selected.slice(0, 1) : [];
    const res = await fetch('/api/boletos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: state.mode,
        numbers,
        name: $('name').value,
        phone: $('phone').value,
        code,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(errorMessage(res, data));
    showDone(data);
    state.selected = [];
    $('code').value = '';
    load().catch(() => { });
  } catch (err) {
    $('buy-error').textContent = err.message || 'No se pudo reservar. Intenta de nuevo.';
    load().catch(() => { });
  } finally {
    btn.textContent = 'Reservar boleto';
    btn.disabled = !canBuy();
  }
});

$('d-again').addEventListener('click', () => {
  $('done-card').classList.add('hidden');
  $('buy-card').classList.remove('hidden');
  $('code').value = '';
  setMode(state.mode);
});

renderHundreds();
setMode('libre');
load().catch((err) => { $('progress-text').textContent = `Error cargando la rifa: ${err.message}`; });
setInterval(() => load().catch(() => { }), 30000);
