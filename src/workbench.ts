// Aside reads this panel instead of the canvas editor: numbered paragraphs and real HTML tables.
import type { EditorBridge, EditorSelection, OutlineBlock, ParagraphBlock, TableBlock } from './editor';

export interface NumberedParagraph extends ParagraphBlock {
  no: number;
}
export interface NumberedTable extends TableBlock {
  no: number;
  anchorNo: number;
}
type Item = { kind: 'p'; para: NumberedParagraph } | { kind: 't'; table: NumberedTable };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class Workbench {
  private items: Item[] = [];
  private selection = '';
  private refreshTimer = 0;
  private hasDocument = () => false;

  private els = {
    panel: $('toolsPanel'),
    outline: $('outline'),
    stats: $('outlineStats'),
    result: $('workResult'),
    selectionNow: $('selectionNow'),
    paraForm: $<HTMLFormElement>('paraForm'),
    paraNo: $<HTMLInputElement>('paraNo'),
    paraText: $<HTMLTextAreaElement>('paraText'),
    cellForm: $<HTMLFormElement>('cellForm'),
    cellTable: $<HTMLInputElement>('cellTable'),
    cellRow: $<HTMLInputElement>('cellRow'),
    cellCol: $<HTMLInputElement>('cellCol'),
    cellText: $<HTMLTextAreaElement>('cellText'),
    replaceForm: $<HTMLFormElement>('replaceForm'),
    findInput: $<HTMLInputElement>('findInput'),
    replaceInput: $<HTMLInputElement>('replaceInput'),
    selectionForm: $<HTMLFormElement>('selectionForm'),
    selectionNew: $<HTMLTextAreaElement>('selectionNew'),
    refreshBtn: $<HTMLButtonElement>('refreshOutlineBtn'),
  };

  constructor(private editor: EditorBridge) {
    editor.onDocumentChanged(() => {
      if (!this.els.panel.hidden) this.scheduleRefresh();
    });
    editor.onSelectionChanged((sel) => this.showSelection(sel));
    this.els.refreshBtn.addEventListener('click', () => void this.refresh());
    this.bindForms();
  }

  attach(hasDocument: () => boolean): void {
    this.hasDocument = hasDocument;
  }

  paragraphs(): NumberedParagraph[] {
    return this.items.filter((item): item is { kind: 'p'; para: NumberedParagraph } => item.kind === 'p').map((item) => item.para);
  }

  tables(): NumberedTable[] {
    return this.items.filter((item): item is { kind: 't'; table: NumberedTable } => item.kind === 't').map((item) => item.table);
  }

  scheduleRefresh(delayMs = 200): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => void this.refresh(), delayMs);
  }

  report(message: string, isError = false): void {
    this.els.result.textContent = message;
    this.els.result.classList.toggle('error', isError);
  }

  async refresh(): Promise<void> {
    clearTimeout(this.refreshTimer);
    if (!this.hasDocument()) {
      this.items = [];
      this.els.outline.replaceChildren();
      this.els.stats.textContent = '문서를 열면 문단 번호와 표가 여기에 표시됩니다.';
      return;
    }
    const blocks = await this.editor.getOutline();
    this.items = numberBlocks(blocks);
    this.els.outline.replaceChildren(...this.items.map((item) => (item.kind === 'p' ? renderParagraph(item.para) : renderTable(item.table))).filter((node): node is HTMLElement => node !== null));
    const paragraphs = this.paragraphs();
    const filled = paragraphs.filter((para) => para.text.trim()).length;
    this.els.stats.textContent = `문단 ${paragraphs.length}개 중 내용 ${filled}개 · 표 ${this.tables().length}개. 빈 문단은 생략되고 번호는 유지됩니다.`;
  }

  outlineText(): string {
    return this.items
      .map((item) => (item.kind === 'p' ? paragraphLine(item.para) : tableLines(item.table)))
      .filter(Boolean)
      .join('\n');
  }

  selectionText(): string {
    return this.selection;
  }

  private findParagraph(no: number): NumberedParagraph {
    const para = this.paragraphs()[no - 1];
    if (!para) throw new Error(`문단 ${no}이(가) 없습니다. 1~${this.paragraphs().length}번입니다.`);
    return para;
  }

  async replaceParagraph(no: number, text: string): Promise<void> {
    await this.refresh();
    const para = this.findParagraph(no);
    const at = { sectionIndex: para.section, paragraphIndex: para.index };
    await this.editor.replaceRange({ ...at, charOffset: 0 }, { ...at, charOffset: para.text.length }, text);
    this.report(`문단 ${no}을(를) 바꿨습니다.`);
    await this.refresh();
  }

  async insertAfterParagraph(no: number, text: string): Promise<void> {
    await this.refresh();
    const para = this.findParagraph(no);
    const at = { sectionIndex: para.section, paragraphIndex: para.index, charOffset: para.text.length };
    await this.editor.replaceRange(at, at, `\n${text}`);
    this.report(`문단 ${no} 뒤에 넣었습니다. 뒤 번호가 하나씩 밀렸습니다.`);
    await this.refresh();
  }

  async deleteParagraph(no: number): Promise<void> {
    await this.refresh();
    const para = this.findParagraph(no);
    await this.editor.deleteParagraph(para.section, para.index);
    this.report(`문단 ${no}을(를) 삭제했습니다. 뒤 번호가 하나씩 당겨졌습니다.`);
    await this.refresh();
  }

  async setCell(tableNo: number, row: number, col: number, text: string): Promise<void> {
    await this.refresh();
    const table = this.tables()[tableNo - 1];
    if (!table) throw new Error(`표 ${tableNo}이(가) 없습니다. 1~${this.tables().length}번입니다.`);
    const cell = table.cells.find(
      (item) =>
        row - 1 >= item.row &&
        row - 1 < item.row + Math.max(1, item.rowSpan) &&
        col - 1 >= item.col &&
        col - 1 < item.col + Math.max(1, item.colSpan),
    );
    if (!cell) throw new Error(`표 ${tableNo}에 ${row}행 ${col}열이 없습니다.`);
    await this.editor.setCellText(table, cell.cell, text);
    this.report(`표 ${tableNo}의 ${row}행 ${col}열을 바꿨습니다.`);
    await this.refresh();
  }

  async replaceAll(find: string, replacement: string): Promise<number> {
    if (!find) throw new Error('찾을 내용을 입력하세요.');
    const res = await this.editor.replaceAll(find, replacement);
    const count = res?.ok ? Number(res.count ?? 0) : 0;
    this.report(count > 0 ? `${count}곳을 바꿨습니다.` : `'${find}'을(를) 찾지 못했습니다.`, count === 0);
    await this.refresh();
    return count;
  }

  async replaceSelection(text: string): Promise<void> {
    const sel = await this.editor.getSelection();
    if (!sel?.hasSelection || !sel.start || !sel.end) throw new Error('선택된 글자가 없습니다. 편집기에서 먼저 드래그하세요.');
    await this.editor.replaceRange(sel.start, sel.end, text);
    this.report('선택 영역을 바꿨습니다.');
    await this.refresh();
  }

  private showSelection(sel: EditorSelection): void {
    this.selection = sel.hasSelection && sel.text ? sel.text : '';
    this.els.selectionNow.textContent = this.selection || '선택된 글자가 없습니다.';
  }

  private bindForms(): void {
    const run = (work: () => Promise<unknown>) => async () => {
      try {
        if (!this.hasDocument()) throw new Error('먼저 문서를 열거나 템플릿을 불러오세요.');
        await work();
      } catch (err) {
        this.report(err instanceof Error ? err.message : String(err), true);
      }
    };
    this.els.paraForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const action = ((event as SubmitEvent).submitter as HTMLButtonElement | null)?.value ?? 'replace';
      const no = Number(this.els.paraNo.value);
      const text = this.els.paraText.value;
      void run(async () => {
        if (action === 'delete') await this.deleteParagraph(no);
        else if (action === 'insert') await this.insertAfterParagraph(no, text);
        else await this.replaceParagraph(no, text);
      })();
    });
    this.els.cellForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void run(() =>
        this.setCell(Number(this.els.cellTable.value), Number(this.els.cellRow.value), Number(this.els.cellCol.value), this.els.cellText.value),
      )();
    });
    this.els.replaceForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void run(() => this.replaceAll(this.els.findInput.value, this.els.replaceInput.value))();
    });
    this.els.selectionForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void run(() => this.replaceSelection(this.els.selectionNew.value))();
    });
  }
}

function numberBlocks(blocks: OutlineBlock[]): Item[] {
  const items: Item[] = [];
  let paragraphCount = 0;
  let tableCount = 0;
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      paragraphCount += 1;
      items.push({ kind: 'p', para: { ...block, no: paragraphCount } });
    } else {
      tableCount += 1;
      items.push({ kind: 't', table: { ...block, no: tableCount, anchorNo: paragraphCount } });
    }
  }
  return items;
}

function paragraphLine(para: NumberedParagraph): string {
  return para.text.trim() ? `문단 ${para.no}: ${para.text}` : '';
}

function renderParagraph(para: NumberedParagraph): HTMLElement | null {
  const line = paragraphLine(para);
  if (!line) return null;
  const node = document.createElement('p');
  node.className = 'ol-para';
  const label = document.createElement('span');
  label.className = 'ol-no';
  label.textContent = `문단 ${para.no}`;
  node.append(label, document.createTextNode(` ${para.text}`));
  return node;
}

function tableLines(table: NumberedTable): string {
  const cells = [...table.cells]
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .map((cell) => `${cell.row + 1}행 ${cell.col + 1}열: ${cell.text.replace(/\n/g, ' / ')}`);
  return [`표 ${table.no} (${table.rows}행 ${table.cols}열, 문단 ${table.anchorNo} 안)`, ...cells].join('\n');
}

function renderTable(table: NumberedTable): HTMLElement {
  const node = document.createElement('table');
  node.className = 'ol-table';
  const caption = document.createElement('caption');
  caption.textContent = `표 ${table.no}, ${table.rows}행 ${table.cols}열, 문단 ${table.anchorNo} 안`;
  node.appendChild(caption);
  const byRow = new Map<number, NumberedTable['cells']>();
  for (const cell of table.cells) byRow.set(cell.row, [...(byRow.get(cell.row) ?? []), cell]);
  for (let row = 0; row < table.rows; row += 1) {
    const tr = document.createElement('tr');
    const head = document.createElement('th');
    head.scope = 'row';
    head.textContent = `${row + 1}행`;
    tr.appendChild(head);
    for (const cell of (byRow.get(row) ?? []).sort((a, b) => a.col - b.col)) {
      const td = document.createElement('td');
      if (cell.colSpan > 1) td.colSpan = cell.colSpan;
      if (cell.rowSpan > 1) td.rowSpan = cell.rowSpan;
      td.textContent = cell.text || '빈칸';
      tr.appendChild(td);
    }
    node.appendChild(tr);
  }
  return node;
}
