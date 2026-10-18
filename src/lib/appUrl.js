// Keep same-origin application requests beneath the Vite deployment base.
// In Node (including the server's shared GLB validator), import.meta.env is absent.
export function appUrl(path, base = import.meta.env?.BASE_URL || '/') {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u001f]/.test(path)) {
    throw new TypeError('Application URLs must be same-origin absolute paths.');
  }
  let decodedPath;
  try { decodedPath = decodeURIComponent(path.split(/[?#]/, 1)[0]); } catch { throw new TypeError('Invalid application URL.'); }
  if (/[\\\u0000-\u001f]/.test(decodedPath) || decodedPath.startsWith('//') || decodedPath.split('/').some(part => part === '.' || part === '..')) {
    throw new TypeError('Application URLs cannot escape their base directory.');
  }
  if (base === './' || base === '') base = '/';
  if (typeof base !== 'string' || !/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)) {
    throw new TypeError('Application base must be a local directory path.');
  }
  return `${base.slice(0, -1)}${path}`;
}
