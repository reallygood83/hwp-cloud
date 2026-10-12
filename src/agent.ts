// window.hwpCloud: what an Aside agent calls when it can run JavaScript.
// The same actions exist as labeled controls in the Aside 도구 panel.
import type { TemplateMeta } from './templates';
import type { Edit, FoundAt, NumberedParagraph, NumberedTable } from './workbench';

export interface AgentContext {
  isReady(): boolean;
  hasDocument(): boolean;
  documentTitle(): string;
  refresh(): Promise<void>;
  outlineText(): string;
  paragraphs(): NumberedParagraph[];
  tables(): NumberedTable[];
  replaceParagraph(no: number, text: string): Promise<void>;
  insertAfterParagraph(no: number, text: string): Promise<void>;
  deleteParagraph(no: number): Promise<void>;
  setCell(tableNo: number, row: number, col: number, text: string): Promise<void>;
  replaceAll(find: string, replacement: string): Promise<number>;
  find(query: string): Promise<FoundAt[]>;
  applyEdits(edits: Edit[]): Promise<number>;
  selectionText(): string;
  replaceSelection(text: string): Promise<void>;
  newDocument(): Promise<void>;
  download(): Promise<string>;
  listTemplates(): Promise<TemplateMeta[]>;
  loadTemplate(idOrName: string): Promise<TemplateMeta>;
  saveAsTemplate(name: string, description?: string): Promise<TemplateMeta>;
}

const HELP = {
  getText: '() 문단 번호와 표 칸이 적힌 문서 전체',
  paragraphs: '() [{ no, text }] 빈 문단 포함',
  tables: '() [{ no, rows, cols, anchorNo, cells: [{ row, col, text }] }] 행·열은 1부터',
  find: '(찾을내용) → [{ type: "paragraph", no, text } | { type: "cell", table, row, col, text }]',
  applyEdits:
    '([{ op: "replace"|"insertAfter"|"delete", no, text?, expect? } | { op: "cell", table, row, col, text, expect? }]) 번호는 모두 호출 전 기준. expect가 다르면 아무것도 안 고침',
  replaceParagraph: '(문단번호, 새내용) 그 문단 전체를 교체',
  insertAfterParagraph: '(문단번호, 내용) 그 문단 뒤에 새 문단. 줄바꿈마다 문단 하나',
  deleteParagraph: '(문단번호) 삭제 후 뒤 번호가 당겨짐',
  setCell: '(표번호, 행, 열, 내용) 행·열은 1부터',
  replaceAll: '(찾을내용, 바꿀내용) → 바꾼 횟수. 표 안까지 적용',
  getSelection: '() 편집기에서 드래그한 글자',
  replaceSelection: '(새내용)',
  loadTemplate: '(이름 또는 id)',
  saveAsTemplate: '(이름, 설명?)',
  download: '() HWP 파일로 내려받기. 사용자 확인 후 실행',
  note: '번호는 편집 후 바뀝니다. 한 번 고친 뒤 getText()로 다시 읽으세요. Ctrl+Z로 되돌릴 수 있습니다.',
};

function normalizeEdit(edit: any): Edit {
  const expect = edit?.expect === undefined || edit?.expect === null ? undefined : String(edit.expect);
  if (edit?.op === 'cell') {
    return { op: 'cell', table: Number(edit.table), row: Number(edit.row), col: Number(edit.col), text: String(edit.text ?? ''), expect };
  }
  if (edit?.op === 'delete') return { op: 'delete', no: Number(edit.no), expect };
  return { op: edit?.op, no: Number(edit?.no), text: String(edit?.text ?? ''), expect } as Edit;
}

export function installAgentApi(ctx: AgentContext): void {
  const api = {
    help: () => HELP,
    status: () => ({ ready: ctx.isReady(), hasDocument: ctx.hasDocument(), title: ctx.documentTitle() }),
    refresh: () => ctx.refresh(),
    getText: async () => {
      await ctx.refresh();
      return ctx.outlineText();
    },
    paragraphs: async () => {
      await ctx.refresh();
      return ctx.paragraphs().map((para) => ({ no: para.no, text: para.text }));
    },
    tables: async () => {
      await ctx.refresh();
      return ctx.tables().map((table) => ({
        no: table.no,
        rows: table.rows,
        cols: table.cols,
        anchorNo: table.anchorNo,
        cells: table.cells.map((cell) => ({ row: cell.row + 1, col: cell.col + 1, text: cell.text })),
      }));
    },
    find: (query: string) => ctx.find(String(query ?? '')),
    applyEdits: (edits: Edit[]) => ctx.applyEdits((Array.isArray(edits) ? edits : []).map(normalizeEdit)),
    replaceParagraph: (no: number, text: string) => ctx.replaceParagraph(Number(no), String(text ?? '')),
    insertAfterParagraph: (no: number, text: string) => ctx.insertAfterParagraph(Number(no), String(text ?? '')),
    deleteParagraph: (no: number) => ctx.deleteParagraph(Number(no)),
    setCell: (tableNo: number, row: number, col: number, text: string) =>
      ctx.setCell(Number(tableNo), Number(row), Number(col), String(text ?? '')),
    replaceAll: (find: string, replacement: string) => ctx.replaceAll(String(find ?? ''), String(replacement ?? '')),
    getSelection: () => ctx.selectionText(),
    replaceSelection: (text: string) => ctx.replaceSelection(String(text ?? '')),
    newDocument: () => ctx.newDocument(),
    download: () => ctx.download(),
    listTemplates: () => ctx.listTemplates(),
    loadTemplate: (idOrName: string) => ctx.loadTemplate(String(idOrName ?? '')),
    saveAsTemplate: (name: string, description = '') => ctx.saveAsTemplate(String(name ?? ''), String(description ?? '')),
  };
  Object.defineProperty(window, 'hwpCloud', { value: Object.freeze(api), configurable: false });
}
