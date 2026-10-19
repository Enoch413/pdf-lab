(function () {
  'use strict';
  const header = document.querySelector('[data-workspace-shell]');
  if (!header) return;
  const base = new URL(document.body.dataset.labRoot || './', location.href);
  let page = document.body.dataset.labPage;
  if (page === 'exam' && new URL(location.href).searchParams.get('workspace') === 'library') page = 'library';
  document.body.dataset.uiPage = page;
  document.body.classList.add('pdflab-workspace');

  const pages = [
    ['exam', '반별 출제', 'app/index.html?workspace=exam'],
    ['final', '파이널테스트', 'app/final_test.html'],
    ['library', '문제 라이브러리', 'app/index.html?workspace=library'],
    ['general', '일반 출제', 'app/general_exam.html?workspace=exam'],
    ['solbook', '쏠북메이커', 'dist/solbook_question_maker_portable/app/solbook_question_maker.html']
  ];
  const logo = document.createElement('a');
  logo.className = 'app-topbar-title';
  logo.href = base.href;
  logo.textContent = 'PDF LAB';
  logo.setAttribute('aria-label', 'PDF LAB 시작 화면');
  const nav = document.createElement('nav');
  nav.className = 'app-topbar-actions';
  nav.setAttribute('aria-label', '작업 화면 이동');
  let currentLink;
  for (const [key, label, path] of pages) {
    const link = document.createElement('a');
    link.className = 'app-topbar-link' + (key === page ? ' is-active' : '');
    link.href = new URL(path, base).href;
    link.textContent = label;
    if (key === page) {
      link.setAttribute('aria-current', 'page');
      currentLink = link;
    }
    if ((key === 'exam' && page !== 'general') || (key === 'general' && page === 'general')) link.id = 'openExamWorkspaceLink';
    if (key === 'final') link.id = 'openFinalTestWorkspaceLink';
    if (key === 'library') link.id = 'openLibraryWorkspaceLink';
    nav.append(link);
  }
  header.replaceChildren(logo, nav);
  currentLink?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  const heading = document.createElement('div');
  heading.className = 'workspace-heading';
  const title = document.createElement('h1');
  title.id = 'workspace-main';
  title.tabIndex = -1;
  title.textContent = pages.find(row => row[0] === page)?.[1] || '시험지 만들기';
  const status = document.createElement('div');
  status.className = 'workspace-status-slot';
  status.textContent = page === 'solbook' ? 'JSON을 불러오고, 문항을 골라 PDF·ZIP으로 저장하세요.'
    : page === 'home' ? '원하는 작업을 선택해 시작하세요.' : '작업 화면을 준비하고 있습니다…';
  heading.append(title, status);
  header.after(heading);
  const skip = document.createElement('a');
  skip.className = 'workspace-skip-link';
  skip.href = '#workspace-main';
  skip.textContent = '본문으로 이동';
  header.before(skip);
})();
