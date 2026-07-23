import { App, TFile, TFolder } from "obsidian";
import { BOOK_BY_ABBREV, BOOKS, BookInfo, bookByFolderName } from "./books";
import { extractVerseTexts, stripAnnotations } from "./note-parser";
import {
  buildCommentaryIndex,
  isUnderFolder,
  matchBookFolders,
  normalizeFolderPath,
} from "./paths";
import { BibleReference, VerseData, Version } from "./types";

/** BibleData가 참조하는 폴더 경로 설정 묶음 (전부 볼트 루트 기준) */
export interface PathSettings {
  biblePath: string;
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
export class BibleData {
  private folderCache: Map<string, TFolder> | null = null;
  private chapterCache = new Map<string, number[]>();
  private duplicateBookFolders: string[] = [];
  /** `${책이름}|${장}` → 통합주석 노트 경로 */
  private commentaryIndex: Map<string, string> | null = null;

  constructor(
    private app: App,
    private getPaths: () => PathSettings,
  ) {}

  private biblePath(): string {
    return normalizeFolderPath(this.getPaths().biblePath);
  }

  private commentaryRoot(): string {
    return normalizeFolderPath(this.getPaths().commentaryPath);
  }

  /** 설정(폴더 경로) 변경 시 호출 */
  invalidate() {
    this.folderCache = null;
    this.chapterCache.clear();
    this.commentaryIndex = null;
  }

  /** 주석 폴더 경로 변경·주석 파일 변동 시 호출 */
  invalidateCommentary() {
    this.commentaryIndex = null;
  }

  /** 책 약자 → 책 폴더 매핑을 lazy 구축. 실패 시 사용자 안내 문구 반환. */
  private ensureFolderCache(): string | null {
    if (this.folderCache) return null;
    const basePath = this.biblePath();
    if (!basePath) return "성경 폴더가 아직 설정되지 않았습니다. 설정 → A4P 성경구절에서 성경 폴더를 선택해주세요.";
    const base = this.app.vault.getAbstractFileByPath(basePath);
    if (!(base instanceof TFolder)) return `성경 폴더를 찾을 수 없습니다: "${basePath}"`;

    // 구약/신약 같은 중간 폴더의 이름·개수와 무관하게 깊이 3까지 책 폴더를 찾는다.
    // 책 폴더로 확정된 폴더 아래로는 내려가지 않는다 (절 파일 수천 개 스캔 방지).
    const flat: Array<{ path: string; name: string; folder: TFolder }> = [];
    const walk = (folder: TFolder, depth: number) => {
      if (depth > 3) return;
      for (const child of folder.children) {
        if (!(child instanceof TFolder)) continue;
        flat.push({ path: child.path, name: child.name, folder: child });
        if (!bookByFolderName(child.name)) walk(child, depth + 1);
      }
    };
    walk(base, 1);

    const { byAbbrev, duplicates } = matchBookFolders(flat);
    if (byAbbrev.size === 0) {
      return `"${basePath}" 아래에서 성경 책 폴더(01.창세기 …)를 찾지 못했습니다. 성경 노트 패키지를 넣은 폴더를 정확히 선택했는지 확인해주세요.`;
    }

    const byPath = new Map(flat.map((f) => [f.path, f.folder]));
    const cache = new Map<string, TFolder>();
    for (const [abbrev, path] of byAbbrev) cache.set(abbrev, byPath.get(path)!);
    this.folderCache = cache;
    this.duplicateBookFolders = duplicates;
    return null;
  }

  /** 해당 장에 실재하는 절 번호 목록 (정렬됨). 장이 없으면 빈 배열. */
  private chapterVerses(abbrev: string, chapter: number): number[] {
    const key = `${abbrev}${chapter}`;
    const cached = this.chapterCache.get(key);
    if (cached) return cached;
    const folder = this.folderCache?.get(abbrev);
    if (!folder) return [];
    const re = new RegExp(`^${abbrev}${chapter}_(\\d+)\\.md$`);
    const verses = folder.children
      .map((c) => (c instanceof TFile ? c.name.match(re) : null))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => parseInt(m[1], 10))
      .sort((a, b) => a - b);
    this.chapterCache.set(key, verses);
    return verses;
  }

  /** 책의 마지막 장 번호 (없는 장 안내용) */
  private maxChapter(abbrev: string): number {
    const folder = this.folderCache?.get(abbrev);
    if (!folder) return 0;
    const re = new RegExp(`^${abbrev}(\\d+)_\\d+\\.md$`);
    let max = 0;
    for (const c of folder.children) {
      if (!(c instanceof TFile)) continue;
      const m = c.name.match(re);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return max;
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
      const folder = this.folderCache!.get(book.abbrev);
      if (!folder) continue;
      const re = new RegExp(`^${book.abbrev}(\\d+)_(\\d+)\\.md$`);
      const inBook: Array<{ file: TFile; book: BookInfo; chapter: number; verse: number }> = [];
      for (const child of folder.children) {
        if (!(child instanceof TFile)) continue;
        const m = child.name.match(re);
        if (!m) continue;
        inBook.push({ file: child, book, chapter: parseInt(m[1], 10), verse: parseInt(m[2], 10) });
      }
      inBook.sort((a, b) => a.chapter - b.chapter || a.verse - b.verse);
      files.push(...inBook);
    }
    if (files.length === 0) {
      return { ok: false, reason: "성경 폴더에서 구절 노트를 찾지 못했습니다." };
    }
    return { ok: true, files };
  }

  /** 설정 탭의 검증 버튼용: 경로·폴더 구조·샘플 절 읽기를 점검한다. */
  async validate(): Promise<{ ok: boolean; messages: string[] }> {
    this.invalidate();
    const err = this.ensureFolderCache();
    if (err) return { ok: false, messages: [err] };

    const cache = this.folderCache!;
    const messages: string[] = [];
    let ok = true;

    for (const testament of ["구약", "신약"] as const) {
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
    }

    if (this.duplicateBookFolders.length > 0) {
      messages.push(
        `⚠️ 같은 책으로 인식되는 폴더가 2개 이상 있습니다 (먼저 찾은 폴더 사용): ${this.duplicateBookFolders.join(", ")}`,
      );
    }

    const sample = await this.loadVerses({
      abbrev: "창",
      bookName: "창세기",
      chapter: 1,
      verseStart: 1,
      verseEnd: 1,
    });
    if (sample.ok && sample.result.verses[0]) {
      const versions = Object.keys(sample.result.verses[0].texts).length;
      if (versions > 0) {
        messages.push(`✅ 샘플 구절(창1_1) 읽기 성공 — 역본 ${versions}개 확인`);
      } else {
        ok = false;
        messages.push("⚠️ 창1_1.md를 읽었지만 역본 콜아웃을 찾지 못했습니다 (노트 형식 확인 필요)");
      }
    } else {
      ok = false;
      messages.push("⚠️ 샘플 구절(창1_1.md)을 읽지 못했습니다");
    }

    return { ok, messages };
  }

  /** 참조가 가리키는 절들의 본문을 로드한다 (범위 클램프·장 경계 범위 포함). */
  async loadVerses(ref: BibleReference, strip = false): Promise<LoadOutcome> {
    const folderError = this.ensureFolderCache();
    if (folderError) return { ok: false, reason: folderError };

    const folder = this.folderCache!.get(ref.abbrev);
    if (!folder) {
      return { ok: false, reason: `볼트에서 ${ref.bookName} 폴더를 찾지 못했습니다.` };
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

    const verses = await Promise.all(
      targets.map(async ({ chapter, verse }): Promise<VerseData> => {
        const linkTarget = `${ref.abbrev}${chapter}_${verse}`;
        const file = this.app.vault.getAbstractFileByPath(`${folder.path}/${linkTarget}.md`);
        if (!(file instanceof TFile)) return { chapter, verse, linkTarget, texts: {} };
        const content = await this.app.vault.cachedRead(file);
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
    const excludes = [this.biblePath(), this.commentaryRoot()].filter(Boolean);
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
