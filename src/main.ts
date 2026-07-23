import { Plugin, TFolder } from "obsidian";
import { BibleData } from "./bible-data";
import { isUnderFolder, normalizeFolderPath } from "./paths";
import { SETTINGS_VERSION, migrateSettings } from "./settings-migrate";
import { VerseInsertModal } from "./modal";
import { BibleVerseSuggest } from "./suggest";
import { VerseIndex } from "./verse-index";
import {
  BibleVerseSettings,
  BibleVerseSettingTab,
  DEFAULT_SETTINGS,
} from "./settings";

interface PersistedState {
  /** 설정 스키마 버전 — v0.7 이하 파일에는 없음(= v1) */
  settingsVersion?: number;
  settings: BibleVerseSettings;
}

export default class BibleVersePlugin extends Plugin {
  settings!: BibleVerseSettings;
  bibleData!: BibleData;
  verseIndex!: VerseIndex;
  private loadedSettingsVersion = SETTINGS_VERSION;

  async onload() {
    await this.loadState();
    this.bibleData = new BibleData(this.app, () => ({
      biblePath: this.settings.biblePath,
      commentaryPath: this.settings.commentaryPath,
      sermonFolder: this.settings.sermonFolder,
    }));
    this.verseIndex = new VerseIndex(
      this.app,
      this.bibleData,
      () => this.settings.biblePath,
      `${this.manifest.dir ?? ".obsidian/plugins/a4p-bible-verse"}/verse-index.json`,
    );
    this.addSettingTab(new BibleVerseSettingTab(this.app, this));

    // 구절 노트 변경 시 인덱스 증분 갱신 (빌드 전에는 no-op)
    // 주석 폴더 내 파일 변동 시 주석 인덱스도 무효화
    this.registerEvent(
      this.app.vault.on("modify", (f) => this.verseIndex.handleFileEvent(f, "modify")),
    );
    this.registerEvent(
      this.app.vault.on("create", (f) => {
        this.verseIndex.handleFileEvent(f, "create");
        this.touchCommentary(f.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (f) => {
        this.verseIndex.handleFileEvent(f, "delete");
        this.touchCommentary(f.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (f, oldPath) => {
        this.verseIndex.handleFileEvent(f, "rename", oldPath);
        this.touchCommentary(f.path);
        this.touchCommentary(oldPath);
      }),
    );

    this.addCommand({
      id: "insert-bible-verse",
      name: "성경 구절 검색·삽입",
      // editorCallback을 쓰면 편집기가 없을 때 팔레트에서 커맨드가 사라진다 —
      // 항상 노출하고, 편집기가 없으면 복사 전용 모드로 연다
      callback: () => {
        const editor = this.app.workspace.activeEditor?.editor ?? null;
        new VerseInsertModal(this.app, this, editor).open();
      },
    });

    this.registerEditorSuggest(new BibleVerseSuggest(this));

    this.registerHoverLinkSource("a4p-bible-verse", {
      display: "A4P 성경구절",
      defaultMod: true,
    });

    // 마이그레이션은 vault 트리가 완성된 뒤에만 (폴더 존재 판정이 필요)
    this.app.workspace.onLayoutReady(() => void this.migrateIfNeeded());
  }

  onunload() {}

  /** 주석 폴더 하위 파일 변동이면 주석 인덱스 무효화 */
  private touchCommentary(path: string) {
    const root = normalizeFolderPath(this.settings.commentaryPath);
    if (root && isUnderFolder(path, root)) this.bibleData.invalidateCommentary();
  }

  async loadState() {
    const raw = ((await this.loadData()) ?? {}) as Partial<PersistedState>;
    this.settings = { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) };
    // 저장된 설정이 없으면(신규 설치) 마이그레이션 불필요 — 최신 버전으로 간주
    this.loadedSettingsVersion = raw.settings ? (raw.settingsVersion ?? 1) : SETTINGS_VERSION;
  }

  private async migrateIfNeeded() {
    if (this.loadedSettingsVersion >= SETTINGS_VERSION) return;
    const { settings, changed } = migrateSettings(this.settings, this.loadedSettingsVersion, {
      folderExists: (p) =>
        this.app.vault.getAbstractFileByPath(normalizeFolderPath(p)) instanceof TFolder,
    });
    this.settings = settings;
    this.loadedSettingsVersion = SETTINGS_VERSION;
    if (changed) {
      this.bibleData.invalidate();
      this.verseIndex.invalidate();
    }
    await this.persist();
  }

  async persist() {
    const payload: PersistedState = {
      settingsVersion: SETTINGS_VERSION,
      settings: this.settings,
    };
    await this.saveData(payload);
  }
}
