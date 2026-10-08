import { App, PluginSettingTab, Setting, normalizePath } from "obsidian";
import type BibleVersePlugin from "./main";
import { AddVersionModal } from "./add-version-modal";
import { QuoteTitleScan } from "./bible-data";
import { confirmModal } from "./confirm-modal";
import { FolderSuggest } from "./folder-suggest";
import { normalizeFolderPath } from "./paths";
import { InsertFormat, Version } from "./types";
import {
  DEFAULT_VERSIONS,
  VersionDef,
  VersionFixes,
  cloneDefaultVersions,
  isDefaultVersionList,
  normalizeVersionName,
  shortLabel,
  versionNames,
} from "./versions";

export interface BibleVerseSettings {
  /** 볼트 루트 기준 구약 성경 폴더 경로 — 빈 값이면 미설정. 하위 책 폴더는 자동 탐색 */
  otPath: string;
  /** 볼트 루트 기준 신약 성경 폴더 경로 — 빈 값이면 미설정. 하위 책 폴더는 자동 탐색 */
  ntPath: string;
  /** @deprecated v2 이하의 단일 성경 폴더 경로 — 마이그레이션에서 otPath/ntPath로 흡수 후 제거 */
  biblePath?: string;
  /**
   * 등록 역본 목록 (순서 = 모달 버튼·Tab·자동완성 순서). name은 구절 노트 `## 📜 본문`의
   * `> [!quote] 이름` 콜아웃 제목과 정확히 같아야 한다. 파서는 모든 콜아웃을 읽으므로 이 목록은
   * UI 어휘일 뿐 — 바꿔도 본문 인덱스는 다시 만들지 않는다. 불변식은 sanitizeVersionSettings.
   */
  versions: VersionDef[];
  /** 모달을 열 때 처음 선택되는 역본 — 반드시 versions 안의 이름 */
  defaultVersion: Version;
  /** 삽입 형식 — 콜아웃 블록 vs 일반 텍스트(wikilink 유지) */
  insertFormat: InsertFormat;
  /** 범위 삽입 시 절마다 줄바꿈(true) vs 한 문단으로 이어 붙임(false) */
  verseNewline: boolean;
  enableSuggest: boolean;
  suggestTrigger: string;
  /** 병렬 삽입 자동완성 트리거 (예: ;;;요3:16 → 두 역본 동시 삽입) */
  parallelTrigger: string;
  /** 병렬 삽입에 쓸 역본 쌍 [주 역본, 병렬 역본] — 둘 다 versions 안, 역본이 2개 이상이면 서로 다름 */
  parallelVersions: [Version, Version];
  /** "인용한 설교"를 찾을 폴더 — 비우면 성경·주석 폴더 제외 전체 볼트 */
  sermonFolder: string;
  /** 본문의 각주 마커·소제목(<...>, a) 등) 제거 여부 */
  stripAnnotations: boolean;
  /** 볼트 루트 기준 주석 폴더 경로 — 성경 폴더와 무관하게 지정. 비우면 주석 기능 끔 */
  commentaryPath: string;
  /** 키워드 본문 검색 대상 — "current": 현재 선택 역본만, "all": 등록 역본 전체 */
  keywordSearchScope: "current" | "all";
  /**
   * 본문 키워드 검색 사용 여부 (저사양 PC용). 끄면 인덱스 빌드(3만 파일 읽기)·디스크 캐시
   * 로드·메모리 사용이 전혀 일어나지 않는다. 장절 참조 검색·자동완성·삽입은 영향 없음.
   */
  enableKeywordSearch: boolean;
}

export const DEFAULT_SETTINGS: BibleVerseSettings = {
  // 경로는 의도적으로 빈 값 — 볼트마다 위치가 다르므로 사용자가 직접 선택한다
  otPath: "",
  ntPath: "",
  versions: cloneDefaultVersions(),
  defaultVersion: "새번역",
  insertFormat: "callout",
  verseNewline: true,
  enableSuggest: true,
  suggestTrigger: ";;",
  parallelTrigger: ";;;",
  parallelVersions: ["새번역", "NIV"],
  sermonFolder: "",
  stripAnnotations: false,
  commentaryPath: "",
  keywordSearchScope: "current",
  enableKeywordSearch: true,
};

type StatusKind = "ok" | "warn";
interface StatusLine {
  text: string;
  kind: StatusKind;
}

export class BibleVerseSettingTab extends PluginSettingTab {
  plugin: BibleVersePlugin;
  /** 역본 섹션 상태줄 — 구조 변경으로 다시 그려도 마지막 안내를 유지한다 */
  private versionStatus: StatusLine | null = null;
  private versionStatusEl: HTMLElement | null = null;
  /** 병렬 삽입 섹션 상태줄 */
  private parallelStatus: StatusLine | null = null;
  /** 표본 노트(창1_1·시23_1·요3_16) 스캔 결과 — 탭이 열려 있는 동안 캐시, "노트에서 찾기"로 갱신 */
  private scan: QuoteTitleScan | null = null;
  private scanning = false;
  /** 역본 행의 배지 영역 — 스캔이 끝나면 전체를 다시 그리지 않고 제자리에서 갱신 */
  private badgeEls = new Map<string, HTMLElement>();
  private detectedEl: HTMLElement | null = null;

  constructor(app: App, plugin: BibleVersePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.badgeEls.clear();
    this.detectedEl = null;
    this.versionStatusEl = null;

    this.addFolderField(containerEl, {
      name: "구약 성경 폴더",
      desc: "구약 성경 노트를 넣어둔 폴더를 선택하세요. 그 아래의 책 폴더(01.창세기 …)는 자동으로 찾습니다.",
      getValue: () => this.plugin.settings.otPath,
      setValue: (v) => {
        this.plugin.settings.otPath = v;
        this.plugin.bibleData.invalidate();
        this.plugin.verseIndex.invalidate();
        this.scan = null;
      },
      validate: () => this.plugin.bibleData.validateTestament("구약"),
    });

    this.addFolderField(containerEl, {
      name: "신약 성경 폴더",
      desc: "신약 성경 노트를 넣어둔 폴더를 선택하세요. 그 아래의 책 폴더(01.마태복음 …)는 자동으로 찾습니다.",
      getValue: () => this.plugin.settings.ntPath,
      setValue: (v) => {
        this.plugin.settings.ntPath = v;
        this.plugin.bibleData.invalidate();
        this.plugin.verseIndex.invalidate();
        this.scan = null;
      },
      validate: () => this.plugin.bibleData.validateTestament("신약"),
    });

    this.renderVersionSection(containerEl);

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
      .setName("본문 키워드 검색 사용")
      .setDesc(
        "참조 형식이 아닌 입력(예: 사랑 은혜)을 성경 본문에서 찾습니다. 첫 검색 때 전체 구절 노트(약 3만 개)를 읽어 인덱스를 만들고 메모리를 100MB 이상 사용합니다. 사양이 낮은 PC에서 옵시디언이 느려지면 끄세요 — 장절 참조 검색·자동완성·삽입은 그대로 동작합니다. 켜 두어도 인덱스는 처음 단어 검색 때 확인을 거친 뒤에만 만듭니다.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableKeywordSearch)
          .onChange(async (value) => {
            this.plugin.settings.enableKeywordSearch = value;
            // 끄면 메모리에 올라온 인덱스를 즉시 해제한다 (디스크 캐시 파일은 그대로 둔다)
            if (!value) this.plugin.verseIndex.invalidate();
            await this.plugin.persist();
            this.display(); // 하위 옵션(대상 역본) 표시 여부 갱신
          }),
      );

    if (this.plugin.settings.enableKeywordSearch) {
      new Setting(containerEl)
        .setName("키워드 검색 대상 역본")
        .setDesc(
          "본문 키워드 검색(예: \"사랑 은혜\") 시 현재 선택한 역본에서만 찾을지, 등록한 역본 전체에서 찾을지 정합니다. 첫 키워드 검색 시 인덱스 생성에 몇 초가 걸리며, 이후에는 캐시로 바로 검색됩니다.",
        )
        .addDropdown((drop) => {
          drop.addOption("current", "현재 선택 역본만");
          drop.addOption("all", `등록된 역본 전체 (${this.plugin.settings.versions.length}개)`);
          drop
            .setValue(this.plugin.settings.keywordSearchScope)
            .onChange(async (value) => {
              this.plugin.settings.keywordSearchScope = value as "current" | "all";
              await this.plugin.persist();
            });
        });
    }

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

    this.addFolderField(containerEl, {
      name: "주석 폴더 경로",
      desc: "주석 노트 패키지를 넣어둔 폴더를 선택하세요. 성경 폴더와 다른 위치여도 됩니다. 장 통합주석 노트가 있으면 모달에 주석 바로가기가 표시됩니다. 비우면 주석 기능을 끕니다.",
      getValue: () => this.plugin.settings.commentaryPath,
      setValue: (v) => {
        this.plugin.settings.commentaryPath = v;
        this.plugin.bibleData.invalidateCommentary();
      },
      validate: () => this.plugin.bibleData.validateCommentary(),
    });

    this.addFolderField(containerEl, {
      name: "설교 폴더 경로",
      desc: "검색한 구절을 인용한 설교를 이 폴더에서 찾아 모달에 보여줍니다. 비우면 성경·주석 폴더를 제외한 전체 볼트에서 찾습니다.",
      getValue: () => this.plugin.settings.sermonFolder,
      setValue: (v) => {
        this.plugin.settings.sermonFolder = v;
      },
      validate: () => this.plugin.bibleData.validateSermonFolder(),
    });

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
        for (const def of this.plugin.settings.versions) drop.addOption(def.name, def.name);
        drop
          .setValue(this.plugin.settings.parallelVersions[0])
          .onChange((value) => void this.setParallel(0, value));
      });

    new Setting(containerEl)
      .setName("병렬 역본 — 병렬 역본")
      .setDesc("각 절 아래 이탤릭으로 따라가는 역본입니다.")
      .addDropdown((drop) => {
        for (const def of this.plugin.settings.versions) drop.addOption(def.name, def.name);
        drop
          .setValue(this.plugin.settings.parallelVersions[1])
          .onChange((value) => void this.setParallel(1, value));
      });

    const parallelStatusEl = containerEl.createDiv({ cls: "bible-verse-settings-status" });
    this.renderStatusLine(parallelStatusEl, this.parallelStatus);
  }

  hide(): void {
    // 다음에 열 때 표본을 다시 읽고, 지난 안내는 지운다
    this.scan = null;
    this.versionStatus = null;
    this.parallelStatus = null;
    super.hide();
  }

  /** 구조가 바뀐 뒤 전체를 다시 그리되 스크롤 위치는 유지 (부분 갱신은 아래 드롭다운이 낡은 값을 보인다) */
  private rerender() {
    const top = this.containerEl.scrollTop;
    this.display();
    this.containerEl.scrollTop = top;
  }

  // ── 역본 섹션 ───────────────────────────────────────────

  private renderVersionSection(containerEl: HTMLElement) {
    const s = this.plugin.settings;
    new Setting(containerEl).setName("역본").setHeading();
    containerEl.createEl("p", {
      cls: "bible-verse-settings-help",
      text: "구절 노트의 본문 섹션(## 📜 본문) 아래에 `> [!quote] 역본 이름` 콜아웃으로 들어 있는 역본을 등록합니다. 이 순서가 모달 역본 버튼·Tab 전환·자동완성 순서가 됩니다. 등록만 바꾸는 것이라 구절 노트는 바뀌지 않습니다.",
    });
    containerEl.createDiv({
      cls: "bible-verse-version-caption",
      text: "오른쪽 칸 = 모달 버튼에 보일 짧은 이름 (비우면 이름 그대로)",
    });

    const count = s.versions.length;
    s.versions.forEach((def, index) => this.renderVersionRow(containerEl, def, index, count));

    this.detectedEl = containerEl.createDiv({ cls: "bible-verse-version-detected" });
    this.renderDetected();

    const actions = new Setting(containerEl).setClass("bible-verse-version-actions");
    actions.addButton((btn) =>
      btn
        .setButtonText("노트에서 찾기")
        .setTooltip("표본 노트 3곳(창1_1·시23_1·요3_16)에서 아직 등록하지 않은 역본 콜아웃을 찾습니다")
        .onClick(() => void this.rescan(true)),
    );
    actions.addButton((btn) =>
      btn
        .setButtonText("역본 추가")
        .setCta()
        .onClick(() => void this.openAddModal()),
    );
    actions.addButton((btn) => {
      btn.setButtonText("기본 5역본으로 되돌리기");
      if (isDefaultVersionList(s.versions)) {
        btn.buttonEl.addClass("is-blocked");
        btn.setTooltip("이미 기본 상태입니다");
      } else {
        btn.onClick(() => void this.resetVersions());
      }
    });

    this.versionStatusEl = containerEl.createDiv({ cls: "bible-verse-settings-status" });
    this.renderStatusLine(this.versionStatusEl, this.versionStatus);

    new Setting(containerEl)
      .setName("기본 역본")
      .setDesc("모달을 열 때 처음 선택되는 역본입니다.")
      .addDropdown((drop) => {
        for (const def of s.versions) drop.addOption(def.name, def.name);
        drop.setValue(s.defaultVersion).onChange(async (value) => {
          await this.plugin.updateVersionSettings({ defaultVersion: value });
          this.rerender(); // 행 배지(기본 역본) 갱신
        });
      });

    void this.ensureScan();
  }

  private renderVersionRow(
    containerEl: HTMLElement,
    def: VersionDef,
    index: number,
    count: number,
  ) {
    const setting = new Setting(containerEl)
      .setName(def.name)
      .setClass("bible-verse-version-row");
    this.badgeEls.set(def.name, setting.descEl);
    this.fillBadges(def.name, count);

    setting.addText((text) => {
      text.setPlaceholder("짧은 이름 (선택)").setValue(def.short ?? "");
      text.inputEl.maxLength = 6;
      text.inputEl.addClass("bible-verse-version-short");
      text.inputEl.title = "모달 역본 버튼에 보일 짧은 이름 (6자 이내, 비우면 이름 그대로)";
      // 키 입력마다 다시 그리면 포커스를 잃는다 — 입력을 마쳤을 때(blur·Enter)만 저장
      text.inputEl.addEventListener("change", () => void this.saveShort(index, text.inputEl));
    });
    setting.addExtraButton((btn) => {
      btn.setIcon("arrow-up").setTooltip("위로");
      if (index === 0) btn.extraSettingsEl.addClass("is-blocked");
      else btn.onClick(() => void this.moveVersion(index, -1));
    });
    setting.addExtraButton((btn) => {
      btn.setIcon("arrow-down").setTooltip("아래로");
      if (index === count - 1) btn.extraSettingsEl.addClass("is-blocked");
      else btn.onClick(() => void this.moveVersion(index, 1));
    });
    setting.addExtraButton((btn) => {
      btn.setIcon("trash-2");
      if (count === 1) {
        // setDisabled는 툴팁까지 막는다 — 흐리게만 두고 눌렀을 때 이유를 보여준다
        btn.setTooltip("역본은 최소 1개 있어야 합니다");
        btn.extraSettingsEl.addClass("is-blocked");
        btn.onClick(() =>
          this.setVersionStatus(
            "warn",
            "역본은 최소 1개 있어야 합니다. 다른 역본을 먼저 추가한 뒤 빼주세요.",
          ),
        );
      } else {
        btn.setTooltip("목록에서 빼기 (노트는 바뀌지 않음)");
        btn.onClick(() => void this.removeVersion(index));
      }
    });
  }

  /** 행 배지: 기본 역본·병렬 쌍·마지막 역본·표본 노트에 콜아웃 없음 */
  private fillBadges(name: string, count: number) {
    const el = this.badgeEls.get(name);
    if (!el) return;
    el.empty();
    const s = this.plugin.settings;
    const add = (text: string, warn = false) =>
      el.createSpan({ cls: `bible-verse-version-badge${warn ? " is-warn" : ""}`, text });
    if (name === s.defaultVersion) add("기본 역본");
    if (name === s.parallelVersions[0]) add("병렬 삽입 주 역본");
    if (name === s.parallelVersions[1] && s.parallelVersions[1] !== s.parallelVersions[0]) {
      add("병렬 삽입 병렬 역본");
    }
    if (count === 1) add("마지막 역본 — 뺄 수 없음");
    if (this.scan && this.scan.total > 0 && !this.scan.titles.some((t) => t.title === name)) {
      add("표본 노트에서 콜아웃을 찾지 못함", true);
    }
  }

  private refreshBadges() {
    const count = this.plugin.settings.versions.length;
    for (const name of this.badgeEls.keys()) this.fillBadges(name, count);
  }

  /** 표본에 있지만 아직 등록하지 않은 제목을 칩으로 — 클릭하면 바로 등록 */
  private renderDetected() {
    const el = this.detectedEl;
    if (!el) return;
    el.empty();
    if (!this.scan || this.scan.total === 0) return;
    const registered = versionNames(this.plugin.settings.versions);
    const fresh = this.scan.titles.filter((t) => !registered.includes(t.title));
    if (fresh.length === 0) return;
    el.createSpan({ cls: "bible-verse-context-label", text: "노트에서 찾은 새 역본:" });
    for (const { title } of fresh) {
      const chip = el.createEl("button", { cls: "bible-verse-chip", text: `+ ${title}` });
      chip.title = `'${title}' 역본을 바로 등록합니다`;
      chip.addEventListener("click", () => void this.addDetected(title));
    }
  }

  /** 탭이 열려 있는 동안 표본 노트를 한 번만 읽어 배지·칩을 채운다 (폴더 미설정이면 생략) */
  private async ensureScan() {
    if (this.scan || this.scanning) return;
    const { otPath, ntPath } = this.plugin.settings;
    if (!otPath && !ntPath) return;
    await this.rescan(false);
  }

  /** explicit=true는 "노트에서 찾기" 버튼 — 결과가 없을 때도 알린다 (자동 스캔은 조용히) */
  private async rescan(explicit: boolean) {
    if (this.scanning) return;
    this.scanning = true;
    let result: QuoteTitleScan;
    try {
      result = await this.plugin.bibleData.detectQuoteTitles();
    } catch (err) {
      console.warn("[a4p-bible-verse] 표본 노트 확인 실패", err);
      result = { titles: [], total: 0, reason: "표본 노트를 읽지 못했습니다." };
    }
    this.scanning = false;
    this.scan = result;
    if (!this.detectedEl?.isConnected) return; // 탭이 닫혔다
    this.renderDetected();
    this.refreshBadges();
    if (!explicit) return;

    const { otPath, ntPath } = this.plugin.settings;
    if (!otPath && !ntPath) {
      this.setVersionStatus("warn", "구약·신약 성경 폴더를 먼저 등록해주세요.");
    } else if (result.total === 0) {
      this.setVersionStatus(
        "warn",
        "표본 노트를 읽지 못했습니다. 위의 성경 폴더 '검증'을 먼저 해주세요.",
      );
    } else {
      const registered = versionNames(this.plugin.settings.versions);
      const fresh = result.titles.filter((t) => !registered.includes(t.title));
      this.setVersionStatus(
        "ok",
        fresh.length === 0
          ? `표본 노트 ${result.total}곳(창1_1·시23_1·요3_16)에 아직 등록하지 않은 역본 콜아웃이 없습니다.`
          : `노트에서 새 역본 ${fresh.length}개를 찾았습니다 — 위 칩을 누르면 바로 등록됩니다.`,
      );
    }
  }

  private async saveShort(index: number, inputEl: HTMLInputElement) {
    const s = this.plugin.settings;
    const def = s.versions[index];
    if (!def) return;
    const short = normalizeVersionName(inputEl.value);
    const effective = short && short !== def.name ? short : undefined;
    const clash = effective
      ? s.versions.find((d, i) => i !== index && shortLabel(d) === effective)
      : undefined;
    if (clash) {
      this.setVersionStatus(
        "warn",
        `짧은 이름 '${effective}'은(는) 이미 '${clash.name}'이(가) 쓰고 있어 버튼이 구분되지 않습니다.`,
      );
      inputEl.value = def.short ?? "";
      return;
    }
    const versions = s.versions.map((d, i) =>
      i === index ? (effective ? { name: d.name, short: effective } : { name: d.name }) : d,
    );
    await this.plugin.updateVersionSettings({ versions });
    inputEl.value = this.plugin.settings.versions[index]?.short ?? "";
    this.setVersionStatus(
      "ok",
      effective
        ? `'${def.name}' 역본의 모달 버튼 이름을 '${effective}'(으)로 바꿨습니다.`
        : `'${def.name}' 역본의 모달 버튼 이름을 이름 그대로로 되돌렸습니다.`,
    );
  }

  private async moveVersion(index: number, dir: -1 | 1) {
    const versions = [...this.plugin.settings.versions];
    const target = index + dir;
    if (target < 0 || target >= versions.length) return;
    [versions[index], versions[target]] = [versions[target], versions[index]];
    await this.plugin.updateVersionSettings({ versions });
    this.rerender();
  }

  private async removeVersion(index: number) {
    const s = this.plugin.settings;
    const removed = s.versions[index];
    if (!removed || s.versions.length <= 1) return;
    const fixes = await this.plugin.updateVersionSettings({
      versions: s.versions.filter((_, i) => i !== index),
    });
    this.versionStatus = {
      kind: "ok",
      text: `'${removed.name}' 역본을 목록에서 뺐습니다. 노트는 그대로이며 '노트에서 찾기'로 다시 추가할 수 있습니다.${this.describeFixes(fixes, removed.name)}`,
    };
    this.rerender();
  }

  /** sanitize가 기본 역본·병렬 쌍을 고쳤으면 어디서 다시 고를 수 있는지까지 알려준다 */
  private describeFixes(fixes: VersionFixes, removedName?: string): string {
    const parts: string[] = [];
    if (fixes.defaultVersion) {
      parts.push(
        removedName
          ? ` 기본 역본이 '${removedName}'이었으므로 '${fixes.defaultVersion}'(으)로 바꿨습니다 — 아래 '기본 역본'에서 다시 고를 수 있습니다.`
          : ` 기본 역본을 '${fixes.defaultVersion}'(으)로 맞췄습니다.`,
      );
    }
    if (fixes.parallelVersions) {
      parts.push(
        ` 병렬 삽입 역본 쌍을 '${fixes.parallelVersions[0]} · ${fixes.parallelVersions[1]}'(으)로 맞췄습니다 — 맨 아래 '병렬 삽입'에서 다시 고를 수 있습니다.`,
      );
    }
    return parts.join("");
  }

  private async addDetected(title: string) {
    await this.plugin.updateVersionSettings({
      versions: [...this.plugin.settings.versions, { name: title }],
    });
    this.versionStatus = {
      kind: "ok",
      text: `'${title}' 역본을 추가했습니다. 모달 버튼에는 '${title}'(으)로 표시됩니다 — 오른쪽 칸에서 짧은 이름을 정할 수 있습니다.`,
    };
    this.rerender();
  }

  private async openAddModal() {
    const result = await AddVersionModal.ask(this.app, this.plugin);
    if (!result) return;
    const label = result.short ?? result.name;
    this.versionStatus = result.foundInSamples
      ? {
          kind: "ok",
          text: `'${result.name}' 역본을 추가했습니다. 모달 버튼에는 '${label}'(으)로 표시됩니다.`,
        }
      : {
          kind: "warn",
          text: `'${result.name}' 역본을 추가했습니다. 표본 노트에는 아직 '${result.name}' 콜아웃이 없어 모달에 '(${result.name} 본문 없음)'으로 나옵니다. 노트에 콜아웃을 넣은 뒤 '노트에서 찾기'로 확인하세요.`,
        };
    this.rerender();
  }

  private async resetVersions() {
    const custom = this.plugin.settings.versions
      .filter((d) => !DEFAULT_VERSIONS.some((x) => x.name === d.name))
      .map((d) => d.name);
    const ok = await confirmModal(this.app, {
      title: "기본 5역본으로 되돌릴까요?",
      body: [
        `${custom.length > 0 ? `직접 추가한 역본(${custom.join(", ")})과 ` : ""}바꾼 순서·짧은 이름이 지워지고, 새번역·개역개정·쉬운성경·NIV·KJV 순서로 돌아갑니다.`,
        "구절 노트는 바뀌지 않습니다.",
      ],
      okText: "되돌리기",
      warning: true,
    });
    if (!ok) return;
    const fixes = await this.plugin.updateVersionSettings({ versions: cloneDefaultVersions() });
    this.versionStatus = {
      kind: "ok",
      text: `기본 5역본(새번역·개역개정·쉬운성경·NIV·KJV)으로 되돌렸습니다.${this.describeFixes(fixes)}`,
    };
    this.rerender();
  }

  private async setParallel(slot: 0 | 1, value: string) {
    const pair = [...this.plugin.settings.parallelVersions] as [string, string];
    pair[slot] = value;
    const fixes = await this.plugin.updateVersionSettings({ parallelVersions: pair });
    // 같은 역본을 둘 다 고르면 sanitize가 병렬 역본 쪽을 다른 역본으로 바꾼다
    this.parallelStatus = fixes.parallelVersions
      ? {
          kind: "warn",
          text: `주 역본과 병렬 역본은 서로 달라야 합니다 — 병렬 역본을 '${this.plugin.settings.parallelVersions[1]}'(으)로 바꿨습니다.`,
        }
      : null;
    this.rerender(); // 행 배지(병렬 역본)와 보정된 드롭다운 값 반영
  }

  private setVersionStatus(kind: StatusKind, text: string) {
    this.versionStatus = { kind, text };
    if (this.versionStatusEl) this.renderStatusLine(this.versionStatusEl, this.versionStatus);
  }

  private renderStatusLine(el: HTMLElement, line: StatusLine | null) {
    el.empty();
    if (!line) return;
    el.createEl("p", {
      text: line.text,
      cls: `bible-verse-settings-status-line${line.kind === "warn" ? " is-warn" : ""}`,
    });
  }

  // ── 폴더 경로 필드 ───────────────────────────────────────

  /** 폴더 경로 설정 공통 필드 — 자동완성 + 정규화 + (선택) 검증 버튼. */
  private addFolderField(
    containerEl: HTMLElement,
    opts: {
      name: string;
      desc: string;
      getValue: () => string;
      setValue: (v: string) => void;
      validate?: () => Promise<{ ok: boolean; messages: string[] }>;
    },
  ): void {
    let statusEl: HTMLElement | null = null;
    const setting = new Setting(containerEl)
      .setName(opts.name)
      .setDesc(opts.desc)
      .addText((text) => {
        let saved = opts.getValue();
        text
          .setPlaceholder("클릭하면 폴더 목록이 나타납니다")
          .setValue(saved)
          .onChange(async (value) => {
            const trimmed = value.trim();
            // FolderSuggest가 선택 시 끝 슬래시를 붙이므로 저장값은 반드시 정규화
            const next = trimmed ? normalizeFolderPath(normalizePath(trimmed)) : "";
            // FolderSuggest의 focus 트릭이 input 이벤트를 흘리므로,
            // 값이 실제로 바뀐 경우에만 저장·invalidate (인덱스 불필요 폐기 방지)
            if (next === saved) return;
            saved = next;
            opts.setValue(next);
            await this.plugin.persist();
          });
        new FolderSuggest(this.app, text.inputEl);
      });
    if (opts.validate) {
      setting.addButton((btn) =>
        btn
          .setButtonText("검증")
          .setCta()
          .onClick(async () => {
            btn.setDisabled(true);
            const result = await opts.validate!();
            btn.setDisabled(false);
            if (statusEl) this.renderValidation(statusEl, result);
          }),
      );
    }
    statusEl = containerEl.createDiv({ cls: "bible-verse-settings-status" });
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
