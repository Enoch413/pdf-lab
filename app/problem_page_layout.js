/* Shared, measured question-page layout. Stored problems are never modified. */
(function (root) {
  "use strict";
  function build(settings, input, options, api) {
    const repeatHeaderEveryPage = options.repeatHeaderEveryPage ?? true;
    const columnWidthMm = (api.width - settings.pagePadding * 2 - api.binding - settings.columnGap) / 2;
    // Match the existing 296.8mm print sheet and reserve the screen border rounding.
    const innerHeight = api.height - 0.6 - settings.pagePadding * 2 - api.footer;
    // Header titles can wrap or exceed the nominal minimum. Measure the actual
    // header at the same width before reserving space for the question columns.
    const headerProbe = document.createElement("div");
    headerProbe.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;";
    headerProbe.innerHTML = api.sheet({ hasHeader: true, headerHeightMm: api.header, columnHeightMm: 1,
      questionLayout: true, columns: [{ items: [] }, { items: [] }] }, settings, 0, {});
    headerProbe.firstElementChild.style.setProperty("--preview-zoom", "1");
    document.body.append(headerProbe);
    const headerHeightMm = Math.max(api.header, headerProbe.querySelector(".sheet-header").getBoundingClientRect().height * 25.4 / 96);
    headerProbe.remove();
    const firstSheetColumnHeightMm = innerHeight - headerHeightMm;
    const continuationSheetColumnHeightMm = innerHeight;
    const createSheet = index => {
      const hasHeader = repeatHeaderEveryPage || index === 0;
      return { hasHeader, headerHeightMm: hasHeader ? headerHeightMm : 0,
        columnHeightMm: hasHeader ? firstSheetColumnHeightMm : continuationSheetColumnHeightMm,
        questionLayout: true, columns: [0, 1].map(() => ({ items: [], usedHeightMm: 0 })) };
    };
    const sheets = [createSheet(0)], splitGroups = [];
    let sheetIndex = 0, columnIndex = 0;
    const nextPage = () => { sheets.push(createSheet(sheets.length)); sheetIndex++; columnIndex = 0; };
    const nextColumn = () => { if (columnIndex === 0) columnIndex = 1; else nextPage(); };
    const canonical = root.PDFLabCanonical;
    const problems = canonical.prepareEntries(input.map(record => ({ record }))).map(e => e.record);
    const keyOf = p => canonical.groupKey(p) || canonical.sharedKey(p) ||
      (p.groupLabel ? JSON.stringify([p.sourceId || p.canonicalDocumentId || p.worksheetFamily || "", p.sourceName || "", p.groupLabel]) : "");
    const units = [];
    for (const problem of problems) {
      const key = keyOf(problem), last = units.at(-1);
      if (key && last?.key === key) last.problems.push(problem);
      else units.push({ key, problems: [problem] });
    }
    const measure = entry => root.PDFLabSolbookText.measureCard(api.render(entry), columnWidthMm);
    const entryFor = problem => {
      const entry = { problem, fitScale: 1, appliedSquashPercent: api.isText(problem) ? 0 : api.squash(problem) };
      entry.heightMm = measure(entry);
      if (!(entry.heightMm > 0)) throw new Error("문항 높이를 측정하지 못했습니다. 출력 준비 후 다시 시도해주세요.");
      return entry;
    };
    // Probe both columns before committing a group's placement. No card-count cap,
    // pair compression, or distributed whitespace participates in this calculation.
    function probe(entries, sheet, start, used = sheet.columns.map(c => c.usedHeightMm), counts = sheet.columns.map(c => c.items.length)) {
      let col = start;
      const placements = [];
      for (const entry of entries) {
        let gap = counts[col] ? settings.cardGap : 0;
        if (used[col] + gap + entry.heightMm > sheet.columnHeightMm) {
          if (++col > 1) return null;
          gap = counts[col] ? settings.cardGap : 0;
        }
        if (used[col] + gap + entry.heightMm > sheet.columnHeightMm) return null;
        placements.push(col); used[col] += gap + entry.heightMm; counts[col]++;
      }
      return placements;
    }
    function put(entry, col) {
      const column = sheets[sheetIndex].columns[col];
      column.usedHeightMm += (column.items.length ? settings.cardGap : 0) + entry.heightMm;
      column.items.push(entry); columnIndex = col;
    }
    function commit(entries, placements) { entries.forEach((entry, i) => put(entry, placements[i])); }
    function fragments(problem, height, firstHeight = height) {
      if (api.isText(problem)) return root.PDFLabSolbookText.paginateProblem(problem, {
        columnWidthMm, columnHeightMm: height, firstColumnHeightMm: firstHeight,
        renderCard: p => api.render({ problem: p, fitScale: 1, appliedSquashPercent: 0 })
      }).map(entryFor);
      const full = entryFor(problem);
      if (full.heightMm <= height) return [full];
      // Image-only long questions keep their width. Show consecutive vertical
      // windows of the original image stack, instead of shrinking or discarding it.
      const box = document.createElement("div"); box.innerHTML = api.render(full);
      const frame = box.querySelector(".problem-segments");
      if (!frame || !(problem.segmentImages || []).some(Boolean)) throw new Error("긴 이미지 문항의 원본 이미지를 확인해주세요.");
      const empty = entryFor({ ...problem, imageSlice: { offsetMm: 0, heightMm: 0 } });
      const bodyHeight = full.heightMm - empty.heightMm;
      const chunk = height - empty.heightMm - 1;
      if (chunk <= 5 || bodyHeight <= 0) throw new Error("이미지 문항을 나눌 출력 공간이 부족합니다.");
      const parts = [];
      for (let offset = 0; offset < bodyHeight; offset += chunk) {
        parts.push(entryFor({ ...problem, textContinuation: offset > 0,
          imageSlice: { offsetMm: offset, heightMm: Math.min(chunk, bodyHeight - offset) } }));
      }
      return parts;
    }
    function splitPlan(members, sheet, start) {
      const used = sheet.columns.map(c => c.usedHeightMm), counts = sheet.columns.map(c => c.items.length);
      const entries = [], placements = [];
      let col = start;
      for (const p of members) {
        const full = entryFor(p), height = sheet.columnHeightMm;
        let space = height - used[col] - (counts[col] ? settings.cardGap : 0);
        // Keep normal cards intact. Long text may start in the remaining space,
        // otherwise a group that fits across two columns could be falsely split.
        if (full.heightMm > space && (full.heightMm <= height || !api.isText(p) || space < 40)) {
          if (++col > 1) return null;
          space = height;
        }
        const parts = full.heightMm > height ? fragments(p, height, space) : [full];
        for (const entry of parts) {
          let gap = counts[col] ? settings.cardGap : 0;
          if (used[col] + gap + entry.heightMm > height) {
            if (++col > 1) return null;
            gap = 0;
          }
          if (entry.heightMm + gap + used[col] > height) return null;
          entries.push(entry);placements.push(col);used[col] += gap + entry.heightMm;counts[col]++;
        }
      }
      return { entries, placements };
    }
    for (const unit of units) {
      const raw = unit.problems.map(entryFor);
      const current = sheets[sheetIndex], fresh = createSheet(sheetIndex + 1);
      const currentPlan = probe(raw, current, columnIndex);
      if (currentPlan) { commit(raw, currentPlan); continue; }
      const freshPlan = probe(raw, fresh, 0);
      if (unit.key && freshPlan) { nextPage(); commit(raw, freshPlan); continue; }
      // A card may itself need both columns. Re-test a freshly split group as a
      // whole before allowing any part of it onto the current partially used page.
      const fragmentedPlan = unit.key && splitPlan(unit.problems, current, columnIndex);
      if (fragmentedPlan) { commit(fragmentedPlan.entries, fragmentedPlan.placements); continue; }
      const freshSplitPlan = unit.key && splitPlan(unit.problems, fresh, 0);
      if (freshSplitPlan) { nextPage(); commit(freshSplitPlan.entries, freshSplitPlan.placements); continue; }
      if (unit.key) {
        const freshParts = unit.problems.flatMap(p => fragments(p, fresh.columnHeightMm));
        splitGroups.push({ key: unit.key, reason: "빈 페이지 두 단의 실제 높이를 초과", heightsMm: freshParts.map(e => e.heightMm), columnHeightMm: fresh.columnHeightMm });
        // Long groups start on a fresh page; never leave just their passage behind
        // in leftover page space. Continuation cards retain question identity.
        if (current.columns.some(c => c.items.length)) nextPage();
      }
      for (const problem of unit.problems) {
        let entries = fragments(problem, sheets[sheetIndex].columnHeightMm);
        for (let i = 0; i < entries.length; i++) {
          let entry = entries[i];
          let column = sheets[sheetIndex].columns[columnIndex];
          if (column.usedHeightMm + (column.items.length ? settings.cardGap : 0) + entry.heightMm > sheets[sheetIndex].columnHeightMm) {
            nextColumn(); column = sheets[sheetIndex].columns[columnIndex];
          }
          if (entry.heightMm > sheets[sheetIndex].columnHeightMm) throw new Error("문항을 안전하게 페이지에 배치하지 못했습니다.");
          // A shared passage that fits with the first child on an empty page must
          // not be orphaned at the bottom of the previous page.
          if (problem.kind === "shared" && i === entries.length - 1) {
            const child = unit.problems[unit.problems.indexOf(problem) + 1];
            if (child && columnIndex === 1) {
              const firstChild = fragments(child, sheets[sheetIndex].columnHeightMm)[0];
              if (!probe([entry, firstChild], sheets[sheetIndex], columnIndex) &&
                  probe([entry, firstChild], createSheet(sheetIndex + 1), 0)) nextPage();
            }
          }
          const previousGroupPage = unit.key && sheets.slice(0, sheetIndex).some(s => s.columns.some(c => c.items.some(e => keyOf(e.problem) === unit.key)));
          if (previousGroupPage && !sheets[sheetIndex].columns.some(c => c.items.length)) {
            entry = entryFor({ ...entry.problem, groupContinuation: true });
          }
          put(entry, columnIndex);
        }
      }
    }
    // Alignment is a final pass, never a capacity constraint. Keep related shared
    // passage/child cards together rather than stretching their connecting gap.
    sheets.forEach(sheet => sheet.columns.forEach(column => {
      const items = column.items;
      column.alignEnds = items.length === 2 && items.every(e => e.problem.kind !== "shared") &&
        !(keyOf(items[0].problem) && keyOf(items[0].problem) === keyOf(items[1].problem)) &&
        items[0].problem.id !== items[1].problem.id;
    }));
    return { sheets, columnWidthMm, firstSheetColumnHeightMm, continuationSheetColumnHeightMm, repeatHeaderEveryPage, splitGroups };
  }
  root.PDFLabPageLayout = { build };
})(typeof window !== "undefined" ? window : globalThis);
