/** Only content-addressed build assets may outlive a deployment. */
export function staticCacheControl(path) {
  const normalized = String(path).replaceAll('\\', '/');
  if (/\.(?:html|json)$/i.test(normalized)) return 'no-store';
  if (/\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?)$/.test(normalized)) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=3600';
}
