// postMessage bridge to the embedded rhwp editor (/editor/).

export interface EditorPosition {
  sectionIndex: number;
  paragraphIndex: number;
  charOffset: number;
  parentParaIndex?: number;
  controlIndex?: number;
  cellIndex?: number;
  cellParaIndex?: number;
}

export interface EditorSelection {
  hasSelection: boolean;
  start?: EditorPosition;
  end?: EditorPosition;
  text?: string;
}

export interface ParagraphBlock {
  type: 'paragraph';
  section: number;
  index: number;
  text: string;
}

export interface TableBlock {
  type: 'table';
  section: number;
  paragraph: number;
  control: number;
  rows: number;
  cols: number;
  cells: { cell: number; row: number; col: number; rowSpan: number; colSpan: number; text: string }[];
}

export type OutlineBlock = ParagraphBlock | TableBlock;

type Pending = { resolve: (value: any) => void; reject: (err: Error) => void; timer: number };

export class EditorBridge {
  private seq = 0;
  private pending = new Map<number, Pending>();
  private changeListeners: (() => void)[] = [];
  private selectionListeners: ((sel: EditorSelection) => void)[] = [];

  constructor(private frame: HTMLIFrameElement) {
    window.addEventListener('message', (event) => {
      if (event.source !== this.frame.contentWindow) return;
      const msg = event.data;
      if (msg?.type === 'rhwp-document-changed') {
        this.changeListeners.forEach((fn) => fn());
        return;
      }
      if (msg?.type === 'rhwp-selection') {
        this.selectionListeners.forEach((fn) => fn(msg.payload ?? { hasSelection: false }));
        return;
      }
      if (!msg || msg.type !== 'rhwp-response') return;
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) entry.reject(new Error(String(msg.error)));
      else entry.resolve(msg.result);
    });
  }

  onDocumentChanged(fn: () => void): void {
    this.changeListeners.push(fn);
  }

  onSelectionChanged(fn: (sel: EditorSelection) => void): void {
    this.selectionListeners.push(fn);
  }

  request<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs = 30000): Promise<T> {
    const target = this.frame.contentWindow;
    if (!target) return Promise.reject(new Error('편집기가 아직 열리지 않았습니다.'));
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`편집기 응답 시간 초과: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      target.postMessage({ type: 'rhwp-request', id, method, params }, window.location.origin);
    });
  }

  async waitUntilReady(maxWaitMs = 30000): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < maxWaitMs) {
      try {
        await this.request('ready', {}, 1500);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    throw new Error('편집기를 불러오지 못했습니다.');
  }

  loadFile(data: ArrayBuffer, fileName: string): Promise<{ pageCount: number }> {
    return this.request('loadFile', { data, fileName }, 60000);
  }

  newDocument(): Promise<{ pageCount: number }> {
    return this.request('newDocument');
  }

  async exportHwp(): Promise<Uint8Array> {
    const res = await this.request<{ base64: string }>('exportBytes', {}, 60000);
    const binary = atob(res?.base64 ?? '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async getParagraphs(): Promise<{ section: number; index: number; text: string }[]> {
    const res = await this.request<{ sections: string[][] }>('getDocumentText');
    return (res?.sections ?? []).flatMap((paragraphs, section) =>
      paragraphs.map((text, index) => ({ section, index, text })),
    );
  }

  async getOutline(): Promise<OutlineBlock[]> {
    const res = await this.request<{ blocks: OutlineBlock[] }>('getDocumentOutline', {}, 60000);
    return res?.blocks ?? [];
  }

  setCellText(table: TableBlock, cell: number, text: string): Promise<unknown> {
    return this.request('setCellText', {
      section: table.section,
      paragraph: table.paragraph,
      control: table.control,
      cell,
      text,
    });
  }

  deleteParagraph(section: number, paragraph: number): Promise<unknown> {
    return this.request('deleteParagraph', { section, paragraph });
  }

  getSelection(): Promise<EditorSelection> {
    return this.request('getSelection');
  }

  getCursor(): Promise<EditorPosition | null> {
    return this.request('getCursor');
  }

  replaceAll(query: string, newText: string): Promise<{ ok: boolean; count?: number }> {
    return this.request('replaceAll', { query, newText });
  }

  replaceRange(start: EditorPosition, end: EditorPosition, newText: string): Promise<unknown> {
    return this.request('applyEdit', {
      section: start.sectionIndex,
      start,
      end,
      startPara: start.paragraphIndex,
      endPara: end.paragraphIndex,
      startChar: start.charOffset,
      endChar: end.charOffset,
      newText,
    });
  }
}
