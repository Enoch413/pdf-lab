(function (root) {
  "use strict";
  async function loadUserCatalog(db, profile, classIds = []) {
    const users = db.collection("users");
    if (profile.adminScope === "all") return (await users.get()).docs;
    const docs = new Map([[profile.uid, { id: profile.uid, data: () => profile }]]);
    const ids = [...new Set(classIds.filter(Boolean))];
    for (let start = 0; start < ids.length; start += 30) {
      const snapshot = await users.where("classIds", "array-contains-any", ids.slice(start, start + 30)).get();
      snapshot.docs.forEach(doc => docs.set(doc.id, doc));
    }
    return [...docs.values()];
  }

  async function commitOperations(db, operations = []) {
    if (!db || typeof db.batch !== "function") return 0;
    // Leave headroom for Firestore encoding; index expansion is still server-validated.
    const encoder = new TextEncoder();
    const rows = operations.filter(Boolean).map(operation => {
      const bytes = encoder.encode(JSON.stringify(operation.data || {}) + (operation.ref.path || "")).length + 512;
      if (operation.type !== "delete" && bytes > 900 * 1024) throw new Error("문항 데이터가 문서 크기 제한을 초과합니다. 내용을 나누어 등록해주세요.");
      return { operation, bytes };
    });
    if (!rows.length) return 0;
    let batch = db.batch(), count = 0, size = 0, committed = 0;
    for (const { operation, bytes } of rows) {
      if (count && (count >= 450 || size + bytes > 4 * 1024 * 1024)) {
        await batch.commit(); committed += count;
        batch = db.batch(); count = 0; size = 0;
      }
      if (operation.type === "delete") batch.delete(operation.ref);
      else batch.set(operation.ref, operation.data, operation.options || {});
      count++; size += bytes;
    }
    if (count) { await batch.commit(); committed += count; }
    return committed;
  }
  root.PDFLabFirebase = { loadUserCatalog, commitOperations };
})(typeof window !== "undefined" ? window : globalThis);
