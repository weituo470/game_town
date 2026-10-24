import { appUrl } from './appUrl.js';
/** Memory URLs are accepted only for same-origin browser-created media. */
export function droneAudioUrl(url, origin = globalThis.location?.origin) {
  if (typeof url === 'string' && url.startsWith('blob:')) {
    if (!origin || new URL(url).origin !== origin) throw new TypeError('外部音轨地址无效。');
    return url;
  }
  return appUrl(url);
}
