/**
 * 설정 마이그레이션 — 순수 모듈 (obsidian 미의존, vitest 대상).
 * v1(0.7 이하): 단일 biblePath + commentaryPath가 성경 폴더 기준 상대 경로.
 * v2: 모든 경로가 볼트 루트 기준 + 정규화된 값 (미릴리스 중간 단계).
 * v3: biblePath를 구약(otPath)/신약(ntPath) 두 폴더로 분리.
 */
import { normalizeFolderPath } from "./paths";
import type { BibleVerseSettings } from "./settings";

export const SETTINGS_VERSION = 3;

export interface MigrateDeps {
  /** 볼트에 해당 경로의 폴더가 존재하는가 */
  folderExists: (path: string) => boolean;
}

/** 구버전 설정을 v3으로 승격. changed=true면 호출자가 저장·캐시 무효화한다. */
export function migrateSettings(
  settings: BibleVerseSettings,
  version: number,
  deps: MigrateDeps,
): { settings: BibleVerseSettings; changed: boolean } {
  if (version >= SETTINGS_VERSION) return { settings, changed: false };

  const next = { ...settings };
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

  const changed =
    next.otPath !== (settings.otPath ?? "") ||
    next.ntPath !== (settings.ntPath ?? "") ||
    next.commentaryPath !== settings.commentaryPath ||
    next.sermonFolder !== settings.sermonFolder;
  return { settings: next, changed };
}
