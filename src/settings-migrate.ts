/**
 * 설정 마이그레이션 — 순수 모듈 (obsidian 미의존, vitest 대상).
 * v1(0.7 이하): commentaryPath가 성경 폴더 기준 상대 경로였다.
 * v2: 모든 경로가 볼트 루트 기준 + 정규화된 값.
 */
import { normalizeFolderPath } from "./paths";
import type { BibleVerseSettings } from "./settings";

export const SETTINGS_VERSION = 2;

export interface MigrateDeps {
  /** 볼트에 해당 경로의 폴더가 존재하는가 */
  folderExists: (path: string) => boolean;
}

/** v1 설정을 v2로 승격. changed=true면 호출자가 저장·캐시 무효화한다. */
export function migrateSettings(
  settings: BibleVerseSettings,
  version: number,
  deps: MigrateDeps,
): { settings: BibleVerseSettings; changed: boolean } {
  if (version >= SETTINGS_VERSION) return { settings, changed: false };

  const next = { ...settings };
  next.biblePath = normalizeFolderPath(next.biblePath);
  next.commentaryPath = normalizeFolderPath(next.commentaryPath);
  next.sermonFolder = normalizeFolderPath(next.sermonFolder);

  // 상대 주석 경로 승격: 볼트 루트에 없고 {성경폴더}/{주석경로} 폴더가 있으면 그쪽으로.
  // 루트에 동명 폴더가 있으면 사용자가 루트 경로를 의도했을 수 있으므로 그대로 둔다.
  if (
    next.commentaryPath &&
    next.biblePath &&
    !deps.folderExists(next.commentaryPath) &&
    deps.folderExists(`${next.biblePath}/${next.commentaryPath}`)
  ) {
    next.commentaryPath = normalizeFolderPath(`${next.biblePath}/${next.commentaryPath}`);
  }

  const changed =
    next.biblePath !== settings.biblePath ||
    next.commentaryPath !== settings.commentaryPath ||
    next.sermonFolder !== settings.sermonFolder;
  return { settings: next, changed };
}
