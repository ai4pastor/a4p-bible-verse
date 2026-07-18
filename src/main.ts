import { Editor, Plugin } from "obsidian";
import { BibleData } from "./bible-data";
import { VerseInsertModal } from "./modal";
import { BibleVerseSuggest } from "./suggest";
import { VerseIndex } from "./verse-index";
import {
  BibleVerseSettings,
  BibleVerseSettingTab,
  DEFAULT_SETTINGS,
} from "./settings";

interface PersistedState {
  settings: BibleVerseSettings;
}

export default class BibleVersePlugin extends Plugin {
  settings!: BibleVerseSettings;
  bibleData!: BibleData;
  verseIndex!: VerseIndex;

  async onload() {
    await this.loadState();
    this.bibleData = new BibleData(this.app, () => this.settings.biblePath);
    this.verseIndex = new VerseIndex(
      this.app,
      this.bibleData,
      () => this.settings.biblePath,
      `${this.manifest.dir ?? ".obsidian/plugins/a4p-bible-verse"}/verse-index.json`,
    );
    this.addSettingTab(new BibleVerseSettingTab(this.app, this));

    // 구절 노트 변경 시 인덱스 증분 갱신 (빌드 전에는 no-op)
    this.registerEvent(
      this.app.vault.on("modify", (f) => this.verseIndex.handleFileEvent(f, "modify")),
    );
    this.registerEvent(
      this.app.vault.on("create", (f) => this.verseIndex.handleFileEvent(f, "create")),
    );
    this.registerEvent(
      this.app.vault.on("delete", (f) => this.verseIndex.handleFileEvent(f, "delete")),
    );
    this.registerEvent(
      this.app.vault.on("rename", (f, oldPath) =>
        this.verseIndex.handleFileEvent(f, "rename", oldPath),
      ),
    );

    this.addCommand({
      id: "insert-bible-verse",
      name: "성경 구절 검색·삽입",
      editorCallback: (editor: Editor) => {
        new VerseInsertModal(this.app, this, editor).open();
      },
    });

    this.registerEditorSuggest(new BibleVerseSuggest(this));

    this.registerHoverLinkSource("a4p-bible-verse", {
      display: "A4P 성경구절",
      defaultMod: true,
    });
  }

  onunload() {}

  async loadState() {
    const raw = ((await this.loadData()) ?? {}) as Partial<PersistedState>;
    this.settings = { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) };
  }

  async persist() {
    const payload: PersistedState = { settings: this.settings };
    await this.saveData(payload);
  }
}
