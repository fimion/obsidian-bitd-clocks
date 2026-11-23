# Blades in the Dark Clocks

An [Obsidian](https://obsidian.md) plugin that renders *Blades in the Dark*–style progress clocks right inside your notes. Clock state lives in plain YAML inside a `clock` code block, so your notes stay readable and portable.

## Usage

Add a `clock` code block to any note:

````markdown
```clock
name: Bluecoat Patrol Alerted
slices: 4
filled: 1
```
````

Or put several clocks in one block with a YAML list:

````markdown
```clock
- name: Infiltrate the Manor
  slices: 6
  filled: 2
- name: The Lampblacks' Revenge
  slices: 8
  filled: 5
```
````

| Key      | Description                         | Default |
| -------- | ----------------------------------- | ------- |
| `name`   | Label shown above the clock         | `Clock` |
| `slices` | Total number of slices (1–12)       | `4`     |
| `filled` | Number of filled slices (0–`slices`) | `0`     |

## Features

- **Pie-style clock** with dividers for each slice, plus a "filled · remaining" readout.
- **Dropdowns** to change the filled count and total slices — changes are written straight back to the YAML.
- **Add clocks without touching YAML**
  - Command palette: **Blades in the Dark Clocks: Insert clock** inserts a new block at the cursor.
  - The **+ Add clock** button on any block appends another clock to it.
- **Rename** (pencil) and **delete** (trash) buttons on each clock.
- **Configurable line colour** for the outline and dividers (Settings → Blades in the Dark Clocks). Defaults to your theme's accent colour.
- Works in Reading view and Live Preview, on desktop and mobile.

> [!note]
> When the plugin saves a change it re-serialises the block's YAML, so comments inside a `clock` block are not preserved.

## Installation

### From Community Plugins

Once published: Settings → Community plugins → Browse → search for **Blades in the Dark Clocks**.

### Manual

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](../../releases/latest).
2. Copy them into `<your vault>/.obsidian/plugins/bitd-clocks/`.
3. Reload Obsidian and enable the plugin under Settings → Community plugins.

## Development

The plugin is plain JavaScript — no build step required.

To develop against a vault, symlink this repo into the vault's plugins folder:

```sh
ln -s /path/to/obsidian-bitd-clocks "/path/to/vault/.obsidian/plugins/bitd-clocks"
```

Then toggle the plugin off/on (or use the Hot Reload plugin) after making changes.

### Releasing

1. Bump `version` in `manifest.json`, and add a matching entry to `versions.json` (`"<plugin version>": "<minAppVersion>"`).
2. Commit, then tag with the exact version number (no `v` prefix) and push the tag:
   ```sh
   git tag 1.0.1
   git push origin 1.0.1
   ```
3. The GitHub Action creates a **draft** release with `main.js`, `manifest.json` and `styles.css` attached. Review it and publish.

## Credits

This work is based on *Blades in the Dark* (found at [bladesinthedark.com](http://www.bladesinthedark.com/)), product of One Seven Design, developed and authored by John Harper, and licensed for our use under the [Creative Commons Attribution 3.0 Unported license](http://creativecommons.org/licenses/by/3.0/).

This plugin is not affiliated with or endorsed by One Seven Design or Evil Hat Productions.

## License

[MIT](LICENSE)
