import { Generator } from '@jspm/generator';
import { addAll } from '../../lib/common/ipfs.js';
import assert from 'assert';

const cid = await addAll([
  {
    path: 'package.json',
    content: JSON.stringify({
      name: 'ipfs-package',
      exports: './main.js'
    })
  },
  {
    path: 'main.js',
    content: 'import "react";'
  }
], process.env.IPFS_API);

const generator = new Generator({
  mapUrl: import.meta.url,
  env: ['production', 'browser'],
  ipfsAPI: process.env.IPFS_API
});

await generator.install(`ipfs://${cid}/`);
const json = generator.getMap();

assert.ok(json.imports['ipfs-package'].startsWith('ipfs://'));
assert.ok(json.scopes['ipfs://bafybeiefyca537juczvl5vyjy3lqiv5nzox6ll23tiy3f4b53ciby3aub4/'].react);
