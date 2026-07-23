import { AbstractInputSuggest, App, TFolder } from "obsidian";

/**
 * 설정 텍스트 입력란에 붙이는 폴더 자동완성.
 * 원본: a4p-sermon-desk/src/folder-suggest.ts (a4p 공통 패턴).
 */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(
    app: App,
    private inputEl: HTMLInputElement,
    private onSelectFolder?: (folder: TFolder) => void,
  ) {
    super(app, inputEl);
    // AbstractInputSuggest는 타이핑(input 이벤트) 시에만 목록을 띄운다.
    // 빈 칸을 클릭(focus)만 해도 전체 폴더 목록이 보이도록 input 이벤트를 한 번 흘려준다.
    inputEl.addEventListener("focus", () => {
      inputEl.dispatchEvent(new Event("input"));
    });
  }

  getSuggestions(query: string): TFolder[] {
    const folders: TFolder[] = [];
    const lowerQuery = query.toLowerCase();

    const traverse = (folder: TFolder) => {
      for (const child of folder.children) {
        if (child instanceof TFolder) {
          folders.push(child);
          traverse(child);
        }
      }
    };

    traverse(this.app.vault.getRoot());

    const filtered = lowerQuery
      ? folders.filter((f) => f.path.toLowerCase().includes(lowerQuery))
      : folders;

    filtered.sort((a, b) => a.path.localeCompare(b.path));
    return filtered.slice(0, 100);
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path + "/");
  }

  selectSuggestion(folder: TFolder): void {
    const value = folder.path + "/";
    this.inputEl.value = value;
    this.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    this.close();
    this.onSelectFolder?.(folder);
  }
}
