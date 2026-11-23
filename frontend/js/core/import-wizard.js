/* core/import-wizard · Excel / CSV 迁移导入：模板 → 字段映射 → 预检 → 写入 → 失败行回执 */

import { API } from "./api.js";
import { icon } from "./icons.js";
import { UI, esc, toast } from "./ui.js";
import { triggerDownload } from "../lib/download.js";

var KINDS = [
  { key: "task", label: "工作项", desc: "任务 / 缺陷，可指定项目、负责人与看板列" },
  { key: "demand", label: "需求", desc: "需求池条目，可指定来源、评审人与期望日期" },
  { key: "case", label: "测试用例", desc: "标题、步骤与预期结果，按项目归类" },
  { key: "worklog", label: "工时", desc: "按工作项编号或标题补记工时" }
];
var IGNORE = "__ignore__";
var MAX_BYTES = 8 * 1024 * 1024;

function kindOf(kind) {
  for (var i = 0; i < KINDS.length; i++) {
    if (KINDS[i].key === kind) return kind;
  }
  return "task";
}

function kindLabel(kind) {
  for (var i = 0; i < KINDS.length; i++) {
    if (KINDS[i].key === kind) return KINDS[i].label;
  }
  return "数据";
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

/* Excel「另存为 CSV」在中文 Windows 上默认 GBK：先按 UTF-8 严格解码，失败再回退 GB18030 */
function decodeCsvBytes(buffer) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch (e) {
    try { return new TextDecoder("gb18030").decode(buffer); }
    catch (e2) { return new TextDecoder("utf-8").decode(buffer); }
  }
}

function readFile(file) {
  var name = String(file.name || "");
  var lower = name.toLowerCase();
  if (lower.slice(-4) === ".csv" || lower.slice(-4) === ".txt") {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve({ csv: decodeCsvBytes(reader.result) }); };
      reader.onerror = function () { reject(new Error("读取文件失败")); };
      reader.readAsArrayBuffer(file);
    });
  }
  if (lower.slice(-5) === ".xlsx" || lower.slice(-4) === ".xls") {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var data = String(reader.result || "");
        var base64 = data.indexOf(",") >= 0 ? data.slice(data.indexOf(",") + 1) : "";
        if (!base64) { reject(new Error("读取文件失败")); return; }
        resolve({ file: base64, fileName: name });
      };
      reader.onerror = function () { reject(new Error("读取文件失败")); };
      reader.readAsDataURL(file);
    });
  }
  return Promise.reject(new Error("只支持 .csv / .xlsx / .xls 文件"));
}

/**
 * 打开迁移导入向导。
 * @param {string} kind  task | demand | case | worklog
 * @param {{onDone:Function}} [opts] 写入成功后的刷新回调
 */
export function openImportDialog(kind, opts) {
  opts = opts || {};
  if (document.querySelector(".import-wizard-layer.open")) return;

  var state = { kind: kindOf(kind), csv: "", file: "", fileName: "", mapping: null, preview: null, busy: false, done: false };

  var layer = document.createElement("div");
  layer.className = "modal-layer import-wizard-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-label", "Excel / CSV 迁移导入");
  layer.innerHTML =
    '<div class="sheet wide import-wizard">' +
      '<div class="sheet-head"><div style="flex:1 1 auto;min-width:0">' +
        '<h2>Excel / CSV 迁移导入</h2>' +
        '<div class="desc">先在表格里准备好数据，预检通过后再写入；字段可以按表头手动对应。</div>' +
      '</div><button class="icon-btn sm" type="button" data-imp-x aria-label="关闭">' + icon("close", 15) + '</button></div>' +
      '<div class="sheet-body">' +
        '<div class="imp-pick">' +
          '<div class="imp-kinds" id="impKinds"></div>' +
          '<div class="imp-file">' +
            '<button class="btn sm" type="button" id="impPick">选择文件</button>' +
            '<span class="imp-file-name" id="impFile">未选择文件（.csv / .xlsx / .xls，单次最多 1000 行）</span>' +
            '<button class="link-btn" type="button" id="impTpl">下载模板</button>' +
          '</div>' +
        '</div>' +
        '<div id="impResult"></div>' +
      '</div>' +
      '<div class="sheet-foot">' +
        '<span class="hint" id="impHint">失败行会附上原因，可下载修正后重新导入。</span>' +
        '<button class="btn" type="button" data-imp-cancel>取消</button>' +
        '<button class="btn primary" type="button" id="impCommit" disabled>开始导入</button>' +
      '</div>' +
      '<input type="file" accept=".csv,.xlsx,.xls" hidden />' +
    '</div>';
  document.body.appendChild(layer);

  var kindsEl = layer.querySelector("#impKinds");
  var fileEl = layer.querySelector("#impFile");
  var resultEl = layer.querySelector("#impResult");
  var hintEl = layer.querySelector("#impHint");
  var commitBtn = layer.querySelector("#impCommit");
  var pickBtn = layer.querySelector("#impPick");
  var tplBtn = layer.querySelector("#impTpl");
  var fileInput = layer.querySelector('input[type="file"]');

  /* ---------- 生命周期 ---------- */
  function close() {
    UI.closeModal(layer);
  }
  layer.__uiOnClose = function () {
    setTimeout(function () { if (layer.parentNode) layer.parentNode.removeChild(layer); }, 220);
  };
  layer.querySelector("[data-imp-x]").addEventListener("click", close);
  layer.querySelector("[data-imp-cancel]").addEventListener("click", close);

  /* ---------- 类型与模板 ---------- */
  function renderKinds() {
    kindsEl.innerHTML = KINDS.map(function (k) {
      return '<button class="imp-kind' + (k.key === state.kind ? " on" : "") + '" type="button" data-kind="' + k.key + '" title="' + esc(k.desc) + '">' +
        '<b>' + esc(k.label) + '</b><span>' + esc(k.desc) + '</span></button>';
    }).join("");
  }
  kindsEl.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-kind]");
    if (!btn || state.busy) return;
    var next = btn.getAttribute("data-kind");
    if (next === state.kind) return;
    state.kind = next;
    state.mapping = null;
    state.preview = null;
    renderKinds();
    resetResult();
    if (state.csv || state.file) runPreview();
  });

  tplBtn.addEventListener("click", function () {
    var url = API.url("/api/import/template?kind=" + encodeURIComponent(state.kind));
    fetch(url, { credentials: "same-origin" }).then(function (res) {
      if (res.status === 401) { window.location.href = API.loginUrl; throw new Error("未登录"); }
      if (!res.ok) throw new Error("请求失败（HTTP " + res.status + "）");
      return res.blob();
    }).then(function (blob) {
      var href = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = href;
      a.download = "hourglass-import-" + state.kind + ".csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(href); }, 1500);
    }).catch(function (ex) { toast("模板下载失败：" + (ex.message || "网络异常"), "bad"); });
  });

  /* ---------- 选文件 ---------- */
  pickBtn.addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > MAX_BYTES) {
      toast("文件超过 8MB，请拆分后再导入", "warn");
      return;
    }
    readFile(f).then(function (res) {
      state.csv = res.csv || "";
      state.file = res.file || "";
      state.fileName = f.name;
      state.mapping = null;
      state.preview = null;
      state.done = false;
      fileEl.textContent = f.name + " · " + fmtSize(f.size);
      runPreview();
    }).catch(function (ex) { toast(ex.message || "读取文件失败", "bad"); });
  });

  /* ---------- 预检 ---------- */
  function payload() {
    var out = { kind: state.kind };
    if (state.file) {
      out.file = state.file;
      out.fileName = state.fileName;
    } else {
      out.csv = state.csv;
    }
    if (state.mapping) out.mapping = state.mapping;
    return out;
  }

  function mappingFrom(preview) {
    var map = {};
    preview.fields.forEach(function (f) {
      map[f.key] = preview.mapping && preview.mapping[f.key] ? preview.mapping[f.key] : IGNORE;
    });
    return map;
  }

  function collectMapping() {
    var map = {};
    resultEl.querySelectorAll("select[data-field]").forEach(function (sel) {
      map[sel.getAttribute("data-field")] = sel.value;
    });
    return map;
  }

  function resetResult() {
    resultEl.innerHTML = "";
    state.done = false;
    commitBtn.textContent = "开始导入";
    commitBtn.disabled = true;
    hintEl.textContent = "失败行会附上原因，可下载修正后重新导入。";
  }

  function runPreview() {
    if (state.busy || (!state.csv && !state.file)) return;
    state.busy = true;
    commitBtn.disabled = true;
    hintEl.textContent = "正在预检…";
    resultEl.innerHTML = '<div class="imp-note">正在读取并校验，稍候…</div>';
    API.post("/api/import/preview", payload()).then(function (preview) {
      state.busy = false;
      state.preview = preview;
      state.mapping = mappingFrom(preview);
      renderPreview(preview);
    }).catch(function (ex) {
      state.busy = false;
      state.preview = null;
      state.mapping = null;
      hintEl.textContent = "预检未通过，请检查文件后重试";
      commitBtn.disabled = true;
      resultEl.innerHTML = '<div class="imp-error">' + esc(ex.message || "预检失败") + '</div>';
    });
  }

  function optionHTML(headers, current) {
    var html = '<option value="' + IGNORE + '"' + (!current || current === IGNORE ? " selected" : "") + '>未映射</option>';
    headers.forEach(function (h) {
      if (!h) return;
      html += '<option value="' + esc(h) + '"' + (h === current ? " selected" : "") + '>' + esc(h) + '</option>';
    });
    return html;
  }

  function renderPreview(p) {
    var badRows = (p.rows || []).filter(function (r) { return !r.ok; });
    var mapRows = p.fields.map(function (f) {
      var cur = p.mapping && p.mapping[f.key] ? p.mapping[f.key] : IGNORE;
      return '<label class="imp-map-row"><span>' + esc(f.label) + (f.required ? ' <b class="req">*</b>' : '') + '</span>' +
        '<select data-field="' + esc(f.key) + '" aria-label="' + esc(f.label) + '映射列">' + optionHTML(p.headers, cur) + '</select></label>';
    }).join("");

    var html = '<div class="imp-summary">' +
      '<span class="imp-pill ok">可导入 ' + p.valid + ' 行</span>' +
      (p.invalid ? '<span class="imp-pill bad">需修正 ' + p.invalid + ' 行</span>' : '') +
      '<span class="tiny">文件共 ' + p.total + ' 行' + (p.truncated ? '，明细只展示前 50 行' : '') + '</span>' +
      '</div>';

    if (p.errors && p.errors.length) {
      html += '<div class="imp-error">' + p.errors.map(function (e) { return esc(e); }).join("<br>") + '</div>';
    }

    html += '<div class="imp-map"><div class="imp-map-head"><b>字段映射</b>' +
      '<span class="tiny">左列是沙漏字段，右列选择表格里的列；带 * 为必填。</span></div>' +
      '<div class="imp-map-grid">' + mapRows + '</div>' +
      (p.ignored && p.ignored.length ? '<div class="tiny imp-ignored">未使用的列：' + p.ignored.map(esc).join("、") + '</div>' : '') +
      '</div>';

    if (badRows.length) {
      html += '<div class="imp-table-wrap"><table class="imp-table"><thead><tr><th style="width:64px">行号</th><th>内容</th><th>问题</th></tr></thead><tbody>' +
        badRows.map(function (r) {
          return '<tr><td class="num">' + r.row + '</td><td>' + esc(r.title || "—") + (r.project ? '<span class="tiny"> · ' + esc(r.project) + '</span>' : '') + '</td><td class="bad">' + esc((r.errors || []).join("；")) + '</td></tr>';
        }).join("") + '</tbody></table></div>';
    } else if (p.valid > 0) {
      html += '<div class="imp-note ok">校验通过' + (p.truncated ? '（至少前 50 行）' : '') + '，可以开始导入。</div>';
    }

    resultEl.innerHTML = html;
    state.done = false;
    commitBtn.textContent = p.valid > 0 ? "导入 " + p.valid + " 行" : "开始导入";
    commitBtn.disabled = p.valid <= 0 || (p.errors && p.errors.length > 0);
    hintEl.textContent = p.invalid
      ? "可以直接导入通过校验的行，失败行会单独回执。"
      : "失败行会附上原因，可下载修正后重新导入。";
  }

  resultEl.addEventListener("change", function (e) {
    var sel = e.target.closest("select[data-field]");
    if (!sel || state.busy) return;
    var value = sel.value;
    if (value !== IGNORE) {
      resultEl.querySelectorAll("select[data-field]").forEach(function (other) {
        if (other !== sel && other.value === value) other.value = IGNORE;
      });
    }
    state.mapping = collectMapping();
    runPreview();
  });

  /* ---------- 写入与回执 ---------- */
  function renderReceipt(res) {
    var html = '<div class="imp-summary">' +
      '<span class="imp-pill ok">成功 ' + res.created + ' 行</span>' +
      (res.failed ? '<span class="imp-pill bad">失败 ' + res.failed + ' 行</span>' : '') +
      '<span class="tiny">文件共 ' + res.total + ' 行</span></div>';

    if (res.errors && res.errors.length) {
      html += '<div class="imp-table-wrap"><table class="imp-table"><thead><tr><th style="width:64px">行号</th><th>原因</th></tr></thead><tbody>' +
        res.errors.map(function (e) {
          return '<tr><td class="num">' + e.row + '</td><td class="bad">' + esc(e.message || "写入失败") + '</td></tr>';
        }).join("") + '</tbody></table></div>';
      if (res.failedCsv) {
        html += '<div class="imp-actions"><button class="btn sm" type="button" id="impFailed">下载失败行 CSV</button>' +
          '<span class="tiny">保留原始列，末尾附「错误原因」，修正后可直接重新导入。</span></div>';
      }
    } else {
      html += '<div class="imp-note ok">全部写入成功。</div>';
    }

    resultEl.innerHTML = html;
    var failedBtn = resultEl.querySelector("#impFailed");
    if (failedBtn) {
      failedBtn.addEventListener("click", function () {
        triggerDownload("hourglass-import-" + res.kind + "-failed.csv", res.failedCsv, "text/csv;charset=utf-8");
      });
    }
    hintEl.textContent = res.failed ? "已保留成功行，失败行可修正后单独重导。" : "可以继续导入其他表格。";
    commitBtn.textContent = "完成";
    commitBtn.disabled = false;
  }

  commitBtn.addEventListener("click", function () {
    if (state.done) { close(); return; }
    if (state.busy || !state.preview || commitBtn.disabled) return;
    state.busy = true;
    state.mapping = collectMapping();
    commitBtn.disabled = true;
    commitBtn.textContent = "正在导入…";
    hintEl.textContent = "正在写入，请勿关闭窗口…";
    API.post("/api/import/commit", payload()).then(function (res) {
      state.busy = false;
      state.done = true;
      renderReceipt(res);
      toast("已导入 " + res.created + " 行" + kindLabel(res.kind) + (res.failed ? "，失败 " + res.failed + " 行" : ""),
        res.failed ? "warn" : "fs");
      if (res.created > 0 && typeof opts.onDone === "function") opts.onDone(res);
    }).catch(function (ex) {
      state.busy = false;
      commitBtn.disabled = false;
      commitBtn.textContent = "重试导入";
      hintEl.textContent = "导入未完成，可修正后重试";
      toast("导入失败：" + (ex.message || "网络异常"), "bad");
    });
  });

  renderKinds();
  UI.openModal(layer, "#impPick");
}
