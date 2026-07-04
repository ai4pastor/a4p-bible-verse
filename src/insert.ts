import { App, Editor, MarkdownView, Notice } from "obsidian";

/**
 * 커서 위치에 블록을 삽입하고 커서를 블록 끝으로 옮긴다.
 * editor가 없으면(리본 등) 활성 마크다운 뷰로 폴백.
 * a4p-readwise-search citation.ts의 insertBlock 패턴 이식.
 */
export function insertBlock(app: App, block: string, editor?: Editor): boolean {
  const ed = editor ?? app.workspace.getActiveViewOfType(MarkdownView)?.editor;
  if (!ed) {
    new Notice("구절을 삽입할 노트를 먼저 열어주세요.");
    return false;
  }
  const cursor = ed.getCursor();
  const needsLeadingNewline = cursor.ch > 0;
  const inserted = needsLeadingNewline ? `\n${block}` : block;
  ed.replaceRange(inserted, cursor);
  const endOffset = ed.posToOffset(cursor) + inserted.length;
  ed.setCursor(ed.offsetToPos(endOffset));
  return true;
}
