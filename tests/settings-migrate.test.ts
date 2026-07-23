import { describe, expect, it } from "vitest";
// settings.ts는 obsidian을 import하므로 여기서 값은 못 가져온다 — 타입만 사용
import type { BibleVerseSettings } from "../src/settings";
import { SETTINGS_VERSION, migrateSettings } from "../src/settings-migrate";

const BIBLE = "100. notes/170. 성경";

/** v1(0.7 이하) data.json 형태 — 단일 biblePath, otPath/ntPath 없음(로드 시 ""로 채워짐) */
function v1Settings(paths: Partial<BibleVerseSettings>): BibleVerseSettings {
  return {
    otPath: "",
    ntPath: "",
    biblePath: BIBLE,
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
  it("단일 biblePath 아래 구약/신약 폴더가 있으면 각각 파생한다", () => {
    const { settings, changed } = migrateSettings(v1Settings({}), 1, {
      folderExists: (p) => p === `${BIBLE}/구약` || p === `${BIBLE}/신약`,
    });
    expect(changed).toBe(true);
    expect(settings.otPath).toBe(`${BIBLE}/구약`);
    expect(settings.ntPath).toBe(`${BIBLE}/신약`);
    expect(settings.biblePath).toBeUndefined();
  });

  it("구약/신약 폴더가 없으면 두 필드 모두 기존 루트를 가리킨다", () => {
    const { settings, changed } = migrateSettings(v1Settings({}), 1, {
      folderExists: () => false,
    });
    expect(changed).toBe(true);
    expect(settings.otPath).toBe(BIBLE);
    expect(settings.ntPath).toBe(BIBLE);
  });

  it("상대 주석 경로를 성경 폴더 하위 절대경로로 승격한다", () => {
    const { settings } = migrateSettings(v1Settings({}), 1, {
      folderExists: (p) => p === `${BIBLE}/171. 성경주석`,
    });
    expect(settings.commentaryPath).toBe(`${BIBLE}/171. 성경주석`);
  });

  it("볼트 루트에 동명 폴더가 있으면 주석 경로를 승격하지 않는다", () => {
    const { settings } = migrateSettings(v1Settings({}), 1, {
      folderExists: (p) => p === "171. 성경주석" || p === `${BIBLE}/171. 성경주석`,
    });
    expect(settings.commentaryPath).toBe("171. 성경주석");
  });

  it("v2(단일 biblePath, 절대 주석 경로)도 구약/신약으로 분리한다", () => {
    const { settings, changed } = migrateSettings(
      v1Settings({ commentaryPath: `${BIBLE}/171. 성경주석` }),
      2,
      { folderExists: (p) => p === `${BIBLE}/구약` || p === `${BIBLE}/신약` },
    );
    expect(changed).toBe(true);
    expect(settings.otPath).toBe(`${BIBLE}/구약`);
    expect(settings.ntPath).toBe(`${BIBLE}/신약`);
    expect(settings.commentaryPath).toBe(`${BIBLE}/171. 성경주석`);
  });

  it("경로 정규화가 적용된다", () => {
    const { settings, changed } = migrateSettings(
      v1Settings({ biblePath: `/${BIBLE}/`, commentaryPath: "" }),
      1,
      { folderExists: () => false },
    );
    expect(changed).toBe(true);
    expect(settings.otPath).toBe(BIBLE);
  });

  it("이미 v3이면 아무것도 하지 않는다", () => {
    const input = v1Settings({});
    const { settings, changed } = migrateSettings(input, SETTINGS_VERSION, {
      folderExists: () => true,
    });
    expect(changed).toBe(false);
    expect(settings).toBe(input);
  });

  it("빈 경로 설정은 그대로 통과한다", () => {
    const { settings, changed } = migrateSettings(
      v1Settings({ biblePath: "", commentaryPath: "", sermonFolder: "" }),
      1,
      { folderExists: () => true },
    );
    expect(changed).toBe(false);
    expect(settings.otPath).toBe("");
    expect(settings.ntPath).toBe("");
  });
});
