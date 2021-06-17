import { Buffer } from 'buffer';
import { execSync } from 'child_process';

function dataUrl (contentType, source) {
  return `data:${contentType};base64,${Buffer.from(source).toString('base64')}`;
}

export function denoExec (map, source) {
  console.log(map);
  execSync(`deno run --unstable --no-check --allow-all --import-map="${dataUrl('application/json+importmap', JSON.stringify(map))}" "${dataUrl('application/javascript', source)}"`);
}
