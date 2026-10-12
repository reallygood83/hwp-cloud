import {
  Bytes,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type Timestamp,
} from 'firebase/firestore';
import { firestore } from './firebase';

export interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  fileName: string;
  format: 'hwp' | 'hwpx';
  size: number;
  createdAt: Date | null;
}

export interface TemplateStore {
  readonly kind: 'cloud' | 'local';
  list(): Promise<TemplateMeta[]>;
  save(input: { name: string; description: string; fileName: string; bytes: Uint8Array }): Promise<TemplateMeta>;
  load(id: string): Promise<{ meta: TemplateMeta; bytes: Uint8Array }>;
  remove(id: string): Promise<void>;
}

export const MAX_TEMPLATE_BYTES = 20 * 1024 * 1024;
// Firestore documents are capped at 1 MiB, so file bytes are split across chunk documents.
const CHUNK_BYTES = 700 * 1024;

export function detectFormat(bytes: Uint8Array, fileName = ''): 'hwp' | 'hwpx' {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'hwpx';
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return 'hwp';
  return fileName.toLowerCase().endsWith('.hwpx') ? 'hwpx' : 'hwp';
}

export function withFormatExtension(name: string, format: 'hwp' | 'hwpx'): string {
  return `${name.replace(/\.(hwp|hwpx)$/i, '')}.${format}`;
}

function validate(name: string, bytes: Uint8Array): void {
  if (!name.trim()) throw new Error('템플릿 이름을 입력하세요.');
  if (name.length > 100) throw new Error('템플릿 이름은 100자 이하로 입력하세요.');
  if (bytes.length === 0) throw new Error('빈 파일은 저장할 수 없습니다.');
  if (bytes.length > MAX_TEMPLATE_BYTES) throw new Error('20MB보다 큰 파일은 템플릿으로 저장할 수 없습니다.');
}

function newId(): string {
  return `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

export class CloudTemplateStore implements TemplateStore {
  readonly kind = 'cloud' as const;

  constructor(private uid: string) {}

  private templatesCol() {
    return collection(firestore(), 'users', this.uid, 'templates');
  }

  private toMeta(id: string, data: Record<string, any>): TemplateMeta {
    const created = data.createdAt as Timestamp | null | undefined;
    return {
      id,
      name: String(data.name ?? ''),
      description: String(data.description ?? ''),
      fileName: String(data.fileName ?? ''),
      format: data.format === 'hwpx' ? 'hwpx' : 'hwp',
      size: Number(data.size ?? 0),
      createdAt: created?.toDate ? created.toDate() : null,
    };
  }

  async list(): Promise<TemplateMeta[]> {
    const snap = await getDocs(query(this.templatesCol(), orderBy('createdAt', 'desc')));
    return snap.docs.map((d) => this.toMeta(d.id, d.data()));
  }

  async save(input: { name: string; description: string; fileName: string; bytes: Uint8Array }): Promise<TemplateMeta> {
    validate(input.name, input.bytes);
    const id = newId();
    const format = detectFormat(input.bytes, input.fileName);
    const chunkCount = Math.ceil(input.bytes.length / CHUNK_BYTES);
    const ref = doc(this.templatesCol(), id);
    // Chunks first: the template only appears in the list once its metadata exists.
    await Promise.all(
      Array.from({ length: chunkCount }, (_, i) =>
        setDoc(doc(ref, 'chunks', String(i)), {
          data: Bytes.fromUint8Array(input.bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)),
        }),
      ),
    );
    const data = {
      name: input.name.trim(),
      description: input.description.trim(),
      fileName: withFormatExtension(input.fileName || input.name, format),
      format,
      size: input.bytes.length,
      chunkCount,
      createdAt: serverTimestamp(),
    };
    await setDoc(ref, data);
    return { ...this.toMeta(id, data), createdAt: new Date() };
  }

  async load(id: string): Promise<{ meta: TemplateMeta; bytes: Uint8Array }> {
    const ref = doc(this.templatesCol(), id);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('템플릿을 찾을 수 없습니다.');
    const data = snap.data();
    const chunkCount = Number(data.chunkCount ?? 0);
    const parts = await Promise.all(
      Array.from({ length: chunkCount }, async (_, i) => {
        const chunk = await getDoc(doc(ref, 'chunks', String(i)));
        if (!chunk.exists()) throw new Error('템플릿 파일 일부가 없습니다. 다시 저장해 주세요.');
        return (chunk.data().data as Bytes).toUint8Array();
      }),
    );
    const bytes = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    if (bytes.length !== Number(data.size)) throw new Error('템플릿 파일 크기가 맞지 않습니다. 다시 저장해 주세요.');
    return { meta: this.toMeta(id, data), bytes };
  }

  async remove(id: string): Promise<void> {
    const ref = doc(this.templatesCol(), id);
    const snap = await getDoc(ref);
    const chunkCount = snap.exists() ? Number(snap.data().chunkCount ?? 0) : 0;
    await deleteDoc(ref);
    await Promise.all(Array.from({ length: chunkCount }, (_, i) => deleteDoc(doc(ref, 'chunks', String(i)))));
  }
}

const DB_NAME = 'hwp-cloud';
const STORE = 'templates';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = run(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Browser-only fallback used when Firebase is not configured. */
export class LocalTemplateStore implements TemplateStore {
  readonly kind = 'local' as const;

  async list(): Promise<TemplateMeta[]> {
    const rows = await tx<any[]>('readonly', (s) => s.getAll());
    return rows
      .map(({ bytes: _bytes, ...meta }) => meta as TemplateMeta)
      .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  }

  async save(input: { name: string; description: string; fileName: string; bytes: Uint8Array }): Promise<TemplateMeta> {
    validate(input.name, input.bytes);
    const format = detectFormat(input.bytes, input.fileName);
    const meta: TemplateMeta = {
      id: newId(),
      name: input.name.trim(),
      description: input.description.trim(),
      fileName: withFormatExtension(input.fileName || input.name, format),
      format,
      size: input.bytes.length,
      createdAt: new Date(),
    };
    await tx('readwrite', (s) => s.put({ ...meta, bytes: input.bytes.slice() }));
    return meta;
  }

  async load(id: string): Promise<{ meta: TemplateMeta; bytes: Uint8Array }> {
    const row = await tx<any>('readonly', (s) => s.get(id));
    if (!row) throw new Error('템플릿을 찾을 수 없습니다.');
    const { bytes, ...meta } = row;
    return { meta: meta as TemplateMeta, bytes: new Uint8Array(bytes) };
  }

  async remove(id: string): Promise<void> {
    await tx('readwrite', (s) => s.delete(id));
  }
}
