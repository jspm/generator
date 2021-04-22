// @ts-ignore
import process from 'process';

export const isWindows = process.platform === 'win32';

export const PATH = isWindows ? Object.keys(process.env).find(e => Boolean(e.match(/^PATH$/i))) || 'Path' : 'PATH';

export const PATHS_SEP = process.platform === 'win32' ? ';' : ':';

