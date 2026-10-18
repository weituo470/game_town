import { isIP } from 'node:net';

const isLoopback = address => address === '::1' || address === '0:0:0:0:0:0:0:1'
  || (isIP(address) === 4 && address.startsWith('127.'))
  || (/^::ffff:127\./i.test(address) && isIP(address) === 6);

// Enable only behind the local reverse proxy. Nginx must overwrite X-Real-IP
// with $remote_addr; client-supplied forwarding chains are never accepted.
export function getRequestClientIp(req, { trustProxyLoopback = false } = {}) {
  const peer = req.socket?.remoteAddress || 'local';
  const forwarded = req.headers?.['x-real-ip'];
  if (trustProxyLoopback === true && isLoopback(peer) && typeof forwarded === 'string' && isIP(forwarded.trim())) {
    return forwarded.trim();
  }
  return peer;
}
