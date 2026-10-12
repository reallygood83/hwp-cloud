// window.hwpCloud: the page-level API for browser AI agents such as Aside.
import type { TemplateMeta } from './templates';

export interface AgentContext {
  isReady(): boolean;
  hasDocument(): boolean;
  documentTitle(): string;
  getParagraphs(): Promise<{ section: number; index: number; text: string }[]>;
  readSelection(): Promise<string>;
  replaceSelection(text: string): Promise<void>;
  replaceAll(find: string, replacement: string): Promise<number>;
  insertAtCursor(text: string): Promise<void>;
  newDocument(): Promise<void>;
  download(): Promise<string>;
  listTemplates(): Promise<TemplateMeta[]>;
  loadTemplate(idOrName: string): Promise<TemplateMeta>;
  saveAsTemplate(name: string, description?: string): Promise<TemplateMeta>;
}

const HELP = {
  status: '() → { ready, hasDocument, title }',
  getText: '() → 본문 전체 텍스트 (문단은 줄바꿈 구분, 표 안 글자 제외)',
  getParagraphs: '() → [{ section, index, text }]',
  getSelection: '() → 사용자가 드래그한 선택 영역 텍스트',
  replaceSelection: '(text) 선택 영역을 text로 교체',
  insertAtCursor: '(text) 커서 위치에 text 삽입',
  replaceAll: '(find, replace) 문서 전체 찾아 바꾸기 → 바꾼 횟수',
  newDocument: '() 빈 문서 만들기',
  download: '() 현재 문서를 HWP 파일로 내려받기 → 파일명',
  listTemplates: '() → [{ id, name, description, format, size }] 내 템플릿 목록',
  loadTemplate: '(idOrName) 템플릿을 편집기로 불러오기',
  saveAsTemplate: '(name, description?) 현재 문서를 템플릿으로 저장',
  note: '모든 편집은 Ctrl+Z로 되돌릴 수 있습니다. 저장(내려받기)은 사용자에게 확인한 뒤 실행하세요.',
};

export function installAgentApi(ctx: AgentContext): void {
  const api = {
    help: () => HELP,
    status: () => ({ ready: ctx.isReady(), hasDocument: ctx.hasDocument(), title: ctx.documentTitle() }),
    getParagraphs: () => ctx.getParagraphs(),
    getText: async () => (await ctx.getParagraphs()).map((p) => p.text).join('\n'),
    getSelection: () => ctx.readSelection(),
    replaceSelection: (text: string) => ctx.replaceSelection(String(text ?? '')),
    insertAtCursor: (text: string) => ctx.insertAtCursor(String(text ?? '')),
    replaceAll: (find: string, replacement: string) => ctx.replaceAll(String(find ?? ''), String(replacement ?? '')),
    newDocument: () => ctx.newDocument(),
    download: () => ctx.download(),
    listTemplates: () => ctx.listTemplates(),
    loadTemplate: (idOrName: string) => ctx.loadTemplate(String(idOrName ?? '')),
    saveAsTemplate: (name: string, description = '') => ctx.saveAsTemplate(String(name ?? ''), String(description ?? '')),
  };
  Object.defineProperty(window, 'hwpCloud', { value: Object.freeze(api), configurable: false });
}
