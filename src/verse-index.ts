import { App, Platform, TAbstractFile, TFile } from "obsidian";
import { BibleData } from "./bible-data";
import { BOOK_BY_ABBREV, BookInfo } from "./books";
import { extractVerseTexts } from "./note-parser";
import { normalizeText } from "./search";
import { IndexEntry, Version } from "./types";

/**
 * 본문 키워드 검색용 전체 구절 인덱스.
 *
 * - lazy 빌드: 첫 키워드 검색 시 ensureBuilt() 호출 (참조 검색에는 비용 0)
 * - 디스크 캐시: {플러그인 폴더}/verse-index.json — 파일 수·최종 수정시각이
 *   일치하면 재시작 후에도 전체 읽기 없이 ~1초 내 로드
 * - 세션 내 증분 갱신: vault 파일 이벤트로 해당 절만 재파싱
 */

const SCHEMA_VERSION = 1;
/** 청크 크기 — 청크마다 이벤트 루프에 양보해 UI 프리즈를 막는다 */
const CHUNK_SIZE = 200;

interface CacheMeta {
  schemaVersion: number;
  biblePath: string;
  fileCount: number;
  maxMtime: number;
}

interface CacheFile extends CacheMeta {
  entries: IndexEntry[];
}

export type IndexStatus = "idle" | "building" | "ready";

const VERSE_FILE_RE = /^([가-힣]+)(\d+)_(\d+)\.md$/;

const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** 전역 정경 순 정렬 키 (구약 1-39, 신약 40-66) */
function makeSortKey(book: BookInfo, chapter: number, verse: number): number {
  const globalOrder = book.testament === "신약" ? book.order + 39 : book.order;
  return globalOrder * 1_000_000 + chapter * 1_000 + verse;
}

export class VerseIndex {
  private _entries: IndexEntry[] = [];
  private _status: IndexStatus = "idle";
  private buildPromise: Promise<string | null> | null = null;

  constructor(
    private app: App,
    private data: BibleData,
    private getBiblePath: () => string,
    private cacheFilePath: string,
  ) {}

  get status(): IndexStatus {
    return this._status;
  }

  /** ready 전에는 빈 배열 */
  get entries(): IndexEntry[] {
    return this._status === "ready" ? this._entries : [];
  }

  /** 설정(성경 폴더 경로) 변경 시 호출 — 다음 검색 때 다시 빌드된다 */
  invalidate() {
    this._entries = [];
    this._status = "idle";
  }

  /**
   * 인덱스를 준비시킨다 (디스크 캐시 로드 또는 전체 빌드).
   * 성공 시 null, 실패 시 사용자 안내 문구(한국어)를 반환한다.
   * 동시 호출은 진행 중인 빌드를 공유한다 (single-flight).
   */
  ensureBuilt(onProgress?: (done: number, total: number) => void): Promise<string | null> {
    if (this._status === "ready") return Promise.resolve(null);
    if (this.buildPromise) return this.buildPromise;
    if (Platform.isMobile) {
      return Promise.resolve(
        "모바일에서는 본문 키워드 검색을 지원하지 않습니다 (장절 참조 검색은 가능).",
      );
    }
    this._status = "building";
    this.buildPromise = this.doBuild(onProgress)
      .catch((e) => {
        console.error("[a4p-bible-verse] 인덱스 빌드 실패", e);
        return "본문 인덱스 생성에 실패했습니다. 콘솔 로그를 확인해주세요.";
      })
      .then((result) => {
        if (result !== null) this._status = "idle"; // 실패 → 다음 검색에서 재시도
        return result;
      })
      .finally(() => {
        this.buildPromise = null;
      });
    return this.buildPromise;
  }

  private async doBuild(onProgress?: (done: number, total: number) => void): Promise<string | null> {
    const enumerated = this.data.enumerateVerseFiles();
    if (!enumerated.ok) return enumerated.reason;
    const { files } = enumerated;

    const meta: CacheMeta = {
      schemaVersion: SCHEMA_VERSION,
      biblePath: this.getBiblePath().replace(/\/+$/, ""),
      fileCount: files.length,
      maxMtime: files.reduce((max, f) => Math.max(max, f.file.stat.mtime), 0),
    };

    if (await this.loadCache(meta)) return null;

    const entries: IndexEntry[] = [];
    for (let i = 0; i < files.length; i += CHUNK_SIZE) {
      const chunk = files.slice(i, i + CHUNK_SIZE);
      const parsed = await Promise.all(
        chunk.map(async ({ file, book, chapter, verse }) => {
          const content = await this.app.vault.cachedRead(file);
          return this.toEntry(book, chapter, verse, file.path, content);
        }),
      );
      entries.push(...parsed);
      onProgress?.(Math.min(i + CHUNK_SIZE, files.length), files.length);
      await yieldToUI();
    }

    this._entries = entries;
    this._status = "ready";
    // 저장은 비동기로 — 첫 검색 응답을 캐시 쓰기(수십 MB)로 지연시키지 않는다
    void this.saveCache(meta, entries);
    return null;
  }

  private toEntry(
    book: BookInfo,
    chapter: number,
    verse: number,
    path: string,
    content: string,
  ): IndexEntry {
    const texts = extractVerseTexts(content);
    for (const key of Object.keys(texts) as Version[]) {
      texts[key] = normalizeText(texts[key]!);
    }
    return {
      abbrev: book.abbrev,
      bookName: book.name,
      sortKey: makeSortKey(book, chapter, verse),
      chapter,
      verse,
      linkTarget: `${book.abbrev}${chapter}_${verse}`,
      path,
      texts,
    };
  }

  // ── 디스크 캐시 ────────────────────────────────────────

  private async loadCache(meta: CacheMeta): Promise<boolean> {
    try {
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(this.cacheFilePath))) return false;
      const raw = JSON.parse(await adapter.read(this.cacheFilePath)) as Partial<CacheFile>;
      if (
        raw.schemaVersion !== meta.schemaVersion ||
        raw.biblePath !== meta.biblePath ||
        raw.fileCount !== meta.fileCount ||
        raw.maxMtime !== meta.maxMtime ||
        !Array.isArray(raw.entries)
      ) {
        return false;
      }
      this._entries = raw.entries as IndexEntry[];
      this._status = "ready";
      return true;
    } catch (e) {
      console.warn("[a4p-bible-verse] 인덱스 캐시 로드 실패 — 다시 생성합니다", e);
      return false;
    }
  }

  private async saveCache(meta: CacheMeta, entries: IndexEntry[]): Promise<void> {
    try {
      const payload: CacheFile = { ...meta, entries };
      await this.app.vault.adapter.write(this.cacheFilePath, JSON.stringify(payload));
    } catch (e) {
      console.warn("[a4p-bible-verse] 인덱스 캐시 저장 실패 (기능에는 영향 없음)", e);
    }
  }

  // ── 세션 내 증분 갱신 ──────────────────────────────────

  /** vault 파일 이벤트 처리 — 인덱스가 준비된 뒤에만 의미 있음 */
  handleFileEvent(
    file: TAbstractFile,
    kind: "modify" | "create" | "delete" | "rename",
    oldPath?: string,
  ): void {
    if (this._status !== "ready") return;
    if (kind === "rename" && oldPath) this.removeByPath(oldPath);
    if (kind === "delete") {
      this.removeByPath(file.path);
      return;
    }
    if (file instanceof TFile) void this.addOrUpdate(file);
  }

  /** 경로가 성경 폴더 하위의 구절 노트인지 판별 */
  private parseVersePath(
    path: string,
  ): { book: BookInfo; chapter: number; verse: number } | null {
    const base = this.getBiblePath().replace(/\/+$/, "");
    if (!base || !path.startsWith(base + "/")) return null;
    const name = path.split("/").pop() ?? "";
    const m = name.match(VERSE_FILE_RE);
    if (!m) return null;
    const book = BOOK_BY_ABBREV.get(m[1]);
    if (!book) return null;
    return { book, chapter: parseInt(m[2], 10), verse: parseInt(m[3], 10) };
  }

  private removeByPath(path: string): void {
    if (!this.parseVersePath(path)) return;
    const idx = this._entries.findIndex((e) => e.path === path);
    if (idx !== -1) this._entries.splice(idx, 1);
  }

  private async addOrUpdate(file: TFile): Promise<void> {
    const parsed = this.parseVersePath(file.path);
    if (!parsed) return;
    const content = await this.app.vault.cachedRead(file);
    const entry = this.toEntry(parsed.book, parsed.chapter, parsed.verse, file.path, content);
    const existing = this._entries.findIndex((e) => e.path === file.path);
    if (existing !== -1) {
      this._entries[existing] = entry;
      return;
    }
    // 정경 순 위치에 삽입 (드문 이벤트라 선형 탐색으로 충분)
    const at = this._entries.findIndex((e) => e.sortKey > entry.sortKey);
    if (at === -1) this._entries.push(entry);
    else this._entries.splice(at, 0, entry);
  }
}
