/**
 * 역본 목록 — 순수 모듈 (obsidian 미의존, vitest 대상).
 *
 * 역본 이름은 구절 노트 `## 📜 본문` 아래 `> [!quote] 이름` 콜아웃 제목과 정확히 같아야 한다
 * (NFC 정규화·앞뒤 공백·연속 공백만 정리하고 대소문자는 구분). 파서(note-parser)는 제목을
 * 가리지 않고 모든 콜아웃을 읽으므로, 이 목록은 모달 버튼·Tab 순서·자동완성·병렬 쌍·키워드
 * 검색 대상을 정하는 UI 어휘일 뿐이다 — 목록을 바꿔도 본문 인덱스는 다시 만들지 않는다.
 */

export interface VersionDef {
  /** 콜아웃 제목과 같은 이름 (예: "새번역", "NIV") */
  name: string;
  /** 모달 역본 버튼에 보일 짧은 이름 (예: "개역") — 없으면 name 그대로 */
  short?: string;
}

/** 정본 성경 노트 패키지의 기본 5역본 (순서 = 버튼·Tab·자동완성 순서) */
export const DEFAULT_VERSIONS: readonly VersionDef[] = [
  { name: "새번역" },
  { name: "개역개정", short: "개역" },
  { name: "쉬운성경", short: "쉬운" },
  { name: "NIV" },
  { name: "KJV" },
];

/** 기본 5역본의 새 복사본 (설정 기본값·되돌리기용 — 공유 참조 금지) */
export function cloneDefaultVersions(): VersionDef[] {
  return DEFAULT_VERSIONS.map((d) => ({ ...d }));
}

export function versionNames(defs: readonly VersionDef[]): string[] {
  return defs.map((d) => d.name);
}

/** 모달 역본 버튼 표시 이름 */
export function shortLabel(def: VersionDef): string {
  return def.short || def.name;
}

/** 콜아웃 제목·설정 이름의 공통 정규화: NFC → 연속 공백 1칸 → trim. 문자열이 아니면 "" */
export function normalizeVersionName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** 현재 목록이 기본 5역본과 이름·순서·짧은 이름까지 같은가 (되돌리기 버튼 비활성 판정) */
export function isDefaultVersionList(defs: readonly VersionDef[]): boolean {
  if (defs.length !== DEFAULT_VERSIONS.length) return false;
  return defs.every(
    (d, i) =>
      d.name === DEFAULT_VERSIONS[i].name &&
      (d.short ?? "") === (DEFAULT_VERSIONS[i].short ?? ""),
  );
}

/** sanitizeVersionSettings가 다루는 설정 조각 */
export interface VersionSettingsSlice {
  versions: VersionDef[];
  defaultVersion: string;
  parallelVersions: [string, string];
}

/** sanitize가 고친 값 — 설정 탭 상태줄 안내용 ("기본 역본을 X로 바꿨습니다") */
export interface VersionFixes {
  defaultVersion?: string;
  parallelVersions?: [string, string];
}

/** 저장된 항목 하나를 VersionDef로 — 문자열 항목 허용, 이름 없으면 버림 */
function toDef(item: unknown): VersionDef | null {
  if (typeof item === "string") {
    const name = normalizeVersionName(item);
    return name ? { name } : null;
  }
  if (item && typeof item === "object") {
    const obj = item as { name?: unknown; short?: unknown };
    const name = normalizeVersionName(obj.name);
    if (!name) return null;
    const short = normalizeVersionName(obj.short);
    return short && short !== name ? { name, short } : { name };
  }
  return null;
}

/**
 * 역본 설정의 불변식을 보장한다 — 로드·마이그레이션·설정 변경의 유일한 보정 지점.
 * ① 항목 정규화(빈 이름·쓰레기 제거, 이름과 같은 짧은 이름 제거) ② 중복 이름은 앞 것만
 * ③ 비면 기본 5역본 ④ 기본 역본은 목록 안(없으면 첫 항목) ⑤ 병렬 쌍은 둘 다 목록 안이고
 * 서로 다름(역본이 1개면 둘 다 같은 값) ⑥ 항상 새 배열·튜플을 돌려준다(기본값 공유 차단).
 */
export function sanitizeVersionSettings<T extends VersionSettingsSlice>(
  s: T,
): { settings: T; fixes: VersionFixes } {
  const seen = new Set<string>();
  const versions: VersionDef[] = [];
  const rawList: unknown[] = Array.isArray(s.versions) ? s.versions : [];
  for (const item of rawList) {
    const def = toDef(item);
    if (!def || seen.has(def.name)) continue;
    seen.add(def.name);
    versions.push(def);
  }
  if (versions.length === 0) versions.push(...cloneDefaultVersions());
  const names = versions.map((d) => d.name);

  const fixes: VersionFixes = {};
  const defaultVersion = names.includes(s.defaultVersion) ? s.defaultVersion : names[0];
  if (defaultVersion !== s.defaultVersion) fixes.defaultVersion = defaultVersion;

  const rawPair: string[] = Array.isArray(s.parallelVersions) ? s.parallelVersions : [];
  const primary = names.includes(rawPair[0]) ? rawPair[0] : defaultVersion;
  let secondary = names.includes(rawPair[1]) ? rawPair[1] : "";
  if (!secondary || secondary === primary) {
    secondary = names.find((n) => n !== primary) ?? primary;
  }
  const parallelVersions: [string, string] = [primary, secondary];
  if (primary !== rawPair[0] || secondary !== rawPair[1]) {
    fixes.parallelVersions = parallelVersions;
  }

  return { settings: { ...s, versions, defaultVersion, parallelVersions }, fixes };
}
