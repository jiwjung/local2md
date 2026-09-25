import { MAX_FILE_BYTES, SUPPORTED_EXTENSIONS, formatBytes, downloadName, validateFile, validateContent, classifyError } from './converter-utils.js';
import { loadLocale, applyTranslations } from './i18n.js';

const { locale, t, number } = await loadLocale([
  ...(navigator.languages || []), navigator.language,
]);
document.documentElement.lang = locale;
const fileSize = bytes => formatBytes(bytes, locale);
const maxSize = fileSize(MAX_FILE_BYTES);

const $ = id => document.getElementById(id);
const input = $('file-input');
let state = { status: 'idle' };
let generation = 0;
let library;
let converter;
let dragDepth = 0;
const activeURLs = new Set();
const PREVIEW_LIMIT = 100_000;
const PROVIDER_WARNING_CODES = new Set(['provider-required', 'pdf-no-text']);

input.accept = SUPPORTED_EXTENSIONS.map(extension => `.${extension}`).join(',');
applyTranslations(document, t, { maxSize, count: number.format(PREVIEW_LIMIT) });

function announce(message) { $('live-status').textContent = message; }

function releaseURLs() {
  for (const url of activeURLs) URL.revokeObjectURL(url);
  activeURLs.clear();
}

function clearDrag() {
  dragDepth = 0;
  $('idle-panel').classList.remove('dragging');
  $('drop-title').textContent = t('drop.title');
}

function render() {
  for (const status of ['idle', 'converting', 'success', 'error']) $(status + '-panel').hidden = status !== state.status;
  $('converter').setAttribute('aria-busy', String(state.status === 'converting'));
  clearDrag();
  document.querySelectorAll('[data-file-name]').forEach(node => {
    node.textContent = state.file?.name || '';
    node.title = state.file?.name || '';
  });
  document.querySelectorAll('[data-file-size]').forEach(node => { node.textContent = state.file ? fileSize(state.file.size) : ''; });
  // Discard the previous result whenever the current job changes.
  $('preview').value = '';
  $('warning-list').replaceChildren();
  $('warnings').hidden = true;
  if (state.status === 'success') {
    $('preview').value = state.markdown.slice(0, PREVIEW_LIMIT);
    $('preview-notice').hidden = state.markdown.length <= PREVIEW_LIMIT;
    $('character-count').textContent = t('success.characters', { count: number.format(state.markdown.length) });
    $('wrap').checked = true;
    $('preview').classList.remove('no-wrap');
    $('preview').wrap = 'soft';
    $('warnings').hidden = !state.warnings.length;
    for (const warning of state.warnings) {
      const item = document.createElement('li');
      const detail = typeof warning === 'string' ? warning : warning.message || warning.code;
      item.textContent = PROVIDER_WARNING_CODES.has(warning.code) ? t('warning.provider')
        : detail ? t('warning.detail', { detail }) : t('warning.generic');
      $('warning-list').append(item);
    }
    $('success-title').focus();
  } else if (state.status === 'error') {
    $('error-title').textContent = t(`error.${state.kind}.title`);
    $('error-description').textContent = t(`error.${state.kind}.description`, { maxSize });
    $('retry').hidden = state.kind !== 'unexpected' || !state.file;
    $('choose-again').focus();
  } else if (state.status === 'converting') {
    $('cancel').focus();
  }
}

function discard() {
  generation++;
  if (state.status === 'converting') state.controller.abort();
  releaseURLs();
  input.value = '';
}

function reset(message = '') {
  discard();
  state = { status: 'idle' };
  render();
  announce(message);
  $('choose-file').focus();
}

function showError(kind, file) {
  state = { status: 'error', kind, file };
  render();
  announce('');
}

async function convertFile(file) {
  discard();
  const invalid = validateFile(file);
  if (invalid) { showError(invalid, file); return; }
  const controller = new AbortController();
  const job = generation;
  state = { status: 'converting', file, controller };
  render();
  announce(t('status.converting'));
  try {
    // Let the browser paint the progress panel before loading or converting.
    await new Promise(resolve => setTimeout(resolve, 0));
    if (job !== generation || controller.signal.aborted) return;
    const contentError = await validateContent(file);
    if (job !== generation || controller.signal.aborted) return;
    if (contentError) { showError(contentError, file); return; }
    library ||= await import('./markitdown.js?v=033c9f9b7a86f82803f971f4c0ba67260e534b3cd6736f8bf3e2aa56e3a83f87');
    if (job !== generation || controller.signal.aborted) return;
    converter ||= new library.MarkItDown({ maxBytes: MAX_FILE_BYTES });
    const result = await converter.convert(file, { signal: controller.signal });
    if (job !== generation || controller.signal.aborted) return;
    const warnings = result.warnings || [];
    if (warnings.some(warning => PROVIDER_WARNING_CODES.has(warning.code)) && !result.markdown.trim()) {
      showError('provider', file);
      return;
    }
    state = { status: 'success', file, markdown: result.markdown, warnings };
    render();
    announce(t(warnings.length ? 'status.warnings' : 'status.success'));
  } catch (error) {
    if (job !== generation || controller.signal.aborted) return;
    showError(library ? classifyError(error, library) : 'unexpected', file);
  }
}

function selectFiles(files) {
  if (!files.length) return;
  if (files.length !== 1) {
    discard();
    showError('multiple');
    return;
  }
  void convertFile(files[0]);
}

$('choose-file').addEventListener('click', event => { event.stopPropagation(); input.click(); });
$('idle-panel').addEventListener('click', () => input.click());
// The native button provides Enter/Space activation for the entire drop area.
input.addEventListener('change', () => selectFiles(Array.from(input.files)));
$('choose-again').addEventListener('click', () => { reset(); input.click(); });
$('cancel').addEventListener('click', () => reset(t('status.cancelled')));
$('reset').addEventListener('click', () => reset(t('status.reset')));
$('retry').addEventListener('click', () => { if (state.file) void convertFile(state.file); });
$('wrap').addEventListener('change', () => {
  $('preview').classList.toggle('no-wrap', !$('wrap').checked);
  $('preview').wrap = $('wrap').checked ? 'soft' : 'off';
});

$('download').addEventListener('click', () => {
  if (state.status !== 'success') return;
  const url = URL.createObjectURL(new Blob([state.markdown], { type: 'text/markdown;charset=utf-8' }));
  activeURLs.add(url);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = downloadName(state.file.name);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Release on the next task so browsers can first consume the download URL.
  setTimeout(() => { URL.revokeObjectURL(url); activeURLs.delete(url); }, 0);
  announce(t('status.download'));
});

const dropzone = $('idle-panel');
dropzone.addEventListener('dragenter', event => {
  if (state.status !== 'idle' || !Array.from(event.dataTransfer.types).includes('Files')) return;
  event.preventDefault();
  dragDepth++;
  dropzone.classList.add('dragging');
  $('drop-title').textContent = t('drop.active');
});
dropzone.addEventListener('dragleave', () => { if (--dragDepth <= 0) clearDrag(); });
dropzone.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
dropzone.addEventListener('drop', event => {
  event.preventDefault();
  clearDrag();
  if (state.status === 'idle') selectFiles(Array.from(event.dataTransfer.files));
});
// A file dropped outside the dropzone must not navigate away from this page.
window.addEventListener('dragover', event => { event.preventDefault(); });
window.addEventListener('drop', event => { event.preventDefault(); clearDrag(); });
window.addEventListener('pagehide', () => {
  if (state.status === 'converting') reset(t('status.cancelled'));
  else releaseURLs();
});
document.body.classList.remove('localizing');
