"use strict";

var obsidian = require("obsidian");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class AliasOnCreatePlugin extends obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.knownFiles = new Set();
  }

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
        if (!(file instanceof obsidian.TFile)) return;
        if (file.extension !== "md") return;

        // If we already knew about this file, skip
        if (this.knownFiles.has(file.path)) return;

        // Add to known set immediately so we don't process twice
        this.knownFiles.add(file.path);

        const newFileName = file.basename;

        // Small delay to let Obsidian finish its file-creation housekeeping
        await sleep(200);

        // 1. Patch source files: rewrite unresolved links that pointed here
        await this.patchSourceLinks(newFileName, file);

        // 2. Add alias to the new file's frontmatter
        await this.addAliasFrontmatter(file, newFileName);
      })
    );

    // Track deletions so knownFiles stays accurate
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof obsidian.TFile) {
          this.knownFiles.delete(file.path);
        }
      })
    );

    // Track renames
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.knownFiles.delete(oldPath);
        if (file instanceof obsidian.TFile) {
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
   */
  async patchSourceLinks(linkText, newFile) {
    const mdFiles = this.app.vault.getMarkdownFiles();
    let patchedCount = 0;

    for (const mdFile of mdFiles) {
      // Don't patch the newly created file itself
      if (mdFile.path === newFile.path) continue;

      const content = await this.app.vault.read(mdFile);

      // Quick pre-check
      if (!content.includes("[[" + linkText)) continue;

      // Replace [[linkText]] and [[linkText#...]] but NOT [[linkText|...]]
      const newContent = content.replace(
        /\[\[([^\]|]*?)(\|[^\]]*)?\]\]/g,
        (match, target, alias) => {
          // If there's already an alias, leave it alone
          if (alias) return match;

          // Extract just the filename part (before any #heading)
          const filenamePart = target.split("#")[0];

          // Check if this link points to our new file
          if (filenamePart === linkText) {
            // [[effort]] → [[effort|effort]]
            // [[effort#heading]] → [[effort#heading|effort]]
            return "[[" + target + "|" + linkText + "]]";
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
      new obsidian.Notice(
        "Alias on Create: patched " + patchedCount + ' file(s) with alias for "' + linkText + '"'
      );
    }
  }

  /**
   * Add the original link text as an alias in the new file's frontmatter.
   */
  async addAliasFrontmatter(file, aliasText) {
    let content = await this.app.vault.read(file);

    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

    if (fmMatch) {
      const fmBody = fmMatch[1];

      if (/^aliases\s*:/m.test(fmBody)) {
        // aliases field exists — check inline vs block style
        const inlineMatch = fmBody.match(/^(aliases\s*:\s*)\[([^\]]*)\]/m);
        if (inlineMatch) {
          const existing = inlineMatch[2]
            .split(",")
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
            .filter(Boolean);
          if (!existing.includes(aliasText)) {
            existing.push(aliasText);
            const newAliases = "aliases: [" + existing.join(", ") + "]";
            const newFmBody = fmBody.replace(/^aliases\s*:\s*\[[^\]]*\]/m, newAliases);
            content = content.replace(fmMatch[1], newFmBody);
          }
        } else {
          // Block-style aliases
          const blockLines = fmBody.split("\n");
          const aliasIdx = blockLines.findIndex((l) => /^aliases\s*:/.test(l));
          const existingAliases = [];
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
            blockLines.splice(insertIdx, 0, "  - " + aliasText);
            const newFmBody = blockLines.join("\n");
            content = content.replace(fmMatch[1], newFmBody);
          }
        }
      } else {
        // No aliases field yet
        const newFmBody = fmBody + "\naliases:\n  - " + aliasText;
        content = content.replace(fmMatch[1], newFmBody);
      }
    } else {
      // No frontmatter at all
      content = "---\naliases:\n  - " + aliasText + "\n---\n" + content;
    }

    await this.app.vault.modify(file, content);
  }
}

module.exports = AliasOnCreatePlugin;
