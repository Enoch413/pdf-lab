(function (root) {
  'use strict';
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
      if (!link || link.target === '_blank' || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
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
  root.PDFLabWorkspaceUI = { install };
})(window);
