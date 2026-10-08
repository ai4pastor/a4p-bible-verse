/**
 * 설정 마이그레이션 — 순수 모듈 (obsidian 미의존, vitest 대상).
 * v1(0.7 이하): 단일 biblePath + commentaryPath가 성경 폴더 기준 상대 경로.
 * v2: 모든 경로가 볼트 루트 기준 + 정규화된 값 (미릴리스 중간 단계).
 * v3: biblePath를 구약(otPath)/신약(ntPath) 두 폴더로 분리.
 * v4(0.12): 역본 목록 `versions` 추가 — 없으면 기본 5역본, 기본 역본·병렬 쌍이 목록 안에 있게 보정.
 */
import { normalizeFolderPath } from "./paths";
import type { BibleVerseSettings } from "./settings";
import { cloneDefaultVersions, sanitizeVersionSettings } from "./versions";

export const SETTINGS_VERSION = 4;

export interface MigrateDeps {
  /** 볼트에 해당 경로의 폴더가 존재하는가 */
  folderExists: (path: string) => boolean;
}

/**
 * 구버전 설정을 최신 버전으로 승격. changed=true면 호출자가 캐시(책 폴더·본문 인덱스)를
 * 무효화한다 — 경로가 바뀐 경우에만 true. 역본 목록 보정은 캐시와 무관하므로 포함하지 않는다
 * (호출자는 버전 승격 자체를 저장한다).
 */
export function migrateSettings(
  settings: BibleVerseSettings,
  version: number,
  deps: MigrateDeps,
): { settings: BibleVerseSettings; changed: boolean } {
  if (version >= SETTINGS_VERSION) return { settings, changed: false };

  let next: BibleVerseSettings = { ...settings };
  let changed = false;

  if (version < 3) {
    const legacyBible = normalizeFolderPath(next.biblePath ?? "");
    next.otPath = normalizeFolderPath(next.otPath ?? "");
    next.ntPath = normalizeFolderPath(next.ntPath ?? "");
    next.commentaryPath = normalizeFolderPath(next.commentaryPath);
    next.sermonFolder = normalizeFolderPath(next.sermonFolder);

    // v1 → 상대 주석 경로 승격: 볼트 루트에 없고 {성경폴더}/{주석경로} 폴더가 있으면 그쪽으로.
    // 루트에 동명 폴더가 있으면 사용자가 루트 경로를 의도했을 수 있으므로 그대로 둔다.
    if (
      next.commentaryPath &&
      legacyBible &&
      !deps.folderExists(next.commentaryPath) &&
      deps.folderExists(`${legacyBible}/${next.commentaryPath}`)
    ) {
      next.commentaryPath = normalizeFolderPath(`${legacyBible}/${next.commentaryPath}`);
    }

    // v2 이하 → 구약/신약 분리: 단일 성경 폴더 아래 구약/신약 폴더가 있으면 각각 파생,
    // 없으면 두 필드 모두 기존 루트를 가리키게 한다 (책 폴더 재귀 탐색이 흡수).
    if (legacyBible && !next.otPath && !next.ntPath) {
      const ot = `${legacyBible}/구약`;
      const nt = `${legacyBible}/신약`;
      next.otPath = deps.folderExists(ot) ? ot : legacyBible;
      next.ntPath = deps.folderExists(nt) ? nt : legacyBible;
    }
    delete next.biblePath;

    changed =
      next.otPath !== (settings.otPath ?? "") ||
      next.ntPath !== (settings.ntPath ?? "") ||
      next.commentaryPath !== settings.commentaryPath ||
      next.sermonFolder !== settings.sermonFolder;
  }

  if (version < 4) {
    // v3 이하 data.json에는 versions가 없다 — 기본 5역본으로 채우고 불변식 보정
    next = sanitizeVersionSettings({
      ...next,
      versions: Array.isArray(next.versions) ? next.versions : cloneDefaultVersions(),
    }).settings;
  }

  return { settings: next, changed };
}
