import { IndexEntry, Version } from "./types";

/**
 * 본문 키워드 검색 — obsidian 미의존 순수 모듈.
 *
 * 3단계 파이프라인:
 *  1) exact   — 모든 토큰이 부분 문자열로 존재(AND), 정경 순
 *  2) partial — 토큰이 2개 이상이고 일부만 일치할 때 관련성 점수 순
 *  3) fuzzy   — 1·2가 0건일 때 문자 bigram 포함률로 근사 매칭 (오타 보정)
 *
 * 한국어는 조사·활용 변화를 부분 문자열 매칭이 흡수하므로("사랑" ⊂ "사랑하사")
 * 형태소 분석 없이 substring 매칭으로 충분하다. 32,900절 선형 스캔 ≈ 수 ms.
 */

/** 유사(partial) 결과 상한 — 보조 결과라 무제한이면 노이즈. exact는 잘리지 않는다 */
const DEFAULT_PARTIAL_LIMIT = 50;
/** 질의 bigram 중 절에 존재해야 하는 비율 (fuzzy 임계값) */
const FUZZY_THRESHOLD = 0.5;
const FUZZY_LIMIT = 20;
/** 토큰당 하이라이트 수집 상한 (한 절 안에서) */
const MAX_RANGES_PER_TOKEN = 8;

export interface SearchHit {
  entry: IndexEntry;
  /** 매칭이 일어난 역본 (전체 역본 검색 시 뱃지 표시용) */
  version: Version;
  score: number;
  tier: "exact" | "partial" | "fuzzy";
  /** version 본문 기준 [시작, 끝) 하이라이트 범위 — 정렬·병합됨. fuzzy는 빈 배열 */
  matchedRanges: Array<[number, number]>;
}

export interface SearchOptions {
  /** 검색할 역본 (우선순위 순 — 첫 역본이 현재 표시 역본) */
  versions: Version[];
  /** 유사(partial) 결과 상한 — exact는 항상 전부 반환된다 */
  partialLimit?: number;
}

export interface SearchOutcome {
  hits: SearchHit[];
  /** 완전 일치(exact) 절 수 */
  exactTotal: number;
}

/** 인덱스 빌드 시 본문 1회 정규화: 개행·연속 공백 → 공백, NFC */
export function normalizeText(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** 질의 → 토큰: NFC, 공백 분리, 영문 소문자화 */
export function tokenize(query: string): string[] {
  return query.normalize("NFC").toLowerCase().split(/\s+/).filter(Boolean);
}

/** 문자열의 문자 bigram 집합 */
function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

/**
 * 질의 bigram 포함률: 질의의 bigram 중 대상에 존재하는 비율 [0,1].
 * Dice 계수는 짧은 질의 대 긴 절에서 분모가 커져 쓸 수 없다 —
 * 절 검색은 "질의가 절 안에 얼마나 들어 있는가"가 관건이므로 포함률을 쓴다.
 */
export function bigramOverlap(query: string, target: string): number {
  const q = bigrams(query);
  if (q.size === 0) return query.length > 0 && target.includes(query) ? 1 : 0;
  const t = bigrams(target);
  let inter = 0;
  for (const g of q) if (t.has(g)) inter++;
  return inter / q.size;
}

interface VersionMatch {
  matched: number;
  sumLen: number;
  first: number;
  ranges: Array<[number, number]>;
}

function matchVersion(text: string, tokens: string[], hasAscii: boolean): VersionMatch {
  const hay = hasAscii ? text.toLowerCase() : text;
  let matched = 0;
  let sumLen = 0;
  let first = Infinity;
  const ranges: Array<[number, number]> = [];
  for (const token of tokens) {
    let idx = hay.indexOf(token);
    if (idx === -1) continue;
    matched++;
    sumLen += token.length;
    if (idx < first) first = idx;
    for (let n = 0; idx !== -1 && n < MAX_RANGES_PER_TOKEN; n++) {
      ranges.push([idx, idx + token.length]);
      idx = hay.indexOf(token, idx + token.length);
    }
  }
  return { matched, sumLen, first, ranges };
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  if (ranges.length <= 1) return ranges;
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [[sorted[0][0], sorted[0][1]]];
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i];
    const last = out[out.length - 1];
    if (s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** 관련성 점수 — 매칭 토큰 비율이 지배 항, 짧은 절·앞쪽 매칭 우대 */
function relevanceScore(m: VersionMatch, totalTokens: number, textLen: number): number {
  const len = Math.max(textLen, 1);
  return (
    10 * (m.matched / totalTokens) +
    2 * (m.sumLen / len) +
    0.5 * (1 - Math.min(m.first, len) / len)
  );
}

export function searchVerses(
  entries: IndexEntry[],
  query: string,
  opts: SearchOptions,
): SearchOutcome {
  const tokens = tokenize(query);
  const partialLimit = opts.partialLimit ?? DEFAULT_PARTIAL_LIMIT;
  if (tokens.length === 0 || opts.versions.length === 0) {
    return { hits: [], exactTotal: 0 };
  }
  const hasAscii = tokens.some((t) => /[a-z]/.test(t));

  const exact: SearchHit[] = [];
  let exactTotal = 0;
  const partial: SearchHit[] = [];

  for (const entry of entries) {
    let best: VersionMatch | null = null;
    let bestVersion: Version | null = null;
    let bestLen = 0;
    for (const v of opts.versions) {
      const text = entry.texts[v];
      if (!text) continue;
      const m = matchVersion(text, tokens, hasAscii);
      if (m.matched === 0) continue;
      if (!best || m.matched > best.matched) {
        best = m;
        bestVersion = v;
        bestLen = text.length;
      }
      if (m.matched === tokens.length) break; // 전 토큰 일치 — 더 볼 필요 없음
    }
    if (!best || !bestVersion) continue;

    const hit: SearchHit = {
      entry,
      version: bestVersion,
      score: relevanceScore(best, tokens.length, bestLen),
      tier: best.matched === tokens.length ? "exact" : "partial",
      matchedRanges: mergeRanges(best.ranges),
    };
    if (hit.tier === "exact") {
      exactTotal++;
      exact.push(hit); // entries가 정경 순이므로 그대로 정렬됨 — 잘림 없음
    } else if (tokens.length >= 2) {
      partial.push(hit);
    }
  }

  let hits = exact;
  if (partial.length > 0) {
    partial.sort((a, b) => b.score - a.score || a.entry.sortKey - b.entry.sortKey);
    hits = exact.concat(partial.slice(0, partialLimit));
  }

  if (hits.length === 0) {
    hits = fuzzySearch(entries, tokens, opts.versions, hasAscii);
  }
  return { hits, exactTotal };
}

/** exact·partial 0건일 때만 도는 오타 보정 폴백 — 질의 bigram 포함률 기준 */
function fuzzySearch(
  entries: IndexEntry[],
  tokens: string[],
  versions: Version[],
  hasAscii: boolean,
): SearchHit[] {
  const queryJoined = tokens.join("");
  const qSet = bigrams(queryJoined);
  if (qSet.size === 0) return [];

  const hits: SearchHit[] = [];
  for (const entry of entries) {
    let bestScore = 0;
    let bestVersion: Version | null = null;
    for (const v of versions) {
      const text = entry.texts[v];
      if (!text) continue;
      const hay = hasAscii ? text.toLowerCase() : text;
      // 대상 bigram을 만들며 질의 집합과 교차 계수 (절당 1패스)
      const seen = new Set<string>();
      let inter = 0;
      for (let i = 0; i < hay.length - 1; i++) {
        const g = hay.slice(i, i + 2);
        if (seen.has(g)) continue;
        seen.add(g);
        if (qSet.has(g)) inter++;
      }
      const score = inter / qSet.size;
      if (score > bestScore) {
        bestScore = score;
        bestVersion = v;
      }
    }
    if (bestScore >= FUZZY_THRESHOLD && bestVersion) {
      hits.push({
        entry,
        version: bestVersion,
        score: bestScore,
        tier: "fuzzy",
        matchedRanges: [],
      });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.entry.sortKey - b.entry.sortKey);
  return hits.slice(0, FUZZY_LIMIT);
}
