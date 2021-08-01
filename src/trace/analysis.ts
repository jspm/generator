export interface Analysis {
  deps: string[];
  dynamicDeps: string[];
  cjsLazyDeps: string[] | null;
  format: 'esm' | 'commonjs' | 'system' | 'json' | 'typescript';
  size: number;
}

export async function parseTs (source: string) {
  // @ts-ignore
  if (typeof Deno !== 'undefined')
    return '';
  const { default: ts } = await import(eval('"typescript"'));
  return ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.ESNext
    }
  }).outputText;
}

export function createEsmAnalysis (imports: any[], source: string, url: string): Analysis {
  if (!imports.length && registerRegEx.test(source))
    return createSystemAnalysis(source, imports, url);  
  const deps: string[] = [];
  const dynamicDeps: string[] = [];
  for (const impt of imports) {
    if (impt.d === -1) {
      deps.push(source.slice(impt.s, impt.e));
      continue;
    }
    // dynamic import -> deoptimize trace all dependencies (and all their exports)
    if (impt.d >= 0) {
      const dynExpression = source.slice(impt.s, impt.e);
      if (dynExpression.startsWith('"') || dynExpression.startsWith('\'')) {
        try {
          dynamicDeps.push(JSON.parse('"' + dynExpression.slice(1, -1) + '"'));
        }
        catch (e) {
          console.warn('TODO: Dynamic import custom expression tracing.');
        }
      }
    }
  }
  const size = source.length;
  return { deps, dynamicDeps, cjsLazyDeps: null, size, format: 'esm' };
}

const registerRegEx = /^\s*(\/\*[^\*]*(\*(?!\/)[^\*]*)*\*\/|\s*\/\/[^\n]*)*\s*System\s*\.\s*register\s*\(\s*(\[[^\]]*\])\s*,\s*\(?function\s*\(\s*([^\),\s]+\s*(,\s*([^\),\s]+)\s*)?\s*)?\)/;
export function createSystemAnalysis (source: string, imports: string[], url: string): Analysis {
  const [, , , rawDeps, , , contextId] = source.match(registerRegEx) || [];
  if (!rawDeps)
    return createEsmAnalysis(imports, source, url);
  const deps = JSON.parse(rawDeps.replace(/'/g, '"'));
  const dynamicDeps: string[] = [];
  if (contextId) {
    const dynamicImport = `${contextId}.import(`;
    let i = -1;
    while ((i = source.indexOf(dynamicImport, i + 1)) !== -1) {
      const importStart = i + dynamicImport.length + 1;
      const quote = source[i + dynamicImport.length];
      if (quote === '"' || quote === '\'') {
        const importEnd = source.indexOf(quote, i + dynamicImport.length + 1);
        if (importEnd !== -1) {
          try {
            dynamicDeps.push(JSON.parse('"' + source.slice(importStart, importEnd) + '"'));
            continue;
          }
          catch (e) {}
        }
      }
      console.warn('TODO: Dynamic import custom expression tracing.');
    }
  }
  const size = source.length;
  return { deps, dynamicDeps, cjsLazyDeps: null, size, format: 'system' };
}
