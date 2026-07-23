/**
 * 폴더 경로 판정·주석 인덱스 순수 유틸.
 * obsidian 미의존 — vitest 대상. Vault 접근이 필요한 쪽(bible-data)은
 * TFolder/TFile을 {path, name}으로 평탄화해 이 모듈에 넘긴다.
 */
import { BOOKS, bookByFolderName } from "./books";

/**
 * 사용자 입력·FolderSuggest 출력을 볼트 경로로 정규화.
 * 앞뒤 공백/슬래시 제거, 역슬래시→슬래시, 연속 슬래시 축약, "./" 접두 제거.
 */
export function normalizeFolderPath(raw: string): string {
  let p = raw.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  while (p.startsWith("./")) p = p.slice(2);
  return p.replace(/^\/+/, "").replace(/\/+$/, "").trim();
}

/** path가 folder 자신이거나 그 하위인지 — "/" 경계 기준. folder가 빈 값이면 false. */
export function isUnderFolder(path: string, folder: string): boolean {
  if (!folder) return false;
  return path === folder || path.startsWith(folder + "/");
}

/** "로마서 5장 통합주석.md" → { bookName: "로마서", chapter: 5 } */
export function parseCommentaryFileName(
  fileName: string,
): { bookName: string; chapter: number } | null {
  const m = fileName.match(/^(.+?)\s+(\d+)장 통합주석\.md$/);
  if (!m) return null;
  return { bookName: m[1].trim(), chapter: parseInt(m[2], 10) };
}

/**
 * 평탄화된 폴더 목록에서 성경 책 폴더를 매칭.
 * 같은 책이 여러 폴더에 매칭되면 첫 폴더를 쓰고 duplicates에 책 이름을 기록.
 */
export function matchBookFolders(folders: Array<{ path: string; name: string }>): {
  byAbbrev: Map<string, string>;
  duplicates: string[];
} {
  const byAbbrev = new Map<string, string>();
  const duplicates: string[] = [];
  for (const f of folders) {
    const book = bookByFolderName(f.name);
    if (!book) continue;
    if (byAbbrev.has(book.abbrev)) {
      if (!duplicates.includes(book.name)) duplicates.push(book.name);
      continue;
    }
    byAbbrev.set(book.abbrev, f.path);
  }
  return { byAbbrev, duplicates };
}

/** 별칭 → 정식 책이름. 정식명·별칭 어느 쪽도 아니면 null. */
const CANONICAL_BOOK_NAME = new Map<string, string>(
  BOOKS.flatMap((b) => [b.name, ...b.aliases].map((n): [string, string] => [n, b.name])),
);

/**
 * 파일 목록에서 주석 인덱스 구축. 폴더 구조와 무관하게 파일명만 본다.
 * 키 = `${정식책이름}|${장}`, 값 = 파일 경로. 중복 키는 먼저 온 파일 유지.
 */
export function buildCommentaryIndex(
  files: Array<{ path: string; name: string }>,
): Map<string, string> {
  const index = new Map<string, string>();
  for (const f of files) {
    const parsed = parseCommentaryFileName(f.name);
    if (!parsed) continue;
    const canonical = CANONICAL_BOOK_NAME.get(parsed.bookName);
    if (!canonical) continue;
    const key = `${canonical}|${parsed.chapter}`;
    if (!index.has(key)) index.set(key, f.path);
  }
  return index;
}
