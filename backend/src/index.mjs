import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { createToken, passwordMatches, verifyToken } from './auth.mjs';
import { HttpError } from './raffle.mjs';
import {
  cancelTicket,
  clearWinner,
  confirmOrder,
  confirmTicket,
  createTicket,
  declareWinner,
  getPublicState,
  listTickets,
  regenerateVerificationCode,
} from './service.mjs';

const ssm = new SSMClient({});
const SESSION_MS = 12 * 3600 * 1000;
let secrets;

// Admin password and token-signing secret live in SSM Parameter Store, cached per container.
async function loadSecrets() {
  if (!secrets) {
    const get = async (Name) =>
      (await ssm.send(new GetParameterCommand({ Name, WithDecryption: true }))).Parameter.Value;
    const [password, tokenSecret] = await Promise.all([
      get(process.env.ADMIN_PASSWORD_PARAM),
      get(process.env.TOKEN_SECRET_PARAM),
    ]);
    secrets = { password, tokenSecret };
  }
  return secrets;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'JSON inválido.');
  }
}

async function requireAdmin(event) {
  const { tokenSecret } = await loadSecrets();
  const token = (event.headers?.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!verifyToken(token, tokenSecret)) throw new HttpError(401, 'Sesión inválida o vencida.');
}

async function route(event) {
  const method = event.requestContext.http.method;
  const path = event.rawPath.replace(/\/+$/, '');

  if (method === 'GET' && path === '/api/estado') return getPublicState();
  if (method === 'POST' && path === '/api/boletos') return createTicket(parseBody(event));

  if (method === 'POST' && path === '/api/admin/login') {
    const { password, tokenSecret } = await loadSecrets();
    if (!passwordMatches(parseBody(event).password, password)) {
      throw new HttpError(401, 'Contraseña incorrecta.');
    }
    return { token: createToken(tokenSecret, SESSION_MS) };
  }

  if (path.startsWith('/api/admin/')) {
    await requireAdmin(event);
    if (method === 'GET' && path === '/api/admin/boletos') return listTickets();
    const action = path.match(/^\/api\/admin\/boletos\/([A-Z0-9]+)\/(confirmar|cancelar)$/);
    if (method === 'POST' && action) {
      return action[2] === 'confirmar' ? confirmTicket(action[1]) : cancelTicket(action[1]);
    }
    const order = path.match(/^\/api\/admin\/pedidos\/([A-Z0-9]+)\/confirmar$/);
    if (method === 'POST' && order) return confirmOrder(order[1]);
    if (method === 'POST' && path === '/api/admin/ganador') return declareWinner(parseBody(event));
    if (method === 'DELETE' && path === '/api/admin/ganador') return clearWinner();
    if (method === 'POST' && path === '/api/admin/codigo/regenerar') return regenerateVerificationCode();
  }

  throw new HttpError(404, 'Ruta no encontrada.');
}

// CloudFront adds this header, so the API only answers requests that come through the site.
function fromCloudFront(event) {
  const expected = process.env.ORIGIN_VERIFY_SECRET;
  return !expected || event.headers?.['x-origin-verify'] === expected;
}

export async function handler(event) {
  if (!fromCloudFront(event)) return json(403, { error: 'Acceso no permitido.' });
  try {
    return json(200, await route(event));
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.message });
    console.error(err);
    return json(500, { error: 'Error interno. Intenta de nuevo.' });
  }
}
