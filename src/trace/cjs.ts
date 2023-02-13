import { Analysis } from "./analysis";

let babel;

export function setBabel(_babel) {
  babel = _babel;
}

export async function createCjsAnalysis(
  imports: any,
  source: string,
  url: string
): Promise<Analysis> {
  if (!babel) ({ default: babel } = await import("@babel/core"));

  const requires = new Set<string>();
  const lazy = new Set<string>();

  babel.transform(source, {
    ast: false,
    sourceMaps: false,
    inputSourceMap: false,
    babelrc: false,
    babelrcRoots: false,
    configFile: false,
    highlightCode: false,
    compact: false,
    sourceType: "script",
    parserOpts: {
      allowReturnOutsideFunction: true,
      // plugins: stage3Syntax,
      errorRecovery: true,
    },
    plugins: [
      ({ types: t }) => {
        return {
          visitor: {
            Program(path, state) {
              state.functionDepth = 0;
            },
            CallExpression(path, state) {
              if (
                t.isIdentifier(path.node.callee, { name: "require" }) ||
                (t.isIdentifier(path.node.callee.object, { name: "require" }) &&
                  t.isIdentifier(path.node.callee.property, {
                    name: "resolve",
                  })) ||
                (t.isMemberExpression(path.node.callee) &&
                  t.isIdentifier(path.node.callee.object, { name: "module" }) &&
                  t.isIdentifier(path.node.callee.property, {
                    name: "require",
                  }))
              ) {
                const req = buildDynamicString(
                  path.get("arguments.0").node,
                  url
                );
                requires.add(req);
                if (state.functionDepth > 0) lazy.add(req);
              }
            },
            Scope: {
              enter(path, state) {
                if (t.isFunction(path.scope.block)) state.functionDepth++;
              },
              exit(path, state) {
                if (t.isFunction(path.scope.block)) state.functionDepth--;
              },
            },
            // Import (path) {
            //   dynamicImports.add(buildDynamicString(path.parentPath.get('arguments.0').node, url, true));
            // }
          },
        };
      },
    ],
  });

  return {
    deps: [...requires],
    dynamicDeps: imports.filter((impt) => impt.n).map((impt) => impt.n),
    cjsLazyDeps: [...lazy],
    size: source.length,
    format: "commonjs",
  };
}

function buildDynamicString(
  node,
  fileName,
  isEsm = false,
  lastIsWildcard = false
): string {
  if (node.type === "StringLiteral") {
    return node.value;
  }
  if (node.type === "TemplateLiteral") {
    let str = "";
    for (let i = 0; i < node.quasis.length; i++) {
      const quasiStr = node.quasis[i].value.cooked;
      if (quasiStr.length) {
        str += quasiStr;
        lastIsWildcard = false;
      }
      const nextNode = node.expressions[i];
      if (nextNode) {
        const nextStr = buildDynamicString(
          nextNode,
          fileName,
          isEsm,
          lastIsWildcard
        );
        if (nextStr.length) {
          lastIsWildcard = nextStr.endsWith("*");
          str += nextStr;
        }
      }
    }
    return str;
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const leftResolved = buildDynamicString(
      node.left,
      fileName,
      isEsm,
      lastIsWildcard
    );
    if (leftResolved.length) lastIsWildcard = leftResolved.endsWith("*");
    const rightResolved = buildDynamicString(
      node.right,
      fileName,
      isEsm,
      lastIsWildcard
    );
    return leftResolved + rightResolved;
  }
  if (node.type === "Identifier") {
    if (node.name === "__dirname") return ".";
    if (node.name === "__filename") return "./" + fileName;
  }
  // TODO: proper expression support
  // new URL('...', import.meta.url).href | new URL('...', import.meta.url).toString() | new URL('...', import.meta.url).pathname
  // import.meta.X
  /*if (isEsm && node.type === 'MemberExpression' && node.object.type === 'MetaProperty' &&
      node.object.meta.type === 'Identifier' && node.object.meta.name === 'import' &&
      node.object.property.type === 'Identifier' && node.object.property.name === 'meta') {
    if (node.property.type === 'Identifier' && node.property.name === 'url') {
      return './' + fileName;
    }
  }*/
  return lastIsWildcard ? "" : "*";
}
