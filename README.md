# Alias on Create

An Obsidian plugin that automatically preserves your original wikilink text as an alias when creating new files from unresolved links.

## The Problem

You write `[[effort]]` in a note. Later you click it, and Obsidian creates a file called `effort.md`. You then rename it to `Effort.md` or `Effort (psychology).md` — but now your original `[[effort]]` link is broken or displays the wrong text.

## The Solution

When you click an unresolved link like `[[effort]]`, this plugin:

1. **Patches the source link** — rewrites `[[effort]]` → `[[effort|effort]]` in the file where you clicked
2. **Adds a frontmatter alias** — the new file gets `aliases: [effort]` in its YAML frontmatter

Now you can freely rename `effort.md` to anything you want. The original link keeps displaying "effort" via the pipe alias, and Obsidian's alias resolution keeps the link intact.

## Installation

### Manual Install

1. Copy these two files into your vault's plugin folder:
   ```
   <your-vault>/.obsidian/plugins/alias-on-create/main.js
   <your-vault>/.obsidian/plugins/alias-on-create/manifest.json
   ```
2. Restart Obsidian (or reload plugins)
3. Go to **Settings → Community Plugins** and enable **Alias on Create**

### From Source

1. Clone this repo into `<your-vault>/.obsidian/plugins/alias-on-create/`
2. Run `npm install` then `npm run build`
3. Restart Obsidian and enable the plugin

## How It Works

The plugin listens for `vault.on("create")` events. When a new `.md` file appears that wasn't previously known (i.e. not from sync or templates loading at startup), it:

- Scans all other markdown files for wikilinks matching the new file's basename
- Rewrites any bare `[[filename]]` links to `[[filename|filename]]`
- Handles heading links too: `[[filename#heading]]` → `[[filename#heading|filename]]`
- Leaves links that already have aliases (`[[filename|my alias]]`) untouched
- Adds or merges the alias into the new file's frontmatter (supports both inline `[...]` and block `- ...` YAML styles)

## Example

**Before clicking the link:**

```markdown
<!-- In your-note.md -->
I need to define [[effort]] more carefully.
```

**After clicking `[[effort]]`:**

```markdown
<!-- In your-note.md (patched) -->
I need to define [[effort|effort]] more carefully.
```

```markdown
<!-- In effort.md (newly created) -->
---
aliases:
  - effort
---

```

**After renaming `effort.md` → `Effort (psychology).md`:**

Your original note still reads: `I need to define [[Effort (psychology)|effort]] more carefully.`  
Obsidian handles the rename automatically, and the display text stays "effort". ✓

## Edge Cases Handled

- Links with `#heading` or `#^blockref` fragments
- Files with existing frontmatter (aliases field is merged, not overwritten)
- Both YAML alias styles (inline array and block list)
- Files created by sync or at startup are ignored (only newly created files trigger)
- Multiple links across multiple files are all patched in one pass

## Building from Source

```bash
npm install
npm run build
```

## License

MIT
