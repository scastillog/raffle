import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HttpError,
  freeNumbers,
  isNumberTaken,
  isVerificationCodeValid,
  lastThreeDigits,
  maskPhone,
  normalizeName,
  normalizePhone,
  normalizeQuantity,
  normalizeVerificationCode,
  pairOf,
  parseNumber,
  pickRandom,
  publicName,
  resolveSelection,
  resolveSelections,
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

test('normalizeVerificationCode requires exactly 6 decimal digits', () => {
  assert.equal(normalizeVerificationCode('123456'), '123456');
  assert.equal(normalizeVerificationCode('004819'), '004819');
  assert.equal(normalizeVerificationCode('  849201  '), '849201');
  assert.equal(normalizeVerificationCode('12345'), null);
  assert.equal(normalizeVerificationCode('1234567'), null);
  assert.equal(normalizeVerificationCode('12345a'), null);
  assert.equal(normalizeVerificationCode(''), null);
  assert.equal(normalizeVerificationCode(null), null);
  assert.equal(normalizeVerificationCode(undefined), null);
});

test('isVerificationCodeValid validates active and grace window codes', () => {
  const record = {
    code: '123456',
    expiresAt: 2000,
    previousCode: '654321',
    previousExpiresAt: 1500,
  };

  // Current code is valid before expiration
  assert.equal(isVerificationCodeValid('123456', record, 1000), true);
  assert.equal(isVerificationCodeValid('123456', record, 1999), true);
  // Current code is invalid at or after expiration
  assert.equal(isVerificationCodeValid('123456', record, 2000), false);
  assert.equal(isVerificationCodeValid('123456', record, 2500), false);

  // Previous code is valid during grace period
  assert.equal(isVerificationCodeValid('654321', record, 1000), true);
  assert.equal(isVerificationCodeValid('654321', record, 1499), true);
  // Previous code is invalid at or after grace period
  assert.equal(isVerificationCodeValid('654321', record, 1500), false);
  assert.equal(isVerificationCodeValid('654321', record, 1800), false);

  // Wrong codes and falsy inputs are rejected
  assert.equal(isVerificationCodeValid('000000', record, 1000), false);
  assert.equal(isVerificationCodeValid(null, record, 1000), false);
  assert.equal(isVerificationCodeValid('123456', null, 1000), false);
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

test('normalizeQuantity accepts 1 to 4 and defaults to 1', () => {
  assert.equal(normalizeQuantity(undefined), 1);
  assert.equal(normalizeQuantity(''), 1);
  assert.equal(normalizeQuantity(4), 4);
  assert.equal(normalizeQuantity('3'), 3);
  for (const bad of [0, 5, -1, 1.5, 'abc', NaN]) assert.equal(normalizeQuantity(bad), null);
});

test('resolveSelections libre builds one pair per ticket', () => {
  assert.deepEqual(resolveSelections('libre', ['850', '7', '1', '2'], 2, new Set()), [['007', '850'], ['001', '002']]);
  assert.throws(() => resolveSelections('libre', ['1', '2'], 2, new Set()), /4 números/);
  assert.throws(() => resolveSelections('libre', ['1', '2', '3', '1'], 2, new Set()), /diferentes/);
  assert.throws(() => resolveSelections('libre', ['1', '2', '3', '4'], 2, new Set(['004'])), /004/);
  assert.throws(() => resolveSelections('libre', ['1', '2'], 5, new Set()), /1 a 4/);
});

test('resolveSelections pareja pairs each pick with its +500 partner', () => {
  assert.deepEqual(resolveSelections('pareja', ['123', '001'], 2, new Set()), [['123', '623'], ['001', '501']]);
  assert.throws(() => resolveSelections('pareja', ['123', '623'], 2, new Set()), /pareja/);
  assert.throws(() => resolveSelections('pareja', ['123'], 2, new Set()), HttpError);
  assert.throws(() => resolveSelections('pareja', ['123', '001'], 2, new Set(['501'])), /501/);
});

test('resolveSelections azar gives distinct free pairs', () => {
  const taken = new Set(freeNumbers(new Set()).slice(0, 992)); // only 992..999 free
  const pairs = resolveSelections('azar', [], 4, taken);
  assert.equal(pairs.length, 4);
  const all = pairs.flat();
  assert.equal(new Set(all).size, 8);
  for (const n of all) assert.ok(Number(n) >= 992);
  const nearlyFull = new Set(freeNumbers(new Set()).slice(0, 993));
  assert.throws(() => resolveSelections('azar', [], 4, nearlyFull), /No quedan/);
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
