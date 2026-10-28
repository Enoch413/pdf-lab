(function (root) {
  'use strict';
  // Only wrap reads: a late response must not apply state after its caller has timed out.
  function readWithTimeout(promise, label, timeoutMs = 15000) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = root.setTimeout(() => reject(new Error(`${label} 응답이 지연되고 있습니다. 연결을 확인한 뒤 다시 불러와 주세요.`)), timeoutMs);
      })
    ]).finally(() => root.clearTimeout(timer));
  }

  function prepareStartup() {
    const panels = [...document.querySelectorAll('.tab-panel')];
    const library = document.body.dataset.uiPage === 'library';
    for (const panel of panels) {
      const active = panel.id === (library ? 'repackTabPanel' : 'examBuilderTabPanel');
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
      panel.inert = true;
      panel.setAttribute('aria-busy', 'true');
    }
    const bar = document.getElementById('statusBar');
    const copy = document.getElementById('statusCopy');
    const pill = document.getElementById('statsPill');
    bar.classList.add('workspace-status');
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-atomic', 'true');
    document.querySelector('.workspace-status-slot').replaceChildren(bar);
    const retry = document.createElement('button');
    retry.id = 'startupRetryButton';
    retry.type = 'button';
    retry.className = 'ghost-button';
    retry.textContent = '다시 불러오기';
    retry.hidden = true;
    retry.addEventListener('click', () => root.location.reload());
    bar.append(retry);
    let timer;
    function show(message, tone, badge) {
      copy.textContent = message;
      bar.dataset.tone = tone;
      pill.textContent = badge;
    }
    function stage(label) {
      root.clearTimeout(timer);
      retry.hidden = true;
      show(label, 'working', '불러오는 중');
      timer = root.setTimeout(() => {
        show(`${label} 지연되고 있습니다. 연결을 확인하고, 다른 PDF LAB 탭을 닫은 뒤 다시 불러와 주세요.`, 'error', '연결 확인');
        retry.hidden = false;
      }, 15000);
    }
    stage('화면 기능을 불러오고 있습니다.');
    return {
      fail(error) {
        root.clearTimeout(timer);
        document.body.dataset.dataReady = 'error';
        show(error?.message || '화면을 초기화하지 못했습니다. 다시 불러와 주세요.', 'error', '불러오기 실패');
        retry.hidden = false;
      },
      async run(load, { setBusy, onLoaded, readyMessage }) {
        document.body.dataset.dataReady = 'loading';
        setBusy(true);
        try {
          const warning = await load(stage);
          onLoaded();
          document.body.dataset.dataReady = 'true';
          for (const panel of panels) panel.inert = false;
          show(warning || readyMessage, warning ? 'error' : 'idle', warning ? '일부 조회 실패' : '준비됨');
          retry.hidden = !warning;
        } catch (error) {
          console.error('Workspace data initialization failed', error);
          this.fail(error);
        } finally {
          root.clearTimeout(timer);
          panels.forEach(panel => panel.setAttribute('aria-busy', 'false'));
          setBusy(false);
        }
      }
    };
  }
  function install({ signature, editorDirty, dialogs }) {
    let baseline = signature();
    let leaving = false;
    const dirty = () => editorDirty() || Object.entries(signature()).some(([scope, value]) => Boolean(value) && value !== baseline[scope]);
    const confirmDiscard = () => !dirty() || root.confirm('저장하지 않은 작업이 있습니다. 저장하지 않고 계속할까요?');
    document.addEventListener('click', event => {
      if (event.target.closest?.('#clearSchoolDraftButton') && !confirmDiscard()) {
        event.preventDefault(); event.stopImmediatePropagation(); return;
      }
      const link = event.target.closest?.('a[href]');
      if (!link || link.hasAttribute('download') || link.target === '_blank' || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
      if (!confirmDiscard()) { event.preventDefault(); event.stopImmediatePropagation(); }
      else { leaving = true; root.setTimeout(() => { leaving = false; }, 0); }
    }, true);
    root.addEventListener('beforeunload', event => {
      if (!leaving && dirty()) { event.preventDefault(); event.returnValue = ''; }
    });
    const focusable = dialog => [...dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')]
      .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
    for (const { element, close } of dialogs.filter(row => row.element)) {
      element.setAttribute('role', 'dialog');
      element.setAttribute('aria-modal', 'true');
      const heading = element.querySelector('h2[id],h3[id]');
      if (heading) element.setAttribute('aria-labelledby', heading.id);
      element.tabIndex = -1;
      let open = false, returnFocus = null;
      const focusFirst = () => (focusable(element)[0] || element).focus();
      new MutationObserver(() => {
        const visible = !element.hidden;
        if (visible === open) return;
        open = visible;
        if (open) { returnFocus = document.activeElement; focusFirst(); }
        else if (returnFocus?.isConnected) returnFocus.focus();
      }).observe(element, { attributes: true, attributeFilter: ['hidden'] });
      document.addEventListener('focusin', event => {
        if (open && !element.contains(event.target)) focusFirst();
      });
      element.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key !== 'Tab') return;
        const nodes = focusable(element);
        if (!nodes.length) { event.preventDefault(); element.focus(); return; }
        if (event.shiftKey && document.activeElement === nodes[0]) {
          event.preventDefault(); nodes.at(-1).focus();
        } else if (!event.shiftKey && document.activeElement === nodes.at(-1)) {
          event.preventDefault(); nodes[0].focus();
        }
      });
    }
    return { confirmDiscard, dirty, markSaved(scope) { baseline = scope ? { ...baseline, [scope]: signature()[scope] } : signature(); } };
  }
  root.PDFLabWorkspaceUI = { install, readWithTimeout, prepareStartup };
})(typeof window !== 'undefined' ? window : globalThis);
