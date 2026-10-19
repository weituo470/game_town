import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { auditSources } from '../scripts/check-readability.mjs';

const studio = await readFile(new URL('../src/components/drone/AiDroneStudio.jsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/components/drone/ai-drone-studio.css', import.meta.url), 'utf8');
const baseCss = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('studio lazily imports the runtime compiler and never evaluates model code', () => {
  assert.match(studio, /await import\('\.\.\/\.\.\/\.\.\/shared\/aiDroneShow\.js'\)/);
  assert.doesNotMatch(studio, /import\s+[^\n]+from\s+['"][^'"]*aiDroneShow/);
  assert.doesNotMatch(studio, /\beval\s*\(|new Function\s*\(|dangerouslySetInnerHTML/);
  assert.match(studio, /validateAiDroneScore\(show\.score\)/);
  assert.match(studio, /onPlay\(current\.runtime\)/);
});

test('studio presents bounded labeled input, honest disabled status, cancellation and quota disclosure', () => {
  for (const expected of ['htmlFor="ai-drone-prompt"', 'maxLength={AI_DRONE_MAX_PROMPT}', 'aria-describedby="ai-drone-privacy"', 'aria-busy={busy}', '取消等待', 'DeepSeek', '每日 5 次', '同 IP', '失败或取消也可能扣次', '仅个人观演', '非真实无人机飞控', '不会自动重试', 'AI 编导暂未开放']) assert.ok(studio.includes(expected), expected);
  assert.match(studio, /disabled=\{busy \|\| checking \|\| !service\?\.enabled/);
  assert.equal((studio.match(/label: '/g) ?? []).length, 3);
  assert.doesNotMatch(studio, /Math\.random|progressbar|百分之/);
});

test('generation has immediate prominent feedback and only measures elapsed time while busy', () => {
  assert.match(studio, /setStage\('identity'\)/);
  assert.ok(studio.indexOf("setStage('identity')") < studio.indexOf('await client.generate('));
  assert.match(studio, /if \(!busy\) return undefined/);
  assert.match(studio, /const timer = setInterval\(update, 1000\)/);
  assert.match(studio, /return \(\) => clearInterval\(timer\)/);
  assert.match(studio, /\}, \[busy\]\)/);
  assert.match(studio, /已等待 <strong>\{elapsed\}<\/strong> 秒/);
  assert.match(studio, /stageFeedback\?\.button/);
  assert.match(studio, /aria-live="off"/);
  assert.match(studio, /aiDroneQuotaFeedback\(usage, stage\)/);
  assert.doesNotMatch(studio, /生成前不调用模型/);
});

test('results and errors focus the feedback region and playback precedes long chapter details', () => {
  assert.match(studio, /feedbackRef\.current\.focus\(\{ preventScroll: true \}\)/);
  assert.match(studio, /scrollIntoView\(\{ block: 'start'/);
  assert.match(studio, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(studio, /tabIndex=\{-1\} aria-labelledby="ai-drone-feedback-title"/);
  assert.match(studio, /节目已就绪/);
  assert.match(studio, /立即观看/);
  assert.match(studio, /观看上一份节目/);
  assert.ok(studio.indexOf('onClick={() => onPlay(current.runtime)}') < studio.indexOf('className="ai-drone-chapters"'));
  assert.ok(studio.indexOf('onClick={save}') < studio.indexOf('className="ai-drone-chapters"'));
  assert.equal((studio.match(/onPlay\(current\.runtime\)/g) || []).length, 1);
  assert.match(studio, /role=\{error \? 'alert' : 'status'\}/);
});

test('focused feedback clears the measured sticky dialog header on desktop and mobile', () => {
  assert.match(studio, /closest\('\.dialog'\)\?\.querySelector\('\.dialog-heading'\)/);
  assert.match(studio, /heading\?\.getBoundingClientRect\(\)\.height/);
  assert.match(studio, /Math\.max\(130, Math\.ceil\(headerHeight\) \+ 20\)/);
  const offset = studio.indexOf("style.setProperty('--ai-feedback-scroll-offset'");
  const scroll = studio.indexOf('feedbackRef.current.scrollIntoView(');
  assert.ok(offset > 0 && offset < scroll);
  assert.match(css, /scroll-margin-top: var\(--ai-feedback-scroll-offset, 130px\)/);
  assert.equal((css.match(/scroll-margin-top:/g) || []).length, 1);
});

test('preview preparation shares the 60 second generation budget and discards late import results', () => {
  assert.match(studio, /60000 - \(performance\.now\(\) - startedAt\.current\)/);
  assert.match(studio, /timeoutMs: Math\.min\(10000, remainingMs\)/);
  assert.match(studio, /prepareShow\(entry, \{ signal: controller\.signal, timeoutMs: 10000 \}\)/);
  const imported = studio.indexOf("await import('../../../shared/aiDroneShow.js')");
  const guard = studio.indexOf('if (signal.aborted)', imported);
  const allocate = studio.indexOf('runtime: createAiDroneRuntime(score)', imported);
  assert.ok(imported < guard && guard < allocate);
});

test('failure and cancellation do not clear the last good preview or auto-retry generation', () => {
  assert.equal((studio.match(/client\.generate\(/g) ?? []).length, 1);
  assert.doesNotMatch(studio, /setCurrent\(null\)/);
  assert.match(studio, /flight\.current\?\.abort\(\)/);
  assert.match(studio, /回放不消耗生成额度/);
  assert.match(studio, /不保存模型密钥/);
});

test('studio is a dialog child, not a second modal or focus trap', () => {
  assert.doesNotMatch(studio, /role="dialog"|aria-modal|document\.addEventListener\('keydown'/);
  assert.match(studio, /onClick=\{onClose\}/);
});

test('quota can recover at Beijing midnight, on tab return and through a manual action without generating', () => {
  assert.match(studio, /usage\.resetAt - Date\.now\(\) \+ 100/);
  assert.match(studio, /\[usage\?\.resetAt\]/);
  assert.match(studio, /document\.addEventListener\('visibilitychange', refreshVisible\)/);
  assert.match(studio, /document\.removeEventListener\('visibilitychange', refreshVisible\)/);
  assert.match(studio, /document\.visibilityState === 'visible'/);
  assert.match(studio, /重新检查额度/);
  assert.match(studio, /onClick=\{\(\) => void refreshUsage\(true\)\}/);
  assert.match(studio, /return \(\) => clearTimeout\(timer\)/);
});

test('studio typography covers JSX classes, semantic tokens and mobile overrides', () => {
  const result = auditSources([
    { path: 'src/styles.css', content: baseCss },
    { path: 'src/components/drone/AiDroneStudio.jsx', content: studio },
    { path: 'src/components/drone/ai-drone-studio.css', content: css },
  ]);
  assert.deepEqual(result.issues, []);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /font-size: var\(--text-body, 1\.125rem\)/);
  assert.match(css, /font-size: var\(--text-control, 1rem\)/);
  assert.match(css, /font-size: var\(--text-meta, \.875rem\)/);
});
