import { parsePracticeImport, serializePracticeExport, practiceExportFilename, sanitizePackId } from '../shared/practice-throws.js';

export function downloadPracticeThrows(entries, { room = '', filename, packId = '' } = {}) {
  const payload = serializePracticeExport(entries, { room, mode: 'utility' });
  const name = filename || practiceExportFilename(payload.count, { packId });
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return { ...payload, filename: name };
}

/** Open a file picker and return parsed practice throws (or null if cancelled). */
export function pickPracticeThrowsFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(result);
    };
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      try {
        const text = await file.text();
        const parsed = parsePracticeImport(text);
        if (!parsed.ok) return finish({ ok: false, error: parsed.error });
        const packId = sanitizePackId(file.name.replace(/\.json$/i, '').replace(/-\d+$/, '')) || 'import';
        finish({ ok: true, throws: parsed.throws, count: parsed.count, filename: file.name, packId });
      } catch (err) {
        finish({ ok: false, error: err.message || String(err) });
      }
    });
    input.addEventListener('cancel', () => finish(null));
    document.body.append(input);
    // Defer click so pointer-lock exit settles; avoids some browsers treating it as navigation.
    queueMicrotask(() => input.click());
  });
}
