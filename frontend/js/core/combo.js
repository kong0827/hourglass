/* core/combo.js · 自绘下拉候选
   native <datalist> 的弹层由浏览器绘制，圆角、行高、深色主题都改不了；
   这里保留 <datalist> 作为候选来源（填充逻辑不用动），输入框换成自绘浮层。 */

var comboSeq = 0;

function readOptions(datalist){
  var out = [], seen = Object.create(null);
  Array.prototype.forEach.call(datalist.options || [], function(o){
    var v = String(o.value || o.textContent || "").trim();
    if(!v || seen[v]) return;
    seen[v] = 1; out.push(v);
  });
  return out;
}

export function attachCombo(input, opts){
  if(!input || input.__dsCombo) return null;
  var listId = input.getAttribute("list");
  var datalist = listId ? document.getElementById(listId) : null;
  if(!datalist) return null;
  opts = opts || {};

  input.__dsCombo = true;
  input.removeAttribute("list");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-autocomplete", "list");
  if(opts.chevron) input.classList.add("combo-input");

  var box = document.createElement("div");
  box.className = "combo-options";
  box.id = "comboList" + (++comboSeq);
  box.setAttribute("role", "listbox");
  box.hidden = true;
  input.setAttribute("aria-controls", box.id);
  document.body.appendChild(box);

  var items = [], active = -1, open = false, picking = false;

  function setOpen(v){
    open = !!v;
    box.hidden = !open;
    input.setAttribute("aria-expanded", open ? "true" : "false");
    if(!open){
      active = -1;
      input.removeAttribute("aria-activedescendant");
    }
  }

  function position(){
    var r = input.getBoundingClientRect();
    if(!r.width || !r.height || !document.documentElement.contains(input)){ setOpen(false); return; }
    var vh = window.innerHeight, gap = 4;
    var below = vh - r.bottom - gap - 8, above = r.top - gap - 8;
    box.style.left = r.left + "px";
    box.style.width = r.width + "px";
    if(below < 140 && above > below){
      box.style.top = "auto";
      box.style.bottom = (vh - r.top + gap) + "px";
      box.style.maxHeight = Math.min(240, Math.max(96, above)) + "px";
    } else {
      box.style.bottom = "auto";
      box.style.top = (r.bottom + gap) + "px";
      box.style.maxHeight = Math.min(240, Math.max(96, below)) + "px";
    }
  }

  function highlight(i){
    var nodes = box.querySelectorAll(".combo-opt");
    if(!nodes.length){ active = -1; return; }
    active = Math.max(0, Math.min(nodes.length - 1, i));
    Array.prototype.forEach.call(nodes, function(n, idx){
      n.classList.toggle("is-active", idx === active);
      n.setAttribute("aria-selected", idx === active ? "true" : "false");
    });
    var cur = nodes[active];
    if(cur && cur.scrollIntoView) cur.scrollIntoView({ block:"nearest" });
    input.setAttribute("aria-activedescendant", cur.id);
  }

  function render(){
    if(picking) return;
    var q = input.value.trim().toLowerCase();
    var all = readOptions(datalist);
    items = q ? all.filter(function(v){ return v.toLowerCase().indexOf(q) !== -1; }) : all;
    active = -1;
    input.removeAttribute("aria-activedescendant");
    box.textContent = "";
    if(!items.length){
      if(!q){ setOpen(false); return; }
      var tip = document.createElement("div");
      tip.className = "combo-empty";
      tip.textContent = "没有匹配的候选，回车按当前输入保存";
      box.appendChild(tip);
    } else {
      items.forEach(function(v, i){
        var b = document.createElement("button");
        b.type = "button";
        b.className = "combo-opt";
        b.id = box.id + "-o" + i;
        b.dataset.i = String(i);
        b.setAttribute("role", "option");
        b.setAttribute("aria-selected", "false");
        b.textContent = v;
        box.appendChild(b);
      });
    }
    var r = input.getBoundingClientRect();
    if(!r.width || !r.height || !document.documentElement.contains(input)){ setOpen(false); return; }
    position();
    setOpen(true);
  }

  function pick(i){
    if(!(i >= 0 && i < items.length)) return;
    input.value = items[i];
    setOpen(false);
    picking = true;
    input.dispatchEvent(new Event("input", { bubbles:true }));
    input.dispatchEvent(new Event("change", { bubbles:true }));
    picking = false;
  }

  input.addEventListener("focus", render);
  input.addEventListener("click", function(){ if(!open) render(); });
  input.addEventListener("input", render);
  input.addEventListener("keydown", function(e){
    if(e.isComposing || e.keyCode === 229) return;
    if(e.key === "ArrowDown" || e.key === "ArrowUp"){
      if(!open || !items.length) render();
      if(!open) return;
      e.preventDefault(); e.stopImmediatePropagation();
      highlight(active < 0 ? (e.key === "ArrowDown" ? 0 : items.length - 1) : active + (e.key === "ArrowDown" ? 1 : -1));
    } else if(e.key === "Enter"){
      if(open && active >= 0){
        /* 候选被高亮时回车只做选中，不再触发标签/表单的默认回车行为 */
        e.preventDefault(); e.stopImmediatePropagation();
        pick(active);
      }
    } else if(e.key === "Escape"){
      if(open){ e.preventDefault(); e.stopImmediatePropagation(); setOpen(false); }
    } else if(e.key === "Tab"){
      if(open) setOpen(false);
    }
  });
  box.addEventListener("mousedown", function(e){
    var b = e.target.closest("[data-i]");
    if(!b) return;
    e.preventDefault();
    pick(Number(b.dataset.i));
  });
  document.addEventListener("mousedown", function(e){
    if(!open) return;
    if(e.target === input || box.contains(e.target)) return;
    setOpen(false);
  }, true);
  window.addEventListener("resize", function(){ if(open) position(); });
  window.addEventListener("scroll", function(){ if(open) position(); }, true);

  return {
    refresh: function(){ if(open) render(); },
    close: function(){ setOpen(false); }
  };
}
