"use strict";

const {
  Plugin,
  PluginSettingTab,
  Modal,
  Setting,
  setIcon,
  parseYaml,
  stringifyYaml,
  TFile,
  MarkdownRenderer,
  MarkdownRenderChild,
  Keymap,
  prepareFuzzySearch,
} = require("obsidian");

const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_SLICES = 12;
const MIN_SLICES = 1;

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeClock(raw) {
  const obj = raw && typeof raw === "object" ? raw : {};
  const slices = clampInt(obj.slices, MIN_SLICES, MAX_SLICES, 4);
  const filled = clampInt(obj.filled, 0, slices, 0);
  const result = {
    ...obj,
    name: obj.name != null ? String(obj.name) : "Clock",
    slices,
    filled,
  };
  if (obj.description != null && String(obj.description).trim() !== "") {
    result.description = String(obj.description);
  } else {
    delete result.description;
  }
  return result;
}

function buildPie(slices, filled, size = 120) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.classList.add("bitd-clock-svg");

  const c = size / 2;
  const r = size / 2 - 4;

  const circle = (cls) => {
    const el = document.createElementNS(SVG_NS, "circle");
    el.setAttribute("cx", String(c));
    el.setAttribute("cy", String(c));
    el.setAttribute("r", String(r));
    el.classList.add(...cls);
    svg.appendChild(el);
  };

  // Angle of slice boundary i: start at 12 o'clock and go clockwise.
  const angle = (i) => (i / slices) * 2 * Math.PI - Math.PI / 2;
  const point = (a) => [c + r * Math.cos(a), c + r * Math.sin(a)];

  // 1. Slice fills (no stroke).
  if (slices === 1) {
    circle(["bitd-clock-slice", filled >= 1 ? "is-filled" : "is-empty"]);
  } else {
    for (let i = 0; i < slices; i++) {
      const [x0, y0] = point(angle(i));
      const [x1, y1] = point(angle(i + 1));
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", `M ${c} ${c} L ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1} Z`);
      path.classList.add("bitd-clock-slice", i < filled ? "is-filled" : "is-empty");
      svg.appendChild(path);
    }

    // 2. Divider lines from the centre to each slice boundary.
    for (let i = 0; i < slices; i++) {
      const [x, y] = point(angle(i));
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(c));
      line.setAttribute("y1", String(c));
      line.setAttribute("x2", String(x));
      line.setAttribute("y2", String(y));
      line.classList.add("bitd-clock-divider");
      svg.appendChild(line);
    }
  }

  // 3. Outer rim on top.
  circle(["bitd-clock-rim"]);
  return svg;
}

class WikilinkSuggest {
  constructor(app, inputEl, sourcePath, onValueChange) {
    this.app = app;
    this.inputEl = inputEl;
    this.sourcePath = sourcePath || "";
    this.onValueChange = onValueChange;
    this.popoverEl = null;
    this.items = [];
    this.selectedIndex = 0;
    this.triggerStart = -1;

    this.onInput = () => this.update();
    this.onKeyDown = (e) => this.handleKeyDown(e);
    this.onBlur = () => this.close();
    this.onResize = () => this.position();

    inputEl.addEventListener("input", this.onInput);
    inputEl.addEventListener("keydown", this.onKeyDown);
    inputEl.addEventListener("blur", this.onBlur);
    window.addEventListener("resize", this.onResize);
  }

  isOpen() {
    return this.popoverEl !== null;
  }

  update() {
    const pos = this.inputEl.selectionStart;
    if (pos == null) {
      this.close();
      return;
    }

    const before = this.inputEl.value.slice(0, pos);
    const match = before.match(/\[\[([^\]\n]*)$/);
    if (!match) {
      this.close();
      return;
    }

    this.triggerStart = match.index;
    const query = match[1];
    const files = this.app.vault.getMarkdownFiles();

    if (!query) {
      this.items = [...files].sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 12);
    } else {
      const fuzzy = prepareFuzzySearch(query);
      const scored = [];
      for (const file of files) {
        const nameMatch = fuzzy(file.basename);
        const pathMatch = fuzzy(file.path.slice(0, -3));
        const best =
          nameMatch && pathMatch
            ? nameMatch.score >= pathMatch.score
              ? nameMatch
              : pathMatch
            : nameMatch || pathMatch;
        if (best) scored.push({ file, score: best.score });
      }
      scored.sort((a, b) => b.score - a.score);
      this.items = scored.slice(0, 12).map((m) => m.file);
    }

    if (this.items.length === 0) {
      this.close();
      return;
    }

    this.selectedIndex = 0;
    this.render();
  }

  render() {
    if (!this.popoverEl) {
      this.popoverEl = document.body.createDiv({ cls: "suggestion-container bitd-clock-suggest" });
    }
    this.popoverEl.empty();

    const listEl = this.popoverEl.createDiv({ cls: "suggestion" });
    this.items.forEach((file, index) => {
      const itemEl = listEl.createDiv({
        cls: index === this.selectedIndex ? "suggestion-item is-selected" : "suggestion-item",
      });
      const contentEl = itemEl.createDiv({ cls: "suggestion-content" });
      contentEl.createDiv({ cls: "suggestion-title", text: file.basename });
      if (file.parent && file.parent.path) {
        contentEl.createDiv({ cls: "suggestion-note", text: file.parent.path });
      }

      itemEl.addEventListener("mouseenter", () => this.setSelected(index));
      itemEl.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.select(index);
      });
    });

    this.position();
  }

  position() {
    if (!this.popoverEl) return;
    const rect = this.inputEl.getBoundingClientRect();
    const width = Math.max(rect.width, 220);
    const left = Math.min(rect.left, Math.max(8, window.innerWidth - width - 8));
    this.popoverEl.style.left = `${left}px`;
    this.popoverEl.style.width = `${width}px`;

    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 160 && rect.top > spaceBelow) {
      this.popoverEl.style.top = "auto";
      this.popoverEl.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    } else {
      this.popoverEl.style.bottom = "auto";
      this.popoverEl.style.top = `${rect.bottom + 4}px`;
    }
  }

  setSelected(index) {
    if (!this.popoverEl || !this.items.length) return;
    this.selectedIndex = (index + this.items.length) % this.items.length;
    const nodes = this.popoverEl.querySelectorAll(".suggestion-item");
    nodes.forEach((node, i) => {
      node.classList.toggle("is-selected", i === this.selectedIndex);
    });
    const active = nodes[this.selectedIndex];
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  select(index) {
    const file = this.items[index];
    if (!file) return;

    const value = this.inputEl.value;
    const pos = this.inputEl.selectionStart ?? value.length;
    const link = this.app.fileManager.generateMarkdownLink(file, this.sourcePath);
    let after = value.slice(pos);
    if (after.startsWith("]]") && link.endsWith("]]")) {
      after = after.slice(2);
    }

    const nextValue = value.slice(0, this.triggerStart) + link + after;
    const nextCursor = this.triggerStart + link.length;
    this.inputEl.value = nextValue;
    this.inputEl.setSelectionRange(nextCursor, nextCursor);
    this.onValueChange(nextValue);
    this.close();
    this.inputEl.focus();
  }

  handleKeyDown(e) {
    if (!this.isOpen()) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      this.setSelected(this.selectedIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      this.setSelected(this.selectedIndex - 1);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      this.select(this.selectedIndex);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  }

  close() {
    if (this.popoverEl) {
      this.popoverEl.remove();
      this.popoverEl = null;
    }
    this.items = [];
    this.triggerStart = -1;
  }

  destroy() {
    this.close();
    this.inputEl.removeEventListener("input", this.onInput);
    this.inputEl.removeEventListener("keydown", this.onKeyDown);
    this.inputEl.removeEventListener("blur", this.onBlur);
    window.removeEventListener("resize", this.onResize);
  }
}

class NewClockModal extends Modal {
  constructor(app, sourcePath, onSubmit) {
    super(app);
    this.sourcePath = sourcePath;
    this.onSubmit = onSubmit;
    this.clock = { name: "", description: "", slices: 4, filled: 0 };
    this.suggests = [];
  }

  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText("New clock");

    new Setting(contentEl).setName("Name").addText((text) => {
      text.setPlaceholder("e.g. Bluecoat Patrol Alerted").onChange((v) => (this.clock.name = v));
      const suggest = new WikilinkSuggest(this.app, text.inputEl, this.sourcePath, (v) => {
        this.clock.name = v;
      });
      this.suggests.push(suggest);
      text.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !suggest.isOpen()) {
          e.preventDefault();
          this.submit();
        }
      });
      setTimeout(() => text.inputEl.focus(), 0);
    });

    new Setting(contentEl).setName("Description").addTextArea((ta) => {
      ta.setPlaceholder("Optional details (type [[ to link a note)").onChange(
        (v) => (this.clock.description = v)
      );
      ta.inputEl.rows = 3;
      this.suggests.push(
        new WikilinkSuggest(this.app, ta.inputEl, this.sourcePath, (v) => {
          this.clock.description = v;
        })
      );
    });

    new Setting(contentEl).setName("Slices").addDropdown((dd) => {
      for (let i = MIN_SLICES; i <= MAX_SLICES; i++) dd.addOption(String(i), String(i));
      dd.setValue(String(this.clock.slices)).onChange((v) => (this.clock.slices = parseInt(v, 10)));
    });

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Add clock").setCta().onClick(() => this.submit())
    );
  }

  submit() {
    const name = this.clock.name.trim() || "Clock";
    const description = this.clock.description.trim();
    const clock = { name, slices: this.clock.slices, filled: 0 };
    if (description) clock.description = description;
    this.close();
    this.onSubmit(clock);
  }

  onClose() {
    this.suggests.forEach((s) => s.destroy());
    this.suggests = [];
    this.contentEl.empty();
  }
}

class EditClockModal extends Modal {
  constructor(app, clock, sourcePath, onSubmit) {
    super(app);
    this.name = clock.name;
    this.description = clock.description || "";
    this.sourcePath = sourcePath;
    this.onSubmit = onSubmit;
    this.suggests = [];
  }

  onOpen() {
    this.titleEl.setText("Edit clock");
    new Setting(this.contentEl).setName("Name").addText((text) => {
      text.setValue(this.name).onChange((v) => (this.name = v));
      const suggest = new WikilinkSuggest(this.app, text.inputEl, this.sourcePath, (v) => {
        this.name = v;
      });
      this.suggests.push(suggest);
      text.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !suggest.isOpen()) {
          e.preventDefault();
          this.submit();
        }
      });
      setTimeout(() => text.inputEl.select(), 0);
    });
    new Setting(this.contentEl).setName("Description").addTextArea((ta) => {
      ta.setPlaceholder("Optional details (type [[ to link a note)")
        .setValue(this.description)
        .onChange((v) => (this.description = v));
      ta.inputEl.rows = 3;
      this.suggests.push(
        new WikilinkSuggest(this.app, ta.inputEl, this.sourcePath, (v) => {
          this.description = v;
        })
      );
    });
    new Setting(this.contentEl).addButton((btn) =>
      btn.setButtonText("Save").setCta().onClick(() => this.submit())
    );
  }

  submit() {
    const name = this.name.trim();
    if (!name) return;
    const description = this.description.trim();
    this.close();
    this.onSubmit({ name, description });
  }

  onClose() {
    this.suggests.forEach((s) => s.destroy());
    this.suggests = [];
    this.contentEl.empty();
  }
}

class ConfirmDeleteModal extends Modal {
  constructor(app, name, onConfirm) {
    super(app);
    this.clockName = name;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    this.titleEl.setText("Delete clock");
    this.contentEl.createEl("p", { text: `Delete the clock "${this.clockName}"?` });
    new Setting(this.contentEl)
      .addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((btn) =>
        btn
          .setButtonText("Delete")
          .setWarning()
          .onClick(() => {
            this.close();
            this.onConfirm();
          })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}

const DEFAULT_SETTINGS = {
  // Empty string = follow the theme's accent colour.
  lineColor: "",
};

class BitDClocksSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    const setting = new Setting(containerEl)
      .setName("Line colour")
      .setDesc("Colour of the clock outline and slice dividers. Defaults to your theme's accent colour.");

    setting.addColorPicker((picker) => {
      const fallback = getComputedStyle(document.body)
        .getPropertyValue("--interactive-accent")
        .trim();
      picker.setValue(this.plugin.settings.lineColor || (fallback.startsWith("#") ? fallback : "#7f6df2"));
      picker.onChange(async (value) => {
        this.plugin.settings.lineColor = value;
        await this.plugin.saveSettings();
      });
    });

    setting.addExtraButton((btn) =>
      btn
        .setIcon("rotate-ccw")
        .setTooltip("Reset to theme accent")
        .onClick(async () => {
          this.plugin.settings.lineColor = "";
          await this.plugin.saveSettings();
          this.display();
        })
    );
  }
}

module.exports = class BitDClocksPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new BitDClocksSettingTab(this.app, this));

    this.registerMarkdownCodeBlockProcessor("clock", (source, el, ctx) =>
      this.renderBlock(source, el, ctx)
    );

    // Insert a brand new clock block at the cursor.
    this.addCommand({
      id: "insert-clock",
      name: "Insert clock",
      editorCallback: (editor, view) => {
        const sourcePath = view && view.file ? view.file.path : "";
        new NewClockModal(this.app, sourcePath, (clock) => {
          const block = "```clock\n" + stringifyYaml(clock).trimEnd() + "\n```\n";
          const cursor = editor.getCursor();
          const prefix = cursor.ch === 0 ? "" : "\n";
          editor.replaceRange(prefix + block, cursor);
        }).open();
      },
    });
  }

  onunload() {
    document.body.style.removeProperty("--bitd-clock-line");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.applyLineColor();
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.applyLineColor();
  }

  applyLineColor() {
    if (this.settings.lineColor) {
      document.body.style.setProperty("--bitd-clock-line", this.settings.lineColor);
    } else {
      document.body.style.removeProperty("--bitd-clock-line");
    }
  }

  renderBlock(source, el, ctx) {
    el.addClass("bitd-clocks");

    let data;
    try {
      data = parseYaml(source);
    } catch (e) {
      el.createDiv({ cls: "bitd-clock-error", text: `Clock YAML error: ${e.message}` });
      return;
    }

    // Supports a single clock (mapping) or a list of clocks. Empty block = no clocks.
    const isList = Array.isArray(data) || data == null;
    const clocks = (data == null ? [] : isList ? data : [data]).map(normalizeClock);
    const commit = (list) => this.save(el, ctx, isList || list.length !== 1 ? list : list[0]);

    const renderChild = new MarkdownRenderChild(el);
    ctx.addChild(renderChild);

    const container = el.createDiv({ cls: "bitd-clock-container" });
    clocks.forEach((clock, index) => {
      this.renderClock(container, clock, {
        sourcePath: ctx.sourcePath,
        component: renderChild,
        onChange: (updated) => {
          const next = [...clocks];
          next[index] = updated;
          commit(next);
        },
        onEdit: () => {
          new EditClockModal(this.app, clock, ctx.sourcePath, ({ name, description }) => {
            const next = [...clocks];
            const updated = { ...clock, name };
            if (description) {
              updated.description = description;
            } else {
              delete updated.description;
            }
            next[index] = updated;
            commit(next);
          }).open();
        },
        onDelete: () => {
          new ConfirmDeleteModal(this.app, clock.name, () => {
            // Always save as a list once deleting, so an empty block stays valid.
            this.save(el, ctx, clocks.filter((_, i) => i !== index));
          }).open();
        },
      });
    });

    // "+ Add clock" button: appends a clock to this block (turning it into a list).
    const addBtn = container.createEl("button", { cls: "bitd-clock-add", text: "+ Add clock" });
    addBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      new NewClockModal(this.app, ctx.sourcePath, (clock) => {
        this.save(el, ctx, [...clocks, clock]);
      }).open();
    });
  }

  renderMarkdownField(markdown, containerEl, sourcePath, component) {
    MarkdownRenderer.render(this.app, markdown, containerEl, sourcePath, component);

    const getInternalLink = (target) => {
      const anchor = target instanceof Element ? target.closest("a.internal-link") : null;
      if (!anchor) return null;
      const href = anchor.getAttribute("data-href") || anchor.getAttribute("href");
      return href ? { anchor, href } : null;
    };

    component.registerDomEvent(containerEl, "mouseover", (evt) => {
      const link = getInternalLink(evt.target);
      if (!link) return;
      this.app.workspace.trigger("hover-link", {
        event: evt,
        source: "preview",
        hoverParent: { hoverPopover: null },
        targetEl: link.anchor,
        linktext: link.href,
        sourcePath,
      });
    });

    component.registerDomEvent(containerEl, "click", (evt) => {
      if (evt.button !== 0) return;
      const link = getInternalLink(evt.target);
      if (link) {
        evt.preventDefault();
        evt.stopPropagation();
        this.app.workspace.openLinkText(link.href, sourcePath, Keymap.isModEvent(evt));
        return;
      }
      const external = evt.target instanceof Element ? evt.target.closest("a.external-link") : null;
      if (external) {
        evt.stopPropagation();
      }
    });

    component.registerDomEvent(containerEl, "auxclick", (evt) => {
      if (evt.button !== 1) return;
      const link = getInternalLink(evt.target);
      if (!link) return;
      evt.preventDefault();
      evt.stopPropagation();
      this.app.workspace.openLinkText(link.href, sourcePath, "tab");
    });
  }

  renderClock(parent, clock, { sourcePath, component, onChange, onEdit, onDelete }) {
    const wrap = parent.createDiv({ cls: "bitd-clock" });

    const header = wrap.createDiv({ cls: "bitd-clock-header" });
    const nameEl = header.createDiv({ cls: "bitd-clock-name" });
    this.renderMarkdownField(clock.name, nameEl, sourcePath, component);
    const actions = header.createDiv({ cls: "bitd-clock-actions" });
    const iconButton = (icon, label, handler) => {
      const btn = actions.createEl("button", {
        cls: "clickable-icon bitd-clock-action",
        attr: { "aria-label": label },
      });
      setIcon(btn, icon);
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        handler();
      });
    };
    iconButton("pencil", "Edit clock", onEdit);
    iconButton("trash-2", "Delete clock", onDelete);

    wrap.appendChild(buildPie(clock.slices, clock.filled));

    const remaining = clock.slices - clock.filled;
    wrap.createDiv({
      cls: "bitd-clock-status",
      text:
        remaining === 0
          ? `${clock.filled}/${clock.slices} — complete!`
          : `${clock.filled}/${clock.slices} filled · ${remaining} remaining`,
    });

    const controls = wrap.createDiv({ cls: "bitd-clock-controls" });

    // Filled dropdown
    const filledLabel = controls.createEl("label", { text: "Filled " });
    const filledSelect = filledLabel.createEl("select", { cls: "dropdown" });
    for (let i = 0; i <= clock.slices; i++) {
      const opt = filledSelect.createEl("option", { text: String(i), value: String(i) });
      if (i === clock.filled) opt.selected = true;
    }
    filledSelect.addEventListener("change", () => {
      onChange({ ...clock, filled: parseInt(filledSelect.value, 10) });
    });

    // Total slices dropdown
    const totalLabel = controls.createEl("label", { text: "Slices " });
    const totalSelect = totalLabel.createEl("select", { cls: "dropdown" });
    for (let i = MIN_SLICES; i <= MAX_SLICES; i++) {
      const opt = totalSelect.createEl("option", { text: String(i), value: String(i) });
      if (i === clock.slices) opt.selected = true;
    }
    totalSelect.addEventListener("change", () => {
      const slices = parseInt(totalSelect.value, 10);
      onChange({ ...clock, slices, filled: Math.min(clock.filled, slices) });
    });

    if (clock.description) {
      const descEl = wrap.createDiv({ cls: "bitd-clock-description" });
      this.renderMarkdownField(clock.description, descEl, sourcePath, component);
    }
  }

  async save(el, ctx, data) {
    const info = ctx.getSectionInfo(el);
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!info || !(file instanceof TFile)) return;

    const yaml = stringifyYaml(data).trimEnd();
    await this.app.vault.process(file, (content) => {
      const lines = content.split("\n");
      // lineStart is the opening ``` fence, lineEnd is the closing fence.
      lines.splice(info.lineStart + 1, info.lineEnd - info.lineStart - 1, ...yaml.split("\n"));
      return lines.join("\n");
    });
  }
};
