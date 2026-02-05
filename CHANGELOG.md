# Changelog

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
