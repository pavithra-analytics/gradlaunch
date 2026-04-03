const { JSDOM } = require('jsdom');
const fs = require('fs');

const html = fs.readFileSync('/home/user/gradlaunch/index.html', 'utf8');
const dom  = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable' });
const { document, window } = dom.window;

let pass=0, fail=0, warns=[];

function check(name, actual, expected, note='') {
  const ok = expected === undefined ? !!actual : actual === expected;
  console.log((ok?'✓':'✗'), name, ok?'':'→ got: '+actual+(note?' ('+note+')':''));
  ok ? pass++ : fail++;
  if (!ok) warns.push(name);
}
function checkExists(name, selector) {
  check(name, !!document.querySelector(selector));
}

// ── 1. Page structure ──
checkExists('pg-input exists',     '#pg-input');
checkExists('pg-loading exists',   '#pg-loading');
checkExists('pg-results exists',   '#pg-results');
check('pg-input active',   document.querySelector('#pg-input').classList.contains('active'), true);
check('pg-results NOT active', document.querySelector('#pg-results').classList.contains('active'), false);

// ── 2. Input page elements ──
checkExists('hero h1',             '.hero h1');
checkExists('hero-sub',            '.hero-sub');
checkExists('upload zone',         '#dz-empty');
checkExists('file-input',          '#file-input');
checkExists('target-role',         '#target-role');
checkExists('target-location',     '#target-location');
checkExists('jd-paste',            '#jd-paste');
checkExists('launch-btn',          '#launch-btn');
checkExists('insights-grid-full',  '.insights-grid-full');
checkExists('insight-cards (4)',   '.insight-card-v2');

// ── 3. Launch button state ──
check('launch-btn disabled initially', document.querySelector('#launch-btn').disabled, true);

// ── 4. JD section open by default ──
check('JD body open by default', document.querySelector('#jd-body').classList.contains('open'), true);

// ── 5. Insight card count ──
const insightCards = document.querySelectorAll('.insight-card-v2');
check('4 insight cards', insightCards.length, 4);

// ── 6. Results page structure ──
checkExists('sidebar',             '.sidebar');
checkExists('tab-bar',             '.tab-bar');
checkExists('tab-profile',         '#tab-profile');
checkExists('tab-score',           '#tab-score');
checkExists('tab-project',         '#tab-project');
checkExists('tab-finalize',        '#tab-finalize');
checkExists('results-main',        '.results-main');

// ── 7. Tab defaults ──
check('profile tab on by default', document.querySelector('#tab-profile').classList.contains('on'), true);
check('score tab off by default',  document.querySelector('#tab-score').classList.contains('on'),    false);
check('project tab off by default',document.querySelector('#tab-project').classList.contains('on'),  false);
check('finalize tab off by default',document.querySelector('#tab-finalize').classList.contains('on'),false);

// ── 8. Sidebar nav buttons ──
const sidebarBtns = document.querySelectorAll('.sidebar-btn');
check('sidebar has 4 buttons', sidebarBtns.length >= 4, true);
check('first sidebar btn is active', document.querySelector('#s-profile').classList.contains('on'), true);

// ── 9. Mobile tab bar ──
const tabBtns = document.querySelectorAll('.tab-btn');
check('tab-bar has 4 buttons', tabBtns.length, 4);

// ── 10. Skeleton loaders present in tabs ──
const skeletons = document.querySelectorAll('.skeleton');
check('skeleton loaders present (≥5)', skeletons.length >= 5, true, 'count='+skeletons.length);

// ── 11. Skeleton loaders in each tab ──
const profileSk = document.querySelectorAll('#tab-profile .skeleton');
const scoreSk   = document.querySelectorAll('#tab-score .skeleton');
const projSk    = document.querySelectorAll('#tab-project .skeleton');
const finSk     = document.querySelectorAll('#tab-finalize .skeleton');
check('profile tab has skeletons',  profileSk.length > 0, true, 'count='+profileSk.length);
check('score tab has skeletons',    scoreSk.length > 0,   true, 'count='+scoreSk.length);
check('project tab has skeletons',  projSk.length > 0,    true, 'count='+projSk.length);
check('finalize tab has skeletons', finSk.length > 0,     true, 'count='+finSk.length);

// ── 12. CSS custom properties present ──
const styleTag = document.querySelector('style');
const css = styleTag ? styleTag.textContent : '';
check('--sp-6 token defined',   css.includes('--sp-6:'),   true);
check('--r-md token defined',   css.includes('--r-md:'),   true);
check('--el-1 token defined',   css.includes('--el-1:'),   true);
check('tab-appear keyframe',    css.includes('@keyframes tab-appear'), true);
check('tab-panel.on animation', css.includes('.tab-panel.on') && css.includes('tab-appear'), true);

// ── 13. Typography weight rules ──
check('font-weight:700 rules present', css.includes('font-weight:700'), true);
check('font-weight:500 rules present', css.includes('font-weight:500'), true);
// Ensure no 800 or 900 weights IN the Prompt 10 block
const p10start = css.indexOf('PROMPT 10');
const p10block = p10start > -1 ? css.slice(p10start) : '';
check('Prompt10 block has no weight:800', !p10block.includes('font-weight:800'), true);
check('Prompt10 block has no weight:900', !p10block.includes('font-weight:900'), true);

// ── 14. Dark mode classes ──
check('dark mode CSS .dark block',  css.includes('.dark{'), true);
check('dark elevation overrides',   css.includes('--el-1:0 1px 3px rgba(0,0,0'), true);

// ── 15. Loading page ──
checkExists('loading title',        '#loading-title');
checkExists('loading steps (5)',    '.lstep');
const lsteps = document.querySelectorAll('.lstep');
check('5 loading steps', lsteps.length, 5);
checkExists('progress-bar',         '.progress-bar');
checkExists('progress-fill',        '#progress-fill');

// ── 16. Finalize tab ──
checkExists('finalize-hero',        '.finalize-hero');
checkExists('finalize metrics',     '#finalize-metrics');
checkExists('cover letter section', '.cl-section');
checkExists('cl-generate-btn',      '#cl-generate-btn');
checkExists('cl-output (hidden)',   '#cl-output');

// ── 17. Dialog ──
checkExists('dlg-overlay',          '.dlg-overlay');
checkExists('dialog header',        '.dlg-hdr');
checkExists('dialog body',          '#dlg-body');

// ── 18. CTA hierarchy classes ──
check('cta-btn present',            !!document.querySelector('.cta-btn'), true);
check('copy-btn class present',     !!document.querySelector('.copy-btn') || css.includes('.copy-btn{'), true);
check('copy-btn-sm class present',  css.includes('.copy-btn-sm'), true);

// ── 19. Hero headline text ──
const h1Text = document.querySelector('.hero h1').textContent;
check('hero h1 not empty', h1Text.trim().length > 0, true, h1Text.trim());

// ── 20. Nav elements ──
checkExists('nav logo',             '.logo');
checkExists('nav dark-btn',         '#dark-btn');
checkExists('nav back-btn',         '#back-btn');
check('back-btn hidden by default', document.querySelector('#back-btn').style.display, 'none');

// ── 21. Feedback section ──
checkExists('feedback section',     '.feedback-section');
checkExists('feedback textarea',    '#feedback-ta');
checkExists('feedback-btn',         '.feedback-btn');

// ── Summary ──
console.log('\n─────────────────────────────');
console.log(`PASS: ${pass}  FAIL: ${fail}  TOTAL: ${pass+fail}`);
if (warns.length) {
  console.log('\nFAILED CHECKS:');
  warns.forEach(w => console.log('  ✗', w));
}
