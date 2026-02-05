"use strict";

var obsidian = require("obsidian");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class AliasOnCreatePlugin extends obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.knownFiles = new Set();
    this.ready = false;
  }

  async onload() {
    console.log("Alias on Create: loaded");

    // Wait until layout is ready before doing anything
    this.app.workspace.onLayoutReady(() => {
      // Snapshot every file path that already exists
      for (const file of this.app.vault.getFiles()) {
        this.knownFiles.add(file.path);
      }
      console.log("Alias on Create: ready, tracking " + this.knownFiles.size + " existing files");
      this.ready = true;

      // Only start listening AFTER we know what files exist
      this.registerEvent(
        this.app.vault.on("create", async (file) => {
          if (!this.ready) return;
          if (!(file instanceof obsidian.TFile)) return;
          if (file.extension !== "md") return;

          // If we already knew about this file, skip
          if (this.knownFiles.has(file.path)) return;

          // Add to known set immediately so we don't process twice
          this.knownFiles.add(file.path);

          const newFileName = file.basename;

          // Small delay to let Obsidian finish its file-creation housekeeping
          await sleep(300);

          // Find all links to this filename across the vault.
          // Returns { hasLinks: boolean, aliases: string[] }
          // where aliases are the unique display texts found
          // (either explicit pipe aliases or the filename itself for bare links)
          const linkInfo = await this.findMatchingLinks(newFileName, file);

          if (!linkInfo.hasLinks) {
            console.log("Alias on Create: no matching links found for \"" + newFileName + "\", skipping");
            return;
          }

          console.log("Alias on Create: found links for \"" + newFileName + "\" with aliases:", linkInfo.aliases);

          // 1. Patch bare links: [[name]] → [[name|name]]
          //    Links with existing aliases are left alone
          await this.patchBareLinks(newFileName, file);

          // 2. Add all collected aliases to the new file's frontmatter
          for (const alias of linkInfo.aliases) {
            await this.addAliasFrontmatter(file, alias);
          }
        })
      );
    });

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
   * Scan the vault for all wikilinks pointing to linkText.
   * Collects the display text for each link:
   *   [[Cloud computing]]                → alias "Cloud computing"
   *   [[Cloud computing|cloud stuff]]     → alias "cloud stuff"
   *   [[Cloud computing#heading]]         → alias "Cloud computing"
   *   [[Cloud computing#heading|my text]] → alias "my text"
   *
   * Returns { hasLinks: boolean, aliases: string[] } with deduplicated aliases.
   */
  async findMatchingLinks(linkText, newFile) {
    const mdFiles = this.app.vault.getMarkdownFiles();
    const aliasSet = new Set();
    let hasLinks = false;

    const escaped = linkText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match [[linkText]], [[linkText#...]], [[linkText|...]], [[linkText#...|...]]
    const pattern = new RegExp(
      "\\[\\[" + escaped + "(#[^\\]|]*)?(\\|([^\\]]+))?\\]\\]",
      "g"
    );

    for (const mdFile of mdFiles) {
      if (mdFile.path === newFile.path) continue;

      const content = await this.app.vault.read(mdFile);

      if (!content.includes("[[" + linkText)) continue;

      let match;
      while ((match = pattern.exec(content)) !== null) {
        hasLinks = true;
        // match[3] is the pipe alias text, if present
        var alias = match[3] ? match[3] : linkText;
        aliasSet.add(alias);
      }
    }

    return { hasLinks: hasLinks, aliases: Array.from(aliasSet) };
  }

  /**
   * Rewrite bare [[linkText]] links to [[linkText|linkText]].
   * Links that already have a pipe alias are left untouched.
   */
  async patchBareLinks(linkText, newFile) {
    const mdFiles = this.app.vault.getMarkdownFiles();
    let patchedCount = 0;

    for (const mdFile of mdFiles) {
      if (mdFile.path === newFile.path) continue;

      const content = await this.app.vault.read(mdFile);

      if (!content.includes("[[" + linkText)) continue;

      const newContent = content.replace(
        /\[\[([^\]|]*?)(\|[^\]]*)?\]\]/g,
        (match, target, alias) => {
          if (alias) return match;

          var filenamePart = target.split("#")[0];

          if (filenamePart === linkText) {
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
      console.log(
        "Alias on Create: patched " + patchedCount + ' file(s) with alias for "' + linkText + '"'
      );
    }
  }

  /**
   * Add a single alias to the file's frontmatter, if not already present.
   */
  async addAliasFrontmatter(file, aliasText) {
    let content = await this.app.vault.read(file);

    var fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

    if (fmMatch) {
      var fmBody = fmMatch[1];

      if (/^aliases\s*:/m.test(fmBody)) {
        var inlineMatch = fmBody.match(/^(aliases\s*:\s*)\[([^\]]*)\]/m);
        if (inlineMatch) {
          var existing = inlineMatch[2]
            .split(",")
            .map(function(s) { return s.trim().replace(/^['"]|['"]$/g, ""); })
            .filter(Boolean);
          if (!existing.includes(aliasText)) {
            existing.push(aliasText);
            var newAliases = "aliases: [" + existing.join(", ") + "]";
            var newFmBody = fmBody.replace(/^aliases\s*:\s*\[[^\]]*\]/m, newAliases);
            content = content.replace(fmMatch[1], newFmBody);
          }
        } else {
          var blockLines = fmBody.split("\n");
          var aliasIdx = blockLines.findIndex(function(l) { return /^aliases\s*:/.test(l); });
          var existingAliases = [];
          for (var i = aliasIdx + 1; i < blockLines.length; i++) {
            var m = blockLines[i].match(/^\s*-\s+(.*)/);
            if (m) {
              existingAliases.push(m[1].replace(/^['"]|['"]$/g, ""));
            } else {
              break;
            }
          }
          if (!existingAliases.includes(aliasText)) {
            var insertIdx = aliasIdx + 1 + existingAliases.length;
            blockLines.splice(insertIdx, 0, "  - " + aliasText);
            var newFmBody2 = blockLines.join("\n");
            content = content.replace(fmMatch[1], newFmBody2);
          }
        }
      } else {
        var newFmBody3 = fmBody + "\naliases:\n  - " + aliasText;
        content = content.replace(fmMatch[1], newFmBody3);
      }
    } else {
      content = "---\naliases:\n  - " + aliasText + "\n---\n" + content;
    }

    await this.app.vault.modify(file, content);
  }
}

module.exports = AliasOnCreatePlugin;
