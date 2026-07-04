import {
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  Notice,
  TFile,
} from "obsidian";
import { formatVerses } from "./formatter";
import type BibleVersePlugin from "./main";
import { formatReference, parseReference } from "./reference-parser";
import { BibleReference, VERSIONS, Version } from "./types";

interface VerseSuggestion {
  version: Version;
  label: string;
}

/** 트리거 뒤 참조 문자열의 최대 길이 — 이보다 길면 자동완성 의도가 아니라고 본다 */
const MAX_QUERY_LEN = 30;

/**
 * 에디터에서 ";;요3:16" 타이핑 → 역본 5개 제안 → 선택 시 콜아웃으로 치환.
 * 범위 세밀 선택이 필요하면 모달을 쓴다.
 */
export class BibleVerseSuggest extends EditorSuggest<VerseSuggestion> {
  private plugin: BibleVersePlugin;
  private ref: BibleReference | null = null;

  constructor(plugin: BibleVersePlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    _file: TFile | null,
  ): EditorSuggestTriggerInfo | null {
    if (!this.plugin.settings.enableSuggest) return null;
    const trigger = this.plugin.settings.suggestTrigger;
    if (!trigger) return null;

    const line = editor.getLine(cursor.line).slice(0, cursor.ch);
    const idx = line.lastIndexOf(trigger);
    if (idx === -1) return null;

    const query = line.slice(idx + trigger.length);
    if (!query.trim() || query.length > MAX_QUERY_LEN) return null;

    const parsed = parseReference(query);
    if (!parsed.ok) return null;

    this.ref = parsed.ref;
    return {
      start: { line: cursor.line, ch: idx },
      end: cursor,
      query,
    };
  }

  getSuggestions(_context: EditorSuggestContext): VerseSuggestion[] {
    if (!this.ref) return [];
    const label = formatReference(this.ref);
    const def = this.plugin.settings.defaultVersion;
    const ordered = [def, ...VERSIONS.filter((v) => v !== def)];
    return ordered.map((version) => ({ version, label: `${label} (${version})` }));
  }

  renderSuggestion(suggestion: VerseSuggestion, el: HTMLElement): void {
    el.setText(suggestion.label);
  }

  async selectSuggestion(suggestion: VerseSuggestion): Promise<void> {
    const ctx = this.context;
    const ref = this.ref;
    if (!ctx || !ref) return;

    const outcome = await this.plugin.bibleData.loadVerses(ref);
    if (!outcome.ok) {
      new Notice(outcome.reason);
      return;
    }
    const verses = outcome.result.verses.filter((v) => v.texts[suggestion.version]);
    if (verses.length === 0) {
      new Notice(`${suggestion.version} 본문이 없습니다.`);
      return;
    }
    if (outcome.result.notice) new Notice(outcome.result.notice);

    const block = formatVerses(verses, {
      bookName: ref.bookName,
      chapter: ref.chapter,
      version: suggestion.version,
      wholeChapter: ref.verseStart === undefined,
      merge: this.plugin.settings.mergeRange,
    });
    ctx.editor.replaceRange(block, ctx.start, ctx.end);
  }
}
