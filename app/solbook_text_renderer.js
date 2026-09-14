/* PDF LAB text-only experiment. Normalizers are copied from the portable
 * Solbook maker at baseline 8855d72; the source maker is intentionally unchanged.
 * This presentation adapter never writes question data or Firebase state.
 */
(function (root) {
  "use strict";
  const CHOICE_MARKERS = ["①", "②", "③", "④", "⑤", "⑥", "⑦"];
  const SLOT_MARKERS = CHOICE_MARKERS.slice(0, 5);
  const ORDER_CHOICE_SEPARATOR = "\u00a0-\u00a0";
    const TYPE_LABELS = {
      topic: "주제",
      title: "제목",
      implication: "함축의미",
      blank: "빈칸",
      summary: "요약",
      vocab_underline: "밑줄어휘",
      vocab_box: "어휘박스",
      factual: "내용일치",
      unfactual: "내용불일치",
      gist: "요지",
      claim: "주장",
      grammar_underline: "밑줄어법",
      grammar_box: "어법박스",
      order: "순서",
      insertion: "삽입",
      irrelevant: "무관문"
    };
    function compactTypeLabel(value) {
      return String(value || "").replace(/\s+/g, "").trim().toLowerCase();
    }

    function normalizeQuestionType(type) {
      const raw = String(type || "").trim();
      if (!raw) {
        return "";
      }
      if (TYPE_LABELS[raw]) {
        return raw;
      }
      const compactRaw = compactTypeLabel(raw);
      const aliases = {
        주장: "claim",
        요지: "gist",
        주제: "topic",
        제목: "title",
        함축: "implication",
        함축의미: "implication",
        내용일치: "factual",
        내용불일치: "unfactual",
        선택어법: "grammar_box",
        어법박스: "grammar_box",
        선택어휘: "vocab_box",
        어휘박스: "vocab_box",
        밑줄어법: "grammar_underline",
        밑줄어휘: "vocab_underline",
        빈칸: "blank",
        무관: "irrelevant",
        무관문: "irrelevant",
        순서: "order",
        삽입: "insertion",
        요약: "summary"
      };
      if (aliases[compactRaw]) {
        return aliases[compactRaw];
      }
      const matched = Object.entries(TYPE_LABELS)
        .find(([, label]) => compactTypeLabel(label) === compactRaw);
      return matched ? matched[0] : raw;
    }

    function isQuestionType(type, expected) {
      return normalizeQuestionType(type) === expected;
    }

    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function escapeRegExp(value) {
      return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function cleanBoxChoiceText(value) {
      return String(value || "")
        .replace(/&(?:amp;)?nbsp;|&(?:amp;)?#160;/gi, " ")
        .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function removeSpaceBeforeClosingBracket(value) {
      return String(value || "")
        .replace(/(?:&(?:amp;)?nbsp;|&(?:amp;)?#160;|[\s\u00A0\u2000-\u200B\u202F\u205F\u3000])+(?=\])/g, "");
    }

    function normalizeBracketChoiceSpacing(value) {
      return removeSpaceBeforeClosingBracket(value)
        .replace(/\[([^\[\]]*?\/[^\[\]]*?)\]/g, (_, content) => {
          const parts = content.split("/").map(cleanBoxChoiceText).filter(Boolean);
          if (parts.length < 2) {
            return removeSpaceBeforeClosingBracket(`[${content}]`);
          }
          return `[${parts[0]} / ${parts.slice(1).join(" / ")}]`;
        })
        .replace(/(?:&(?:amp;)?nbsp;|&(?:amp;)?#160;|[\s\u00A0\u2000-\u200B\u202F\u205F\u3000])+(?=\])/g, "");
    }

    function renderPlainBracketChoiceBox(content) {
      const parts = String(content || "").split("/").map(cleanBoxChoiceText).filter(Boolean);
      if (parts.length < 2) {
        return `[${removeSpaceBeforeClosingBracket(content)}]`;
      }
      return `<strong class="choice-box">[${parts[0]} / ${parts.slice(1).join(" / ")}]</strong>`;
    }

    function cleanUnderlineTargetText(value) {
      return String(value || "")
        .replace(/^[\s\u00A0\u2000-\u200B\u202F\u205F\u3000]*[①②③④⑤⑥⑦]\s*/u, "")
        .replace(/^[\s\u00A0\u2000-\u200B\u202F\u205F\u3000]*(?:\(?[1-7]\)?[.)．、:]?)\s*/u, "")
        .trim();
    }

    function normalizeSolbookSectionText(value, type = "") {
      const normalizedType = normalizeQuestionType(type);
      let text = String(value || "").replace(/\r\n?/g, "\n");
      const hadInsertionHeader = normalizedType === "insertion" && /\[\s*삽입문\s*\]/.test(text);
      const headerLabelsByType = {
        summary: ["본문", "요약문"],
        order: ["주어진 글", "보기"],
        insertion: ["삽입문", "주어진 글", "주어진 문장", "보기", "본문"]
      };
      const labels = headerLabelsByType[normalizedType] || [];
      if (normalizedType === "insertion") {
        text = text.replace(/\[\s*삽입문\s*\]\s*/g, "\n\n");
      }
      labels.forEach((label) => {
        text = text.replace(new RegExp(`(^|\\n)\\s*\\[${escapeRegExp(label)}\\]\\s*(?=\\n|$)`, "g"), "\n\n");
      });
      if (hadInsertionHeader) {
        const lines = text
          .replace(/\n{3,}/g, "\n\n")
          .trim()
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        if (lines.length >= 2) {
          return [lines[0], lines.slice(1).join("\n")].join("\n\n");
        }
      }
      return text.replace(/\n{3,}/g, "\n\n").trim();
    }

    function normalizeSolbookMarkers(value, type = "") {
      const normalizedType = normalizeQuestionType(type);
      let slotIndex = 0;
      let text = normalizeSolbookSectionText(value, type)
        .replace(/\[\[blank(?::([A-Za-z]))?\]\]/g, (_, label) => label ? `___(${label})___` : "____________________")
        .replace(/\[\[box:([^:\]]+):([^|\]]*)\|([^\]]*)\]\]/g, (_, label, left, right) => `[[boxout:${cleanBoxChoiceText(label)}:${cleanBoxChoiceText(left)}|${cleanBoxChoiceText(right)}]]`)
        .replace(/\[\[(?:s|slot)\]\]/g, () => {
          const marker = SLOT_MARKERS[slotIndex] || `(${slotIndex + 1})`;
          slotIndex += 1;
          return marker;
        });
      text = normalizeBracketChoiceSpacing(text);
      if (normalizedType === "order") {
        text = text
          .replace(/(\([A-C]\))\s*\n+\s*/g, "$1 ")
          .replace(/\s*(\([A-C]\)\s*)/g, "\n\n$1")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      }
      return removeSpaceBeforeClosingBracket(text);
    }

    function shouldNumberUnderlineMarkers(type = "") {
      return ["vocab_underline", "grammar_underline"].includes(normalizeQuestionType(type));
    }

    function renderInlineText(value, type = "") {
      const safe = removeSpaceBeforeClosingBracket(normalizeBracketChoiceSpacing(escapeHtml(normalizeSolbookMarkers(value, type))));
      let underlineIndex = 0;
      const rendered = safe
        .replace(/\[([^\[\]<>]*?\/[^\[\]<>]*?)\]/g, (_, content) => renderPlainBracketChoiceBox(content))
        .replace(/\[\[boxout:([^:\]]+):([^|\]]*)\|([^\]]*)\]\]/g, (_, label, left, right) => (
          `<strong class="choice-box">(${cleanBoxChoiceText(label)}) [${cleanBoxChoiceText(left)} / ${cleanBoxChoiceText(right)}]</strong>`
        ))
        .replace(/\[\[u:([\s\S]*?)\]\]/g, (_, text) => {
          const marker = shouldNumberUnderlineMarkers(type)
            ? `${SLOT_MARKERS[underlineIndex] || `(${underlineIndex + 1})`} `
            : "";
          const targetText = cleanUnderlineTargetText(text);
          underlineIndex += 1;
          return `${marker}<u>${targetText}</u>`;
        });
      return removeSpaceBeforeClosingBracket(rendered);
    }

    function addKoreanBreakHintsToHtml(html) {
      const source = String(html || "");
      let result = "";
      let insideTag = false;
      for (const char of source) {
        if (char === "<") {
          insideTag = true;
          result += char;
          continue;
        }
        if (char === ">") {
          insideTag = false;
          result += char;
          continue;
        }
        result += char;
        if (!insideTag && /[\uAC00-\uD7A3]/.test(char)) {
          result += "<wbr>";
        }
      }
      return result;
    }

    function renderStemText(value, type = "") {
      return addKoreanBreakHintsToHtml(renderInlineText(value, type));
    }

    function renderChoiceText(value, type = "") {
      const normalized = normalizeChoiceText(value, type);
      const html = renderInlineText(normalized, "");
      return isQuestionType(type, "order") ? html : addKoreanBreakHintsToHtml(html);
    }

    function stripChoiceSlotLabels(value) {
      return String(value || "")
        .replace(/(?:\(|（|\[|【)\s*[A-C]\s*(?:\)|）|\]|】)\s*/g, "")
        .replace(/\b[A-C]\s*[)）\]】.．:：]\s*/g, "");
    }

    function cleanChoiceSegment(value, options = {}) {
      let cleaned = stripChoiceSlotLabels(value);
      if (options.removeBareLabel) {
        cleaned = cleaned.replace(/^\s*[A-C]\s+(?=\S)/, "");
      }
      return cleaned
        .replace(/^[\s,，:：/|ㆍ·.…\-–—－]+|[\s,，:：/|ㆍ·.…\-–—－]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    function splitChoiceParts(value) {
      return String(value || "")
        .split(/\s*(?:\/|／|……|\.{2,}|…{2,}|[-–—－]{2,}|\s+[-–—－]\s+|\s+[|｜]\s+)\s*/);
    }

    function isBareChoiceSlotLabel(value) {
      return /^[A-C]$/i.test(String(value || "").trim());
    }

    function cleanSummarySlotValue(value) {
      return String(value || "")
        .replace(/^[\s,，:：/／|｜ㆍ·.…\-–—－]+|[\s,，:：/／|｜ㆍ·.…\-–—－]+$/g, "")
        .replace(/^\([A-C]\)\s*:?\s*/i, "")
        .replace(/^[A-C]\s*:\s*/i, "")
        .replace(/^[A-C]\s+/i, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    function parseSummarySlotParts(value) {
      const normalized = String(value || "")
        .replace(/／/g, "/")
        .replace(/…{2,}|\.{2,}/g, "……")
        .replace(/\s+/g, " ")
        .trim();
      const matches = Array.from(normalized.matchAll(/(?:^|[\s,，/／|｜ㆍ·.…\-–—－]+)(?:\(([A-C])\)|([A-C])(?:\s*:|\s+))/gi));
      const parts = matches.map((match, index) => {
        const next = matches[index + 1];
        const text = cleanSummarySlotValue(normalized.slice(match.index + match[0].length, next ? next.index : normalized.length));
        return { label: (match[1] || match[2]).toUpperCase(), text };
      }).filter((part) => part.text);
      const uniqueLabels = new Set(parts.map((part) => part.label));
      if (parts.length >= 2 && uniqueLabels.size >= 2) {
        return parts;
      }
      return [];
    }

    function normalizeKoreanSummaryVerb(value) {
      const text = cleanSummarySlotValue(value);
      if (text.endsWith("시킬")) {
        return `${text.slice(0, -1)}키다`;
      }
      if (text.endsWith("할")) {
        return `${text.slice(0, -1)}하다`;
      }
      if (text.endsWith("을") || text.endsWith("를")) {
        return `${text.slice(0, -1)}다`;
      }
      return text;
    }

    function simplifySummaryTranslationPart(value, index) {
      let text = cleanSummarySlotValue(value);
      if (index === 0) {
        const fixedMatch = text.match(/영구적으로\s+(.+?)\s+것이/);
        if (fixedMatch) {
          return cleanSummarySlotValue(fixedMatch[1]);
        }
        text = text
          .replace(/^뇌가\s+/, "")
          .replace(/\s*때문에$/, "")
          .replace(/하게\s+남아\s+있기$/, "한")
          .replace(/되어\s+있기$/, "된")
          .replace(/적이기$/, "적인")
          .replace(/가\s+있기$/, "가 있는")
          .replace(/\s+있기$/, " 있는");
        return cleanSummarySlotValue(text);
      }
      const exposureMatch = text.match(/반복\s+([^\s을를]+)(?:을|를)?\s+통해/);
      if (exposureMatch) {
        return cleanSummarySlotValue(exposureMatch[1]);
      }
      const objectMatch = text.match(/그것을\s+(.+?)\s+수\s+있다/);
      if (objectMatch) {
        return normalizeKoreanSummaryVerb(objectMatch[1]);
      }
      return text;
    }

    function splitSummaryPairText(value) {
      const normalized = String(value || "")
        .replace(/／/g, "/")
        .replace(/…{2,}|\.{2,}/g, "……")
        .replace(/\s+/g, " ")
        .trim();
      const parts = normalized
        .split(/\s*(?:……|\/|\s+[-–—－]\s+)\s*/)
        .map(cleanSummarySlotValue)
        .filter(Boolean);
      if (parts.length >= 2) {
        return parts.slice(0, 2);
      }
      const commaParts = normalized
        .split(/\s*,\s*/)
        .map(cleanSummarySlotValue)
        .filter(Boolean);
      return commaParts.length >= 2
        ? [
          simplifySummaryTranslationPart(commaParts[0], 0),
          simplifySummaryTranslationPart(commaParts.slice(1).join(", "), 1)
        ]
        : [];
    }

    function normalizeSummaryChoiceText(value) {
      const slots = parseSummarySlotParts(value);
      if (slots.length >= 2) {
        return slots.map((slot) => cleanSummarySlotValue(slot.text)).join(" - ");
      }
      const pair = splitSummaryPairText(value);
      if (pair.length >= 2) {
        return `${cleanSummarySlotValue(pair[0])} - ${cleanSummarySlotValue(pair[1])}`;
      }
      return cleanSummarySlotValue(value);
    }

    function normalizeChoiceText(value, type = "") {
      const raw = String(value || "").trim();
      const normalizedType = normalizeQuestionType(type);
      if (normalizedType === "summary") {
        return normalizeSummaryChoiceText(raw);
      }
      if (normalizedType === "order") {
        const normalized = raw
          .replace(/[–—－]/g, "-")
          .replace(/\s*[-–—－]\s*/g, " - ")
          .replace(/\s+/g, " ")
          .trim();
        const parts = normalized
          .split(/\s+-\s+/)
          .map((part) => part.trim())
          .filter(Boolean);
        if (parts.length >= 2 && parts.every((part) => /^\(?[A-C]\)?$/i.test(part))) {
          return parts
            .map((part) => `(${part.replace(/[()]/g, "").toUpperCase()})`)
            .join(ORDER_CHOICE_SEPARATOR);
        }
        const labelSequence = normalized.match(/\(?[A-C]\)?/gi) || [];
        const onlyLabels = normalized.replace(/\(?[A-C]\)?/gi, "").trim();
        if (labelSequence.length >= 2 && !onlyLabels) {
          return labelSequence
            .map((part) => `(${part.replace(/[()]/g, "").toUpperCase()})`)
            .join(ORDER_CHOICE_SEPARATOR);
        }
        return normalized.replace(/\s+-\s+/g, ORDER_CHOICE_SEPARATOR);
      }
      const labelToken = "(?:\\(|（|\\[|【)?\\s*[A-C]\\s*(?:\\)|）|\\]|】|[)）.．:：])";
      const labelSeparator = "[\\s,，;；/／|｜ㆍ·\\-–—－]+";
      const labeledRegex = new RegExp(`(?:^|${labelSeparator})${labelToken}\\s*([\\s\\S]*?)(?=(?:${labelSeparator}${labelToken})|$)`, "g");
      const labeledSegments = Array.from(raw.matchAll(labeledRegex))
        .map((match) => cleanChoiceSegment(match[1]))
        .filter(Boolean);
      if (labeledSegments.length >= 2) {
        return labeledSegments.join(" - ");
      }
      const withoutLabels = stripChoiceSlotLabels(raw);
      const parts = splitChoiceParts(withoutLabels)
        .map((part) => cleanChoiceSegment(part, { removeBareLabel: true }))
        .filter((part) => !isBareChoiceSlotLabel(part))
        .filter(Boolean);
      if (parts.length >= 2) {
        return parts.join(" - ");
      }
      return cleanChoiceSegment(withoutLabels).replace(/\s*(?:\/|／|……|\.{2,}|…{2,})\s*/g, " - ").trim();
    }


  function cleanText(value) {
    return String(value ?? "").replace(/\r\n?/g, "\n").trim();
  }

  function getType(problem, structure) {
    if (problem.isSubjective || problem.kind === "shared") return "";
    const type = normalizeQuestionType(problem.problemType || problem.type || "");
    if (type && type !== "기타") return type;
    return ({
      "objective-sequence": "order",
      "objective-insertion": "insertion",
      "objective-summary-ab": "summary"
    })[structure?.templateKey] || type;
  }

  function choiceValue(choice) {
    return cleanText(typeof choice === "string" ? choice : choice?.text);
  }

  function toQuestion(problem = {}, fallbackBlocks = () => []) {
    const structure = problem.textStructure || {};
    const type = getType(problem, structure);
    const hasStructure = ["questionText", "referenceText", "bodyText", "givenText", "insertionText", "leadText", "summaryText"]
      .some(key => cleanText(structure[key]))
      || (Array.isArray(structure.sequenceParts) && structure.sequenceParts.some(part => cleanText(part?.text)))
      || (Array.isArray(structure.choices) && structure.choices.some(choiceValue));
    let stem = "", body = "", choices = [];
    if (hasStructure) {
      stem = [structure.questionText, structure.referenceText].map(cleanText).filter(Boolean).join(" ");
      const given = cleanText(structure.givenText || structure.insertionText || structure.leadText);
      const sequenceBody = (Array.isArray(structure.sequenceParts) ? structure.sequenceParts : []).map((part, index) => {
        const text = cleanText(part?.text);
        if (!text || type !== "order" || /^\([A-C]\)/.test(text)) return text;
        const label = cleanText(part?.label).replace(/[()]/g, "") || ["A", "B", "C"][index];
        return label ? "(" + label + ") " + text : text;
      }).filter(Boolean).join("\n\n");
      body = [given, cleanText(structure.bodyText) || sequenceBody, structure.summaryText].map(cleanText).filter(Boolean).join("\n\n");
      const entries = (Array.isArray(structure.choices) ? structure.choices : [])
        .map((choice, index) => ({ text: choiceValue(choice), marker: CHOICE_MARKERS[index] || String(index + 1) }))
        .filter(choice => choice.text);
      const inlineChoices = !problem.isSubjective && (["objective-insertion", "objective-body-only"].includes(structure.templateKey)
        || ["insertion", "grammar_underline", "vocab_underline", "irrelevant", "지칭"].includes(type));
      if (inlineChoices && entries.length) {
        // These legacy fields hold numbered passage fragments, not answer options.
        body = [body, entries.map(choice => choice.marker + " " + choice.text).join(" ")].filter(Boolean).join(" ");
      } else {
        choices = entries.map(choice => choice.text);
      }
    } else if (problem.stem || problem.body || problem.passage) {
      stem = cleanText(problem.stem);
      body = cleanText(problem.body || problem.passage);
      choices = (Array.isArray(problem.choices) ? problem.choices : []).map(choiceValue).filter(Boolean);
    } else {
      const blocks = typeof fallbackBlocks === "function" ? fallbackBlocks() : fallbackBlocks;
      stem = blocks.filter(block => ["stem", "reference"].includes(block.type)).map(block => block.text).join(" ");
      body = blocks.filter(block => block.type === "body").map(block => block.text).join(" ");
      choices = blocks.filter(block => block.type === "choice").map(block => block.text);
      if (problem.kind !== "shared" && !stem) {
        const match = body.match(/^([\s\S]*?(?:고르시오|쓰시오|답하시오|완성하시오|서술하시오)[.!。]?)(?:\s+|$)([\s\S]*)$/);
        if (match) {
          stem = match[1];
          body = match[2];
        }
      }
    }
    if (problem.kind === "shared") {
      body = [stem, body].filter(Boolean).join("\n\n");
      stem = "";
    }
    stem = cleanText(stem).replace(/^\s*\d{1,3}\s*(?:번[.)]?|[.)])(?:\s+|(?=[가-힣]))/, "");
    if (["grammar_underline", "vocab_underline"].includes(type)) {
      body = body.replace(/[①②③④⑤⑥⑦]\s*(?=\[\[u:)/g, "");
    }
    body = cleanText(body).replace(/\(\s*\)/g, "____________________")
      .replace(/[\[〔]\s*빈칸\s*[\]〕]/g, "____________________");
    return { type, stem, body, choices, isSubjective: Boolean(problem.isSubjective) };
  }

  function render(problem, fallbackBlocks) {
    // Only runtime pagination creates this field; library records remain intact.
    if (typeof problem.textFragmentHtml === "string") return problem.textFragmentHtml;
    const question = toQuestion(problem, fallbackBlocks);
    const hasContent = question.stem || question.body || question.choices.length;
    const stem = question.stem ? '<p class="solbook-stem">' + renderStemText(question.stem, question.type) + '</p>' : "";
    const body = question.body ? '<p class="solbook-body">' + renderInlineText(question.body, question.type) + '</p>' : "";
    const choices = question.choices.length ? '<ol class="solbook-choices' + (question.type === "order" ? " is-order" : "") + '">' +
      question.choices.map((choice, index) => {
        // Do not turn ordinary slashes or parenthetical letters into slot separators.
        const paired = ["summary", "order", "grammar_box", "vocab_box", "연결사"].includes(question.type);
        const text = paired ? normalizeChoiceText(choice, question.type) : cleanText(choice);
        const html = renderInlineText(text, "");
        return '<li><span class="solbook-choice-marker">' + (CHOICE_MARKERS[index] || String(index + 1) + ".") +
          '</span><span class="solbook-choice-text">' + (question.type === "order" ? html : addKoreanBreakHintsToHtml(html)) + '</span></li>';
      }).join("") + "</ol>" : "";
    return '<div class="solbook-text-question" data-solbook-type="' + escapeHtml(question.type) + '">' +
      (hasContent ? stem + body + choices : '<p class="solbook-body">문항 텍스트가 없습니다.</p>') + "</div>";
  }

  const fontHref = root.document?.currentScript?.src
    ? new URL("../dist/solbook_question_maker_portable/app/assets/fonts/NotoSansKR-VF.ttf", root.document.currentScript.src).href
    : "";
  const cssText = (fontHref ? '@font-face{font-family:"PDF Lab Solbook";src:url("' + fontHref + '") format("truetype");font-weight:100 900;font-display:swap;}\n' : "") + [
    '.problem-card.is-text-render { padding:1.6mm; border-radius:2.6mm; background:#fff; }',
    '.problem-card.is-text-render::before { display:none; }',
    '.problem-card.is-text-render .problem-card-header { margin-bottom:0.5mm; gap:1mm; }',
    '.problem-card.is-text-render .problem-heading-stack { gap:1mm; flex-wrap:wrap; }',
    '.problem-card.is-text-render .problem-badge, .problem-card.is-text-render .problem-type-badge {',
    'min-height:0; padding:0; border:0; border-radius:0; background:none; color:#000;',
    'font-family:"PDF Lab Solbook","Noto Sans KR",sans-serif; font-size:9.6pt; line-height:1.35; font-weight:800; }',
    '.problem-card.is-text-render .problem-text-body { display:block; min-width:0; }',
    '.solbook-text-question { font-family:"PDF Lab Solbook","Noto Sans KR",sans-serif; color:#000; min-width:0; }',
    '.solbook-text-question .solbook-stem { margin:0 0 0.6mm; font-size:10.5pt; font-weight:900; line-height:1.5;',
    'text-align:left; word-break:normal; overflow-wrap:anywhere; white-space:normal; }',
    '.solbook-text-question .solbook-body { margin:0; font-size:9.5pt; line-height:1.5; letter-spacing:normal;',
    'text-align:justify; text-align-last:left; white-space:pre-wrap; overflow-wrap:anywhere; word-break:normal; }',
    '.solbook-text-question .solbook-body:has(+ .solbook-choices) { margin-bottom:5.03mm; }',
    '.solbook-text-question u, .solbook-text-question .choice-box {',
    'font-weight:800; text-underline-offset:3px; text-decoration-thickness:1.5px; }',
    '.solbook-text-question .choice-box { display:inline-block; max-width:100%; white-space:normal; text-align:left; }',
    '.solbook-text-question .solbook-choices { display:grid; gap:0.1mm; margin:0; padding:0; list-style:none;',
    'font-size:9.5pt; line-height:1.5; color:#000; }',
    '.solbook-text-question .solbook-choices li { display:grid; grid-template-columns:3.8mm minmax(0,1fr); gap:0.7mm; }',
    '.solbook-text-question .solbook-choice-marker { font-weight:400; }',
    '.solbook-text-question .solbook-choice-text { min-width:0; white-space:normal; overflow-wrap:anywhere; word-break:normal; }',
    '.solbook-text-question .solbook-choices.is-order .solbook-choice-text { white-space:nowrap; }',
    '.problem-continuation-badge { font-family:"PDF Lab Solbook",sans-serif; font-size:8pt; font-weight:600; color:#555; }'
  ].join("\n");

  let measurementRoot = null;
  const heightCache = new Map();
  const paginationCache = new Map();
  function measureCard(markup, columnWidthMm) {
    if (!root.document?.body) return null;
    const key = columnWidthMm + "|" + markup;
    if (heightCache.has(key)) return heightCache.get(key);
    if (!measurementRoot) {
      measurementRoot = root.document.createElement("div");
      measurementRoot.setAttribute("aria-hidden", "true");
      measurementRoot.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;contain:layout style;";
      root.document.body.append(measurementRoot);
    }
    measurementRoot.style.width = columnWidthMm + "mm";
    measurementRoot.innerHTML = markup;
    const height = measurementRoot.firstElementChild.getBoundingClientRect().height * 25.4 / 96 + 0.5;
    measurementRoot.replaceChildren();
    if (heightCache.size >= 512) heightCache.clear();
    heightCache.set(key, height);
    return height;
  }

  async function ready() {
    if (root.document?.fonts && fontHref) {
      await Promise.all([
        root.document.fonts.load('400 9.5pt "PDF Lab Solbook"'),
        root.document.fonts.load('900 10.5pt "PDF Lab Solbook"')
      ]).catch(() => {});
    }
  }

  // Split rendered paragraphs/choices, preserving inline markup and original
  // choice numbers. The fragments are layout-only and never become new questions.
  function paginateProblem(problem, { columnWidthMm, columnHeightMm, renderCard }) {
    if (!root.document?.body || problem.textFragmentHtml != null) return [problem];
    const originalMarkup = renderCard(problem);
    if (measureCard(originalMarkup, columnWidthMm) <= columnHeightMm) return [problem];
    const cacheKey = columnWidthMm + "|" + columnHeightMm + "|" + originalMarkup;
    const makeProblem = (html, index) => ({ ...problem, textFragmentHtml: html, textContinuation: index > 0 });
    if (paginationCache.has(cacheKey)) return paginationCache.get(cacheKey).map(makeProblem);
    const template = root.document.createElement("template");
    template.innerHTML = originalMarkup;
    const content = template.content.querySelector(".solbook-text-question");
    if (!content) return [problem];
    const blocks = [];
    for (const element of content.children) {
      if (element.matches(".solbook-choices")) {
        for (const item of element.children) {
          const text = item.querySelector(".solbook-choice-text");
          if (text) blocks.push({ element: text, item, list: element, start: 0, end: text.textContent.length });
        }
      } else {
        blocks.push({ element, start: 0, end: element.textContent.length });
      }
    }
    // Copy the selected text interval through the element tree rather than
    // slicing HTML strings (which would break underlines, blanks, and boxes).
    function sliceElement(element, start, end) {
      let cursor = 0;
      const copyNode = (node) => {
        if (node.nodeType === 3) {
          const from = cursor;
          cursor += node.textContent.length;
          return root.document.createTextNode(node.textContent.slice(Math.max(0, start - from), Math.max(0, Math.min(cursor, end) - from)));
        }
        if (node.nodeType !== 1) return null;
        const clone = node.cloneNode(false);
        const position = cursor;
        for (const child of node.childNodes) {
          const copied = copyNode(child);
          if (copied && (copied.nodeType !== 3 || copied.textContent)) clone.append(copied);
        }
        return clone.childNodes.length || (position >= start && position < end && /^(BR|WBR)$/.test(node.tagName)) ? clone : null;
      };
      return copyNode(element) || element.cloneNode(false);
    }
    function fragmentMarkup(parts) {
      const wrapper = content.cloneNode(false);
      let lastList = null;
      let lastSourceList = null;
      for (const block of parts) {
        const sliced = sliceElement(block.element, block.start, block.end);
        if (block.list) {
          if (lastSourceList !== block.list) {
            lastList = block.list.cloneNode(false);
            wrapper.append(lastList);
            lastSourceList = block.list;
          }
          const item = block.item.cloneNode(true);
          item.querySelector(".solbook-choice-text").replaceWith(sliced);
          if (block.start > 0) item.querySelector(".solbook-choice-marker")?.setAttribute("data-repeated-marker", "true");
          lastList.append(item);
        } else {
          wrapper.append(sliced);
          lastSourceList = null;
        }
      }
      return wrapper.outerHTML;
    }
    const fragments = [];
    let current = [];
    const fits = parts => measureCard(renderCard(makeProblem(fragmentMarkup(parts), fragments.length)), columnWidthMm) <= columnHeightMm;
    const flush = () => { fragments.push(fragmentMarkup(current)); current = []; };
    const remaining = blocks.slice();
    while (remaining.length) {
      const block = remaining[0];
      if (fits([...current, block])) {
        current.push(block);
        remaining.shift();
        continue;
      }
      // Keep an answer option together when it fits in a fresh column.
      if (current.length && block.list && fits([block])) { flush(); continue; }
      const text = block.element.textContent;
      const boundaries = [];
      for (const match of text.slice(block.start, block.end).matchAll(/\s+/gu)) boundaries.push(block.start + match.index + match[0].length);
      boundaries.push(block.end);
      let low = 0, high = boundaries.length - 1, best = block.start;
      while (low <= high) {
        const middle = (low + high) >> 1;
        const end = boundaries[middle];
        if (fits([...current, { ...block, end }])) { best = end; low = middle + 1; }
        else high = middle - 1;
      }
      // A very long token (e.g. Korean without spaces) still needs a safe break.
      if (best === block.start && !current.length) {
        const points = Array.from(text.slice(block.start, block.end));
        let offset = block.start;
        const ends = points.map(point => (offset += point.length));
        low = 0; high = ends.length - 1;
        while (low <= high) {
          const middle = (low + high) >> 1;
          if (fits([{ ...block, end: ends[middle] }])) { best = ends[middle]; low = middle + 1; }
          else high = middle - 1;
        }
      }
      if (best === block.start) {
        if (current.length) { flush(); continue; }
        throw new Error("문항 " + (problem.displayNumber ?? problem.number ?? "-") + "번의 텍스트를 단에 배치하지 못했습니다. 출력 여백과 글꼴을 확인해주세요.");
      }
      current.push({ ...block, end: best });
      if (best === block.end) remaining.shift();
      else remaining[0] = { ...block, start: best };
      flush();
    }
    if (current.length) flush();
    if (paginationCache.size >= 128) paginationCache.clear();
    paginationCache.set(cacheKey, fragments);
    return fragments.map(makeProblem);
  }

  function assertFits(sheets) {
    const overflow = sheets.flatMap(sheet => sheet.columns.flatMap(column => column.items))
      .find(entry => entry.isOverflow && entry.problem.renderContentMode === "text");
    if (overflow) {
      throw new Error("문항 " + (overflow.problem.displayNumber ?? overflow.problem.number ?? "-") +
        "번의 텍스트가 한 단보다 깁니다. 본문을 나누거나 페이지 여백을 줄인 후 다시 출력해주세요.");
    }
  }

  root.PDFLabSolbookText = Object.freeze({ toQuestion, render, measureCard, ready, paginateProblem, assertFits, cssText, normalizeQuestionType, normalizeSolbookMarkers, normalizeChoiceText, renderInlineText });
  if (root.document?.head) {
    const style = root.document.createElement("style");
    style.id = "pdflab-solbook-text-style";
    style.textContent = cssText;
    root.document.head.append(style);
    root.document.fonts?.addEventListener("loadingdone", () => { heightCache.clear(); paginationCache.clear(); });
  }
})(typeof window === "object" ? window : globalThis);
