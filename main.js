"use strict";

const { Plugin, PluginSettingTab, Modal, Setting, setIcon, parseYaml, stringifyYaml, TFile } = require("obsidian");

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
  return {
    ...obj,
    name: obj.name != null ? String(obj.name) : "Clock",
    slices,
    filled,
  };
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

class NewClockModal extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
    this.clock = { name: "", slices: 4, filled: 0 };
  }

  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText("New clock");

    new Setting(contentEl).setName("Name").addText((text) => {
      text.setPlaceholder("e.g. Bluecoat Patrol Alerted").onChange((v) => (this.clock.name = v));
      text.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.submit();
        }
      });
      setTimeout(() => text.inputEl.focus(), 0);
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
    this.close();
    this.onSubmit({ name, slices: this.clock.slices, filled: 0 });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class RenameClockModal extends Modal {
  constructor(app, currentName, onSubmit) {
    super(app);
    this.name = currentName;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    this.titleEl.setText("Rename clock");
    new Setting(this.contentEl).setName("Name").addText((text) => {
      text.setValue(this.name).onChange((v) => (this.name = v));
      text.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.submit();
        }
      });
      setTimeout(() => text.inputEl.select(), 0);
    });
    new Setting(this.contentEl).addButton((btn) =>
      btn.setButtonText("Save").setCta().onClick(() => this.submit())
    );
  }

  submit() {
    const name = this.name.trim();
    if (!name) return;
    this.close();
    this.onSubmit(name);
  }

  onClose() {
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
      editorCallback: (editor) => {
        new NewClockModal(this.app, (clock) => {
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

    const container = el.createDiv({ cls: "bitd-clock-container" });
    clocks.forEach((clock, index) => {
      this.renderClock(container, clock, {
        onChange: (updated) => {
          const next = [...clocks];
          next[index] = updated;
          commit(next);
        },
        onRename: () => {
          new RenameClockModal(this.app, clock.name, (name) => {
            const next = [...clocks];
            next[index] = { ...clock, name };
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
      new NewClockModal(this.app, (clock) => {
        this.save(el, ctx, [...clocks, clock]);
      }).open();
    });
  }

  renderClock(parent, clock, { onChange, onRename, onDelete }) {
    const wrap = parent.createDiv({ cls: "bitd-clock" });

    const header = wrap.createDiv({ cls: "bitd-clock-header" });
    header.createDiv({ cls: "bitd-clock-name", text: clock.name });
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
    iconButton("pencil", "Rename clock", onRename);
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
