/**
 * Fetch resumes stored as external URLs (e.g. Google Docs links from Excel import).
 */

function extractGoogleDocId(url) {
  const s = String(url);
  const doc = s.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (doc) return doc[1];
  const file = s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (file) return file[1];
  const d = s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (d) return d[1];
  try {
    const u = new URL(s);
    return u.searchParams.get('id') || null;
  } catch {
    return null;
  }
}

function isGoogleHost(hostname) {
  return (
    hostname === 'docs.google.com' ||
    hostname === 'drive.google.com' ||
    hostname.endsWith('.google.com')
  );
}

/**
 * @returns {{ fetchUrl: string, contentType: string, ext: string, filename: string } | null}
 */
function resolveExternalResumeDownload(storedUrl, label = 'resume') {
  const raw = String(storedUrl || '').trim();
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (!/^https?:$/i.test(parsed.protocol)) return null;

  const safeLabel =
    String(label || 'resume')
      .replace(/[^\w\s.-]/g, '_')
      .trim()
      .slice(0, 80) || 'resume';

  if (isGoogleHost(parsed.hostname)) {
    const id = extractGoogleDocId(raw);
    if (!id) return null;

    const isSpreadsheet = /\/spreadsheets\//i.test(raw);
    const isPresentation = /\/presentation\//i.test(raw);

    if (isSpreadsheet) {
      return {
        fetchUrl: `https://docs.google.com/spreadsheets/d/${id}/export?format=pdf`,
        contentType: 'application/pdf',
        ext: '.pdf',
        filename: `${safeLabel}.pdf`,
      };
    }
    if (isPresentation) {
      return {
        fetchUrl: `https://docs.google.com/presentation/d/${id}/export/pdf`,
        contentType: 'application/pdf',
        ext: '.pdf',
        filename: `${safeLabel}.pdf`,
      };
    }

    return {
      fetchUrl: `https://docs.google.com/document/d/${id}/export?format=pdf`,
      contentType: 'application/pdf',
      ext: '.pdf',
      filename: `${safeLabel}.pdf`,
    };
  }

  const pathLower = parsed.pathname.toLowerCase();
  const extMatch = pathLower.match(/\.(pdf|docx?|rtf)$/);
  const ext = extMatch ? extMatch[0] : '.pdf';
  const types = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx':
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.rtf': 'application/rtf',
  };

  return {
    fetchUrl: raw,
    contentType: types[ext] || 'application/octet-stream',
    ext,
    filename: extMatch ? `${safeLabel}${ext}` : `${safeLabel}.pdf`,
  };
}

function looksLikeHtml(buf) {
  if (!buf || buf.length < 20) return true;
  const head = buf.subarray(0, Math.min(512, buf.length)).toString('utf8').toLowerCase();
  return head.includes('<!doctype html') || head.includes('<html');
}

module.exports = {
  resolveExternalResumeDownload,
  looksLikeHtml,
};
