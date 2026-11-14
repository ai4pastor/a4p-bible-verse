/**
 * 설교 성경 지도 — 설교 노트를 성경 66권 위에 모으는 계산.
 * obsidian 미의존 — vitest 대상. 볼트에서 모으는 쪽은 bible-data(`sermonAtlasInput`).
 *
 * - 주 본문 = 파일 이름 끝 본문(parseSermonName). 없으면 속성의 첫 절 링크로 추정(estimated).
 *   속성(성경구절)에는 주 본문과 인용 구절이 섞여 있어, 속성만으로는 주 본문을 정하지 않는다.
 * - 인용 = 속성 + 본문의 절 링크 전부. 「인용 포함」 기준에서만 센다.
 * - 같은 날짜·같은 부서의 노트(원고·정리본·_hm)는 설교 한 편. 같은 날 본문이 다른 노트는 따로 센다.
 * - books.ts의 order는 신약에서 1부터 다시 시작한다 → 정경 순서는 canonIndex로(구약 다음에 신약).
 * - 읽을 정보가 없으면 오류 대신 빈칸 — 본문을 못 읽은 설교는 「본문 미상」으로 모은다.
 */
import { BOOKS, BOOK_BY_ABBREV, type BookInfo } from "./books";
import { parseSermonName, type SermonDate } from "./sermon-meta";
import { nfc } from "./verse-files";

/** 볼트에서 모은 노트 하나 */
export interface AtlasInputNote {
  path: string;
  basename: string;
  /** 설교 폴더 아래 첫 분류 폴더로 정한 부서(sermonGroup) — 없으면 undefined */
  group?: string;
  /** 속성(frontmatter)의 절 노트 링크 — 적힌 순서대로, 절 노트 이름(예: "요3_16") */
  propertyVerses: string[];
  /** 이 노트가 링크한 절 노트 이름 전부(속성 + 본문) */
  linkedVerses: string[];
  /** 파일 이름에 날짜가 없을 때 쓸 속성 날짜(date·설교일) — 「인용한 설교」와 같은 보충 */
  propertyDate?: SermonDate;
}

export interface PassageRef {
  book: string;
  chapter: number;
  verseStart?: number;
  verseEnd?: number;
}

export interface AtlasSermon {
  date?: SermonDate;
  /** YYYYMMDD — 날짜가 없으면 0 */
  dateKey: number;
  /** 부서 — 폴더가 먼저, 없으면 파일 이름의 부서 표시, 없으면 빈칸 */
  dept: string;
  title: string;
  /** 주 본문 — 비어 있으면 「본문 미상」 */
  main: PassageRef[];
  /** 주 본문을 파일 이름이 아니라 속성의 첫 절로 정했는가 */
  estimated: boolean;
  /** 인용한 책(약자)·장("약자|장") — 주 본문 포함 */
  citedBooks: string[];
  citedChapters: string[];
  /** 이 설교로 묶인 노트들 — 첫째가 대표 */
  paths: string[];
}

export type AtlasMode = "main" | "all";

export interface AtlasFilter {
  /** 부서 — 비우면 전체 */
  dept?: string;
  mode: AtlasMode;
  /** 이 날짜(YYYYMMDD) 이후만 — 날짜 없는 설교는 빠진다 */
  sinceKey?: number;
}

export interface AtlasAggregate {
  /** 책 약자 → 설교 수 */
  books: Map<string, number>;
  /** "약자|장" → 설교 수 */
  chapters: Map<string, number>;
  /** 책 약자 → 가장 최근 설교 날짜(YYYYMMDD) */
  last: Map<string, number>;
}

export interface Genre {
  name: string;
  testament: "구약" | "신약";
  /** 정경 순서(canonIndex) 범위 — 양끝 포함 */
  from: number;
  to: number;
}

const OT_COUNT = BOOKS.filter((b) => b.testament === "구약").length;

/** 정경 전체 순서 1~66 — 신약 order가 1부터 다시 시작하므로 구약 권수를 더한다 */
export const canonIndex = (b: BookInfo): number =>
  b.testament === "구약" ? b.order : OT_COUNT + b.order;

/** 장르 10묶음 (WORD 기준표 성경학 분류 이름과 맞춤) */
export const GENRES: Genre[] = [
  { name: "토라", testament: "구약", from: 1, to: 5 },
  { name: "역사서", testament: "구약", from: 6, to: 17 },
  { name: "시가서", testament: "구약", from: 18, to: 22 },
  { name: "대선지서", testament: "구약", from: 23, to: 27 },
  { name: "소선지서", testament: "구약", from: 28, to: 39 },
  { name: "사복음서", testament: "신약", from: 40, to: 43 },
  { name: "사도행전", testament: "신약", from: 44, to: 44 },
  { name: "바울서신", testament: "신약", from: 45, to: 57 },
  { name: "일반서신", testament: "신약", from: 58, to: 65 },
  { name: "요한계시록", testament: "신약", from: 66, to: 66 },
];

/**
 * 책마다 장 수 — 한국어·영어 성경의 장 구분(합계 1,189장). 2026-11-14 볼트 절 노트(약자+장_절)에서
 * 센 최대 장과 66권 모두 일치 확인. 장 막대의 칸 수로만 쓴다.
 */
export const CHAPTER_COUNT: Readonly<Record<string, number>> = {
  창: 50, 출: 40, 레: 27, 민: 36, 신: 34, 수: 24, 삿: 21, 룻: 4, 삼상: 31, 삼하: 24,
  왕상: 22, 왕하: 25, 대상: 29, 대하: 36, 스: 10, 느: 13, 에: 10, 욥: 42, 시: 150, 잠: 31,
  전: 12, 아: 8, 사: 66, 렘: 52, 애: 5, 겔: 48, 단: 12, 호: 14, 욜: 3, 암: 9,
  옵: 1, 욘: 4, 미: 7, 나: 3, 합: 3, 습: 3, 학: 2, 슥: 14, 말: 4,
  마: 28, 막: 16, 눅: 24, 요: 21, 행: 28, 롬: 16, 고전: 16, 고후: 13, 갈: 6, 엡: 6,
  빌: 4, 골: 4, 살전: 5, 살후: 3, 딤전: 6, 딤후: 4, 딛: 3, 몬: 1, 히: 13, 약: 5,
  벧전: 5, 벧후: 3, 요일: 5, 요이: 1, 요삼: 1, 유: 1, 계: 22,
};

/** 장르에 든 책 — 정경 순서대로 */
export function booksInGenre(g: Genre): BookInfo[] {
  return BOOKS.filter((b) => {
    const i = canonIndex(b);
    return i >= g.from && i <= g.to;
  }).sort((a, b) => canonIndex(a) - canonIndex(b));
}

export const dateKeyOf = (d?: SermonDate): number => (d ? d.y * 10000 + d.m * 100 + d.d : 0);

const VERSE_NAME = /^([가-힣]{1,3})(\d{1,3})_(\d{1,3})$/;

/** 절 노트 이름(요3_16) → 책·장·절. 66권 표에 없는 약자면 null */
export function verseFromName(name: string): { book: string; chapter: number; verse: number } | null {
  const m = VERSE_NAME.exec(nfc(name).trim());
  if (!m || !BOOK_BY_ABBREV.has(m[1])) return null;
  return { book: m[1], chapter: Number(m[2]), verse: Number(m[3]) };
}

const PASSAGE_TEXT = /^([가-힣]{1,3}) (\d{1,3})(?::(\d{1,3})(?:-(\d{1,3}))?|장|편)$/;

/** parseSermonName의 본문 표기("고후 8:9, 고전 15장, 시 23편")를 구조로 */
export function parsePassageText(text: string): PassageRef[] {
  const out: PassageRef[] = [];
  for (const part of text.split(/,\s*/)) {
    const m = PASSAGE_TEXT.exec(part.trim());
    if (!m || !BOOK_BY_ABBREV.has(m[1])) continue;
    out.push({
      book: m[1],
      chapter: Number(m[2]),
      verseStart: m[3] ? Number(m[3]) : undefined,
      verseEnd: m[4] ? Number(m[4]) : undefined,
    });
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 본문 글자 속 이 책의 성경 표기 — 「창세기 22:1-18」 「(창 22:16-18)」 「창3:21」 「창세기 22장」
 * 「고린도전서 15장 5-8절」 「시편 23편」 「시 139편 8절」. 설교 성경 지도 미리보기에서 링크 없이 글자로만 적은
 * 인용도 찾아가게 하려는 것(어린이부 교재 원고 등).
 * - 책 이름(정식·별칭·약자) 뒤에 장 번호와 「:절」 또는 「장」「편」이 와야 표기로 본다 — 「창 밖」 같은 낱말 제외.
 * - 앞 글자가 한글이면 표기가 아니다 — 「필요 3:1」의 「요」, 「위에 3장」의 「에」.
 * - 긴 이름부터 맞춘다 — 「요일 4:11」은 요한복음(요)으로 잡히지 않는다(약자 뒤에 숫자가 바로 와야 하므로).
 * 66권 표에 없는 약자면 null.
 */
export function bookMentionPattern(abbrev: string): RegExp | null {
  const book = BOOK_BY_ABBREV.get(abbrev);
  if (!book) return null;
  const tokens = [book.name, ...book.aliases, book.abbrev]
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join("|");
  const n = "\\d{1,3}";
  const dash = "\\s*[-~–—]\\s*";
  // 3:16 · 3:16-18 · 3:36-4:2
  const colon = `${n}\\s*:\\s*${n}(?:${dash}${n}(?:\\s*:\\s*${n})?)?`;
  // 3장 · 23편 · 3장 16절 · 15장 5-8절 · 1장 1절-2장 3절 · 1장-3장
  // (「절」 앞 빈칸은 「절」이 있을 때만 — 표기 뒤 빈칸까지 칠하지 않게)
  const verse = `${n}(?:\\s*절)?`;
  const chapter = `${n}\\s*[장편](?:\\s*${verse}(?:${dash}${n}(?:\\s*장\\s*${n})?(?:\\s*절)?)?|${dash}${n}\\s*[장편])?`;
  return new RegExp(`(?<![가-힣])(?:${tokens})\\s*(?:${colon}|${chapter})`, "g");
}

/** 글자 속 이 책의 성경 표기 위치 — bookMentionPattern으로 찾은 [시작, 끝) */
export function findBookMentions(text: string, abbrev: string): Array<{ start: number; end: number; text: string }> {
  const re = bookMentionPattern(abbrev);
  if (!re) return [];
  const out: Array<{ start: number; end: number; text: string }> = [];
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return out;
}

/** "창 1:1-5" · "창 1장" · "시 23편" */
export function passageLabel(p: PassageRef): string {
  if (p.verseStart === undefined) return `${p.book} ${p.chapter}${p.book === "시" ? "편" : "장"}`;
  return `${p.book} ${p.chapter}:${p.verseStart}${p.verseEnd ? `-${p.verseEnd}` : ""}`;
}

interface Parsed {
  note: AtlasInputNote;
  date?: SermonDate;
  title: string;
  tag?: string;
  dept: string;
  main: PassageRef[];
  passageText: string;
}

/** 대표 노트 고르기 — 이름에 본문이 있는 것 → 꼬리표 없는 것 → 짧은 경로 → 경로 순 */
function pickOrder(a: Parsed, b: Parsed): number {
  const am = a.main.length > 0 ? 0 : 1;
  const bm = b.main.length > 0 ? 0 : 1;
  if (am !== bm) return am - bm;
  const at = a.tag ? 1 : 0;
  const bt = b.tag ? 1 : 0;
  if (at !== bt) return at - bt;
  if (a.note.path.length !== b.note.path.length) return a.note.path.length - b.note.path.length;
  return a.note.path < b.note.path ? -1 : a.note.path > b.note.path ? 1 : 0;
}

/** 노트들을 설교 단위로 묶는다 — 최신순(날짜 없는 설교는 맨 뒤) */
export function buildSermons(notes: AtlasInputNote[]): AtlasSermon[] {
  const groups = new Map<string, Parsed[]>();
  for (const note of notes) {
    // 수강생마다 이름 규칙이 달라도 지도는 떠야 한다 — 뜻밖의 판독 실패는 이름만 쓰는 설교로
    let meta: ReturnType<typeof parseSermonName>;
    try {
      meta = parseSermonName(note.basename);
    } catch {
      meta = { title: note.basename };
    }
    const date = meta.date ?? note.propertyDate;
    const main = meta.passage ? parsePassageText(meta.passage) : [];
    const parsed: Parsed = {
      note,
      date,
      title: meta.title,
      tag: meta.tag,
      dept: note.group ?? meta.dept ?? "",
      main,
      passageText: main.map(passageLabel).join(", "),
    };
    const key = date ? `${dateKeyOf(date)}|${parsed.dept}` : `path|${note.path}`;
    const list = groups.get(key);
    if (list) list.push(parsed);
    else groups.set(key, [parsed]);
  }

  const out: AtlasSermon[] = [];
  for (const items of groups.values()) {
    // 같은 날·같은 부서라도 이름의 본문이 서로 다르면 다른 설교 — 본문 없는 노트는 첫 묶음에 붙인다
    const byPassage = new Map<string, Parsed[]>();
    const noPassage: Parsed[] = [];
    for (const it of items) {
      if (!it.passageText) noPassage.push(it);
      else {
        const l = byPassage.get(it.passageText);
        if (l) l.push(it);
        else byPassage.set(it.passageText, [it]);
      }
    }
    const subgroups = [...byPassage.values()];
    if (subgroups.length === 0) subgroups.push(noPassage);
    else subgroups[0].push(...noPassage);

    for (const sub of subgroups) {
      sub.sort(pickOrder);
      const rep = sub[0];
      let main = rep.main;
      let estimated = false;
      if (main.length === 0) {
        for (const it of sub) {
          const first = it.note.propertyVerses.map(verseFromName).find((v) => v !== null);
          if (first) {
            main = [{ book: first.book, chapter: first.chapter, verseStart: first.verse }];
            estimated = true;
            break;
          }
        }
      }
      const books = new Set<string>();
      const chapters = new Set<string>();
      for (const p of main) {
        books.add(p.book);
        chapters.add(`${p.book}|${p.chapter}`);
      }
      for (const it of sub) {
        for (const name of [...it.note.propertyVerses, ...it.note.linkedVerses]) {
          const v = verseFromName(name);
          if (!v) continue;
          books.add(v.book);
          chapters.add(`${v.book}|${v.chapter}`);
        }
      }
      out.push({
        date: rep.date,
        dateKey: dateKeyOf(rep.date),
        dept: rep.dept,
        title: rep.title,
        main,
        estimated,
        citedBooks: [...books],
        citedChapters: [...chapters],
        paths: sub.map((it) => it.note.path),
      });
    }
  }
  return out.sort(compareAtlasSermons);
}

/** 최신순 — 날짜 없는 설교는 맨 뒤, 같은 날은 제목 → 경로 순 */
export function compareAtlasSermons(a: AtlasSermon, b: AtlasSermon): number {
  if (a.dateKey !== b.dateKey) return b.dateKey - a.dateKey;
  const t = a.title.localeCompare(b.title, "ko");
  if (t !== 0) return t;
  return a.paths[0] < b.paths[0] ? -1 : a.paths[0] > b.paths[0] ? 1 : 0;
}

/** 설교 수가 많은 부서부터 — 빈칸 부서는 뺀다 */
export function departments(sermons: AtlasSermon[]): string[] {
  const count = new Map<string, number>();
  for (const s of sermons) if (s.dept) count.set(s.dept, (count.get(s.dept) ?? 0) + 1);
  return [...count.keys()].sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0) || a.localeCompare(b, "ko"));
}

export function filterSermons(sermons: AtlasSermon[], filter: AtlasFilter): AtlasSermon[] {
  return sermons.filter((s) => {
    if (filter.dept && s.dept !== filter.dept) return false;
    if (filter.sinceKey !== undefined && (s.dateKey === 0 || s.dateKey < filter.sinceKey)) return false;
    return true;
  });
}

/** 기간 단추의 시작 날짜 — today에서 n년 전 같은 날 */
export function sinceKeyFor(years: number, today: SermonDate): number {
  return (today.y - years) * 10000 + today.m * 100 + today.d;
}

/** 이 설교가 기준(mode)에서 닿는 책 */
export function booksOf(s: AtlasSermon, mode: AtlasMode): string[] {
  if (mode === "all") return s.citedBooks;
  return [...new Set(s.main.map((p) => p.book))];
}

/** 이 설교가 기준(mode)에서 닿는 장 — "약자|장" */
export function chaptersOf(s: AtlasSermon, mode: AtlasMode): string[] {
  if (mode === "all") return s.citedChapters;
  return [...new Set(s.main.map((p) => `${p.book}|${p.chapter}`))];
}

export function aggregate(sermons: AtlasSermon[], mode: AtlasMode): AtlasAggregate {
  const books = new Map<string, number>();
  const chapters = new Map<string, number>();
  const last = new Map<string, number>();
  for (const s of sermons) {
    for (const b of booksOf(s, mode)) {
      books.set(b, (books.get(b) ?? 0) + 1);
      if (s.dateKey && s.dateKey > (last.get(b) ?? 0)) last.set(b, s.dateKey);
    }
    for (const c of chaptersOf(s, mode)) chapters.set(c, (chapters.get(c) ?? 0) + 1);
  }
  return { books, chapters, last };
}

/** 진하기 0~4 — 0은 설교 없음. 제곱근 비례라 적은 수도 눈에 띈다 */
export function heatLevel(count: number, max: number): number {
  if (!count) return 0;
  return Math.max(1, Math.min(4, Math.ceil(4 * Math.sqrt(count / Math.max(1, max)))));
}

/** 장르마다 비어 있는 책 */
export function emptyBooksByGenre(agg: AtlasAggregate): Array<{ genre: Genre; total: number; empty: BookInfo[] }> {
  return GENRES.map((genre) => {
    const books = booksInGenre(genre);
    return { genre, total: books.length, empty: books.filter((b) => !agg.books.get(b.abbrev)) };
  });
}

/** 장르마다 가장 최근 설교 날짜(YYYYMMDD) — 없으면 0 */
export function lastByGenre(agg: AtlasAggregate): Array<{ genre: Genre; last: number }> {
  return GENRES.map((genre) => ({
    genre,
    last: Math.max(0, ...booksInGenre(genre).map((b) => agg.last.get(b.abbrev) ?? 0)),
  }));
}

/** 이 책을 기준(mode)에서 다룬 설교 — 최신순 */
export function sermonsForBook(sermons: AtlasSermon[], book: string, mode: AtlasMode): AtlasSermon[] {
  return sermons.filter((s) => booksOf(s, mode).includes(book));
}

/** 마지막 설교가 얼마나 지났는지 — 오늘 이후면 「예정」 */
export function agoLabel(dateKey: number, today: SermonDate): string {
  if (!dateKey) return "없음";
  const todayKey = dateKeyOf(today);
  if (dateKey > todayKey) return "예정";
  const y = Math.floor(dateKey / 10000);
  const m = Math.floor((dateKey % 10000) / 100);
  const months = (today.y - y) * 12 + (today.m - m);
  if (months < 1) return "이번 달";
  if (months < 12) return `${months}달 전`;
  return `${Math.floor(months / 12)}년 전`;
}

/** "2026.03.29" */
export function formatDateKey(dateKey: number): string {
  if (!dateKey) return "날짜 없음";
  const s = String(dateKey);
  return `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}`;
}

/** 화면 위 요약 */
export function summarize(sermons: AtlasSermon[], agg: AtlasAggregate) {
  let ot = 0;
  let nt = 0;
  for (const [abbrev, n] of agg.books) {
    if (BOOK_BY_ABBREV.get(abbrev)?.testament === "구약") ot += n;
    else nt += n;
  }
  const withMain = sermons.filter((s) => s.main.length > 0).length;
  return {
    sermons: sermons.length,
    withMain,
    unknown: sermons.length - withMain,
    coveredBooks: agg.books.size,
    otShare: ot + nt ? Math.round((100 * ot) / (ot + nt)) : 0,
    ntShare: ot + nt ? 100 - Math.round((100 * ot) / (ot + nt)) : 0,
  };
}
