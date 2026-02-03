import { Plugin, TFile, MarkdownView, Notice } from "obsidian";

/**
 * Alias on Create
 *
 * Intercepts the creation of new files from unresolved wikilinks.
 * When a new file is created by clicking [[something]], the plugin:
 *   1. Rewrites [[something]] → [[something|something]] in the source file
 *   2. Adds `aliases: [something]` to the new file's frontmatter
 *
 * This lets you freely rename the new note (e.g. "something" → "Something (concept)")
 * while the original link continues to display the original text.
 */
export default class AliasOnCreatePlugin extends Plugin {
  // Track which files existed before, so we can detect genuinely new files
  private knownFiles: Set<string> = new Set();

  async onload() {
    console.log("Alias on Create: loaded");

    // Snapshot every file path that already exists
    this.app.workspace.onLayoutReady(() => {
      for (const file of this.app.vault.getFiles()) {
        this.knownFiles.add(file.path);
      }
    });

    // Listen for file creation events
    this.registerEvent(
      this.app.vault.on("create", async (file) => {
        if (!(file instanceof TFile)) return;
        if (file.extension !== "md") return;

        // If we already knew about this file, skip (e.g. sync, template, etc.)
        if (this.knownFiles.has(file.path)) return;

        // Add to known set immediately so we don't process it twice
        this.knownFiles.add(file.path);

        // The basename (without extension) is the link target text
        const newFileName = file.basename;

        // Small delay to let Obsidian finish its own file-creation housekeeping
        await sleep(200);

        // 1. Patch the source file(s): rewrite unresolved links that pointed here
        await this.patchSourceLinks(newFileName, file);

        // 2. Add alias to the new file's frontmatter
        await this.addAliasFrontmatter(file, newFileName);
      })
    );

    // Also track deletions so knownFiles stays accurate
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          this.knownFiles.delete(file.path);
        }
      })
    );

    // Track renames
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
   * Search all markdown files for wikilinks like [[newFileName]] (without an
   * existing alias) and rewrite them to [[newFileName|newFileName]].
   *
   * We only patch links that are *exact* matches to the new file's basename,
   * and that don't already have a pipe alias.
   */
  private async patchSourceLinks(linkText: string, newFile: TFile): Promise<void> {
    const mdFiles = this.app.vault.getMarkdownFiles();
    let patchedCount = 0;

    for (const mdFile of mdFiles) {
      // Don't patch the newly created file itself
      if (mdFile.path === newFile.path) continue;

      const content = await this.app.vault.read(mdFile);

      // Quick pre-check to avoid unnecessary regex work
      if (!content.includes(`[[${linkText}`)) continue;

      // We need to be careful not to match links that already have aliases.
      // Strategy: replace [[linkText]] and [[linkText#heading]] patterns,
      // but skip [[linkText|alias]] patterns.
      const newContent = content.replace(
        /\[\[([^\]|]*?)(\|[^\]]*)?\]\]/g,
        (match, target, alias) => {
          // If there's already an alias, leave it alone
          if (alias) return match;

          // Extract just the filename part (before any #heading)
          const filenamePart = target.split("#")[0];

          // Check if this link points to our new file
          if (filenamePart === linkText) {
            // Rewrite: [[effort]] → [[effort|effort]]
            // or [[effort#heading]] → [[effort#heading|effort]]
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
      new Notice(`Alias on Create: patched ${patchedCount} file(s) with alias for "${linkText}"`);
    }
  }

  /**
   * Add (or merge into) the frontmatter of the new file so it contains
   * the original link text as an alias.
   */
  private async addAliasFrontmatter(file: TFile, aliasText: string): Promise<void> {
    let content = await this.app.vault.read(file);

    // Check if the file already has frontmatter
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

    if (fmMatch) {
      // Frontmatter exists — check for existing aliases field
      const fmBody = fmMatch[1];

      if (/^aliases\s*:/m.test(fmBody)) {
        // aliases field exists — append our alias if not already present
        // Handle both YAML list styles:
        //   aliases: [a, b]    (inline)
        //   aliases:\n  - a    (block)
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
          // Block-style aliases — check if alias already there
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
            // Insert a new "  - alias" line after the last alias entry
            let insertIdx = aliasIdx + 1 + existingAliases.length;
            blockLines.splice(insertIdx, 0, `  - ${aliasText}`);
            const newFmBody = blockLines.join("\n");
            content = content.replace(fmMatch[1], newFmBody);
          }
        }
      } else {
        // No aliases field yet — add one
        const newFmBody = fmBody + `\naliases:\n  - ${aliasText}`;
        content = content.replace(fmMatch[1], newFmBody);
      }
    } else {
      // No frontmatter at all — prepend it
      content = `---\naliases:\n  - ${aliasText}\n---\n${content}`;
    }

    await this.app.vault.modify(file, content);
  }
}

/**
 * Simple async sleep helper.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
