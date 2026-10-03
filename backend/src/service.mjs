import { randomInt } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  HttpError,
  TOTAL_NUMBERS,
  isNumberTaken,
  isVerificationCodeValid,
  lastThreeDigits,
  maskPhone,
  normalizeName,
  normalizePhone,
  normalizeVerificationCode,
  publicName,
  resolveSelection,
  ticketStatus,
} from './raffle.mjs';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const NUMBERS_TABLE = process.env.NUMBERS_TABLE;
const TICKETS_TABLE = process.env.TICKETS_TABLE;
const SETTINGS_TABLE = process.env.SETTINGS_TABLE;
const WINNER_KEY = { id: 'ganador' };
const VERIFICATION_CODE_KEY = { id: 'codigo_verificacion' };
const RESERVATION_MS = Number(process.env.RESERVATION_HOURS || 24) * 3600 * 1000;
const CODE_ROTATION_MS = Number(process.env.CODE_ROTATION_HOURS || 1) * 3600 * 1000;
const CODE_GRACE_MS = 10 * 60 * 1000;

export const raffleInfo = {
  name: process.env.RAFFLE_NAME,
  ticketPrice: Number(process.env.TICKET_PRICE),
  prize: Number(process.env.PRIZE),
  drawDate: process.env.DRAW_DATE,
  lottery: 'Lotería de Boyacá',
  paymentInstructions: process.env.PAYMENT_INSTRUCTIONS,
  whatsappNumber: process.env.WHATSAPP_NUMBER,
  reservationHours: Number(process.env.RESERVATION_HOURS || 24),
  totalNumbers: TOTAL_NUMBERS,
};

async function scanAll(table) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const page = await db.send(new ScanCommand({ TableName: table, ExclusiveStartKey }));
    items.push(...page.Items);
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function getWinner() {
  const { Item } = await db.send(new GetCommand({ TableName: SETTINGS_TABLE, Key: WINNER_KEY }));
  return Item ?? null;
}

function generateRandomCode() {
  return String(randomInt(100000, 1000000));
}

async function readVerificationRecord() {
  const { Item } = await db.send(new GetCommand({ TableName: SETTINGS_TABLE, Key: VERIFICATION_CODE_KEY }));
  return Item ?? null;
}

// Replaces `current` with a fresh code. The write is conditional on the record being unchanged,
// so concurrent rotations can't clobber each other. Returns null if someone else rotated first.
// `keepPrevious` (manual regeneration) keeps the old code valid for a short grace window, never
// beyond its own expiry; on natural expiry the old code is simply dead.
async function rotateVerificationCode(current, now, keepPrevious) {
  const previousUsable = keepPrevious && current?.code && current.expiresAt > now;
  const item = {
    ...VERIFICATION_CODE_KEY,
    code: generateRandomCode(),
    createdAt: now,
    expiresAt: now + CODE_ROTATION_MS,
    previousCode: previousUsable ? current.code : null,
    previousExpiresAt: previousUsable ? Math.min(now + CODE_GRACE_MS, current.expiresAt) : null,
  };
  try {
    await db.send(
      new PutCommand({
        TableName: SETTINGS_TABLE,
        Item: item,
        ...(current
          ? {
              ConditionExpression: 'code = :code AND createdAt = :createdAt',
              ExpressionAttributeValues: { ':code': current.code, ':createdAt': current.createdAt },
            }
          : { ConditionExpression: 'attribute_not_exists(id)' }),
      }),
    );
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return null;
    throw err;
  }
  return item;
}

async function getVerificationRecord(now) {
  for (let i = 0; i < 3; i++) {
    const current = await readVerificationRecord();
    if (current?.code && current.expiresAt > now) return current;
    const rotated = await rotateVerificationCode(current, now, false);
    if (rotated) return rotated;
  }
  throw new HttpError(503, 'No se pudo generar el código de verificación. Intenta de nuevo.');
}

const publicCode = ({ code, expiresAt }) => ({ code, expiresAt });

export async function getActiveVerificationCode(now = Date.now()) {
  return publicCode(await getVerificationRecord(now));
}

export async function regenerateVerificationCode(now = Date.now()) {
  for (let i = 0; i < 3; i++) {
    const rotated = await rotateVerificationCode(await readVerificationRecord(), now, true);
    if (rotated) return publicCode(rotated);
  }
  throw new HttpError(503, 'No se pudo generar el código de verificación. Intenta de nuevo.');
}

export async function verifyPurchaseCode(inputCode, now = Date.now()) {
  const normalized = normalizeVerificationCode(inputCode);
  if (!normalized) {
    throw new HttpError(400, 'Ingresa el código de verificación de 6 dígitos.');
  }
  const record = await getVerificationRecord(now);
  if (!isVerificationCodeValid(normalized, record, now)) {
    throw new HttpError(400, 'Código de verificación incorrecto o vencido. Solicita el código actual al organizador.');
  }
  return true;
}

// Map of number -> 'vendido' | 'reservado' for every number that is currently blocked.
async function takenNumbers(now) {
  const taken = {};
  for (const item of await scanAll(NUMBERS_TABLE)) {
    if (isNumberTaken(item, now)) taken[item.num] = item.status === 'pagado' ? 'vendido' : 'reservado';
  }
  return taken;
}

function publicWinner(winner) {
  if (!winner) return null;
  return {
    lotteryNumber: winner.lotteryNumber,
    drawDate: winner.drawDate,
    number: winner.number,
    name: winner.ticket ? publicName(winner.ticket.name) : null,
    phone: winner.ticket ? maskPhone(winner.ticket.phone) : null,
  };
}

export async function getPublicState(now = Date.now()) {
  const [taken, winner] = await Promise.all([takenNumbers(now), getWinner()]);
  return { info: raffleInfo, taken, winner: publicWinner(winner) };
}

function newTicketId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

function reserveTransaction(ticket) {
  return new TransactWriteCommand({
    TransactItems: [
      ...ticket.numbers.map((num) => ({
        Put: {
          TableName: NUMBERS_TABLE,
          Item: { num, ticketId: ticket.id, status: 'reservado', expiresAt: ticket.expiresAt },
          // Free if never used, or if the previous reservation expired without payment.
          ConditionExpression: 'attribute_not_exists(num) OR (#s = :reservado AND expiresAt <= :now)',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':reservado': 'reservado', ':now': ticket.createdAt },
        },
      })),
      {
        Put: {
          TableName: TICKETS_TABLE,
          Item: ticket,
          ConditionExpression: 'attribute_not_exists(id)',
        },
      },
    ],
  });
}

export async function createTicket(body, now = Date.now()) {
  const name = normalizeName(body.name);
  const phone = normalizePhone(body.phone);
  if (!name) throw new HttpError(400, 'Escribe tu nombre completo.');
  if (!phone) throw new HttpError(400, 'Escribe un celular colombiano válido (10 dígitos, empieza por 3).');
  if (await getWinner()) throw new HttpError(409, 'La rifa ya se jugó. No se venden más boletos.');
  await verifyPurchaseCode(body.code, now);

  // Random mode retries a few times in case someone grabs the same number concurrently.
  const attempts = body.mode === 'azar' ? 3 : 1;
  for (let attempt = 1; ; attempt++) {
    const taken = new Set(Object.keys(await takenNumbers(now)));
    const numbers = resolveSelection(body.mode, body.numbers, taken);
    const ticket = {
      id: newTicketId(),
      name,
      phone,
      numbers,
      mode: body.mode,
      status: 'pendiente',
      verificationCode: normalizeVerificationCode(body.code),
      createdAt: now,
      expiresAt: now + RESERVATION_MS,
    };
    try {
      await db.send(reserveTransaction(ticket));
      return { id: ticket.id, numbers, expiresAt: ticket.expiresAt, info: raffleInfo };
    } catch (err) {
      if (err.name !== 'TransactionCanceledException') throw err;
      if (attempt >= attempts) {
        throw new HttpError(409, 'Alguien acaba de tomar uno de esos números. Intenta con otros.');
      }
    }
  }
}

export async function listTickets(now = Date.now()) {
  const [tickets, winner, verificationCode] = await Promise.all([
    scanAll(TICKETS_TABLE),
    getWinner(),
    getActiveVerificationCode(now),
  ]);
  const rows = tickets
    .map((t) => ({ ...t, status: ticketStatus(t, now) }))
    .sort((a, b) => b.createdAt - a.createdAt);
  const count = (s) => rows.filter((t) => t.status === s).length;
  const paid = count('pagado');
  return {
    info: raffleInfo,
    winner,
    verificationCode,
    tickets: rows,
    stats: {
      pagados: paid,
      pendientes: count('pendiente'),
      vencidos: count('vencido'),
      cancelados: count('cancelado'),
      recaudado: paid * raffleInfo.ticketPrice,
      numerosVendidos: paid * 2,
    },
  };
}

async function getTicket(id) {
  const { Item } = await db.send(new GetCommand({ TableName: TICKETS_TABLE, Key: { id } }));
  if (!Item) throw new HttpError(404, 'Boleto no encontrado.');
  return Item;
}

export async function confirmTicket(id, now = Date.now()) {
  const ticket = await getTicket(id);
  if (ticket.status !== 'pendiente') throw new HttpError(409, `El boleto está ${ticket.status}.`);
  try {
    await db.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: TICKETS_TABLE,
              Key: { id },
              UpdateExpression: 'SET #s = :pagado, paidAt = :now',
              ConditionExpression: '#s = :pendiente',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: { ':pagado': 'pagado', ':pendiente': 'pendiente', ':now': now },
            },
          },
          // Still works after the reservation expired, as long as nobody else took the numbers.
          ...ticket.numbers.map((num) => ({
            Update: {
              TableName: NUMBERS_TABLE,
              Key: { num },
              UpdateExpression: 'SET #s = :pagado REMOVE expiresAt',
              ConditionExpression: 'ticketId = :id',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: { ':pagado': 'pagado', ':id': id },
            },
          })),
        ],
      }),
    );
  } catch (err) {
    if (err.name !== 'TransactionCanceledException') throw err;
    throw new HttpError(409, 'La reserva venció y otra persona tomó estos números. Cancela este boleto.');
  }
  return { ok: true };
}

export async function cancelTicket(id, now = Date.now()) {
  const ticket = await getTicket(id);
  if (ticket.status === 'cancelado') throw new HttpError(409, 'El boleto ya está cancelado.');
  await db.send(
    new UpdateCommand({
      TableName: TICKETS_TABLE,
      Key: { id },
      UpdateExpression: 'SET #s = :cancelado, cancelledAt = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':cancelado': 'cancelado', ':now': now },
    }),
  );
  // Release only numbers that still belong to this ticket.
  for (const num of ticket.numbers) {
    try {
      await db.send(
        new DeleteCommand({
          TableName: NUMBERS_TABLE,
          Key: { num },
          ConditionExpression: 'ticketId = :id',
          ExpressionAttributeValues: { ':id': id },
        }),
      );
    } catch (err) {
      if (err.name !== 'ConditionalCheckFailedException') throw err;
    }
  }
  return { ok: true };
}

export async function declareWinner(body, now = Date.now()) {
  const number = lastThreeDigits(body.lotteryNumber);
  if (!number) throw new HttpError(400, 'Escribe el número ganador de la Lotería de Boyacá (solo dígitos).');
  const drawDate = String(body.drawDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(drawDate)) throw new HttpError(400, 'Fecha del sorteo inválida.');

  const { Item: numItem } = await db.send(new GetCommand({ TableName: NUMBERS_TABLE, Key: { num: number } }));
  let ticket = null;
  if (numItem?.status === 'pagado') {
    const t = await getTicket(numItem.ticketId);
    ticket = { id: t.id, name: t.name, phone: t.phone, numbers: t.numbers };
  }
  const winner = {
    ...WINNER_KEY,
    lotteryNumber: String(body.lotteryNumber).trim(),
    drawDate,
    number,
    ticket,
    declaredAt: now,
  };
  await db.send(new PutCommand({ TableName: SETTINGS_TABLE, Item: winner }));
  return winner;
}

export async function clearWinner() {
  await db.send(new DeleteCommand({ TableName: SETTINGS_TABLE, Key: WINNER_KEY }));
  return { ok: true };
}
