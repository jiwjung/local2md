export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const SUPPORTED_EXTENSIONS = ['txt', 'text', 'md', 'markdown', 'html', 'htm', 'pdf', 'hwp', 'hwpx', 'docx', 'epub', 'json', 'xml', 'csv', 'tsv', 'xls', 'xlsx', 'pptx', 'rss', 'atom', 'ipynb', 'zip', 'jpg', 'jpeg', 'png'];
const PROVIDER_EXTENSIONS = ['msg', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'aiff', 'aif', 'wma', 'opus', 'mp4', 'webm'];

export function formatBytes(bytes, locale = 'en') {
  if (bytes < 1024) return `${bytes} B`;
  const unit = bytes < 1024 * 1024 ? 'KiB' : 'MiB';
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / (unit === 'KiB' ? 1024 : 1024 * 1024))} ${unit}`;
}

export function downloadName(name = '') {
  const safe = name.replace(/[\\/<>:"|?*\u0000-\u001f\u007f]/g, '').trim();
  const stem = safe.replace(/\.[^.]*$/, '').replace(/^[.\s]+|[.\s]+$/g, '');
  return stem ? `${stem}.md` : 'converted.md';
}

export function validateFile(file) {
  if (file.size > MAX_FILE_BYTES) return 'size';
  const extension = file.name.split('.').pop().toLowerCase();
  if (PROVIDER_EXTENSIONS.includes(extension)) return 'provider';
  if (!file.name.includes('.') || !SUPPORTED_EXTENSIONS.includes(extension)) return 'unsupported';
  if (!file.size) return 'corrupt';
  return null;
}

// Reject obvious damaged containers before the library's plain-text fallback.
// These checks never replace the converter's own content detection or limits.
export async function validateContent(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const startsWith = signature => signature.every((byte, index) => bytes[index] === byte);
  if (extension === 'pdf' && !startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'corrupt';
  if (['hwpx', 'docx', 'xlsx', 'pptx', 'epub', 'zip'].includes(extension) &&
      !startsWith([0x50, 0x4b, 0x03, 0x04]) && !startsWith([0x50, 0x4b, 0x05, 0x06])) return 'corrupt';
  if (extension === 'hwp' && !startsWith([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'corrupt';
  if (extension === 'png' && !startsWith([137, 80, 78, 71, 13, 10, 26, 10])) return 'corrupt';
  if (['jpg', 'jpeg'].includes(extension) && !startsWith([255, 216, 255])) return 'corrupt';
  if (['json', 'ipynb'].includes(extension)) {
    try { JSON.parse((await file.text()).replace(/^\uFEFF/, '')); }
    catch { return 'corrupt'; }
  }
  return null;
}

export function classifyError(error, library) {
  if (error instanceof library.ProviderError) return 'provider';
  if (error instanceof library.InputLimitError) return 'security';
  if (error instanceof library.UnsupportedFormatError) return 'unsupported';
  if (error instanceof library.FileConversionError) {
    const kinds = (error.attempts || []).map(attempt => classifyError(attempt.error, library));
    if (kinds.includes('security')) return 'security';
    if (kinds.includes('provider')) return 'provider';
    return 'corrupt';
  }
  return 'unexpected';
}
