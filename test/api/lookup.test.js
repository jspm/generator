import { Generator } from '@jspm/generator';
import assert from 'assert';

const generator = new Generator();

const lookup = await generator.lookup('es-module-lexer@0.4');
assert.deepStrictEqual(lookup.subpath, '.');
assert.deepStrictEqual(lookup.registry, 'npm');
assert.deepStrictEqual(lookup.name, 'es-module-lexer');
assert.deepStrictEqual(lookup.version, '0.4.1');
