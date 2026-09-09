// Run with PDFLAB_NODE_MODULES pointing to a directory containing playwright.
// Isolated browser: all external requests are blocked; Firebase sign-in is mocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PDFLAB_NODE_MODULES
  ? path.join(process.env.PDFLAB_NODE_MODULES, 'playwright') : 'playwright');
const root = path.resolve(__dirname, '..');
const origin = 'http://pdflab-test.local';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      const target = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      if (url.origin !== origin || !target.startsWith(path.join(root, 'app') + path.sep)) {
        return route.abort();
      }
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        return route.fulfill({ status: 404, body: '' });
      }
      return route.fulfill({ body: fs.readFileSync(target), contentType: mime[path.extname(target)] || 'application/octet-stream' });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/app/index.html?workspace=exam');
    await page.waitForFunction(() => document.body.dataset.appReady === 'true');
    await page.evaluate(() => {
      window.firebase = { auth: { Auth: { Persistence: { LOCAL: 'local' } } } };
      ensurePdfLabFirebaseServices = () => true;
      syncSchoolCatalogFromFirebase = async () => true;
      refreshLibrarySummary = async () => {};
      window.loginTest = { attempts: 0, persistence: '' };
      state.firebaseSchoolBridge.auth = {
        currentUser: null,
        setPersistence: async value => { loginTest.persistence = value; },
        signInWithEmailAndPassword: async (email, password) => {
          loginTest.attempts++;
          if (email !== 'qa-admin@prep.local' || password !== 'test-only-password') {
            throw new Error('Unexpected test credentials');
          }
          return new Promise((resolve, reject) => {
            loginTest.complete = success => success
              ? resolve({ user: { uid: 'test-only-user', email } })
              : reject({ code: 'auth/invalid-credential' });
          });
        }
      };
      renderPdfLabFirebaseAuthUi();
    });
    const email = page.getByLabel('이메일', { exact: true });
    const password = page.getByLabel('비밀번호', { exact: true });
    const button = page.getByRole('button', { name: '이메일로 로그인', exact: true });
    assert.equal(await email.isVisible(), true);
    assert.equal(await password.getAttribute('type'), 'password');
    assert.equal(await password.getAttribute('autocomplete'), 'current-password');
    assert.equal(await page.getByRole('button', { name: 'Google로 로그인' }).isVisible(), true);

    await button.click();
    await page.waitForFunction(() => !state.isBusy && elements.statusCopy.textContent.includes('이메일과 비밀번호를 입력'));
    assert.equal(await page.evaluate(() => loginTest.attempts), 0);

    for (const [index, action] of ['click', 'enter', 'submit'].entries()) {
      await email.fill('qa-admin@prep.local');
      await password.fill('test-only-password');
      if (action === 'click') await button.click();
      if (action === 'enter') await password.press('Enter');
      if (action === 'submit') await page.locator('#firebaseLoginForm').evaluate(form => form.requestSubmit());
      await page.waitForFunction(attempts => loginTest.attempts === attempts && typeof loginTest.complete === 'function', index + 1);
      assert.equal(await button.isDisabled(), true);
      assert.equal(await email.isDisabled(), true);
      assert.equal(await password.isDisabled(), true);
      const success = action !== 'click';
      await page.evaluate(success => { loginTest.complete(success); delete loginTest.complete; }, success);
      await page.waitForFunction(() => !state.isBusy);
      if (success) {
        assert.equal(await page.locator('#firebaseLoginForm').isHidden(), true);
        assert.equal(await password.inputValue(), '');
        assert.equal(await page.locator('#firebaseLogoutButton').isVisible(), true);
        assert.match(await page.locator('#firebaseAuthStatus').textContent(), /qa-admin@prep\.local/);
      } else {
        assert.equal(await button.isEnabled(), true);
        assert.match(await page.locator('#firebaseAuthStatus').textContent(), /이메일 또는 비밀번호를 확인/);
      }
      await page.evaluate(() => {
        state.firebaseSchoolBridge.currentUser = null;
        state.firebaseSchoolBridge.syncError = '';
        renderPdfLabFirebaseAuthUi();
      });
    }
    assert.equal(await page.evaluate(() => loginTest.persistence), 'local');
    assert.equal(await page.evaluate(() => loginTest.attempts), 3, 'One sign-in per interaction');
    await email.fill('');
    await password.fill('');
    const out = path.join(root, 'tmp', 'firebase-email-login-qa');
    fs.mkdirSync(out, { recursive: true });
    await page.locator('#firebaseAuthPanel').screenshot({ path: path.join(out, 'login-panel.png') });
    await page.evaluate(() => { window.firebase = undefined; renderPdfLabFirebaseAuthUi(); });
    assert.equal(await page.locator('#firebaseLoginForm').isHidden(), true);
    assert.deepEqual(errors, [], 'No browser runtime errors');
    console.log('PASS: email login UI, empty input, click/Enter/submit, busy state, error/success, password clearing, local persistence, Google button, unconfigured state. No live Firebase calls.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
