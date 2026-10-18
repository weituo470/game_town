import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Original geometric placeholders for the open-source distribution. No source
// portrait is read, traced, embedded or fetched. Identity colours are editorial.
export const PORTRAITS = Object.freeze([
  ['ali', '阿栗', '#896047', 'parcel', 'human'],
  ['huaya', '花芽', '#7f9c77', 'flower', 'human'],
  ['nuannuan', '暖暖', '#c3a34c', 'yarn', 'human'],
  ['beidong', '北冬', '#99785c', 'mountain', 'human'],
  ['juya', '橘芽', '#da9550', 'flower', 'cat'],
  ['lituan', '栗团', '#ad694b', 'parcel', 'panda'],
  ['lanyue', '蓝跃', '#5685a0', 'route', 'human'],
  ['maipao', '麦跑', '#c1975c', 'parcel', 'dog'],
  ['lanjian', '蓝笺', '#5f87a0', 'letter', 'human'],
  ['chengsu', '橙酥', '#ce8851', 'bread', 'human'],
  ['rongrong', '绒绒', '#9c8fae', 'book', 'rabbit'],
  ['yubai', '予白', '#628ea5', 'brush', 'human'],
  ['miaomu', '苗木', '#738e66', 'leaf', 'human'],
  ['dengcheng', '灯橙', '#cf944c', 'lamp', 'human'],
  ['xiaotai', '小苔', '#83967a', 'leaf', 'human'],
  ['alan', '阿蓝', '#527e99', 'tool', 'human'],
].map(Object.freeze));

const ICONS = {
  parcel: '<rect x="-15" y="-12" width="30" height="24" rx="3"/><path d="M-15-5H15M0-12V12"/>',
  flower: '<path d="M0 17V-1M0 11L-9 6"/><circle cx="0" cy="-8" r="6"/><circle cx="-8" cy="-8" r="5"/><circle cx="8" cy="-8" r="5"/><circle cx="0" cy="-16" r="5"/>',
  yarn: '<circle r="14"/><path d="M-12-6L9 11M-6-12L13 5M-13 4L3 14M11-9L-7 12"/>',
  mountain: '<path d="M-17 13L-4-14 4 0 10-9 19 13ZM-9-3L-4 1 1-3"/>',
  route: '<path d="M-15 12L-3 2 5 8 15-12M7-12H15V-4"/>',
  letter: '<rect x="-17" y="-12" width="34" height="24" rx="3"/><path d="M-15-9L0 3 15-9"/>',
  bread: '<path d="M-15 10V-5C-15-20 15-20 15-5V10ZM-5-9V-3M4-10V-4"/>',
  book: '<path d="M0 14C-5 9-12 9-17 11V-13C-10-15-4-13 0-9 4-13 10-15 17-13V11C12 9 5 9 0 14ZM0-9V14"/>',
  brush: '<path d="M-5 5L10-15 16-10 1 11ZM-5 5C-16 3-8 16-16 17-5 20 2 17 1 11"/>',
  leaf: '<path d="M-13 14C-19-10 3-14 17-14 17 3 6 20-13 14ZM-13 14L9-7"/>',
  lamp: '<rect x="-12" y="-10" width="24" height="26" rx="4"/><path d="M-6-10V-17H6V-10M-16 16H16M0-3V9M-5 3H5"/>',
  tool: '<path d="M-12 16L4 0C13 3 20-5 15-13L9-6 3-12 10-19C0-23-8-14-4-5L-20 11Z"/>',
};

export function renderNpcPortrait([id, name, colour, icon, kind]) {
  if (!/^[a-z]+$/.test(id) || !ICONS[icon]) throw new Error('Unknown portrait specification');
  let ears = '', face = '#f2d6b7', detail = '';
  if (kind === 'human') detail = '<path d="M86 101C84 58 166 56 170 99 143 101 127 78 86 101Z" fill="#465258"/>';
  else {
    if (kind === 'rabbit') ears = '<ellipse cx="106" cy="60" rx="14" ry="36"/><ellipse cx="150" cy="60" rx="14" ry="36"/>';
    else if (kind === 'cat') ears = '<path d="M86 96L80 50 115 78M141 78L177 50 170 96Z"/>';
    else if (kind === 'dog') ears = '<ellipse cx="88" cy="91" rx="19" ry="32"/><ellipse cx="168" cy="91" rx="19" ry="32"/>';
    else ears = '<circle cx="91" cy="76" r="22"/><circle cx="165" cy="76" r="22"/>';
    face = kind === 'rabbit' ? '#f4efe5' : colour;
    detail = '<ellipse cx="128" cy="126" rx="27" ry="22" fill="#f9eed8"/><path d="M121 119H135L128 126Z" fill="#465258"/>';
    if (kind === 'panda') detail = '<ellipse cx="110" cy="104" rx="18" ry="16" fill="#f9eed8"/><ellipse cx="146" cy="104" rx="18" ry="16" fill="#f9eed8"/>' + detail;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-labelledby="portrait-title"><title id="portrait-title">${name} · 原创示意头像</title><desc>Original geometric placeholder; no external artwork or font asset. SPDX-License-Identifier: MIT.</desc><rect width="256" height="256" rx="32" fill="#f5f0e6"/><circle cx="128" cy="116" r="94" fill="${colour}" opacity=".15"/><path d="M49 232V207C49 160 207 160 207 207V232Z" fill="${colour}"/><path d="M96 174L128 198 160 174" fill="none" stroke="#f9eed8" stroke-width="8" stroke-linecap="round"/><g fill="${face}" stroke="#465258" stroke-width="3">${ears}<ellipse cx="128" cy="109" rx="44" ry="49"/></g>${detail}<g fill="#37454c"><circle cx="111" cy="108" r="4"/><circle cx="145" cy="108" r="4"/></g><path d="M116 132Q128 141 140 132" fill="none" stroke="#465258" stroke-width="3" stroke-linecap="round"/><circle cx="194" cy="196" r="30" fill="#fcfaf4" stroke="${colour}" stroke-width="3"/><g transform="translate(194 196)" fill="none" stroke="${colour}" stroke-width="2.7" stroke-linejoin="round" stroke-linecap="round">${ICONS[icon]}</g></svg>\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = fileURLToPath(new URL('../public/npc/', import.meta.url));
  await fs.mkdir(destination, { recursive: true });
  for (const spec of PORTRAITS) await fs.writeFile(path.join(destination, `${spec[0]}.svg`), renderNpcPortrait(spec));
  console.log(`Generated ${PORTRAITS.length} original SVG placeholders.`);
}
