import { Buffer } from 'buffer';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { writeFileSync, unlinkSync } from 'fs';

// function dataUrl (contentType, source) {
//   return `data:${contentType};base64,${Buffer.from(source).toString('base64')}`;
// }

export function denoExec (map, source) {
  const tmpDir = tmpdir();
  const tmpMap = resolve(tmpDir, 'map.json');
  const tmpSrc = resolve(tmpDir, 'app.js');
  writeFileSync(tmpMap, JSON.stringify(map));
  writeFileSync(tmpSrc, source);
  try {
    execSync(`deno run --unstable --no-check --allow-all --import-map=${tmpMap} ${tmpSrc}`);
  }
  finally {
    // unlinkSync(tmpMap);
    // unlinkSync(tmpSrc);
  }
}
