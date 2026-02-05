import { Plugin, TFile, Notice } from "obsidian";

/**
 * Alias on Create
 *
 * Intercepts the creation of new files from unresolved wikilinks.
 * When a new file is created by clicking [[something]], the plugin:
 *   1. Rewrites [[something]] → [[something|something]] in the source file
 *   2. Adds aliases to the new file's frontmatter, preserving any existing
 *      pipe aliases (e.g. [[something|my alias]] → adds "my alias")
 *
 * This lets you freely rename the new note while original links keep
 * displaying their intended text.
 */
export default class AliasOnCreatePlugin extends Plugin {
  private knownFiles: Set<string> = new Set();
  private ready: boolean = false;

  async onload() {
    console.log("Alias on Create: loaded");

    this.app.workspace.onLayoutReady(() => {
      for (const file of this.app.vault.getFiles()) {
        this.knownFiles.add(file.path);
      }
      console.log(`Alias on Create: ready, tracking ${this.knownFiles.size} existing files`);
      this.ready = true;

      this.registerEvent(
        this.app.vault.on("create", async (file) => {
          if (!this.ready) return;
          if (!(file instanceof TFile)) return;
          if (file.extension !== "md") return;

          if (this.knownFiles.has(file.path)) return;
          this.knownFiles.add(file.path);

          const newFileName = file.basename;

          await sleep(300);

          const linkInfo = await this.findMatchingLinks(newFileName, file);

          if (!linkInfo.hasLinks) {
            console.log(`Alias on Create: no matching links found for "${newFileName}", skipping`);
            return;
          }

          console.log(`Alias on Create: found links for "${newFileName}" with aliases:`, linkInfo.aliases);

          await this.patchBareLinks(newFileName, file);

          for (const alias of linkInfo.aliases) {
            await this.addAliasFrontmatter(file, alias);
          }
        })
      );
    });

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          this.knownFiles.delete(file.path);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.knownFiles.delete(oldPath);
        if (file instanceof TFile) {
          this.knownFiles.add(file.path);
        }
      })
    );
  }

  onunload() {
    console.log("Alias on Create: unloaded");
  }

  /**
   * Scan the vault for all wikilinks pointing to linkText.
   * Collects the display text for each link:
   *   [[Cloud computing]]                → alias "Cloud computing"
   *   [[Cloud computing|cloud stuff]]     → alias "cloud stuff"
   *   [[Cloud computing#heading]]         → alias "Cloud computing"
   *   [[Cloud computing#heading|my text]] → alias "my text"
   *
   * Returns { hasLinks: boolean, aliases: string[] } with deduplicated aliases.
   */
  private async findMatchingLinks(linkText: string, newFile: TFile): Promise<{ hasLinks: boolean; aliases: string[] }> {
    const mdFiles = this.app.vault.getMarkdownFiles();
    const aliasSet = new Set<string>();
    let hasLinks = false;

    const escaped = linkText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      "\\[\\[" + escaped + "(#[^\\]|]*)?(\\|([^\\]]+))?\\]\\]",
      "g"
    );

    for (const mdFile of mdFiles) {
      if (mdFile.path === newFile.path) continue;

      const content = await this.app.vault.read(mdFile);
      if (!content.includes(`[[${linkText}`)) continue;

      let match;
      while ((match = pattern.exec(content)) !== null) {
        hasLinks = true;
        const alias = match[3] ? match[3] : linkText;
        aliasSet.add(alias);
      }
    }

    return { hasLinks, aliases: Array.from(aliasSet) };
  }

  /**
   * Rewrite bare [[linkText]] links to [[linkText|linkText]].
   * Links that already have a pipe alias are left untouched.
   */
  private async patchBareLinks(linkText: string, newFile: TFile): Promise<void> {
    const mdFiles = this.app.vault.getMarkdownFiles();
    let patchedCount = 0;

    for (const mdFile of mdFiles) {
      if (mdFile.path === newFile.path) continue;

      const content = await this.app.vault.read(mdFile);
      if (!content.includes(`[[${linkText}`)) continue;

      const newContent = content.replace(
        /\[\[([^\]|]*?)(\|[^\]]*)?\]\]/g,
        (match: string, target: string, alias: string) => {
          if (alias) return match;

          const filenamePart = target.split("#")[0];
          if (filenamePart === linkText) {
            return `[[${target}|${linkText}]]`;
          }

          return match;
        }
      );

      if (newContent !== content) {
        await this.app.vault.modify(mdFile, newContent);
        patchedCount++;
      }
    }

    if (patchedCount > 0) {
      console.log(`Alias on Create: patched ${patchedCount} file(s) with alias for "${linkText}"`);
    }
  }

  /**
   * Add a single alias to the file's frontmatter, if not already present.
   */
  private async addAliasFrontmatter(file: TFile, aliasText: string): Promise<void> {
    let content = await this.app.vault.read(file);

    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

    if (fmMatch) {
      const fmBody = fmMatch[1];

      if (/^aliases\s*:/m.test(fmBody)) {
        const inlineMatch = fmBody.match(/^(aliases\s*:\s*)\[([^\]]*)\]/m);
        if (inlineMatch) {
          const existing = inlineMatch[2]
            .split(",")
            .map((s: string) => s.trim().replace(/^['"]|['"]$/g, ""))
            .filter(Boolean);
          if (!existing.includes(aliasText)) {
            existing.push(aliasText);
            const newAliases = `aliases: [${existing.join(", ")}]`;
            const newFmBody = fmBody.replace(/^aliases\s*:\s*\[[^\]]*\]/m, newAliases);
            content = content.replace(fmMatch[1], newFmBody);
          }
        } else {
          const blockLines = fmBody.split("\n");
          const aliasIdx = blockLines.findIndex((l: string) => /^aliases\s*:/.test(l));
          const existingAliases: string[] = [];
          for (let i = aliasIdx + 1; i < blockLines.length; i++) {
            const m = blockLines[i].match(/^\s*-\s+(.*)/);
            if (m) {
              existingAliases.push(m[1].replace(/^['"]|['"]$/g, ""));
            } else {
              break;
            }
          }
          if (!existingAliases.includes(aliasText)) {
            const insertIdx = aliasIdx + 1 + existingAliases.length;
            blockLines.splice(insertIdx, 0, `  - ${aliasText}`);
            const newFmBody = blockLines.join("\n");
            content = content.replace(fmMatch[1], newFmBody);
          }
        }
      } else {
        const newFmBody = fmBody + `\naliases:\n  - ${aliasText}`;
        content = content.replace(fmMatch[1], newFmBody);
      }
    } else {
      content = `---\naliases:\n  - ${aliasText}\n---\n${content}`;
    }

    await this.app.vault.modify(file, content);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
