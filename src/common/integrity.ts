// @ts-ignore
import { fetch } from '#fetch';

let createHash;
export function setCreateHash (_createHash) {
  createHash = _createHash;
}

export async function getIntegrity (url, fetchOpts) {
  if (!createHash)
    ({ createHash } = await import('crypto'));
  const res = await fetch(url, fetchOpts);
  const buf = await res.text();
  const hash = createHash('sha384');
  hash.update(buf);
  return 'sha384-' + hash.digest('base64');
}
