// Pure raffle rules: no AWS calls here, so everything is unit-testable.
import { randomInt } from 'node:crypto';

export const TOTAL_NUMBERS = 1000;
export const NUMBERS_PER_TICKET = 2;
// In "pareja" mode the second number is always the first one + 500 (e.g. 123 -> 623).
export const PAIR_OFFSET = 500;
export const MODES = ['libre', 'pareja', 'azar'];

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function formatNumber(n) {
  return String(n).padStart(3, '0');
}

export function parseNumber(value) {
  const s = String(value ?? '').trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  return formatNumber(Number(s));
}

export function pairOf(num) {
  return formatNumber((Number(num) + PAIR_OFFSET) % TOTAL_NUMBERS);
}

// Colombian mobile numbers: 10 digits starting with 3, optional +57 prefix.
export function normalizePhone(value) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('57')) digits = digits.slice(2);
  return /^3\d{9}$/.test(digits) ? digits : null;
}

export function normalizeName(value) {
  const s = String(value ?? '').trim().replace(/\s+/g, ' ');
  return s.length >= 3 && s.length <= 80 ? s : null;
}

// A number item blocks the number while it is paid, or reserved and not yet expired.
export function isNumberTaken(item, now) {
  if (!item) return false;
  if (item.status === 'pagado') return true;
  return item.status === 'reservado' && item.expiresAt > now;
}

export function ticketStatus(ticket, now) {
  if (ticket.status === 'pendiente' && ticket.expiresAt <= now) return 'vencido';
  return ticket.status;
}

export function freeNumbers(takenSet) {
  const free = [];
  for (let i = 0; i < TOTAL_NUMBERS; i++) {
    const n = formatNumber(i);
    if (!takenSet.has(n)) free.push(n);
  }
  return free;
}

export function pickRandom(list, count, rand = randomInt) {
  const copy = [...list];
  const picked = [];
  for (let i = 0; i < count && copy.length > 0; i++) {
    const j = rand(copy.length);
    picked.push(copy[j]);
    copy[j] = copy[copy.length - 1];
    copy.pop();
  }
  return picked;
}

// Turns the buyer's request into the two numbers to reserve, or throws HttpError.
export function resolveSelection(mode, requested, takenSet, rand = randomInt) {
  if (!MODES.includes(mode)) throw new HttpError(400, 'Modo de selección inválido.');
  const input = Array.isArray(requested) ? requested : [];
  let numbers;

  if (mode === 'libre') {
    numbers = input.map(parseNumber);
    if (numbers.length !== NUMBERS_PER_TICKET || numbers.includes(null)) {
      throw new HttpError(400, 'Debes elegir exactamente 2 números entre 000 y 999.');
    }
    if (numbers[0] === numbers[1]) throw new HttpError(400, 'Los 2 números deben ser diferentes.');
  } else if (mode === 'pareja') {
    const first = parseNumber(input[0]);
    if (input.length !== 1 || first === null) {
      throw new HttpError(400, 'Debes elegir 1 número entre 000 y 999.');
    }
    numbers = [first, pairOf(first)];
  } else {
    const free = freeNumbers(takenSet);
    if (free.length < NUMBERS_PER_TICKET) throw new HttpError(409, 'No quedan números disponibles.');
    numbers = pickRandom(free, NUMBERS_PER_TICKET, rand);
  }

  const taken = numbers.filter((n) => takenSet.has(n));
  if (taken.length > 0) {
    throw new HttpError(409, `Ya no está disponible: ${taken.join(', ')}. Elige otro.`);
  }
  return numbers.sort();
}

// The winner is the last 3 digits of the Lotería de Boyacá main prize number.
export function lastThreeDigits(lotteryNumber) {
  const digits = String(lotteryNumber ?? '').trim();
  if (!/^\d{3,6}$/.test(digits)) return null;
  return digits.slice(-3);
}

export function publicName(name) {
  const [first, second] = String(name).split(' ');
  return second ? `${first} ${second[0]}.` : first;
}

export function maskPhone(phone) {
  return `${phone.slice(0, 3)}****${phone.slice(-3)}`;
}
