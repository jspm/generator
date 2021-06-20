import { Generator } from '@jspm/generator';
import assert from 'assert';

const generator = new Generator();

const { staticDeps } = await generator.install('react@16');
assert.strictEqual(staticDeps.length, 5);
