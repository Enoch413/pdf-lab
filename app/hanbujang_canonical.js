/* Canonical-16 boundary and presentation adapter. No persistence or network access. */
(function (root) {
  "use strict";
  const fields = ["number", "passageLabel", "questionGroupId", "groupOrder", "groupSize", "problemType", "tailSubType", "isSubjective", "questionText", "bodyText", "summaryText", "givenText", "choices", "answerText", "explanationText", "rawText"];
  const types = ["삽입", "순서", "요약", "선택어법", "선택어휘", "연결사", "밑줄어법", "밑줄어휘", "무관", "지칭", "빈칸", "함축의미", "내용", "제목", "주제", "요지", "주장", "목적", "심경", "기타", "꼬리"];
  const groupFields = ["questionGroupId", "groupOrder", "groupSize", "tailSubType"];
  const textFields = ["questionText", "givenText", "bodyText", "summaryText"];
  const clone = value => JSON.parse(JSON.stringify(value));
  const has = record => Boolean(record?.canonical);
  const candidate = items => items.some(item => item && groupFields.some(key => Object.hasOwn(item, key)));
  function fail(number, field, reason) { throw new Error(`한부장 JSON ${number ?? "파일"}번 · ${field}: ${reason}`); }
  function keys(value, expected, number, field) {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(number, field, "객체가 필요합니다.");
    const missing = expected.filter(key => !Object.hasOwn(value, key));
    const extra = Object.keys(value).filter(key => !expected.includes(key));
    if (missing.length || extra.length) fail(number, field, `누락 [${missing.join(", ")}] / 알 수 없는 필드 [${extra.join(", ")}].`);
  }
  function validateProblem(p, index) {
    const n = p?.number ?? index + 1;
    keys(p, fields, n, "16필드");
    for (const key of fields) {
      if (["number", "groupOrder", "groupSize"].includes(key)) {
        if (!Number.isSafeInteger(p[key]) || p[key] < (key === "groupOrder" ? 0 : 1)) fail(n, key, "범위에 맞는 정수가 필요합니다.");
      } else if (key === "isSubjective") {
        if (typeof p[key] !== "boolean") fail(n, key, "문자열이 아닌 boolean이어야 합니다.");
      } else if (key === "choices") {
        if (!Array.isArray(p[key])) fail(n, key, "배열이 필요합니다.");
        const markers = new Set();
        p.choices.forEach((choice, i) => {
          keys(choice, ["marker", "text"], n, `choices[${i}]`);
          if (typeof choice.marker !== "string" || typeof choice.text !== "string") fail(n, `choices[${i}]`, "marker/text는 문자열이어야 합니다.");
          if (!choice.marker.trim() || markers.has(choice.marker)) fail(n, `choices[${i}].marker`, "빈 marker 또는 중복 marker입니다.");
          markers.add(choice.marker);
        });
      } else if (typeof p[key] !== "string") fail(n, key, "null이 아닌 문자열이어야 합니다.");
    }
    if (!types.includes(p.problemType)) fail(n, "problemType", "canonical 21종에 없는 유형입니다.");
    if (p.problemType === "꼬리") {
      if (!p.questionGroupId.trim()) fail(n, "questionGroupId", "꼬리문항 그룹 ID가 필요합니다.");
      if (!types.slice(0, -1).includes(p.tailSubType)) fail(n, "tailSubType", "꼬리를 제외한 실제 유형이 필요합니다.");
    } else if (p.questionGroupId !== "" || p.groupOrder !== 0 || p.groupSize !== 1 || p.tailSubType !== "") {
      fail(n, "questionGroupId/groupOrder/groupSize/tailSubType", "독립문항은 빈 ID, 0, 1, 빈 하위유형이어야 합니다.");
    }
  }
  function validateGroups(items) {
    const groups = new Map();
    items.filter(p => p.questionGroupId).forEach(p => {
      if (!groups.has(p.questionGroupId)) groups.set(p.questionGroupId, []);
      groups.get(p.questionGroupId).push(p);
    });
    groups.forEach(members => {
      const orders = new Set(members.map(p => p.groupOrder));
      members.forEach(p => {
        if (p.groupSize !== members.length) fail(p.number, "groupSize", "실제 그룹 문항 수와 다릅니다.");
        if (orders.size !== members.length || p.groupOrder < 1 || p.groupOrder > members.length) fail(p.number, "groupOrder", "중복 없는 1..N 순서여야 합니다.");
        if (p.bodyText !== members[0].bodyText) fail(p.number, "bodyText", "같은 그룹의 공통 본문이 다릅니다.");
      });
    });
  }
  function validate(payload) {
    keys(payload, ["sourceName", "textbookName", "problems"], null, "최상위");
    for (const key of ["sourceName", "textbookName"]) if (typeof payload[key] !== "string") fail(null, key, "문자열이 필요합니다.");
    if (!Array.isArray(payload.problems) || !payload.problems.length) fail(null, "problems", "비어 있지 않은 배열이 필요합니다.");
    payload.problems.forEach(validateProblem);
    const numbers = new Set(payload.problems.map(p => p.number));
    payload.problems.forEach(p => {
      if (numbers.size !== payload.problems.length || p.number > payload.problems.length) fail(p.number, "number", "중복 없는 연속 번호 1..N이어야 합니다.");
    });
    validateGroups(payload.problems);
    return payload;
  }
  const effectiveType = record => record.canonical.problemType === "꼬리" ? record.canonical.tailSubType : record.canonical.problemType;
  // Stored sourceId is authoritative; unsaved/work snapshots use canonicalDocumentId.
  const documentId = record => record.sourceId || record.canonicalDocumentId;
  const groupKey = record => has(record) && record.canonical.questionGroupId
    ? JSON.stringify([documentId(record), record.canonical.questionGroupId]) : "";
  const passageKey = record => groupKey(record) || `${documentId(record)}::independent::${record.canonical.number}`;
  function sharedKey(record) {
    if (!record?.canonicalSharedFor) return "";
    const [originalDocument, group] = JSON.parse(record.canonicalSharedFor);
    return JSON.stringify([record.sourceId || originalDocument, group]);
  }
  function bindSource(record, source) {
    if (!has(record) && !record?.canonicalSharedFor) return record;
    const next = { ...record, sourceId: source.sourceId,
      librarySourceKey: source.librarySourceKey, librarySourceName: source.librarySourceName,
      worksheetFamily: source.textbookName };
    if (has(record)) next.canonicalDocumentId = source.sourceId;
    if (record.canonicalSharedFor) next.canonicalSharedFor = sharedKey(next);
    return next;
  }
  function structure(record) {
    const p = record.canonical;
    return { templateKey: "canonical-16", ...Object.fromEntries(textFields.map(key => [key, p[key]])), choices: clone(p.choices) };
  }
  function derive(record) {
    if (!has(record)) return record;
    const p = record.canonical;
    record.problemType = p.problemType === "꼬리" ? "꼬리문제" : p.problemType;
    record.subjectiveType = p.isSubjective ? "기타주관식" : "";
    record.selectableType = p.problemType === "꼬리" ? "꼬리문제" : (p.isSubjective ? "기타주관식" : p.problemType);
    record.isSubjective = p.isSubjective;
    record.groupLabel = p.questionGroupId;
    record.worksheetRef = p.passageLabel;
    record.textStructure = structure(record);
    record.promptText = record.analysisText = textFields.map(key => p[key]).filter(Boolean).join("\n\n");
    record.answerText = p.answerText;
    record.explanationText = p.explanationText;
    record.typeTags = [record.selectableType];
    return record;
  }
  function metadata(record) {
    return { ...(record?.canonicalSharedFor ? { canonicalSharedFor: sharedKey(record) } : {}),
      ...(has(record) ? { canonical: clone(record.canonical), canonicalDocumentId: documentId(record),
        canonicalSource: clone(record.canonicalSource), canonicalDisplay: record.canonicalDisplay || "" } : {}) };
  }
  function attach(problem, record) { return has(record) ? derive(Object.assign(problem, metadata(record))) : problem; }
  function create(p, payload, documentId, uploadFileName, base) {
    return derive({ ...base, canonical: clone(p), canonicalDocumentId: documentId,
      canonicalSource: { sourceName: payload.sourceName, textbookName: payload.textbookName, uploadFileName } });
  }
  function guardOverlay(payload, records, fileName) {
    const questions = records.filter(p => p.kind === "problem");
    const source = questions.find(has)?.canonicalSource?.sourceName ?? fileName;
    if (!payload.sourceName || source !== payload.sourceName || questions.length !== payload.problems.length) {
      fail(null, "overlay", "대상 문서/문항 수를 확정할 수 없습니다. 현재 작업을 저장한 뒤 초기화하여 새 JSON으로 가져오세요.");
    }
    const byNumber = new Map(questions.map(p => [p.number, p]));
    if (byNumber.size !== questions.length) fail(null, "overlay", "대상 문항 번호가 중복됩니다. 새 가져오기를 사용하세요.");
    payload.problems.forEach(p => {
      const target = byNumber.get(p.number);
      if (!target) fail(p.number, "overlay", "대응하는 PDF 문항이 없습니다. 새 가져오기를 사용하세요.");
      if (has(target) && (target.canonical.questionGroupId !== p.questionGroupId || target.canonical.groupOrder !== p.groupOrder)) fail(p.number, "overlay", "기존 canonical 그룹 대응이 다릅니다. 새 가져오기를 사용하세요.");
      if (!has(target) && Boolean(target.groupLabel) !== Boolean(p.questionGroupId)) fail(p.number, "overlay", "기존 PDF 그룹 대응이 불명확합니다. 새 가져오기를 사용하세요.");
      if (!has(target) && p.questionGroupId) {
        const members = payload.problems.filter(q => q.questionGroupId === p.questionGroupId);
        const targets = questions.filter(q => q.groupLabel === target.groupLabel);
        if (members.length !== targets.length || members.some(q => !targets.some(t => t.number === q.number))) fail(p.number, "overlay", "전체 그룹을 대응시킬 수 없습니다. 새 가져오기를 사용하세요.");
      }
    });
  }
  function editedRecords(records, target, updates) {
    const next = clone(target.canonical);
    Object.assign(next, clone(updates));
    validateProblem(next, 0);
    const key = groupKey(target);
    const changedBody = next.bodyText !== target.canonical.bodyText;
    const members = key ? records.filter(r => groupKey(r) === key) : [target];
    if (key) validateGroups(members.map(r => r.canonical));
    return members.filter(r => r === target || (changedBody && key)).map(record => {
      const canonical = record === target ? next : { ...clone(record.canonical), bodyText: next.bodyText };
      return derive({ ...record, canonical });
    });
  }
  function guardDelete(record) {
    if (groupKey(record)) throw new Error("공통지문 그룹 문항은 단독 삭제할 수 없습니다. 원본 JSON에서 그룹 전체를 제외한 뒤 같은 문서로 다시 등록하거나 교재 전체 삭제 기능을 사용하세요.");
  }
  // Only runtime copies get shared/child display flags; canonical body stays intact.
  function prepareEntries(entries) {
    const ordered = [], seen = new Set();
    const textGroupKeys = new Set(entries.filter(e => e.record.renderContentMode !== "image").map(e => groupKey(e.record)).filter(Boolean));
    for (const entry of entries) {
      if (entry.record.canonicalSharedFor && textGroupKeys.has(sharedKey(entry.record))) continue;
      if (entry.record.renderContentMode === "image") { ordered.push(entry); continue; }
      if (entry.record.canonicalDisplay) { ordered.push(entry); continue; }
      const key = groupKey(entry.record);
      if (!key) { ordered.push(entry); continue; }
      if (seen.has(key)) continue;
      seen.add(key);
      const members = entries.filter(e => groupKey(e.record) === key)
        .sort((a, b) => a.record.canonical.groupOrder - b.record.canonical.groupOrder);
      const first = members[0];
      const insertionMembers = members.filter(e => effectiveType(e.record) === "삽입");
      const insertionProblem = insertionMembers[0]?.record.canonical;
      if (insertionProblem) {
        const body = inlineProblem(insertionProblem).fields.bodyText;
        if (insertionMembers.some(e => inlineProblem(e.record.canonical).fields.bodyText !== body)) {
          fail(insertionProblem.number, "삽입 위치", "같은 공통지문의 문항별 위치 해석이 다릅니다. 출력 전 확인해주세요.");
        }
      }
      const reference = `공통지문 · ${first.record.canonical.passageLabel || first.record.canonical.questionGroupId} · ${first.record.canonical.questionGroupId}`;
      ordered.push({ ...first, record: { ...first.record, recordId: `${first.record.recordId || first.record.id}::canonical-shared`,
        kind: "shared", number: null, canonicalDisplay: "shared", canonicalGroupReference: reference,
        ...(insertionProblem ? { canonicalInsertionProblem: insertionProblem } : {}), textOnly: true, renderContentMode: "text" } });
      members.forEach(e => ordered.push({ ...e, record: { ...e.record, canonicalDisplay: "child", canonicalGroupReference: reference } }));
    }
    return ordered;
  }
  function textRuntime(record, examNumber) {
    return attach({ ...record, id: `exam-${record.recordId || record.id}`, number: examNumber, displayNumber: examNumber,
      originalNumber: record.canonical.number, segments: [], segmentImages: [], answerSegments: [], answerSegmentImages: [],
      renderContentMode: "text", contentMode: "text", manualSquashPercent: null }, record);
  }
  const escape = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  function inline(value, options = {}) {
    let html = "", cursor = 0, slots = 0;
    const warnings = [];
    // Quote ranges use the whole field so inline tokens cannot reset quote context.
    const quotes = options.position ? [...value.matchAll(/"(?:\\.|[^"\\])*"|“[^”]*”|‘[^’]*’|(?<![\p{L}\p{N}])'(?:\\.|[^'\\])*'(?![\p{L}\p{N}])/gu)] : [];
    const boxed = text => escape(text).replace(/\[([^\[\]\n]*\/[^\[\]\n]*)\]/g, '<strong class="choice-box">[$1]</strong>');
    const plain = (text, positions = true, offset = 0) => {
      if (text.includes("]]")) warnings.push("대응하는 여는 괄호가 없는 닫는 토큰");
      if (!positions || !options.position) return boxed(text);
      let markup = "", last = 0;
      for (const match of text.matchAll(/\(\s*([①-⑳])\s*\)|([①-⑳])/g)) {
        const at = offset + match.index, literal = match[0];
        if (quotes.some(q => at > q.index && at < q.index + q[0].length)) continue;
        markup += boxed(text.slice(last, match.index));
        // Bare labels must be at a sentence/line boundary, not an in-sentence reference.
        if (!match[1] && !/(?:^\s*|[.!?]["”'’]?\s*|[\r\n]\s*)$/.test(value.slice(0, at))) options.ambiguousPosition();
        markup += options.position(literal, match[1] || match[2]);
        last = match.index + literal.length;
      }
      return markup + boxed(text.slice(last));
    };
    while (cursor < value.length) {
      const start = value.indexOf("[[", cursor);
      if (start < 0) { html += plain(value.slice(cursor), true, cursor); break; }
      html += plain(value.slice(cursor, start), true, cursor);
      let depth = 0, end = -1;
      for (let i = start + 2; i < value.length; i++) {
        if (value[i] === "[") depth++;
        else if (value[i] === "]") {
          if (depth) depth--;
          else if (value[i + 1] === "]") { end = i; break; }
        }
      }
      if (end < 0) { html += escape(value.slice(start)); warnings.push("닫히지 않은 토큰"); break; }
      const token = value.slice(start + 2, end), original = value.slice(start, end + 2);
      let match;
      if (token.startsWith("u:") && token.length > 2 && !token.includes("[[")) html += `<u>${plain(token.slice(2), false)}</u>`;
      else if ((match = token.match(/^blank(?::([A-Za-z]))?$/))) html += match[1] ? `___(${match[1]})___` : "____________________";
      else if ((match = token.match(/^box:([^:\[\]]+):([^|\[\]]*)\|([^\[\]]*)$/))) html += `<strong class="choice-box">(${escape(match[1])}) [${escape(match[2])} / ${escape(match[3])}]</strong>`;
      else if (token === "s" || token === "slot") html += options.slot ? options.slot() : ["①", "②", "③", "④", "⑤"][slots++] || `(${slots})`;
      else { html += escape(original); warnings.push(`미지원 토큰 ${original}`); }
      cursor = end + 2;
    }
    return { html, warnings };
  }
  function inlineProblem(p) {
    const insertion = (p.problemType === "꼬리" ? p.tailSubType : p.problemType) === "삽입";
    const positions = [], warningList = [];
    const markers = Array.from("①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳");
    const position = (literal, marker, anonymous = false) => {
      if (!marker) fail(p.number, "삽입 위치", "20개를 넘는 위치는 출력 전에 확인해주세요.");
      positions.push({ marker, anonymous });
      return `<span data-insertion-position="${marker}">${literal}</span>`;
    };
    const renderText = (text, body = false) => {
      const result = inline(text, insertion ? {
        slot: () => position(markers[positions.length], markers[positions.length], true),
        // Only passage labels are positions. Question/choice labels remain references.
        ...(body ? { position, ambiguousPosition: () => fail(p.number, "삽입 위치", "괄호 없는 번호가 문장/줄 경계의 위치인지 불명확합니다. 원문을 확인해주세요.") } : {})
      } : {});
      warningList.push(...result.warnings);
      return result.html;
    };
    const renderedFields = Object.fromEntries(textFields.map(key => [key, renderText(p[key], key === "bodyText")]));
    const choices = p.choices.map(c => renderText(c.text));
    if (insertion) {
      const labels = positions.map(e => e.marker);
      if (new Set(labels).size !== labels.length) fail(p.number, "삽입 위치", "명시적 위치 또는 토큰 위치 번호가 중복됩니다. 원문과 정답을 확인해주세요.");
      if (positions.some(e => e.anonymous) && positions.some((e, i) => !e.anonymous && e.marker !== markers[i])) {
        fail(p.number, "삽입 위치", "명시적 위치와 익명 토큰의 순서 대응이 불명확합니다. 자동 재번호하지 않습니다.");
      }
      const answer = p.answerText.trim();
      if (answer) {
        const parts = answer.split(/[\s,，/;]+/).filter(Boolean);
        const answers = parts.map(a => markers.includes(a) ? a : /^\d+$/.test(a) ? markers[Number(a) - 1] : null);
        if (answers.some(a => !a || !labels.includes(a))) fail(p.number, "answerText/삽입 위치", "정답이 가리키는 유일한 삽입 위치를 확인할 수 없습니다.");
      }
    }
    return { fields: renderedFields, choices, positions, warnings: warningList };
  }
  function warnings(p) {
    return [...textFields.map(key => p[key]), ...p.choices.map(c => c.text)]
      .flatMap(text => inline(text).warnings).map(message => `${p.number}번: ${message}`);
  }
  function render(record) {
    const p = record.canonical;
    const shared = record.canonicalDisplay === "shared", child = record.canonicalDisplay === "child";
    const rendered = inlineProblem(shared && record.canonicalInsertionProblem ? record.canonicalInsertionProblem : p);
    const field = (key, className) => p[key] === "" ? "" : `<p class="${className}" data-canonical-field="${key}">${rendered.fields[key]}</p>`;
    const reference = record.canonicalGroupReference || (p.questionGroupId ? `공통지문 · ${p.passageLabel} · ${p.questionGroupId}` : "");
    const heading = reference ? `<p class="canonical-group-reference">${escape(reference)}${shared ? "" : ` · ${escape(effectiveType(record))}`}</p>` : "";
    const choiceMarkup = !shared && p.choices.length ? '<ol class="solbook-choices">' + p.choices.map((c, i) =>
      `<li><span class="solbook-choice-marker">${escape(c.marker)}</span><span class="solbook-choice-text">${rendered.choices[i]}</span></li>`).join("") + '</ol>' : "";
    const warningList = rendered.warnings.map(message => `${p.number}번: ${message}`);
    return `<div class="solbook-text-question is-canonical" data-canonical-number="${p.number}" data-canonical-display="${record.canonicalDisplay || "full"}">${heading}${shared ? field("bodyText", "solbook-body") :
      field("questionText", "solbook-stem") + field("givenText", "solbook-body canonical-given") + (child ? "" : field("bodyText", "solbook-body")) + field("summaryText", "solbook-body canonical-summary") + choiceMarkup}${warningList.length ? `<p class="canonical-token-warning">표기 확인: ${escape([...new Set(warningList)].join("; "))}</p>` : ""}</div>`;
  }
  root.PDFLabCanonical = { fields, types, textFields, clone, has, candidate, validate, validateProblem, validateGroups,
    effectiveType, documentId, groupKey, passageKey, sharedKey, bindSource, structure, derive, metadata, attach, create, guardOverlay, editedRecords, guardDelete, prepareEntries, textRuntime, inline, inlineProblem, warnings, render };
})(typeof window !== "undefined" ? window : globalThis);
