import { createHash as _createHash } from "crypto";

let createHash = _createHash;

export function setCreateHash(_createHash) {
  createHash = _createHash;
}

export function getIntegrity(buf: Uint8Array | string): `sha384-${string}` {
  const hash = createHash("sha384");
  hash.update(buf);
  return `sha384-${hash.digest("base64")}`;
}
