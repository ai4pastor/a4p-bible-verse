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
  /** onLayoutReady 콜백이 플러그인 unload 이후 실행되는 경우를 막는 플래그 */
  private unloaded = false;

  async onload() {
    await this.loadState();
    this.bibleData = new BibleData(this.app, () => ({
      otPath: this.settings.otPath,
      ntPath: this.settings.ntPath,
      commentaryPath: this.settings.commentaryPath,
      sermonFolder: this.settings.sermonFolder,
    }));
    this.verseIndex = new VerseIndex(
      this.app,
      this.bibleData,
      () => [this.settings.otPath, this.settings.ntPath],
      `${this.manifest.dir ?? ".obsidian/plugins/a4p-bible-verse"}/verse-index.json`,
    );
    this.addSettingTab(new BibleVerseSettingTab(this.app, this));

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

    // 부팅 비용 0 원칙 — onload는 등록만 한다.
    // vault 리스너는 볼트 트리가 완성된 뒤에만 등록한다. 그 전에 등록하면 옵시디언이 볼트
    // 최초 로드 때 기존 파일마다 create를 발생시켜(API 문서 명시) 부팅마다 파일 수만큼
    // (구절 노트 3만 개) 콜백이 돈다. 마이그레이션도 같은 시점(폴더 존재 판정에 트리 필요).
    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) return; // 레이아웃 준비 전에 플러그인이 꺼졌으면 리스너를 남기지 않는다
      this.registerVaultListeners();
      void this.migrateIfNeeded();
    });
  }

  onunload() {
    this.unloaded = true;
  }

  /**
   * 구절 노트 변경 시 인덱스 증분 갱신(빌드 전에는 no-op) + 책 단위 캐시 무효화,
   * 주석 폴더 내 파일 변동 시 주석 인덱스 무효화. onLayoutReady 이후에만 호출된다.
   */
  private registerVaultListeners() {
    this.registerEvent(
      this.app.vault.on("modify", (f) => this.verseIndex.handleFileEvent(f, "modify")),
    );
    this.registerEvent(
      this.app.vault.on("create", (f) => {
        this.verseIndex.handleFileEvent(f, "create");
        this.bibleData.handleVaultChange(f.path);
        this.touchCommentary(f.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (f) => {
        this.verseIndex.handleFileEvent(f, "delete");
        this.bibleData.handleVaultChange(f.path);
        this.touchCommentary(f.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (f, oldPath) => {
        this.verseIndex.handleFileEvent(f, "rename", oldPath);
        this.bibleData.handleVaultChange(f.path);
        this.bibleData.handleVaultChange(oldPath);
        this.touchCommentary(f.path);
        this.touchCommentary(oldPath);
      }),
    );
  }

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
