import { Plugin, TFile } from "obsidian";

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

          // Wait for other plugins (e.g., Templater) to finish modifying the file.
          // Watches for modify events and waits until content has been stable
          // (no modifications) for 500ms, up to a max of 5s.
          await this.waitForFileStable(file);

          const linkInfo = await this.findMatchingLinks(newFileName, file);

          if (!linkInfo.hasLinks) {
            console.log(`Alias on Create: no matching links found for "${newFileName}", skipping`);
            return;
          }

          console.log(`Alias on Create: found links for "${newFileName}" with aliases:`, linkInfo.aliases);

          await this.patchBareLinks(newFileName, file);

          for (const alias of linkInfo.aliases) {
            await this.addAliasViaProcessFrontMatter(file, alias);
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
   * Wait for a newly created file's content to stabilize.
   *
   * After file creation, other plugins (e.g., Templater) may modify the file.
   * This method listens for modify events and waits until no modifications
   * have occurred for `stabilizeMs` milliseconds, or until `maxWaitMs` is reached.
   */
  private waitForFileStable(file: TFile, stabilizeMs = 500, maxWaitMs = 5000): Promise<void> {
    return new Promise((resolve) => {
      let stabilizeTimer: ReturnType<typeof setTimeout>;
      let resolved = false;

      const done = () => {
        if (resolved) return;
        resolved = true;
        this.app.vault.offref(modifyRef);
        clearTimeout(stabilizeTimer);
        clearTimeout(maxTimer);
        resolve();
      };

      const modifyRef = this.app.vault.on("modify", (modifiedFile) => {
        if (!(modifiedFile instanceof TFile)) return;
        if (modifiedFile.path !== file.path) return;
        console.log(`Alias on Create: "${file.basename}" was modified by another plugin, resetting stabilization timer`);
        clearTimeout(stabilizeTimer);
        stabilizeTimer = setTimeout(done, stabilizeMs);
      });

      // If nothing modifies the file within stabilizeMs, proceed
      stabilizeTimer = setTimeout(done, stabilizeMs);

      // Hard ceiling: never wait longer than maxWaitMs total
      const maxTimer = setTimeout(() => {
        console.log(`Alias on Create: max wait reached for "${file.basename}", proceeding`);
        done();
      }, maxWaitMs);
    });
  }

  /**
   * Add a single alias to the file's frontmatter using Obsidian's
   * processFrontMatter API for atomic read-modify-write.
   */
  private async addAliasViaProcessFrontMatter(file: TFile, aliasText: string): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (!frontmatter.aliases) {
        frontmatter.aliases = [];
      }
      if (typeof frontmatter.aliases === "string") {
        frontmatter.aliases = [frontmatter.aliases];
      }
      if (!frontmatter.aliases.includes(aliasText)) {
        frontmatter.aliases.push(aliasText);
      }
    });
  }
}
