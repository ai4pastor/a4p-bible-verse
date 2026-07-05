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
  /** 병렬 삽입 시 두 번째 역본 */
  secondary?: Version;
  label: string;
}

/** 트리거 뒤 참조 문자열의 최대 길이 — 이보다 길면 자동완성 의도가 아니라고 본다 */
const MAX_QUERY_LEN = 30;

/**
 * 에디터 자동완성.
 * - 일반 트리거(";;요3:16"): 역본 5개 제안 → 선택 역본으로 삽입
 * - 병렬 트리거(";;;요3:16"): 설정에 등록된 역본 쌍이 절마다 교차로 함께 삽입
 * 두 트리거가 겹치면(";;;"는 ";;"를 포함) 더 뒤에서 끝나는·더 긴 쪽이 이긴다.
 */
export class BibleVerseSuggest extends EditorSuggest<VerseSuggestion> {
  private plugin: BibleVersePlugin;
  private ref: BibleReference | null = null;
  private parallel = false;

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
    const line = editor.getLine(cursor.line).slice(0, cursor.ch);

    const { suggestTrigger, parallelTrigger } = this.plugin.settings;
    const candidates: Array<{ trigger: string; parallel: boolean }> = [];
    if (parallelTrigger) candidates.push({ trigger: parallelTrigger, parallel: true });
    if (suggestTrigger) candidates.push({ trigger: suggestTrigger, parallel: false });

    let best: { idx: number; trigger: string; parallel: boolean } | null = null;
    for (const c of candidates) {
      const idx = line.lastIndexOf(c.trigger);
      if (idx === -1) continue;
      const end = idx + c.trigger.length;
      const bestEnd = best ? best.idx + best.trigger.length : -1;
      if (
        !best ||
        end > bestEnd ||
        (end === bestEnd && c.trigger.length > best.trigger.length)
      ) {
        best = { idx, trigger: c.trigger, parallel: c.parallel };
      }
    }
    if (!best) return null;

    const query = line.slice(best.idx + best.trigger.length);
    if (!query.trim() || query.length > MAX_QUERY_LEN) return null;

    const parsed = parseReference(query);
    if (!parsed.ok) return null;

    this.ref = parsed.ref;
    this.parallel = best.parallel;
    return {
      start: { line: cursor.line, ch: best.idx },
      end: cursor,
      query,
    };
  }

  getSuggestions(_context: EditorSuggestContext): VerseSuggestion[] {
    if (!this.ref) return [];
    const label = formatReference(this.ref);

    if (this.parallel) {
      const [primary, secondary] = this.plugin.settings.parallelVersions;
      return [{ version: primary, secondary, label: `${label} (${primary} · ${secondary})` }];
    }

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

    const outcome = await this.plugin.bibleData.loadVerses(
      ref,
      this.plugin.settings.stripAnnotations,
    );
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
      secondaryVersion: suggestion.secondary,
      wholeChapter: ref.verseStart === undefined,
      format: this.plugin.settings.insertFormat,
      verseNewline: this.plugin.settings.verseNewline,
    });
    ctx.editor.replaceRange(block, ctx.start, ctx.end);
  }
}
