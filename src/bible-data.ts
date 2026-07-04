import { App, TFile, TFolder } from "obsidian";
import { BOOK_BY_ABBREV, BOOKS } from "./books";
import { extractVerseTexts } from "./note-parser";
import { BibleReference, VerseData } from "./types";

export interface LoadResult {
  verses: VerseData[];
  /** 범위가 실제 절 수를 넘어 잘렸을 때의 안내 문구 */
  notice?: string;
}

export type LoadOutcome = { ok: true; result: LoadResult } | { ok: false; reason: string };

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

  /** 참조가 가리키는 절들의 본문을 로드한다 (범위 클램프 포함). */
  async loadVerses(ref: BibleReference): Promise<LoadOutcome> {
    const folderError = this.ensureFolderCache();
    if (folderError) return { ok: false, reason: folderError };

    const folder = this.folderCache!.get(ref.abbrev);
    if (!folder) {
      return { ok: false, reason: `볼트에서 ${ref.bookName} 폴더를 찾지 못했습니다.` };
    }

    const available = this.chapterVerses(ref.abbrev, ref.chapter);
    if (available.length === 0) {
      const max = this.maxChapter(ref.abbrev);
      const unit = ref.bookName === "시편" ? "편" : "장";
      return {
        ok: false,
        reason:
          max > 0
            ? `${ref.bookName}은(는) ${max}${unit}까지 있습니다.`
            : `${ref.bookName}의 구절 노트가 없습니다.`,
      };
    }

    const lastVerse = available[available.length - 1];
    let targets: number[];
    let notice: string | undefined;
    const unit = ref.bookName === "시편" ? "편" : "장";

    if (ref.verseStart === undefined) {
      targets = available;
    } else {
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
      targets = available.filter((v) => v >= ref.verseStart! && v <= end);
    }

    const verses = await Promise.all(
      targets.map(async (v): Promise<VerseData> => {
        const linkTarget = `${ref.abbrev}${ref.chapter}_${v}`;
        const file = this.app.vault.getAbstractFileByPath(`${folder.path}/${linkTarget}.md`);
        if (!(file instanceof TFile)) return { verse: v, linkTarget, texts: {} };
        const content = await this.app.vault.cachedRead(file);
        return { verse: v, linkTarget, texts: extractVerseTexts(content) };
      }),
    );

    return { ok: true, result: { verses, notice } };
  }
}
