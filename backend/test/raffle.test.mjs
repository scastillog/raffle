import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HttpError,
  freeNumbers,
  isNumberTaken,
  lastThreeDigits,
  maskPhone,
  normalizeName,
  normalizePhone,
  pairOf,
  parseNumber,
  pickRandom,
  publicName,
  resolveSelection,
  ticketStatus,
} from '../src/raffle.mjs';
import { createToken, passwordMatches, verifyToken } from '../src/auth.mjs';

test('parseNumber pads and rejects out-of-range input', () => {
  assert.equal(parseNumber('7'), '007');
  assert.equal(parseNumber(42), '042');
  assert.equal(parseNumber('999'), '999');
  assert.equal(parseNumber('1000'), null);
  assert.equal(parseNumber('-1'), null);
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber(undefined), null);
});

test('pairOf adds 500 and wraps around', () => {
  assert.equal(pairOf('123'), '623');
  assert.equal(pairOf('623'), '123');
  assert.equal(pairOf('000'), '500');
  assert.equal(pairOf('999'), '499');
});

test('normalizePhone accepts Colombian mobiles only', () => {
  assert.equal(normalizePhone('300 123 4567'), '3001234567');
  assert.equal(normalizePhone('+57 310-555-1234'), '3105551234');
  assert.equal(normalizePhone('6011234567'), null);
  assert.equal(normalizePhone('30012345'), null);
});

test('normalizeName trims and collapses whitespace', () => {
  assert.equal(normalizeName('  Ana   María  '), 'Ana María');
  assert.equal(normalizeName('A'), null);
});

test('isNumberTaken honours expiry of reservations', () => {
  const now = 1000;
  assert.equal(isNumberTaken(undefined, now), false);
  assert.equal(isNumberTaken({ status: 'pagado' }, now), true);
  assert.equal(isNumberTaken({ status: 'reservado', expiresAt: 2000 }, now), true);
  assert.equal(isNumberTaken({ status: 'reservado', expiresAt: 1000 }, now), false);
});

test('ticketStatus marks expired pending tickets as vencido', () => {
  assert.equal(ticketStatus({ status: 'pendiente', expiresAt: 5 }, 10), 'vencido');
  assert.equal(ticketStatus({ status: 'pendiente', expiresAt: 50 }, 10), 'pendiente');
  assert.equal(ticketStatus({ status: 'pagado', expiresAt: 5 }, 10), 'pagado');
});

test('resolveSelection libre', () => {
  assert.deepEqual(resolveSelection('libre', ['850', '7'], new Set()), ['007', '850']);
  assert.throws(() => resolveSelection('libre', ['1'], new Set()), HttpError);
  assert.throws(() => resolveSelection('libre', ['1', '001'], new Set()), /diferentes/);
  assert.throws(() => resolveSelection('libre', ['1', '2'], new Set(['002'])), /002/);
});

test('resolveSelection pareja uses the +500 partner', () => {
  assert.deepEqual(resolveSelection('pareja', ['623'], new Set()), ['123', '623']);
  assert.throws(() => resolveSelection('pareja', ['123'], new Set(['623'])), /623/);
  assert.throws(() => resolveSelection('pareja', ['1', '2'], new Set()), HttpError);
});

test('resolveSelection azar only picks free numbers', () => {
  const taken = new Set(freeNumbers(new Set()).slice(0, 997)); // only 997, 998, 999 free
  for (let i = 0; i < 20; i++) {
    const picked = resolveSelection('azar', [], taken);
    assert.equal(picked.length, 2);
    assert.notEqual(picked[0], picked[1]);
    for (const n of picked) assert.ok(['997', '998', '999'].includes(n));
  }
  const full = new Set(freeNumbers(new Set()).slice(0, 999));
  assert.throws(() => resolveSelection('azar', [], full), /No quedan/);
});

test('resolveSelection rejects unknown modes', () => {
  assert.throws(() => resolveSelection('otro', [], new Set()), /Modo/);
});

test('pickRandom returns distinct elements', () => {
  const picked = pickRandom(['a', 'b', 'c'], 3);
  assert.deepEqual([...picked].sort(), ['a', 'b', 'c']);
});

test('lastThreeDigits takes the Boyacá result tail', () => {
  assert.equal(lastThreeDigits('4827'), '827');
  assert.equal(lastThreeDigits('0051'), '051');
  assert.equal(lastThreeDigits('12'), null);
  assert.equal(lastThreeDigits('12a4'), null);
});

test('public masking helpers', () => {
  assert.equal(publicName('Ana María Pérez'), 'Ana M.');
  assert.equal(publicName('Ana'), 'Ana');
  assert.equal(maskPhone('3001234567'), '300****567');
});

test('admin tokens sign, expire and reject tampering', () => {
  const token = createToken('secret', 1000, 0);
  assert.equal(verifyToken(token, 'secret', 500), true);
  assert.equal(verifyToken(token, 'secret', 1500), false);
  assert.equal(verifyToken(token, 'other', 500), false);
  assert.equal(verifyToken(`${token}x`, 'secret', 500), false);
  assert.equal(verifyToken('', 'secret', 500), false);
});

test('passwordMatches', () => {
  assert.equal(passwordMatches('abc', 'abc'), true);
  assert.equal(passwordMatches('abd', 'abc'), false);
  assert.equal(passwordMatches(undefined, 'abc'), false);
});
