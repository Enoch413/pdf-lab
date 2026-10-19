(function (root) {
  "use strict";
  function parseBlock(blockText, fallbackNumber, parseOcrBlock) {
    const text = String(blockText || "").replace(/\r\n?/g, "\n").trim();
    const numbered = text.match(/^(\d{1,3})\s*(?:번)?\s*[.)-]?\s*/);
    const number = numbered ? Number(numbered[1]) : (fallbackNumber == null ? null : Number(fallbackNumber));
    const body = numbered ? text.slice(numbered[0].length) : text;
    const answer = body.match(/^(?:정답|답)\s*[:：-]?\s*([\s\S]*?)(?=\n(?:해설|설명)\s*[:：-]?|$)/);
    const explanation = body.match(/(?:^|\n)(?:해설|설명)\s*[:：-]?\s*([\s\S]*)$/);
    if (answer) return { number, answerText: answer[1].trim(), explanationText: explanation?.[1]?.trim() || "" };
    const fallback = parseOcrBlock(text, number);
    return { number, answerText: fallback.answerText || "", explanationText: fallback.explanationText || "" };
  }

  function parse(value, records, { parseOcrBlock, normalizeOcrText, entryPattern, normalizeAnswer, normalizeFallbackAnswer = normalizeAnswer, normalizeExplanation }) {
    const targetRecords = (Array.isArray(records) ? records : []).filter((record) => record?.kind === "problem");
    if (!targetRecords.length) {
      throw new Error("수정할 문항이 없습니다.");
    }
    const normalizedText = String(value || "").replace(/\r\n?/g, "\n").trim();
    if (!normalizedText) {
      throw new Error("번호-정답-해설 텍스트가 비어 있습니다.");
    }

    const blocks = normalizedText.split(/\n(?=\d{1,3}\s*(?:번)?\s*[.)-]?\s*(?:정답|답)\s*[:：-])/).map((block) => block.trim()).filter(Boolean);
    const parsedByNumber = new Map();

    if (blocks.length === targetRecords.length || targetRecords.length === 1) {
      blocks.forEach((block, index) => {
        const parsed = parseBlock(block, targetRecords[index]?.number ?? null, parseOcrBlock);
        if (parsed.number != null) {
          parsedByNumber.set(String(parsed.number), parsed);
        } else {
          parsedByNumber.set(`index:${index}`, parsed);
        }
      });
    }

    if (parsedByNumber.size < targetRecords.length) {
      Array.from(normalizeOcrText(normalizedText).matchAll(entryPattern)).forEach((match) => {
        const number = Number(match[1]);
        if (!Number.isFinite(number)) {
          return;
        }
        parsedByNumber.set(String(number), {
          number,
          answerText: normalizeFallbackAnswer(match[2] || ""),
          explanationText: normalizeExplanation(match[3] || "")
        });
      });
    }

    return targetRecords.map((record, index) => {
      const parsed = parsedByNumber.get(String(record.number))
        || (blocks.length === targetRecords.length ? parseBlock(blocks[index], record.number, parseOcrBlock) : null)
        || (targetRecords.length === 1 ? parseBlock(normalizedText, record.number, parseOcrBlock) : null)
        || parsedByNumber.get(`index:${index}`);
      if (!parsed) {
        throw new Error(`문항 ${record.number} 수정 내용을 찾지 못했습니다. 번호-정답-해설 형식을 확인해주세요.`);
      }
      return {
        recordId: record.recordId,
        sourceId: record.sourceId,
        number: record.number,
        answerText: root.PDFLabCanonical.has(record) || record.isSubjective
          ? String(parsed.answerText || "").trim() : normalizeAnswer(parsed.answerText || ""),
        explanationText: parsed.explanationText || ""
      };
    });
  }
  root.PDFLabAnswerEditor = { parseBlock, parse };
})(typeof window !== "undefined" ? window : globalThis);
