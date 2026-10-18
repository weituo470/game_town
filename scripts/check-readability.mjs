import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A dependency-free regression guard, NOT a substitute for computed-style,
// contrast, overflow and final displayed-size checks in a real browser.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLOOR = { '--text-body': 18, '--text-control': 16, '--text-meta': 14 };
const CONTROL_TAGS = new Set(['button', 'input', 'select', 'textarea', 'nav', 'option', 'label', 'td', 'th']);
const BODY_TAGS = new Set(['body', 'p', 'blockquote', 'legend', 'li']);
const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, text => text.replace(/[^\n]/g, ' '));
const lineAt = (source, offset) => source.slice(0, offset).split('\n').length;
const tagFloor = tag => BODY_TAGS.has(tag) ? 18 : CONTROL_TAGS.has(tag) ? 16 : 14;

function splitArguments(value) {
  let depth = 0, start = 0;
  const parts = [];
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '(') depth += 1;
    if (value[i] === ')') depth -= 1;
    if (value[i] === ',' && depth === 0) { parts.push(value.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function pixels(raw, variables, seen = new Set()) {
  const value = raw.replace(/!important/g, '').trim();
  const number = value.match(/^(-?(?:\d*\.)?\d+)(px|rem|em|%)$/i);
  if (number) {
    const amount = Number(number[1]);
    return number[2] === 'px' ? amount : number[2] === '%' ? amount * 0.16 : amount * 16;
  }
  if (value === '0') return 0;
  if (value === 'initial' || value === 'medium') return 16;
  const variable = value.match(/^var\((.*)\)$/);
  if (variable) {
    const [name, fallback] = splitArguments(variable[1]);
    if (seen.has(name)) return null;
    const next = new Set([...seen, name]);
    if (!variables.has(name)) return fallback ? pixels(fallback, variables, next) : null;
    const values = variables.get(name).map(item => pixels(item.value, variables, next));
    return values.every(item => item !== null) ? Math.min(...values) : null;
  }
  const expression = value.match(/^(clamp|min|max)\((.*)\)$/);
  if (expression) {
    const sizes = splitArguments(expression[2]).map(item => pixels(item, variables, seen));
    if (expression[1] === 'clamp') return sizes[0] ?? null;
    if (expression[1] === 'max') return sizes.some(item => item !== null) ? Math.max(...sizes.filter(item => item !== null)) : null;
    return sizes.every(item => item !== null) ? Math.min(...sizes) : null;
  }
  return null;
}

function shorthandSize(value) {
  // Start with var/clamp expressions so commas in a font family cannot hide
  // size overrides. A /line-height suffix is intentionally not part of size.
  const functional = value.match(/(?:var|clamp|min|max)\(/);
  if (functional) {
    let depth = 0;
    for (let i = functional.index; i < value.length; i += 1) {
      if (value[i] === '(') depth += 1;
      if (value[i] === ')' && --depth === 0) return value.slice(functional.index, i + 1);
    }
  }
  return value.match(/(?:^|\s)(-?(?:\d*\.)?\d+(?:px|rem|em|%))(?=\s|\/|$)/)?.[1] ?? null;
}

export function auditSources(sources) {
  const issues = [];
  const stats = { files: sources.length, fontSizes: 0, fontShorthands: 0, inlineFonts: 0, customVariableDeclarations: 0, customVariableUses: 0, utilityClasses: 0, mediaQueries: 0 };
  const cssFiles = sources.filter(file => file.path.endsWith('.css')).map(file => ({ ...file, clean: stripComments(file.content) }));
  const jsxFiles = sources.filter(file => /\.(?:jsx|tsx|js|ts)$/.test(file.path)).map(file => ({ ...file, clean: stripComments(file.content) }));
  const variables = new Map();
  const classFloors = new Map();
  const tags = new Map();
  const addIssue = (file, offset, message) => issues.push({ file: file.path, line: lineAt(file.content, offset), message });

  for (const file of jsxFiles) {
    const found = [];
    for (const match of file.clean.matchAll(/<([a-z][\w-]*)\b([^>]*?)>/g)) {
      const attrs = match[2];
      const role = attrs.match(/role=["'](button|tab|menuitem|combobox|textbox)["']/);
      const minimum = role ? Math.max(16, tagFloor(match[1])) : tagFloor(match[1]);
      const classes = attrs.match(/className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\}|\{([^}]*)\})/);
      const classText = classes ? classes[1] ?? classes[2] ?? classes[3] ?? classes[4] : '';
      for (const name of classText.match(/[A-Za-z_][\w-]*/g) ?? []) classFloors.set(name, Math.max(minimum, classFloors.get(name) ?? 14));
      found.push({ start: match.index, end: match.index + match[0].length, minimum, classText });
    }
    tags.set(file.path, found);
  }

  for (const file of cssFiles) {
    stats.mediaQueries += [...file.clean.matchAll(/@media\b/g)].length;
    for (const match of file.clean.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) {
      stats.customVariableDeclarations += 1;
      if (!variables.has(match[1])) variables.set(match[1], []);
      variables.get(match[1]).push({ value: match[2].trim(), file, offset: match.index });
    }
  }

  for (const [name, floor] of Object.entries(FLOOR)) {
    if (!variables.has(name)) {
      issues.push({ file: 'src/styles.css', line: 1, message: `缺少统一语义字号 ${name}（至少 ${floor}px）。` });
      continue;
    }
    for (const declaration of variables.get(name)) {
      const size = pixels(declaration.value, variables, new Set([name]));
      if (size === null || size < floor) addIssue(declaration.file, declaration.offset, `${name}: ${declaration.value} 未达到 ${floor}px；媒体查询中的覆盖也必须合规。`);
    }
  }

  function selectorFloor(selector) {
    let floor = 14;
    for (const part of selector.split(',')) {
      // Only the target element's class controls this floor, not ancestors.
      const target = part.trim().split(/\s+|\s*[>+~]\s*/).filter(Boolean).at(-1) ?? '';
      const tag = target.match(/^([a-z][\w-]*)/i)?.[1]?.toLowerCase();
      floor = Math.max(floor, tagFloor(tag));
      for (const match of target.matchAll(/\.([\w-]+)/g)) {
        floor = Math.max(floor, classFloors.get(match[1]) ?? 14);
        if (/^(?:button|nav-item|tab|input|control)(?:-|$)/.test(match[1])) floor = Math.max(floor, 16);
      }
    }
    return floor;
  }

  function checkValue(file, offset, value, minimum, context) {
    stats.customVariableUses += [...value.matchAll(/var\(/g)].length;
    for (const match of value.matchAll(/var\(\s*(--(?:font|text)-[\w-]+)/g)) {
      if (!match[1].startsWith('--text-')) addIssue(file, offset, `${context} 使用未统一的字号变量 ${match[1]}；改用 --text-body / --text-control / --text-meta / --text-title。`);
    }
    if (/^(inherit|unset|revert|revert-layer)$/.test(value.trim())) return;
    const size = pixels(value, variables);
    if (size === null) addIssue(file, offset, `${context} 的字号 ${value} 无法静态确认；请使用语义变量或带明确下限的 clamp()，并做浏览器检查。`);
    else if (size < minimum - 0.001) addIssue(file, offset, `${context} 为 ${size}px，低于 ${minimum}px 下限（原值：${value}）。`);
  }

  let rootSizeSeen = false;
  for (const file of cssFiles) {
    for (const block of file.clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = block[1].trim();
      if (selector.startsWith('@')) continue;
      const minimum = selectorFloor(selector);
      const offset = block.index + block[0].indexOf('{') + 1;
      for (const declaration of block[2].matchAll(/(?:^|;)\s*(font-size|font)\s*:\s*([^;]+)/g)) {
        const property = declaration[1], value = declaration[2].trim();
        const declarationOffset = offset + declaration.index;
        if (property === 'font-size') stats.fontSizes += 1;
        else stats.fontShorthands += 1;
        const isRoot = selector.split(',').some(part => /^(html|:root)$/.test(part.trim()));
        if (isRoot && property === 'font-size') {
          rootSizeSeen = true;
          if (value !== '100%') addIssue(file, declarationOffset, 'html 根字号必须保持 100%，不能通过修改根字号或缩放掩盖小字。');
          continue;
        }
        if (property === 'font') {
          if (/^(inherit|unset|revert|revert-layer)$/.test(value)) continue;
          const size = shorthandSize(value);
          if (!size) addIssue(file, declarationOffset, `${selector} 的 font 简写无法确认字号：${value}。`);
          else checkValue(file, declarationOffset, size, minimum, `${selector} 的 font 简写`);
        } else checkValue(file, declarationOffset, value, minimum, selector);
      }
      for (const declaration of block[2].matchAll(/(?:^|;)\s*zoom\s*:\s*([^;]+)/g)) {
        if (!/^(1|100%|normal)$/.test(declaration[1].trim())) addIssue(file, offset + declaration.index, '禁止使用 CSS zoom 代替可读字号。');
      }
      if (selector.split(',').some(part => /^(html|body|:root|#root|main)$/.test(part.trim()))) {
        for (const declaration of block[2].matchAll(/(?:^|;)\s*(?:transform|scale)\s*:\s*([^;]+)/g)) {
          const scale = declaration[1].match(/scale\(\s*([\d.]+)|^\s*([\d.]+)(?:\s|$)/);
          if (scale && Number(scale[1] ?? scale[2]) !== 1) addIssue(file, offset + declaration.index, '禁止通过缩放整个页面或根容器掩盖字号；请重排布局。');
        }
      }
    }
  }
  if (!rootSizeSeen) issues.push({ file: 'src/styles.css', line: 1, message: '缺少显式 html { font-size: 100%; }。' });

  for (const file of jsxFiles) {
    for (const match of file.clean.matchAll(/(?:\bfontSize|['"]font-size['"])\s*:\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`|([\d.]+)|([^,}\n]+))/g)) {
      stats.inlineFonts += 1;
      const literal = match[1] ?? match[2] ?? match[3];
      const value = literal ?? (match[4] ? `${match[4]}px` : match[5].trim());
      const enclosing = tags.get(file.path).find(tag => match.index >= tag.start && match.index <= tag.end);
      checkValue(file, match.index, value, enclosing?.minimum ?? 14, 'JSX/CSS-in-JS fontSize');
    }
    for (const match of file.clean.matchAll(/\bfont\s*:\s*(?:'([^']*)'|"([^"]*)")/g)) {
      stats.inlineFonts += 1;
      const value = match[1] ?? match[2];
      if (/^(inherit|unset|revert|revert-layer)$/.test(value)) continue;
      const size = shorthandSize(value);
      const enclosing = tags.get(file.path).find(tag => match.index >= tag.start && match.index <= tag.end);
      if (size) checkValue(file, match.index, size, enclosing?.minimum ?? 14, 'JSX font 简写');
      else addIssue(file, match.index, `JSX font 简写无法确认字号：${value}。`);
    }
    for (const tag of tags.get(file.path)) {
      const utilitySizes = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30, '4xl': 36, '5xl': 48, '6xl': 60, '7xl': 72, '8xl': 96, '9xl': 128 };
      for (const match of tag.classText.matchAll(/(?:^|\s|['"`])(?:[\w-]+:)*text-(xs|sm|base|lg|xl|[2-9]xl|\[[^\]]+\])(?=$|\s|['"`])/g)) {
        stats.utilityClasses += 1;
        const value = match[1].startsWith('[') ? match[1].slice(1, -1) : `${utilitySizes[match[1]]}px`;
        checkValue(file, tag.start, value, tag.minimum, `工具类 text-${match[1]}`);
      }
    }
  }
  return { issues, stats };
}

function findSources(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return findSources(target);
    if (!/\.(?:css|jsx|tsx|js|ts)$/.test(entry.name)) return [];
    return [{ path: path.relative(ROOT, target).replaceAll('\\', '/'), content: fs.readFileSync(target, 'utf8') }];
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const { issues, stats } = auditSources(findSources(path.join(ROOT, 'src')));
  console.log(`Readability scan: ${JSON.stringify(stats)}`);
  if (issues.length) {
    for (const issue of issues) console.error(`${issue.file}:${issue.line} ${issue.message}`);
    console.error(`FAIL: ${issues.length} readability regression(s).`);
    process.exitCode = 1;
  } else {
    console.log('PASS: static font-size floors, semantic variables, overrides, shorthand, utility classes and media-query checks.');
  }
  console.log('Browser QA still required: 100% zoom, desktop + ~390px mobile, computed font sizes, contrast, wrapping, overlap, overflow, dialogs and final 3D/SVG text sizes.');
}
