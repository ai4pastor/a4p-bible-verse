import { App, PluginSettingTab, Setting } from "obsidian";
import type BibleVersePlugin from "./main";
import { InsertFormat, VERSIONS, Version } from "./types";

export interface BibleVerseSettings {
  /** 볼트 루트 기준 성경 폴더 경로 (하위에 구약/신약 폴더가 있어야 함) */
  biblePath: string;
  defaultVersion: Version;
  /** 삽입 형식 — 콜아웃 블록 vs 일반 텍스트(wikilink 유지) */
  insertFormat: InsertFormat;
  /** 범위 삽입 시 절마다 줄바꿈(true) vs 한 문단으로 이어 붙임(false) */
  verseNewline: boolean;
  enableSuggest: boolean;
  suggestTrigger: string;
  /** 병렬 삽입 자동완성 트리거 (예: ;;;요3:16 → 두 역본 동시 삽입) */
  parallelTrigger: string;
  /** 병렬 삽입에 쓸 역본 쌍 [주 역본, 병렬 역본] */
  parallelVersions: [Version, Version];
  /** "인용한 설교"를 찾을 폴더 — 비우면 성경 폴더 제외 전체 볼트 */
  sermonFolder: string;
  /** 본문의 각주 마커·소제목(<...>, a) 등) 제거 여부 */
  stripAnnotations: boolean;
  /** 성경 폴더 기준 주석 폴더 상대 경로 — 비우면 주석 기능 끔 */
  commentaryPath: string;
}

export const DEFAULT_SETTINGS: BibleVerseSettings = {
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
};

export class BibleVerseSettingTab extends PluginSettingTab {
  plugin: BibleVersePlugin;

  constructor(app: App, plugin: BibleVersePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    let statusEl: HTMLElement;

    new Setting(containerEl)
      .setName("성경 폴더 경로")
      .setDesc("볼트 루트 기준. 이 폴더 아래에 구약/신약 폴더가 있어야 합니다.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.biblePath)
          .setValue(this.plugin.settings.biblePath)
          .onChange(async (value) => {
            this.plugin.settings.biblePath = value.trim();
            this.plugin.bibleData.invalidate();
            await this.plugin.persist();
          }),
      )
      .addButton((btn) =>
        btn
          .setButtonText("검증")
          .setCta()
          .onClick(async () => {
            btn.setDisabled(true);
            const result = await this.plugin.bibleData.validate();
            btn.setDisabled(false);
            this.renderValidation(statusEl, result);
          }),
      );

    statusEl = containerEl.createDiv({ cls: "bible-verse-settings-status" });

    new Setting(containerEl)
      .setName("기본 역본")
      .setDesc("모달을 열 때 처음 선택되는 역본입니다.")
      .addDropdown((drop) => {
        for (const v of VERSIONS) drop.addOption(v, v);
        drop.setValue(this.plugin.settings.defaultVersion).onChange(async (value) => {
          this.plugin.settings.defaultVersion = value as Version;
          await this.plugin.persist();
        });
      });

    new Setting(containerEl)
      .setName("삽입 형식")
      .setDesc(
        "콜아웃: 인용 콜아웃 블록으로 삽입. 일반 텍스트: 콜아웃 없이 본문만 삽입 (wikilink는 유지되어 백링크·인용한 설교 기능이 계속 작동합니다).",
      )
      .addDropdown((drop) => {
        drop.addOption("callout", "콜아웃");
        drop.addOption("text", "일반 텍스트");
        drop.setValue(this.plugin.settings.insertFormat).onChange(async (value) => {
          this.plugin.settings.insertFormat = value as InsertFormat;
          await this.plugin.persist();
        });
      });

    new Setting(containerEl)
      .setName("범위 삽입 스타일")
      .setDesc("여러 절을 삽입할 때 절마다 줄을 바꿀지, 줄바꿈 없이 한 문단으로 이어 붙일지 정합니다.")
      .addDropdown((drop) => {
        drop.addOption("lines", "절마다 줄바꿈");
        drop.addOption("inline", "한 문단 이어붙임");
        drop
          .setValue(this.plugin.settings.verseNewline ? "lines" : "inline")
          .onChange(async (value) => {
            this.plugin.settings.verseNewline = value === "lines";
            await this.plugin.persist();
          });
      });

    new Setting(containerEl)
      .setName("에디터 자동완성")
      .setDesc("노트에서 트리거 문자열 + 참조(예: ;;요3:16)를 입력하면 역본을 골라 바로 삽입합니다.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableSuggest).onChange(async (value) => {
          this.plugin.settings.enableSuggest = value;
          await this.plugin.persist();
        }),
      );

    new Setting(containerEl)
      .setName("자동완성 트리거")
      .setDesc("자동완성을 시작하는 문자열입니다.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.suggestTrigger)
          .setValue(this.plugin.settings.suggestTrigger)
          .onChange(async (value) => {
            this.plugin.settings.suggestTrigger = value || DEFAULT_SETTINGS.suggestTrigger;
            await this.plugin.persist();
          }),
      );

    new Setting(containerEl)
      .setName("각주 표기 정리")
      .setDesc(
        "삽입·복사 시 본문에 섞인 소제목(<다윗의 노래>)과 각주 마커(a), (a. …))를 제거합니다.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.stripAnnotations)
          .onChange(async (value) => {
            this.plugin.settings.stripAnnotations = value;
            await this.plugin.persist();
          }),
      );

    new Setting(containerEl)
      .setName("주석 폴더 경로")
      .setDesc(
        "성경 폴더 기준 상대 경로. 장 통합주석 노트가 있으면 모달에 주석 바로가기가 표시됩니다. 비우면 끕니다.",
      )
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.commentaryPath)
          .setValue(this.plugin.settings.commentaryPath)
          .onChange(async (value) => {
            this.plugin.settings.commentaryPath = value.trim();
            await this.plugin.persist();
          }),
      );

    new Setting(containerEl)
      .setName("설교 폴더 경로")
      .setDesc(
        "검색한 구절을 인용한 설교를 이 폴더에서 찾아 모달에 보여줍니다. 비우면 성경 폴더를 제외한 전체 볼트에서 찾습니다.",
      )
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.sermonFolder)
          .setValue(this.plugin.settings.sermonFolder)
          .onChange(async (value) => {
            this.plugin.settings.sermonFolder = value.trim();
            await this.plugin.persist();
          }),
      );

    new Setting(containerEl).setName("병렬 삽입 (이중 역본)").setHeading();

    new Setting(containerEl)
      .setName("병렬 삽입 트리거")
      .setDesc(
        "이 트리거로 참조를 입력하면(예: ;;;요3:16) 아래 두 역본이 절마다 교차로 함께 삽입됩니다. 해외 이중 언어 설교용.",
      )
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.parallelTrigger)
          .setValue(this.plugin.settings.parallelTrigger)
          .onChange(async (value) => {
            this.plugin.settings.parallelTrigger = value || DEFAULT_SETTINGS.parallelTrigger;
            await this.plugin.persist();
          }),
      );

    new Setting(containerEl)
      .setName("병렬 역본 — 주 역본")
      .setDesc("본문으로 먼저 들어가는 역본입니다.")
      .addDropdown((drop) => {
        for (const v of VERSIONS) drop.addOption(v, v);
        drop
          .setValue(this.plugin.settings.parallelVersions[0])
          .onChange(async (value) => {
            this.plugin.settings.parallelVersions[0] = value as Version;
            await this.plugin.persist();
          });
      });

    new Setting(containerEl)
      .setName("병렬 역본 — 병렬 역본")
      .setDesc("각 절 아래 이탤릭으로 따라가는 역본입니다.")
      .addDropdown((drop) => {
        for (const v of VERSIONS) drop.addOption(v, v);
        drop
          .setValue(this.plugin.settings.parallelVersions[1])
          .onChange(async (value) => {
            this.plugin.settings.parallelVersions[1] = value as Version;
            await this.plugin.persist();
          });
      });
  }

  private renderValidation(
    el: HTMLElement,
    result: { ok: boolean; messages: string[] },
  ): void {
    el.empty();
    for (const message of result.messages) {
      el.createEl("p", { text: message, cls: "bible-verse-settings-status-line" });
    }
    if (result.ok) {
      el.createEl("p", {
        text: "모든 점검을 통과했습니다. 바로 사용할 수 있습니다.",
        cls: "bible-verse-settings-status-line",
      });
    }
  }
}
