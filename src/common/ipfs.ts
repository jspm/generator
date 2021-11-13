import { create } from 'ipfs-client';
import { Buffer } from 'buffer';

let client, clientAPI;

function initClient (api = '/ip4/127.0.0.1/tcp/45005/http') {
  if (client && clientAPI === api)
    return;
  client = create({
    http: api
  });
  clientAPI = api;
}

export async function get (id, api) {
  initClient(api);

  const chunks = [];

  try {
    for await (const chunk of client.cat(id)) {
      chunks.push(chunk);
    }
  }
  catch (e) {
    if (e.message.includes('node is a directory'))
      return null;
    if (e.message.includes('no link named'))
      return undefined;
    throw e;
  }
  return Buffer.concat(chunks);
}

export async function ls (cid, api) {
  initClient(api);

  const result = await client.ls(cid);

  const files = [];
  for await (const item of result) {
    files.push(item);
  }
  return files;
}

export async function add (content, api) {
  initClient(api);
  
  const result = await client.add(content, { cidVersion: 1 });
  return result.cid.toString();
}

export async function addAll (files, api) {
  initClient(api);
  
  const result = await client.addAll(files, { wrapWithDirectory: true, cidVersion: 1 });
  let lastCid;
  for await (const item of result) {
    lastCid = item.cid;
  }
  return lastCid.toString();
}

// console.log(await add('hello world'));
// console.log(await addAll([{ path: 'x.js', content: 'hello world' }, { path: 'y.js', content: 'hello world 3' }]));
// console.log(await get('bafybeie5a3olferoa6hm75awyyj5g2ig7bq2haj74btlftlfujudpt4x7i'));
// console.log(new TextDecoder().decode(await get('/ipfs/bafybeie5a3olferoa6hm75awyyj5g2ig7bq2haj74btlftlfujudpt4x7i/x.js')));
// console.log(await ls('bafybeie5a3olferoa6hm75awyyj5g2ig7bq2haj74btlftlfujudpt4x7i'));
