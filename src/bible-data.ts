import { App, TFile, TFolder } from "obsidian";
import { BOOK_BY_ABBREV, BOOKS, BookInfo, bookByFolderName } from "./books";
import { extractVerseTexts, stripAnnotations } from "./note-parser";
import {
  bookFolderMissingReason,
  buildCommentaryIndex,
  isUnderFolder,
  matchBookFolders,
  normalizeFolderPath,
} from "./paths";
import { BibleReference, VerseData, Version } from "./types";
import {
  BOOK_SCAN_DEPTH,
  FlatEntry,
  VERSE_FILE_RE,
  VerseFileIndex,
  diagnoseBookFolder,
  formatBookDiagnosis,
  indexVerseFiles,
  nfc,
} from "./verse-files";

/** BibleData가 참조하는 폴더 경로 설정 묶음 (전부 볼트 루트 기준) */
export interface PathSettings {
  otPath: string;
  ntPath: string;
  commentaryPath: string;
  sermonFolder: string;
}

export interface LoadResult {
  verses: VerseData[];
  /** 범위가 실제 절 수를 넘어 잘렸을 때의 안내 문구 */
  notice?: string;
}

export type LoadOutcome = { ok: true; result: LoadResult } | { ok: false; reason: string };

/** frontmatter 값("[[롬5_8]]" 문자열 리스트)에서 링크 대상만 추출 */
function extractRefLinks(value: unknown): string[] {
  const arr = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return arr
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.match(/\[\[([^\]|]+)/)?.[1]?.trim() ?? "")
    .filter(Boolean);
}

/**
 * 볼트의 성경 구절 노트 접근 계층.
 * 인덱스 없이 파일명 규칙으로 O(1) 조회하고, 폴더 매핑·장 절 목록만 캐시한다.
 */
/** 정본 성경 노트 패키지의 절 파일 수 — 동기화 미완료·부분 설치 판별용 소프트 기준 */
const EXPECTED_VERSE_FILES = { 구약: 23_145, 신약: 7_959 } as const;

export class BibleData {
  private folderCache: Map<string, TFolder> | null = null;
  /** 책 약자 → 절 파일 인덱스 (책 폴더 내부 재귀 스캔, lazy) */
  private bookFileCache = new Map<string, VerseFileIndex<TFile>>();
  private duplicateBookFolders: string[] = [];
  /** 설정된 루트 경로가 볼트에 없을 때의 testament별 에러 — folderCache와 같은 세대 */
  private rootErrors = new Map<"구약" | "신약", string>();
  /** `${책이름}|${장}` → 통합주석 노트 경로 */
  private commentaryIndex: Map<string, string> | null = null;

  constructor(
    private app: App,
    private getPaths: () => PathSettings,
  ) {}

  private otPath(): string {
    return normalizeFolderPath(this.getPaths().otPath);
  }

  private ntPath(): string {
    return normalizeFolderPath(this.getPaths().ntPath);
  }

  private commentaryRoot(): string {
    return normalizeFolderPath(this.getPaths().commentaryPath);
  }

  /** 설정(폴더 경로) 변경 시 호출 */
  invalidate() {
    this.folderCache = null;
    this.bookFileCache.clear();
    this.commentaryIndex = null;
    this.rootErrors.clear();
  }

  /**
   * vault 파일 이벤트 — 성경 루트 하위의 절 파일이면 해당 책 캐시만 무효화.
   * iCloud·OneDrive가 파일을 뒤늦게 내려받는 동안에도 재시작 없이 자동 회복된다.
   */
  handleVaultChange(path: string): void {
    const bases = [this.otPath(), this.ntPath()].filter(Boolean);
    if (bases.length === 0) return;
    const p = nfc(path);
    if (!bases.some((b) => isUnderFolder(p, nfc(b)))) return;
    const m = nfc(path.split("/").pop() ?? "").match(VERSE_FILE_RE);
    if (!m || !BOOK_BY_ABBREV.has(m[1])) return;
    this.bookFileCache.delete(m[1]);
    // 인식된 적 없는 책의 절 파일이 나타나면(책 폴더가 뒤늦게 동기화) 폴더 캐시도 재구축
    if (this.folderCache && !this.folderCache.has(m[1])) this.folderCache = null;
  }

  /** 주석 폴더 경로 변경·주석 파일 변동 시 호출 */
  invalidateCommentary() {
    this.commentaryIndex = null;
  }

  /** 책 약자 → 책 폴더 매핑을 lazy 구축. 실패 시 사용자 안내 문구 반환. */
  private ensureFolderCache(): string | null {
    if (this.folderCache) return null;
    const roots: Array<{ label: "구약" | "신약"; path: string }> = [
      { label: "구약", path: this.otPath() },
      { label: "신약", path: this.ntPath() },
    ];
    if (!roots.some((r) => r.path)) {
      return "성경 폴더가 아직 설정되지 않았습니다. 설정 → A4P 성경구절에서 구약·신약 성경 폴더를 선택해주세요.";
    }
    this.rootErrors.clear();

    // 중간 폴더의 이름·개수와 무관하게 각 루트에서 깊이 3까지 책 폴더를 찾는다.
    // 책 폴더로 확정된 폴더 아래로는 내려가지 않는다 (절 파일 수천 개 스캔 방지).
    // 두 루트가 같거나 겹쳐도 visited로 중복 수집을 막는다.
    const flat: Array<{ path: string; name: string; folder: TFolder }> = [];
    const visited = new Set<string>();
    const walk = (folder: TFolder, depth: number) => {
      if (depth > 3) return;
      for (const child of folder.children) {
        if (!(child instanceof TFolder) || visited.has(child.path)) continue;
        visited.add(child.path);
        flat.push({ path: child.path, name: child.name, folder: child });
        if (!bookByFolderName(child.name)) walk(child, depth + 1);
      }
    };
    let configured = 0;
    for (const r of roots) {
      if (!r.path) continue;
      configured++;
      const base = this.app.vault.getAbstractFileByPath(r.path);
      if (!(base instanceof TFolder)) {
        // 한쪽 경로가 잘못돼도 다른 쪽 성경은 계속 동작해야 한다 — testament별 에러로 보관
        this.rootErrors.set(r.label, `${r.label} 성경 폴더를 찾을 수 없습니다: "${r.path}"`);
        continue;
      }
      walk(base, 1);
    }
    if (this.rootErrors.size === configured) {
      return [...this.rootErrors.values()].join(" ");
    }

    const { byAbbrev, duplicates } = matchBookFolders(flat);
    if (byAbbrev.size === 0) {
      const rootNote = this.rootErrors.size > 0 ? [...this.rootErrors.values()].join(" ") + " " : "";
      return `${rootNote}설정한 성경 폴더 아래에서 책 폴더(01.창세기 …)를 찾지 못했습니다. 성경 노트 패키지를 넣은 폴더를 정확히 선택했는지 확인해주세요.`;
    }

    const byPath = new Map(flat.map((f) => [f.path, f.folder]));
    const cache = new Map<string, TFolder>();
    for (const [abbrev, path] of byAbbrev) cache.set(abbrev, byPath.get(path)!);
    this.folderCache = cache;
    this.duplicateBookFolders = duplicates;
    return null;
  }

  /** TFolder 서브트리를 FlatEntry 목록으로 BFS 평탄화 (verse-files 순수 함수의 입력) */
  private flattenFolder(root: TFolder, maxDepth: number): Array<FlatEntry<TFile>> {
    const out: Array<FlatEntry<TFile>> = [];
    let level: TFolder[] = [root];
    for (let depth = 1; depth <= maxDepth && level.length > 0; depth++) {
      const next: TFolder[] = [];
      for (const f of level) {
        for (const child of f.children) {
          if (child instanceof TFolder) {
            out.push({ name: child.name, depth, isFolder: true });
            next.push(child);
          } else if (child instanceof TFile) {
            out.push({ name: child.name, depth, isFolder: false, file: child });
          }
        }
      }
      level = next;
    }
    return out;
  }

  /**
   * 책의 절 파일 인덱스를 lazy 구축 — 책 폴더 내부를 깊이 제한 재귀로 스캔해
   * 압축 해제 이중 폴더·장별 하위 폴더·NFD 파일명 배치를 흡수한다.
   */
  private ensureBookFiles(abbrev: string): VerseFileIndex<TFile> | null {
    const cached = this.bookFileCache.get(abbrev);
    if (cached) return cached;
    const folder = this.folderCache?.get(abbrev);
    if (!folder) return null;
    const idx = indexVerseFiles(abbrev, this.flattenFolder(folder, BOOK_SCAN_DEPTH));
    this.bookFileCache.set(abbrev, idx);
    return idx;
  }

  /** 해당 장에 실재하는 절 번호 목록 (정렬됨). 장이 없으면 빈 배열. */
  private chapterVerses(abbrev: string, chapter: number): number[] {
    return this.ensureBookFiles(abbrev)?.chapters.get(chapter) ?? [];
  }

  /** 책의 마지막 장 번호 (없는 장 안내용) */
  private maxChapter(abbrev: string): number {
    return this.ensureBookFiles(abbrev)?.maxChapter ?? 0;
  }

  /**
   * 본문 인덱스 빌드용: 전체 구절 노트 파일을 정경 순(구약→신약, 장→절)으로 열거한다.
   * BOOKS 배열이 정경 순이므로 반환 배열도 정렬 상태다.
   */
  enumerateVerseFiles():
    | { ok: true; files: Array<{ file: TFile; book: BookInfo; chapter: number; verse: number }> }
    | { ok: false; reason: string } {
    const err = this.ensureFolderCache();
    if (err) return { ok: false, reason: err };

    const files: Array<{ file: TFile; book: BookInfo; chapter: number; verse: number }> = [];
    for (const book of BOOKS) {
      const idx = this.ensureBookFiles(book.abbrev);
      if (!idx) continue;
      for (const chapter of [...idx.chapters.keys()].sort((a, b) => a - b)) {
        for (const verse of idx.chapters.get(chapter)!) {
          const file = idx.byLink.get(`${book.abbrev}${chapter}_${verse}`);
          if (file) files.push({ file, book, chapter, verse });
        }
      }
    }
    if (files.length === 0) {
      return { ok: false, reason: "성경 폴더에서 구절 노트를 찾지 못했습니다." };
    }
    return { ok: true, files };
  }

  /** 설정 탭의 구약/신약 폴더 검증 버튼용: 경로·책 폴더 인식·샘플 절 읽기를 점검한다. */
  async validateTestament(testament: "구약" | "신약"): Promise<{ ok: boolean; messages: string[] }> {
    const path = testament === "구약" ? this.otPath() : this.ntPath();
    if (!path) {
      return {
        ok: false,
        messages: [`${testament} 성경 폴더가 아직 설정되지 않았습니다. 폴더를 선택한 뒤 다시 검증해주세요.`],
      };
    }

    this.invalidate();
    const err = this.ensureFolderCache();
    if (err) return { ok: false, messages: [err] };
    // 비차단 캐시 빌드에서 이쪽 루트만 실패했을 수 있다 — 검증 버튼은 정확한 에러를 보여야 함
    const rootError = this.rootErrors.get(testament);
    if (rootError) return { ok: false, messages: [rootError] };

    const cache = this.folderCache!;
    const messages: string[] = [];
    let ok = true;

    const books = BOOKS.filter((b) => b.testament === testament);
    const found = books.filter((b) => cache.has(b.abbrev));
    if (found.length === books.length) {
      messages.push(`✅ ${testament} ${books.length}권 모두 인식됨`);
    } else {
      ok = false;
      const missing = books
        .filter((b) => !cache.has(b.abbrev))
        .map((b) => b.name)
        .join(", ");
      messages.push(
        `⚠️ ${testament} ${books.length}권 중 ${found.length}권 인식 — 누락: ${missing}`,
      );
    }

    // 절 파일 총수 — 동기화 미완료(iCloud·OneDrive 주문형)를 판별하는 가장 강한 신호
    const totalVerses = books.reduce(
      (n, b) => n + (this.ensureBookFiles(b.abbrev)?.byLink.size ?? 0),
      0,
    );
    const expected = EXPECTED_VERSE_FILES[testament];
    if (totalVerses === 0) {
      ok = false;
      messages.push(`⚠️ 책 폴더는 있지만 ${testament} 절 파일이 하나도 보이지 않습니다.`);
      messages.push(
        `📁 iCloud·OneDrive를 사용하시는 경우 폴더 모양만 먼저 만들어지고 파일은 아직 이 기기에 내려받아지지 않았을 수 있습니다. Finder(맥)나 파일 탐색기(윈도우)에서 성경 폴더를 마우스 오른쪽 버튼으로 눌러 "지금 다운로드"(iCloud) 또는 "이 장치에 항상 유지"(OneDrive)를 선택하고, 다운로드가 끝난 뒤 옵시디언을 껐다 켠 후 다시 검증해주세요.`,
      );
    } else if (totalVerses < expected) {
      ok = false;
      const emptyBooks = books
        .filter((b) => (this.ensureBookFiles(b.abbrev)?.byLink.size ?? 0) === 0)
        .map((b) => b.name);
      const emptyNote =
        emptyBooks.length > 0
          ? ` · 절 파일이 없는 책: ${emptyBooks.slice(0, 5).join(", ")}${emptyBooks.length > 5 ? ` 외 ${emptyBooks.length - 5}권` : ""}`
          : "";
      messages.push(
        `⚠️ ${testament} 절 파일 ${totalVerses.toLocaleString("ko-KR")}개 인식 — 예상(약 ${expected.toLocaleString("ko-KR")}개)보다 적습니다. 동기화가 아직 끝나지 않았거나 일부 파일이 빠졌을 수 있습니다${emptyNote}`,
      );
    } else {
      messages.push(`✅ ${testament} 절 파일 ${totalVerses.toLocaleString("ko-KR")}개 인식`);
    }
    const nfdTotal = books.reduce(
      (n, b) => n + (this.bookFileCache.get(b.abbrev)?.nfdFixed ?? 0),
      0,
    );
    if (nfdTotal > 0) {
      messages.push(
        `ℹ️ 일부 파일 이름이 자모가 분리된 형태(NFD)로 저장되어 있었지만 자동으로 보정해 인식했습니다.`,
      );
    }

    if (this.duplicateBookFolders.length > 0) {
      messages.push(
        `⚠️ 같은 책으로 인식되는 폴더가 2개 이상 있습니다 (먼저 찾은 폴더 사용): ${this.duplicateBookFolders.join(", ")}`,
      );
    }

    const sampleRef =
      testament === "구약"
        ? { abbrev: "창", bookName: "창세기", chapter: 1, verseStart: 1, verseEnd: 1 }
        : { abbrev: "요", bookName: "요한복음", chapter: 3, verseStart: 16, verseEnd: 16 };
    const sampleName = `${sampleRef.abbrev}${sampleRef.chapter}_${sampleRef.verseStart}`;
    const sample = await this.loadVerses(sampleRef);
    if (sample.ok && sample.result.verses[0]) {
      const versions = Object.keys(sample.result.verses[0].texts).length;
      if (versions > 0) {
        messages.push(`✅ 샘플 구절(${sampleName}) 읽기 성공 — 역본 ${versions}개 확인`);
      } else {
        ok = false;
        messages.push(
          `⚠️ ${sampleName}.md를 읽었지만 역본 콜아웃을 찾지 못했습니다 (노트 형식 확인 필요)`,
        );
      }
    } else {
      ok = false;
      const cause = sample.ok ? "" : ` — 원인: ${sample.reason}`;
      messages.push(`⚠️ 샘플 구절(${sampleName}.md)을 읽지 못했습니다${cause}`);
      // 절 파일이 아예 없는 경우는 위의 동기화 안내가 이미 원인을 설명한다
      const sampleFolder = cache.get(sampleRef.abbrev);
      if (totalVerses > 0 && sampleFolder) {
        messages.push(
          ...formatBookDiagnosis(
            sampleRef.bookName,
            sampleRef.abbrev,
            diagnoseBookFolder(
              sampleRef.abbrev,
              this.flattenFolder(sampleFolder, BOOK_SCAN_DEPTH + 2),
            ),
          ),
        );
      }
    }

    return { ok, messages };
  }

  /** 참조가 가리키는 절들의 본문을 로드한다 (범위 클램프·장 경계 범위 포함). */
  async loadVerses(ref: BibleReference, strip = false): Promise<LoadOutcome> {
    const folderError = this.ensureFolderCache();
    if (folderError) return { ok: false, reason: folderError };

    const folder = this.folderCache!.get(ref.abbrev);
    if (!folder) {
      // 우선순위: 해당 testament 루트 에러(경로 오타) > 미등록 안내 > 일반 문구
      const testament = BOOK_BY_ABBREV.get(ref.abbrev)?.testament;
      const rootError = testament ? this.rootErrors.get(testament) : undefined;
      if (rootError) return { ok: false, reason: rootError };
      return {
        ok: false,
        reason: bookFolderMissingReason(ref.abbrev, ref.bookName, {
          cachedAbbrevs: new Set(this.folderCache!.keys()),
          otPathSet: !!this.otPath(),
          ntPathSet: !!this.ntPath(),
        }),
      };
    }

    const unit = ref.bookName === "시편" ? "편" : "장";
    const available = this.chapterVerses(ref.abbrev, ref.chapter);
    if (available.length === 0) {
      const max = this.maxChapter(ref.abbrev);
      return {
        ok: false,
        reason:
          max > 0
            ? `${ref.bookName}은(는) ${max}${unit}까지 있습니다.`
            : `${ref.bookName}의 구절 노트가 없습니다.`,
      };
    }

    let targets: Array<{ chapter: number; verse: number }>;
    let notice: string | undefined;

    if (ref.chapterEnd !== undefined && ref.chapterEnd !== ref.chapter) {
      // 장 경계 범위 (요3:36-4:2)
      targets = [];
      for (let ch = ref.chapter; ch <= ref.chapterEnd; ch++) {
        const chVerses = this.chapterVerses(ref.abbrev, ch);
        if (chVerses.length === 0) {
          const max = this.maxChapter(ref.abbrev);
          return { ok: false, reason: `${ref.bookName}은(는) ${max}${unit}까지 있습니다.` };
        }
        const last = chVerses[chVerses.length - 1];
        let from = 1;
        let to = last;
        if (ch === ref.chapter) {
          if (ref.verseStart! > last) {
            return {
              ok: false,
              reason: `${ref.bookName} ${ch}${unit}은 ${last}절까지 있습니다.`,
            };
          }
          from = ref.verseStart!;
        }
        if (ch === ref.chapterEnd) {
          to = Math.min(ref.verseEnd!, last);
          if (ref.verseEnd! > last) {
            notice = `${ref.bookName} ${ch}${unit}은 ${last}절까지 있습니다 — ${ch}:${to}까지 표시합니다.`;
          }
        }
        for (const v of chVerses) if (v >= from && v <= to) targets.push({ chapter: ch, verse: v });
      }
    } else if (ref.verseStart === undefined) {
      targets = available.map((v) => ({ chapter: ref.chapter, verse: v }));
    } else {
      const lastVerse = available[available.length - 1];
      if (ref.verseStart > lastVerse) {
        return {
          ok: false,
          reason: `${ref.bookName} ${ref.chapter}${unit}은 ${lastVerse}절까지 있습니다.`,
        };
      }
      const end = Math.min(ref.verseEnd ?? ref.verseStart, lastVerse);
      if ((ref.verseEnd ?? ref.verseStart) > lastVerse) {
        notice = `${ref.bookName} ${ref.chapter}${unit}은 ${lastVerse}절까지 있습니다 — ${ref.verseStart}-${end}절로 표시합니다.`;
      }
      targets = available
        .filter((v) => v >= ref.verseStart! && v <= end)
        .map((v) => ({ chapter: ref.chapter, verse: v }));
    }

    const bookFiles = this.ensureBookFiles(ref.abbrev);
    const verses = await Promise.all(
      targets.map(async ({ chapter, verse }): Promise<VerseData> => {
        const linkTarget = `${ref.abbrev}${chapter}_${verse}`;
        // 직계 경로 조합 대신 재귀 인덱스 조회 — 중첩·NFD 실파일도 TFile 참조로 읽는다
        const file = bookFiles?.byLink.get(linkTarget);
        if (!file) return { chapter, verse, linkTarget, texts: {} };
        let content: string;
        try {
          content = await this.app.vault.cachedRead(file);
        } catch {
          // 동기화 중 삭제된 스테일 참조 — 미존재 파일과 동일하게 처리
          return { chapter, verse, linkTarget, texts: {} };
        }
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        const texts = extractVerseTexts(content);
        if (strip) {
          for (const key of Object.keys(texts) as Version[]) {
            texts[key] = stripAnnotations(texts[key]!);
          }
        }
        return {
          chapter,
          verse,
          linkTarget,
          path: file.path,
          texts,
          related: extractRefLinks(fm?.["관련구절"]),
          parallel: extractRefLinks(fm?.["평행본문"]),
        };
      }),
    );

    return { ok: true, result: { verses, notice } };
  }

  /** 주석 폴더(볼트 루트 기준) 아래 전체 md 파일에서 통합주석 인덱스를 lazy 구축 */
  private ensureCommentaryIndex(): Map<string, string> | null {
    if (this.commentaryIndex) return this.commentaryIndex;
    const root = this.commentaryRoot();
    if (!root) return null;
    const folder = this.app.vault.getAbstractFileByPath(root);
    if (!(folder instanceof TFolder)) return null;
    const files: Array<{ path: string; name: string }> = [];
    const walk = (f: TFolder) => {
      for (const child of f.children) {
        if (child instanceof TFolder) walk(child);
        else if (child instanceof TFile && child.extension === "md") {
          files.push({ path: child.path, name: child.name });
        }
      }
    };
    walk(folder);
    this.commentaryIndex = buildCommentaryIndex(files);
    return this.commentaryIndex;
  }

  /** 설정 탭의 주석 폴더 검증 버튼용 */
  async validateCommentary(): Promise<{ ok: boolean; messages: string[] }> {
    const root = this.commentaryRoot();
    if (!root) {
      return {
        ok: false,
        messages: [
          "주석 폴더가 설정되지 않았습니다. 비워두면 주석 바로가기 없이 다른 기능은 정상 작동합니다.",
        ],
      };
    }
    const folder = this.app.vault.getAbstractFileByPath(root);
    if (!(folder instanceof TFolder)) {
      return { ok: false, messages: [`주석 폴더를 찾을 수 없습니다: "${root}"`] };
    }
    this.commentaryIndex = null;
    const index = this.ensureCommentaryIndex()!;
    if (index.size === 0) {
      return {
        ok: false,
        messages: [
          `⚠️ 폴더는 있지만 "책이름 N장 통합주석.md" 형식의 노트를 찾지 못했습니다: "${root}"`,
        ],
      };
    }
    const bookCount = new Set([...index.keys()].map((k) => k.split("|")[0])).size;
    return { ok: true, messages: [`✅ 통합주석 노트 ${index.size}개 인식 (${bookCount}권)`] };
  }

  /**
   * 해당 절이 속한 장 통합주석 노트와 pericope 헤딩을 찾는다.
   * 주석 폴더 아래를 파일명("{책이름} {N}장 통합주석.md")으로 인덱싱하므로
   * 내부 폴더 구조(구약/신약 층, 책 폴더명)와 무관하게 동작한다.
   * 헤딩: "## 3:14-17 - 제목" 중 절이 범위에 포함되는 것.
   */
  findCommentary(
    abbrev: string,
    chapter: number,
    verse: number | null,
  ): { path: string; heading?: string; label: string } | null {
    const book = BOOK_BY_ABBREV.get(abbrev);
    if (!book) return null;
    const index = this.ensureCommentaryIndex();
    if (!index) return null;
    const path = index.get(`${book.name}|${chapter}`);
    if (!path) return null;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;

    const fallbackLabel = `${book.name} ${chapter}장 통합주석`;
    if (verse === null) return { path, label: fallbackLabel };

    const headings = this.app.metadataCache.getFileCache(file)?.headings ?? [];
    for (const h of headings) {
      if (h.level !== 2) continue;
      const m = h.heading.match(/^(\d+):(\d+)(?:-(\d+))?/);
      if (!m) continue;
      const ch = parseInt(m[1], 10);
      const from = parseInt(m[2], 10);
      const to = m[3] ? parseInt(m[3], 10) : from;
      if (ch === chapter && verse >= from && verse <= to) {
        return { path, heading: h.heading, label: h.heading };
      }
    }
    return { path, label: fallbackLabel };
  }

  /** 설정 탭의 설교 폴더 검증 버튼용 */
  async validateSermonFolder(): Promise<{ ok: boolean; messages: string[] }> {
    const root = normalizeFolderPath(this.getPaths().sermonFolder);
    if (!root) {
      return {
        ok: true,
        messages: [
          "설교 폴더가 비어 있습니다 — 성경·주석 폴더를 제외한 전체 볼트에서 인용을 찾습니다.",
        ],
      };
    }
    const folder = this.app.vault.getAbstractFileByPath(root);
    if (!(folder instanceof TFolder)) {
      return { ok: false, messages: [`설교 폴더를 찾을 수 없습니다: "${root}"`] };
    }
    const count = this.app.vault
      .getMarkdownFiles()
      .filter((f) => isUnderFolder(f.path, root)).length;
    return { ok: true, messages: [`✅ 설교 폴더 인식 — 노트 ${count}개`] };
  }

  /**
   * 주어진 구절 노트들을 인용(링크)한 노트 경로 목록.
   * 설교 폴더가 있으면 그 안에서만, 없으면 성경·주석 폴더 제외 전체에서 찾는다.
   * 날짜 접두 파일명이 최신순이 되도록 경로 내림차순 정렬.
   */
  citingNotes(versePaths: string[]): string[] {
    const targets = versePaths.filter(Boolean);
    if (targets.length === 0) return [];
    // 주석 노트는 구절을 대량 링크하므로 "인용한 설교"에서 제외
    const excludes = [this.otPath(), this.ntPath(), this.commentaryRoot()].filter(Boolean);
    const sermonRoot = normalizeFolderPath(this.getPaths().sermonFolder);
    const links = this.app.metadataCache.resolvedLinks;
    const results: string[] = [];
    for (const source in links) {
      if (excludes.some((p) => isUnderFolder(source, p))) continue;
      if (sermonRoot && !isUnderFolder(source, sermonRoot)) continue;
      const linkedTargets = links[source];
      for (const p of targets) {
        if (linkedTargets[p]) {
          results.push(source);
          break;
        }
      }
    }
    return results.sort().reverse();
  }
}
