import { describe, expect, it } from "vitest";
// settings.ts는 obsidian을 import하므로 여기서 값은 못 가져온다 — 타입만 사용
import type { BibleVerseSettings } from "../src/settings";
import { SETTINGS_VERSION, migrateSettings } from "../src/settings-migrate";

function v1Settings(paths: Partial<BibleVerseSettings>): BibleVerseSettings {
  return {
    biblePath: "100. notes/170. 성경",
    defaultVersion: "새번역",
    insertFormat: "callout",
    verseNewline: true,
    enableSuggest: true,
    suggestTrigger: ";;",
    parallelTrigger: ";;;",
    parallelVersions: ["새번역", "NIV"],
    sermonFolder: "300. Sermons",
    stripAnnotations: false,
    commentaryPath: "171. 성경주석",
    keywordSearchScope: "current",
    ...paths,
  };
}

describe("migrateSettings", () => {
  it("상대 주석 경로를 성경 폴더 하위 절대경로로 승격한다", () => {
    const { settings, changed } = migrateSettings(v1Settings({}), 1, {
      folderExists: (p) => p === "100. notes/170. 성경/171. 성경주석",
    });
    expect(changed).toBe(true);
    expect(settings.commentaryPath).toBe("100. notes/170. 성경/171. 성경주석");
  });

  it("볼트 루트에 동명 폴더가 있으면 승격하지 않는다", () => {
    const { settings, changed } = migrateSettings(v1Settings({}), 1, {
      folderExists: (p) =>
        p === "171. 성경주석" || p === "100. notes/170. 성경/171. 성경주석",
    });
    expect(changed).toBe(false);
    expect(settings.commentaryPath).toBe("171. 성경주석");
  });

  it("둘 다 없으면 값을 유지한다 (검증 버튼이 안내)", () => {
    const { settings, changed } = migrateSettings(v1Settings({}), 1, {
      folderExists: () => false,
    });
    expect(changed).toBe(false);
    expect(settings.commentaryPath).toBe("171. 성경주석");
  });

  it("경로 정규화만 필요한 경우도 changed=true", () => {
    const { settings, changed } = migrateSettings(
      v1Settings({ biblePath: "/100. notes/170. 성경/", commentaryPath: "" }),
      1,
      { folderExists: () => false },
    );
    expect(changed).toBe(true);
    expect(settings.biblePath).toBe("100. notes/170. 성경");
  });

  it("이미 v2면 아무것도 하지 않는다", () => {
    const input = v1Settings({ commentaryPath: "171. 성경주석/" });
    const { settings, changed } = migrateSettings(input, SETTINGS_VERSION, {
      folderExists: () => true,
    });
    expect(changed).toBe(false);
    expect(settings).toBe(input);
  });

  it("신규 설치(빈 경로)는 그대로 통과한다", () => {
    const { settings, changed } = migrateSettings(
      v1Settings({ biblePath: "", commentaryPath: "", sermonFolder: "" }),
      1,
      { folderExists: () => true },
    );
    expect(changed).toBe(false);
    expect(settings.biblePath).toBe("");
    expect(settings.commentaryPath).toBe("");
  });
});
