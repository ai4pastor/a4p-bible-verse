import { App, TFile, TFolder } from "obsidian";
import { BOOK_BY_ABBREV, BOOKS, BookInfo } from "./books";
import { extractVerseTexts, stripAnnotations } from "./note-parser";
import { BibleReference, VerseData, Version } from "./types";

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

  constructor(
    private app: App,
    private getBiblePath: () => string,
  ) {}

  /** 설정(성경 폴더 경로) 변경 시 호출 */
  invalidate() {
    this.folderCache = null;
    this.chapterCache.clear();
  }

  /** 책 약자 → 책 폴더 매핑을 lazy 구축. 실패 시 사용자 안내 문구 반환. */
  private ensureFolderCache(): string | null {
    if (this.folderCache) return null;
    const basePath = this.getBiblePath().replace(/\/+$/, "");
    if (!basePath) return "설정에서 성경 폴더를 먼저 지정해주세요.";
    const base = this.app.vault.getAbstractFileByPath(basePath);
    if (!(base instanceof TFolder)) return `성경 폴더를 찾을 수 없습니다: "${basePath}"`;

    const cache = new Map<string, TFolder>();
    for (const testament of ["구약", "신약"]) {
      const tFolder = base.children.find(
        (c): c is TFolder => c instanceof TFolder && c.name === testament,
      );
      if (!tFolder) return `"${basePath}" 아래에 ${testament} 폴더가 없습니다.`;
      for (const child of tFolder.children) {
        if (!(child instanceof TFolder)) continue;
        const stripped = child.name.replace(/^\d+\./, "").trim();
        for (const book of BOOK_BY_ABBREV.values()) {
          if (book.name === stripped || book.aliases.includes(stripped)) {
            cache.set(book.abbrev, child);
            break;
          }
        }
      }
    }
    if (cache.size === 0) return `"${basePath}" 아래에서 성경 책 폴더를 찾지 못했습니다.`;
    this.folderCache = cache;
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

  /**
   * 해당 절이 속한 장 통합주석 노트와 pericope 헤딩을 찾는다.
   * 경로: {성경폴더}/{주석폴더}/{구약|신약}/{NN.책이름}/{책이름} {장}장 통합주석.md
   * 헤딩: "## 3:14-17 - 제목" 중 절이 범위에 포함되는 것.
   */
  findCommentary(
    abbrev: string,
    chapter: number,
    verse: number | null,
    commentaryPath: string,
  ): { path: string; heading?: string; label: string } | null {
    if (!commentaryPath.trim()) return null;
    if (this.ensureFolderCache() !== null) return null;
    const folder = this.folderCache!.get(abbrev);
    const book = BOOK_BY_ABBREV.get(abbrev);
    if (!folder || !book) return null;

    const basePath = this.getBiblePath().replace(/\/+$/, "");
    const path = `${basePath}/${commentaryPath.trim().replace(/\/+$/, "")}/${book.testament}/${folder.name}/${book.name} ${chapter}장 통합주석.md`;
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

  /**
   * 주어진 구절 노트들을 인용(링크)한 노트 경로 목록.
   * sermonFolder가 있으면 그 폴더 안에서만, 없으면 성경 폴더 제외 전체에서 찾는다.
   * 날짜 접두 파일명이 최신순이 되도록 경로 내림차순 정렬.
   */
  citingNotes(versePaths: string[], sermonFolder: string): string[] {
    const targets = versePaths.filter(Boolean);
    if (targets.length === 0) return [];
    const biblePrefix = this.getBiblePath().replace(/\/+$/, "") + "/";
    const folderPrefix = sermonFolder.trim().replace(/\/+$/, "");
    const links = this.app.metadataCache.resolvedLinks;
    const results: string[] = [];
    for (const source in links) {
      if (source.startsWith(biblePrefix)) continue;
      if (folderPrefix && !source.startsWith(folderPrefix + "/")) continue;
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
