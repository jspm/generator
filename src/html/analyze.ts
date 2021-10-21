import { parseStyled } from '../common/json.js';
import { SourceStyle } from '../common/source-style.js';
import { baseUrl } from '../common/url.js';
import { ParsedAttribute, ParsedTag, parseHtml } from './lexer.js';
import { parse } from 'es-module-lexer';

export interface Attr {
  quote: '"' | "'" | '';
  name: string;
  value: string | null;
}

function getAttr (source: string, tag: ParsedTag, name: string) {
  for (const attr of tag.attributes) {
    if (source.slice(attr.nameStart, attr.nameEnd) === name)
      return source.slice(attr.valueStart, attr.valueEnd);
  }
  return null;
}

export interface ParsedMap {
  json: any;
  style: SourceStyle;
  postInject: string;
  start: number;
  end: number;
  attrs: Attr[];
}

export interface HtmlAnalysis {
  map: ParsedMap;
  base: URL;
  hasESMS: boolean;
  staticImports: Set<string>;
  dynamicImports: Set<string>;
  preloads: ParsedPreload[];
}

export interface ParsedPreload {
  start: number;
  end: number;
  attrs: Attr[];
}

const esmsSrcRegEx = /(^|\/)(es-module-shims|esms)(\.min)?\.js$/;

export function analyzeHtml (source: string, url: URL = baseUrl): HtmlAnalysis {
  const analysis: HtmlAnalysis = {
    base: url,
    map: { json: null, style: null, start: -1, end: -1, postInject: '', attrs: [] },
    staticImports: new Set<string>(),
    dynamicImports: new Set<string>(),
    preloads: [],
    hasESMS: false
  };
  const tags = parseHtml(source);
  for (const tag of tags) {
    switch (tag.tagName) {
      case 'base':
        if (!analysis.map.json) createInjectionPoint(source, analysis.map, tag);
        const href = getAttr(source, tag, 'href');
        if (href)
          analysis.base = new URL(href, url);
        break;
      case 'script':
        const type = getAttr(source, tag, 'type');
        if (type === 'importmap') {
          const { json, style } = parseStyled(source.slice(tag.innerStart, tag.innerEnd), url.href + '#importmap');
          const { start, end } = tag;
          const attrs = tag.attributes.map(attr => readAttr(source, attr));
          analysis.map = { json, style, start, end, attrs, postInject: detectIndent(source, tag.start) };
        }
        else if (type === 'module') {
          const src = getAttr(source, tag, 'src');
          if (src) {
            if (esmsSrcRegEx.test(src))
              analysis.hasESMS = true;
            else
              analysis.staticImports.add(src);
          }
          else {
            const [imports] = parse(source.slice(tag.innerStart, tag.innerEnd)) || [];
            for (const { n, d } of imports) {
              if (!n) continue;
              (d === -1 ? analysis.staticImports : analysis.dynamicImports).add(n);
            }
          }
        }
        else if (!type) {
          const src = getAttr(source, tag, 'src');
          if (src) {
            if (esmsSrcRegEx.test(src))
              analysis.hasESMS = true;
            else
              analysis.staticImports.add(src);
          }
          else {
            const [imports] = parse(source.slice(tag.innerStart, tag.innerEnd)) || [];
            for (const { n, d } of imports) {
              if (!n) continue;
              (d === -1 ? analysis.staticImports : analysis.dynamicImports).add(n);
            }
          }
        }
        if (!analysis.map.json) createInjectionPoint(source, analysis.map, tag);
        break;
      case 'link':
        if (!analysis.map.json) createInjectionPoint(source, analysis.map, tag);
        if (getAttr(source, tag, 'rel') === 'modulepreload') {
          const { start, end } = tag;
          const attrs = tag.attributes.map(attr => readAttr(source, attr));
          analysis.preloads.push({ start, end, attrs });
        }
    }
  }
  return analysis;
}

function createInjectionPoint (source: string, map: ParsedMap, tag: ParsedTag) {
  map.postInject = detectIndent(source, tag.start);
  map.attrs = tag.attributes.map(attr => readAttr(source, attr));
  map.start = map.end = tag.start;
}

function readAttr (source: string, { nameStart, nameEnd, valueStart, valueEnd }: ParsedAttribute): Attr {
  return {
    quote: valueStart !== -1 && (source[valueStart - 1] === '"' || source[valueStart - 1] === "'") ? source[valueStart - 1] as '"' | "'" : '',
    name: source.slice(nameStart, nameEnd),
    value: valueStart === -1 ? null : source.slice(valueStart, valueEnd)
  };
}

function detectIndent (source: string, atIndex: number) {
  if (source === '' || atIndex === -1) return '';
  const nl = source.lastIndexOf('\n', atIndex);
  const spaceMatch = (nl === -1 ? source : source.slice(nl, atIndex)).match(/^\s*/);
  return spaceMatch ? '\n' + spaceMatch[0] : '';
}
