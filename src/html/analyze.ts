import { parseStyled } from "../common/json.js";
import { defaultStyle, SourceStyle } from "../common/source-style.js";
import { baseUrl, isPlain } from "../common/url.js";
import { isWs, ParsedAttribute, ParsedTag, parseHtml } from "./lexer.js";
// @ts-ignore
import { parse } from "es-module-lexer/js";

export interface HtmlAttr {
  quote: '"' | "'" | "";
  name: string;
  value: string | null;
  start: number;
  end: number;
}

function getAttr(source: string, tag: ParsedTag, name: string) {
  for (const attr of tag.attributes) {
    if (source.slice(attr.nameStart, attr.nameEnd) === name)
      return source.slice(attr.valueStart, attr.valueEnd);
  }
  return null;
}

export interface ParsedMap extends HtmlTag {
  json: any;
  style: SourceStyle;
  newScript: boolean;
}

export interface HtmlAnalysis {
  map: ParsedMap;
  base: URL;
  esModuleShims: HtmlTag | null;
  staticImports: Set<string>;
  dynamicImports: Set<string>;
  preloads: HtmlTag[];
  modules: HtmlTag[];
  comments: HtmlTag[];
  newlineTab: string;
}

export interface HtmlTag {
  start: number;
  end: number;
  attrs: Record<string, HtmlAttr>;
}

const esmsSrcRegEx = /(^|\/)(es-module-shims|esms)(\.min)?\.js$/;

function toHtmlAttrs(
  source: string,
  attributes: ParsedAttribute[]
): Record<string, HtmlAttr> {
  return Object.fromEntries(
    attributes
      .map((attr) => readAttr(source, attr))
      .map((attr) => [attr.name, attr])
  );
}

export function analyzeHtml(source: string, url: URL = baseUrl): HtmlAnalysis {
  const analysis: HtmlAnalysis = {
    base: url,
    newlineTab: "\n",
    map: {
      json: null,
      style: null,
      start: -1,
      end: -1,
      newScript: false,
      attrs: null,
    },
    staticImports: new Set<string>(),
    dynamicImports: new Set<string>(),
    preloads: [],
    modules: [],
    esModuleShims: null,
    comments: [],
  };
  let createdInjectionPoint = false;
  const tags = parseHtml(source);
  for (const tag of tags) {
    switch (tag.tagName) {
      case "!--":
        analysis.comments.push({ start: tag.start, end: tag.end, attrs: {} });
        break;
      case "base":
        if (!createdInjectionPoint) {
          createInjectionPoint(source, analysis.map, tag, analysis);
          createdInjectionPoint = true;
        }
        const href = getAttr(source, tag, "href");
        if (href) analysis.base = new URL(href, url);
        break;
      case "script":
        const type = getAttr(source, tag, "type");
        if (type === "importmap") {
          const mapText = source.slice(tag.innerStart, tag.innerEnd);
          const emptyMap = mapText.trim().length === 0;
          const { json, style } = emptyMap
            ? { json: {}, style: defaultStyle }
            : parseStyled(mapText, url.href + "#importmap");
          const { start, end } = tag;
          const attrs = toHtmlAttrs(source, tag.attributes);
          let lastChar = tag.innerEnd;
          while (isWs(source.charCodeAt(--lastChar)));
          analysis.newlineTab = detectIndent(source, lastChar + 1);
          analysis.map = { json, style, start, end, attrs, newScript: false };
          createdInjectionPoint = true;
        } else if (type === "module") {
          const src = getAttr(source, tag, "src");
          if (src) {
            if (esmsSrcRegEx.test(src)) {
              analysis.esModuleShims = {
                start: tag.start,
                end: tag.end,
                attrs: toHtmlAttrs(source, tag.attributes),
              };
            } else {
              analysis.staticImports.add(isPlain(src) ? "./" + src : src);
              analysis.modules.push({
                start: tag.start,
                end: tag.end,
                attrs: toHtmlAttrs(source, tag.attributes),
              });
            }
          } else {
            const [imports] =
              parse(source.slice(tag.innerStart, tag.innerEnd)) || [];
            for (const { n, d } of imports) {
              if (!n) continue;
              (d === -1 ? analysis.staticImports : analysis.dynamicImports).add(
                n
              );
            }
          }
        } else if (!type || type === "javascript") {
          const src = getAttr(source, tag, "src");
          if (src) {
            if (esmsSrcRegEx.test(src)) {
              analysis.esModuleShims = {
                start: tag.start,
                end: tag.end,
                attrs: toHtmlAttrs(source, tag.attributes),
              };
            }
          } else {
            const [imports] =
              parse(source.slice(tag.innerStart, tag.innerEnd)) || [];
            for (const { n, d } of imports) {
              if (!n) continue;
              (d === -1 ? analysis.staticImports : analysis.dynamicImports).add(
                n
              );
            }
          }
        }
        if (!createdInjectionPoint) {
          createInjectionPoint(source, analysis.map, tag, analysis);
          createdInjectionPoint = true;
        }
        break;
      case "link":
        if (!createdInjectionPoint) {
          createInjectionPoint(source, analysis.map, tag, analysis);
          createdInjectionPoint = true;
        }
        if (getAttr(source, tag, "rel") === "modulepreload") {
          const { start, end } = tag;
          const attrs = toHtmlAttrs(source, tag.attributes);
          analysis.preloads.push({ start, end, attrs });
        }
    }
  }
  if (analysis.map.start === -1) {
    createInjectionPoint(
      source,
      analysis.map,
      {
        tagName: "html",
        start: source.length,
        end: source.length,
        attributes: [],
        innerStart: source.length,
        innerEnd: source.length,
      },
      analysis
    );
  }
  return analysis;
}

function createInjectionPoint(
  source: string,
  map: ParsedMap,
  tag: ParsedTag,
  analysis: HtmlAnalysis
) {
  let lastChar = tag.innerEnd;
  while (isWs(source.charCodeAt(--lastChar)));
  analysis.newlineTab = detectIndent(source, lastChar + 1);
  if (analysis.newlineTab.indexOf("\n") === -1) {
    lastChar = tag.start;
    while (isWs(source.charCodeAt(--lastChar)));
    analysis.newlineTab = detectIndent(source, lastChar + 1);
  }
  map.newScript = true;
  map.attrs = toHtmlAttrs(source, tag.attributes);
  map.start = map.end = tag.start;
}

function readAttr(
  source: string,
  { nameStart, nameEnd, valueStart, valueEnd }: ParsedAttribute
): HtmlAttr {
  return {
    start: nameStart,
    end: valueEnd !== -1 ? valueEnd : nameEnd,
    quote:
      valueStart !== -1 &&
      (source[valueStart - 1] === '"' || source[valueStart - 1] === "'")
        ? (source[valueStart - 1] as '"' | "'")
        : "",
    name: source.slice(nameStart, nameEnd),
    value: valueStart === -1 ? null : source.slice(valueStart, valueEnd),
  };
}

function detectIndent(source: string, atIndex: number) {
  if (source === "" || atIndex === -1) return "";
  const nlIndex = atIndex;
  if (source[atIndex] === "\r" && source[atIndex + 1] === "\n") atIndex++;
  if (source[atIndex] === "\n") atIndex++;
  while (source[atIndex] === " " || source[atIndex] === "\t") atIndex++;
  return source.slice(nlIndex, atIndex) || "";
}
