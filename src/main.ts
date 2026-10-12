import './style.css';
import type { User } from 'firebase/auth';
import { installAgentApi } from './agent';
import { EditorBridge } from './editor';
import { Workbench } from './workbench';
import { firebaseEnabled, onUserChanged, signInWithGoogle, signOutUser } from './firebase';
import {
  CloudTemplateStore,
  LocalTemplateStore,
  detectFormat,
  withFormatExtension,
  type TemplateMeta,
  type TemplateStore,
} from './templates';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  docName: $('docName'),
  docFormat: $('docFormat'),
  newBtn: $<HTMLButtonElement>('newBtn'),
  openBtn: $<HTMLButtonElement>('openBtn'),
  openInput: $<HTMLInputElement>('openInput'),
  templatesBtn: $<HTMLButtonElement>('templatesBtn'),
  downloadBtn: $<HTMLButtonElement>('downloadBtn'),
  toolsBtn: $<HTMLButtonElement>('toolsBtn'),
  toolsPanel: $('toolsPanel'),
  toolsClose: $<HTMLButtonElement>('toolsClose'),
  account: $('account'),
  frame: $<HTMLIFrameElement>('editorFrame'),
  modal: $('templatesModal'),
  modalClose: $<HTMLButtonElement>('templatesClose'),
  storeNote: $('storeNote'),
  gate: $('templatesGate'),
  gateSignIn: $<HTMLButtonElement>('gateSignIn'),
  templatesBody: $('templatesBody'),
  saveForm: $<HTMLFormElement>('saveTemplateForm'),
  templateName: $<HTMLInputElement>('templateName'),
  templateDesc: $<HTMLInputElement>('templateDesc'),
  saveFileBtn: $<HTMLButtonElement>('saveFileBtn'),
  templateFileInput: $<HTMLInputElement>('templateFileInput'),
  templatesList: $('templatesList'),
  toast: $('toast'),
};

const editor = new EditorBridge(els.frame);
const workbench = new Workbench(editor);
const state = {
  editorReady: false,
  docLoaded: false,
  docTitle: '',
  user: null as User | null,
  store: (firebaseEnabled ? null : new LocalTemplateStore()) as TemplateStore | null,
};
workbench.attach(() => state.docLoaded);

let toastTimer = 0;
export function toast(message: string, isError = false): void {
  els.toast.textContent = message;
  els.toast.classList.toggle('error', isError);
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => els.toast.classList.remove('show'), isError ? 6000 : 3000);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function setDocument(title: string, format: 'hwp' | 'hwpx' | null): void {
  state.docLoaded = true;
  state.docTitle = title.replace(/\.(hwp|hwpx)$/i, '');
  els.docName.textContent = title;
  els.docFormat.hidden = !format;
  els.docFormat.textContent = format ? format.toUpperCase() : '';
  els.downloadBtn.disabled = false;
  document.title = `${state.docTitle} · HWP Cloud`;
  if (!els.toolsPanel.hidden) workbench.scheduleRefresh(0);
}

async function loadBytes(bytes: Uint8Array, fileName: string, title = fileName): Promise<void> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const info = await editor.loadFile(buffer, fileName);
  setDocument(title, detectFormat(bytes, fileName));
  toast(`${title} 열림 · ${info.pageCount}쪽`);
}

async function openLocalFile(file: File): Promise<void> {
  try {
    await loadBytes(new Uint8Array(await file.arrayBuffer()), file.name);
  } catch (err) {
    toast(`열기 실패: ${errorMessage(err)}`, true);
  }
}

async function newDocument(): Promise<void> {
  try {
    await editor.newDocument();
    setDocument('새 문서', null);
  } catch (err) {
    toast(`새 문서 만들기 실패: ${errorMessage(err)}`, true);
  }
}

async function downloadCurrent(): Promise<string> {
  const bytes = await editor.exportHwp();
  const fileName = withFormatExtension(state.docTitle || '문서', 'hwp');
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/x-hwp' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return fileName;
}

// ---------- Aside tools panel ----------

function setToolsOpen(open: boolean): void {
  els.toolsPanel.hidden = !open;
  els.toolsBtn.setAttribute('aria-pressed', String(open));
  if (open) workbench.scheduleRefresh(0);
}

// ---------- Templates ----------

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function requireStore(): TemplateStore {
  if (!state.store) throw new Error('템플릿을 쓰려면 구글로 로그인하세요.');
  return state.store;
}

async function renderTemplates(): Promise<void> {
  const signedOut = firebaseEnabled && !state.user;
  els.gate.hidden = !signedOut;
  els.templatesBody.hidden = signedOut;
  els.storeNote.textContent = !firebaseEnabled
    ? '로컬 모드: Firebase가 설정되지 않아 이 브라우저에만 저장됩니다.'
    : state.user
      ? `${state.user.email ?? '내 계정'}에 저장됩니다. 나만 볼 수 있습니다.`
      : '';
  if (signedOut) return;

  els.templatesList.innerHTML = '<li class="template-empty">불러오는 중…</li>';
  let items: TemplateMeta[];
  try {
    items = await requireStore().list();
  } catch (err) {
    els.templatesList.innerHTML = '';
    const li = document.createElement('li');
    li.className = 'template-empty';
    li.textContent = `목록을 불러오지 못했습니다: ${errorMessage(err)}`;
    els.templatesList.appendChild(li);
    return;
  }
  els.templatesList.innerHTML = '';
  if (!items.length) {
    els.templatesList.innerHTML = '<li class="template-empty">저장된 템플릿이 없습니다. 위에서 현재 문서나 파일을 저장해 보세요.</li>';
    return;
  }
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'template-item';
    const meta = document.createElement('div');
    meta.className = 'meta';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = item.name;
    meta.appendChild(name);
    if (item.description) {
      const desc = document.createElement('div');
      desc.className = 'desc';
      desc.textContent = item.description;
      meta.appendChild(desc);
    }
    const info = document.createElement('div');
    info.className = 'info';
    const date = item.createdAt ? item.createdAt.toLocaleDateString('ko-KR') : '';
    info.textContent = [date, item.format.toUpperCase(), formatSize(item.size)].filter(Boolean).join(' · ');
    meta.appendChild(info);

    const load = document.createElement('button');
    load.type = 'button';
    load.className = 'btn primary small';
    load.textContent = '불러오기';
    load.setAttribute('aria-label', `${item.name} 불러오기`);
    load.addEventListener('click', () => void loadTemplate(item.id));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn ghost small danger';
    del.textContent = '삭제';
    del.setAttribute('aria-label', `${item.name} 삭제`);
    del.addEventListener('click', async () => {
      if (!window.confirm(`'${item.name}' 템플릿을 삭제할까요?`)) return;
      try {
        await requireStore().remove(item.id);
        toast('템플릿을 삭제했습니다.');
        await renderTemplates();
      } catch (err) {
        toast(`삭제 실패: ${errorMessage(err)}`, true);
      }
    });

    li.append(meta, load, del);
    els.templatesList.appendChild(li);
  }
}

async function loadTemplate(id: string): Promise<TemplateMeta> {
  const { meta, bytes } = await requireStore().load(id);
  await loadBytes(bytes, meta.fileName, meta.name);
  els.modal.hidden = true;
  return meta;
}

async function saveTemplate(name: string, description: string, bytes: Uint8Array, fileName: string): Promise<TemplateMeta> {
  const meta = await requireStore().save({ name, description, fileName, bytes });
  toast(`'${meta.name}' 템플릿을 저장했습니다.`);
  if (!els.modal.hidden) await renderTemplates();
  return meta;
}

async function saveCurrentAsTemplate(name: string, description = ''): Promise<TemplateMeta> {
  if (!state.docLoaded) throw new Error('열린 문서가 없습니다.');
  const bytes = await editor.exportHwp();
  return saveTemplate(name, description, bytes, withFormatExtension(name, 'hwp'));
}

function openTemplates(): void {
  els.modal.hidden = false;
  els.templateName.value = state.docTitle;
  void renderTemplates();
}

// ---------- Account ----------

function renderAccount(): void {
  els.account.innerHTML = '';
  if (!firebaseEnabled) return;
  if (!state.user) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = '구글로 로그인';
    btn.addEventListener('click', () => void signIn());
    els.account.appendChild(btn);
    return;
  }
  if (state.user.photoURL) {
    const img = document.createElement('img');
    img.className = 'avatar';
    img.src = state.user.photoURL;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    els.account.appendChild(img);
  }
  const name = document.createElement('span');
  name.className = 'account-name';
  name.textContent = state.user.displayName || state.user.email || '';
  const out = document.createElement('button');
  out.type = 'button';
  out.className = 'btn ghost small';
  out.textContent = '로그아웃';
  out.addEventListener('click', () => void signOutUser());
  els.account.append(name, out);
}

async function signIn(): Promise<void> {
  try {
    await signInWithGoogle();
  } catch (err) {
    toast(`로그인 실패: ${errorMessage(err)}`, true);
  }
}

onUserChanged((user) => {
  state.user = user;
  if (firebaseEnabled) state.store = user ? new CloudTemplateStore(user.uid) : null;
  renderAccount();
  if (!els.modal.hidden) void renderTemplates();
});

// ---------- Wiring ----------

for (const btn of [els.newBtn, els.openBtn, els.templatesBtn]) btn.disabled = true;
editor
  .waitUntilReady()
  .then(() => {
    state.editorReady = true;
    for (const btn of [els.newBtn, els.openBtn, els.templatesBtn]) btn.disabled = false;
  })
  .catch((err) => toast(errorMessage(err), true));

els.newBtn.addEventListener('click', () => void newDocument());
editor.onCommand((command) => {
  if (command === 'new-document') void newDocument();
});
els.openBtn.addEventListener('click', () => els.openInput.click());
els.openInput.addEventListener('change', () => {
  const file = els.openInput.files?.[0];
  els.openInput.value = '';
  if (file) void openLocalFile(file);
});
els.downloadBtn.addEventListener('click', async () => {
  try {
    const fileName = await downloadCurrent();
    toast(`${fileName} 내려받기를 시작했습니다.`);
  } catch (err) {
    toast(`내려받기 실패: ${errorMessage(err)}`, true);
  }
});

els.toolsBtn.addEventListener('click', () => setToolsOpen(els.toolsPanel.hidden));
els.toolsClose.addEventListener('click', () => setToolsOpen(false));

els.templatesBtn.addEventListener('click', openTemplates);
els.modalClose.addEventListener('click', () => (els.modal.hidden = true));
els.modal.addEventListener('click', (e) => {
  if (e.target === els.modal) els.modal.hidden = true;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.modal.hidden) els.modal.hidden = true;
});
els.gateSignIn.addEventListener('click', () => void signIn());
els.saveForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await saveCurrentAsTemplate(els.templateName.value, els.templateDesc.value);
    els.templateDesc.value = '';
  } catch (err) {
    toast(`템플릿 저장 실패: ${errorMessage(err)}`, true);
  }
});
els.saveFileBtn.addEventListener('click', () => els.templateFileInput.click());
els.templateFileInput.addEventListener('change', async () => {
  const file = els.templateFileInput.files?.[0];
  els.templateFileInput.value = '';
  if (!file) return;
  const name = els.templateName.value.trim() || file.name.replace(/\.(hwp|hwpx)$/i, '');
  try {
    await saveTemplate(name, els.templateDesc.value, new Uint8Array(await file.arrayBuffer()), file.name);
    els.templateDesc.value = '';
  } catch (err) {
    toast(`템플릿 저장 실패: ${errorMessage(err)}`, true);
  }
});

window.addEventListener('beforeunload', (e) => {
  if (state.docLoaded) e.preventDefault();
});

installAgentApi({
  isReady: () => state.editorReady,
  hasDocument: () => state.docLoaded,
  documentTitle: () => state.docTitle,
  refresh: () => workbench.refresh(),
  outlineText: () => workbench.outlineText(),
  paragraphs: () => workbench.paragraphs(),
  tables: () => workbench.tables(),
  replaceParagraph: (no, text) => workbench.replaceParagraph(no, text),
  insertAfterParagraph: (no, text) => workbench.insertAfterParagraph(no, text),
  deleteParagraph: (no) => workbench.deleteParagraph(no),
  setCell: (tableNo, row, col, text) => workbench.setCell(tableNo, row, col, text),
  replaceAll: (find, replacement) => workbench.replaceAll(find, replacement),
  find: (query) => workbench.find(query),
  applyEdits: (edits) => workbench.applyEdits(edits),
  selectionText: () => workbench.selectionText(),
  replaceSelection: (text) => workbench.replaceSelection(text),
  newDocument,
  download: downloadCurrent,
  listTemplates: () => requireStore().list(),
  loadTemplate: async (idOrName: string) => {
    const items = await requireStore().list();
    const match = items.find((t) => t.id === idOrName) ?? items.find((t) => t.name === idOrName);
    if (!match) throw new Error(`템플릿을 찾을 수 없습니다: ${idOrName}`);
    return loadTemplate(match.id);
  },
  saveAsTemplate: saveCurrentAsTemplate,
});
