/* Export existing paper markup without changing drafts, CHECK or Firebase data. */
(function (root) {
  "use strict";
  const baseUrl = new URL(".", document.currentScript.src);
  const loads = new Map();
  function load(path, ready) {
    if (ready()) return Promise.resolve();
    if (!loads.has(path)) loads.set(path, new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL(path, baseUrl).href;
      script.onload = () => ready() ? resolve() : reject(new Error("PDF 출력 라이브러리를 확인해주세요."));
      script.onerror = () => reject(new Error("PDF 출력 파일을 불러오지 못했습니다. 연결을 확인하고 다시 시도해주세요."));
      document.head.appendChild(script);
    }).catch(error => { loads.delete(path); throw error; }));
    return loads.get(path);
  }
  async function dependencies() {
    await Promise.all([
      load("vendor/jspdf/jspdf.umd.min.js", () => root.jspdf?.jsPDF),
      load("vendor/html2canvas/html2canvas.min.js", () => root.html2canvas),
      load("vendor/jszip/jszip.min.js", () => root.JSZip)
    ]);
  }
  const css = `
    html,body{margin:0!important;padding:0!important;width:210mm!important;background:white!important}
    .preview-panel,.preview-root{margin:0!important;padding:0!important;display:block!important;width:210mm!important;max-width:none!important}
    .sheet,.answer-key-section{box-sizing:border-box!important;max-width:none!important;width:210mm!important;margin:0!important;border:0!important;border-radius:0!important;box-shadow:none!important;transform:none!important;background:white!important}
    .sheet{height:297mm!important;min-height:297mm!important}
    .pdf-batch-answer-page{box-sizing:border-box;width:210mm;height:297mm;padding:16mm;background:white;color:#173f43}
    .pdf-batch-answer-page h2{margin:0 0 6mm;font-size:6mm}
    .pdf-batch-answer-columns{display:grid;grid-template-columns:1fr 1fr;gap:7mm;height:249mm}
    .pdf-batch-answer-column{height:249mm;min-width:0;overflow:hidden}
    .pdf-batch-answer-column .answer-key-card{display:block;overflow-wrap:anywhere}
    .problem-squash-control{display:none!important}
  `;
  async function frameFor(html) {
    const frame = document.createElement("iframe");
    frame.title = "난이도별 PDF 출력 준비";
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;left:-20000px;top:0;width:1000px;height:1200px;border:0;pointer-events:none";
    const loaded = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("PDF 출력 화면 준비 시간이 초과됐습니다.")), 30000);
      frame.onload = () => { clearTimeout(timer); resolve(); };
      frame.onerror = () => { clearTimeout(timer); reject(new Error("PDF 출력 화면을 열지 못했습니다.")); };
    });
    frame.srcdoc = html;
    document.body.appendChild(frame);
    try {
      await loaded;
      const doc = frame.contentDocument;
      const style = doc.createElement("style"); style.textContent = css; doc.head.appendChild(style);
      await doc.fonts.ready;
      await Promise.all(Array.from(doc.images, async image => {
        if (!image.complete) await new Promise((resolve, reject) => {
          image.onload = resolve; image.onerror = () => reject(new Error("문항 이미지 또는 로고를 불러오지 못했습니다."));
        });
        if (!image.naturalWidth) throw new Error("문항 이미지 또는 로고가 누락되었습니다.");
        if (image.decode) await image.decode();
      }));
      return frame;
    } catch (error) { frame.remove(); throw error; }
  }
  function answerPages(doc, title) {
    const source = doc.querySelector(".answer-key-section");
    if (!source) throw new Error("답지 문항을 찾지 못했습니다.");
    const cards = Array.from(source.querySelectorAll(".answer-key-card"));
    const pages = [], host = doc.querySelector(".preview-root");
    source.remove();
    let columns, columnIndex = 2;
    function nextColumn() {
      columnIndex++;
      if (columnIndex >= 2) {
        const page = doc.createElement("section"); page.className = "pdf-batch-answer-page";
        const heading = doc.createElement("h2"); heading.textContent = title + " · 정답 및 해설";
        const row = doc.createElement("div"); row.className = "pdf-batch-answer-columns";
        columns = [0, 1].map(() => { const col = doc.createElement("div"); col.className = "pdf-batch-answer-column"; row.appendChild(col); return col; });
        page.append(heading, row); host.appendChild(page); pages.push(page); columnIndex = 0;
      }
      return columns[columnIndex];
    }
    let column = nextColumn();
    const fits = () => column.scrollHeight <= column.clientHeight + 1;
    for (const sourceCard of cards) {
      let card = sourceCard.cloneNode(true);
      column.appendChild(card);
      if (fits()) continue;
      card.remove();
      if (column.children.length) column = nextColumn();
      column.appendChild(card);
      if (fits()) continue;
      // Very long explanations are continued across columns without clipping.
      const blocks = Array.from(card.children); card.replaceChildren();
      for (const block of blocks) {
        let remaining = block.textContent;
        while (remaining) {
          const part = block.cloneNode(false); part.textContent = remaining; card.appendChild(part);
          if (fits()) break;
          let low = 0, high = remaining.length;
          while (low < high) {
            const middle = Math.ceil((low + high) / 2); part.textContent = remaining.slice(0, middle);
            if (fits()) low = middle; else high = middle - 1;
          }
          if (low) { part.textContent = remaining.slice(0, low); remaining = remaining.slice(low); }
          else part.remove();
          column = nextColumn(); card = sourceCard.cloneNode(false); column.appendChild(card);
        }
      }
    }
    return pages;
  }
  async function renderPdf(html, answers, title, onPage) {
    const frame = await frameFor(html);
    try {
      const doc = frame.contentDocument;
      const pages = answers ? answerPages(doc, title) : Array.from(doc.querySelectorAll(".sheet"));
      if (!pages.length) throw new Error("출력할 PDF 페이지가 없습니다.");
      const pdf = new root.jspdf.jsPDF({ unit: "mm", format: "a4", compress: true });
      pdf.setProperties({ title, creator: "PDF LAB" });
      for (let index = 0; index < pages.length; index++) {
        onPage(index + 1, pages.length);
        // Render one A4 page at a time to bound peak canvas memory.
        const canvas = await root.html2canvas(pages[index], { scale: 2, backgroundColor: "#ffffff", logging: false, useCORS: true, windowWidth: 1000, windowHeight: 1200 });
        if (index) pdf.addPage();
        pdf.addImage(canvas, "PNG", 0, 0, 210, 297, undefined, "FAST");
        canvas.width = canvas.height = 0;
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      return pdf.output("blob");
    } finally { frame.remove(); }
  }
  async function createZip({ plans, build, report = () => {} }) {
    await dependencies();
    const zip = new root.JSZip();
    for (const plan of plans) {
      const documents = await build(plan);
      for (const answers of [false, true]) {
        const kind = answers ? "답지" : "문제지";
        const title = `${plan.label} ${kind}`;
        const blob = await renderPdf(answers ? documents.answersHtml : documents.questionsHtml, answers, plan.label,
          (page, total) => report(`${title} · ${page}/${total}쪽 생성 중...`));
        zip.file(`${plan.label}_${kind}.pdf`, await blob.arrayBuffer());
      }
    }
    report("PDF를 ZIP으로 묶고 있습니다...");
    return zip.generateAsync({ type: "blob" });
  }
  root.PDFLabDifficultyPdf = { createZip };
})(window);
