# Changelog

## [1.2.1] - 2026-02-08

### Fixed
- Fixed Templater compatibility on iCloud-synced vaults. On iCloud, filesystem
  event latency caused the plugin to write before Templater finished, overwriting
  template properties. The plugin now guards aliases after writing: if another
  plugin modifies the file afterward, aliases are re-merged into the new content.

## [1.2.0] - 2026-02-08

### Fixed
- Fixed compatibility with Templater default folder templates. Previously, this
  plugin's 300ms delay was too short — it would write alias-only frontmatter
  before Templater finished applying its template, causing the template properties
  (tags, status, etc.) to be lost.
- The plugin now watches for file modifications after creation and waits for
  content to stabilize before adding aliases, allowing Templater (or any other
  plugin) to finish first.

### Changed
- Replaced manual regex-based frontmatter parsing with Obsidian's built-in
  `processFrontMatter` API for safer, atomic read-modify-write operations that
  preserve all existing frontmatter fields.
- Removed the fixed `sleep(300)` delay in favor of an event-driven stabilization
  approach (500ms of no modifications, 5s hard cap).

## [1.1.0] - 2026-02-05

### Added
- Existing pipe aliases are now collected and added to the new file's frontmatter.
  For example, `[[Cloud computing|cloud stuff]]` will add "cloud stuff" as an alias
  to the new `Cloud computing.md` file.
- Multiple distinct aliases across the vault are all collected and added.

### Fixed
- Plugin no longer fires on vault startup. The create event listener is now
  registered inside `onLayoutReady`, after the known files snapshot is built.
- Plugin no longer fires on files created by other means (Cmd+N, calendar,
  templates, sync). It now checks whether a matching `[[link]]` actually exists
  in the vault before processing.
- Template files no longer get aliases added to their frontmatter.
- Notification popups replaced with console logging.

## [1.0.0] - 2026-02-05

### Added
- Initial release.
- Rewrites bare `[[link]]` → `[[link|link]]` when a new file is created.
- Adds the link text as an alias in the new file's frontmatter.
- Handles `#heading` and `#^blockref` fragments.
- Supports both inline and block YAML alias styles.
