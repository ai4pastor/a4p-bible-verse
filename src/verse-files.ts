/**
 * 절 파일 인덱스·진단 순수 유틸.
 * obsidian 미의존 — vitest 대상. Vault 접근이 필요한 쪽(bible-data)은
 * TFolder 서브트리를 FlatEntry 목록으로 평탄화해 이 모듈에 넘긴다.
 */

/** 구절 파일명 정본 정규식: {약자}{장}_{절}.md */
export const VERSE_FILE_RE = /^([가-힣]+)(\d+)_(\d+)\.md$/;

/** 파일·폴더명 비교 전 유니코드 정규화 — 일부 압축 툴이 자모 분리(NFD)로 풀어놓는 것 방어 */
export const nfc = (s: string) => s.normalize("NFC");

/** 책 폴더 안 절 파일을 찾는 재귀 깊이 상한: 직계(1) + 하위 폴더 2단계 */
export const BOOK_SCAN_DEPTH = 3;

/** TFolder 서브트리를 평탄화한 항목. depth는 책 폴더 직계 = 1. */
export interface FlatEntry<T> {
  name: string;
  depth: number;
  isFolder: boolean;
  /** 파일이면 원본 참조 (bible-data에선 TFile, 테스트에선 string) */
  file?: T;
}

export interface VerseFileIndex<T> {
  /** linkTarget("요3_16") → 파일. NFC 정규화 후 매칭, 같은 링크는 얕은 깊이 우선 */
  byLink: Map<string, T>;
  /** 장 번호 → 정렬된 절 번호 배열 */
  chapters: Map<number, number[]>;
  maxChapter: number;
  /** NFC 보정 후에야 정규식에 일치한 파일 수 (진단용) */
  nfdFixed: number;
}

/**
 * 책 폴더 평탄화 목록에서 절 파일 인덱스 구축.
 * 압축 해제 이중 폴더(04.요한복음/04.요한복음/…)·장별 하위 폴더 배치를
 * maxDepth까지 흡수한다. 같은 linkTarget 중복은 얕은 것 우선(결정적).
 */
export function indexVerseFiles<T>(
  abbrev: string,
  entries: Array<FlatEntry<T>>,
  maxDepth = BOOK_SCAN_DEPTH,
): VerseFileIndex<T> {
  const re = new RegExp(`^${abbrev}(\\d+)_(\\d+)\\.md$`);
  const byLink = new Map<string, T>();
  const chapters = new Map<number, number[]>();
  let maxChapter = 0;
  let nfdFixed = 0;

  const sorted = entries.slice().sort((a, b) => a.depth - b.depth);
  for (const e of sorted) {
    if (e.isFolder || e.depth > maxDepth || e.file === undefined) continue;
    const name = nfc(e.name);
    const m = name.match(re);
    if (!m) continue;
    const chapter = parseInt(m[1], 10);
    const verse = parseInt(m[2], 10);
    const link = `${abbrev}${chapter}_${verse}`;
    if (byLink.has(link)) continue;
    if (name !== e.name) nfdFixed++;
    byLink.set(link, e.file);
    let list = chapters.get(chapter);
    if (!list) chapters.set(chapter, (list = []));
    list.push(verse);
    if (chapter > maxChapter) maxChapter = chapter;
  }
  for (const list of chapters.values()) list.sort((a, b) => a - b);
  return { byLink, chapters, maxChapter, nfdFixed };
}

/** 검증 버튼용 책 폴더 내용 진단 — 샘플 절 읽기 실패의 원인을 구분한다 */
export interface BookDiagnosis {
  /** 직계 md 파일 수 */
  directMd: number;
  /** 직계에서 절 파일명 패턴에 일치한 수 */
  directMatches: number;
  /** 하위 폴더(깊이 2~BOOK_SCAN_DEPTH)에서 일치한 수 */
  nestedMatches: number;
  /** 스캔 깊이를 초과한 위치의 md 파일 수 */
  deepFiles: number;
  /** 직계 하위 폴더 수 */
  subfolders: number;
  /** NFC 보정 후에야 일치한 파일 수 */
  nfdFixed: number;
  /** 패턴 불일치 md 파일명 예시 (직계 우선, 최대 3개) */
  mismatchSamples: string[];
}

export function diagnoseBookFolder<T>(
  abbrev: string,
  entries: Array<FlatEntry<T>>,
  maxDepth = BOOK_SCAN_DEPTH,
): BookDiagnosis {
  const re = new RegExp(`^${abbrev}(\\d+)_(\\d+)\\.md$`);
  const d: BookDiagnosis = {
    directMd: 0,
    directMatches: 0,
    nestedMatches: 0,
    deepFiles: 0,
    subfolders: 0,
    nfdFixed: 0,
    mismatchSamples: [],
  };
  const sorted = entries.slice().sort((a, b) => a.depth - b.depth);
  for (const e of sorted) {
    if (e.isFolder) {
      if (e.depth === 1) d.subfolders++;
      continue;
    }
    const name = nfc(e.name);
    if (!name.endsWith(".md")) continue;
    if (e.depth === 1) d.directMd++;
    if (e.depth > maxDepth) {
      d.deepFiles++;
      continue;
    }
    if (re.test(name)) {
      if (name !== e.name) d.nfdFixed++;
      if (e.depth === 1) d.directMatches++;
      else d.nestedMatches++;
    } else if (d.mismatchSamples.length < 3) {
      d.mismatchSamples.push(e.name);
    }
  }
  return d;
}

/**
 * 진단 결과 → 수강생(비개발자)용 한국어 안내 문구 목록.
 * 절 파일을 하나도 못 찾은 실패 상황에서 호출된다.
 */
export function formatBookDiagnosis(bookName: string, abbrev: string, d: BookDiagnosis): string[] {
  const out: string[] = [];
  const totalMatches = d.directMatches + d.nestedMatches;

  if (totalMatches === 0) {
    if (d.directMd === 0 && d.subfolders === 0 && d.deepFiles === 0) {
      out.push(
        `📁 ${bookName} 폴더가 비어 있습니다. iCloud·OneDrive를 사용하시는 경우 폴더 모양만 먼저 만들어지고 파일은 아직 이 기기에 내려받아지지 않았을 수 있습니다. Finder(맥)나 파일 탐색기(윈도우)에서 성경 폴더를 마우스 오른쪽 버튼으로 눌러 "지금 다운로드"(iCloud) 또는 "이 장치에 항상 유지"(OneDrive)를 선택하고, 다운로드가 끝난 뒤 다시 검증해주세요.`,
      );
    } else if (d.directMd > 0) {
      const samples = d.mismatchSamples.map((s) => `"${s}"`).join(", ");
      out.push(
        `⚠️ ${bookName} 폴더에 md 파일이 ${d.directMd}개 있지만 절 파일 이름 형식(예: ${abbrev}1_1.md)과 다릅니다${samples ? ` — 발견된 예: ${samples}` : ""}. 성경 노트 패키지를 다시 내려받아 폴더 그대로 넣어주세요.`,
      );
    }
    if (d.deepFiles > 0) {
      out.push(
        `⚠️ 파일이 너무 깊은 폴더(책 폴더에서 ${BOOK_SCAN_DEPTH}단계 이상 안쪽)에 들어 있습니다. 정본 패키지의 폴더 구조(예: 신약/04.요한복음/요1_1.md)대로 절 파일을 책 폴더 바로 아래로 옮겨주세요.`,
      );
    }
  } else if (d.directMatches === 0 && d.nestedMatches > 0) {
    out.push(
      `ℹ️ 절 파일이 ${bookName} 폴더 안의 하위 폴더에서 발견되었습니다 — 자동으로 인식하므로 그대로 사용하셔도 됩니다.`,
    );
  }
  if (d.nfdFixed > 0) {
    out.push(
      `ℹ️ 일부 파일 이름이 자모가 분리된 형태(NFD)로 저장되어 있었지만 자동으로 보정해 인식했습니다.`,
    );
  }
  return out;
}
