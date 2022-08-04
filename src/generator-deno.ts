import babel from '@babel/core';
import babelPresetTs from '@babel/preset-typescript';
import babelPluginSyntaxImportAssertions from '@babel/plugin-syntax-import-assertions';
import { createHash } from 'crypto';
import { realpath } from 'fs';
import { pathToFileURL } from 'url';

import { setBabel as setBabelCjs } from './trace/cjs';
import { setBabel as setBabelTs } from './trace/ts';
import { setPathFns } from './trace/resolver';
import { setCreateHash } from './common/integrity';

setBabelCjs(babel);
setBabelTs(babel, babelPresetTs, babelPluginSyntaxImportAssertions);
setCreateHash(createHash);
setPathFns(realpath, pathToFileURL);

export * from './generator';
