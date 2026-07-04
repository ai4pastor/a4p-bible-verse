import { Editor, Plugin } from "obsidian";
import { BibleData } from "./bible-data";
import { VerseInsertModal } from "./modal";
import { BibleVerseSuggest } from "./suggest";
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

  async onload() {
    await this.loadState();
    this.bibleData = new BibleData(this.app, () => this.settings.biblePath);
    this.addSettingTab(new BibleVerseSettingTab(this.app, this));

    this.addCommand({
      id: "insert-bible-verse",
      name: "성경 구절 검색·삽입",
      editorCallback: (editor: Editor) => {
        new VerseInsertModal(this.app, this, editor).open();
      },
    });

    this.registerEditorSuggest(new BibleVerseSuggest(this));
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
