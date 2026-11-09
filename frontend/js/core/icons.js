/* ==========================================================================
   icons.js · 全部内联 SVG 图标（ui-redesign-spec §5）
   规范：一律内联 SVG；viewBox 0 0 20 20；stroke-width 1.5（14–16px）/ 1.6（18–24px）；
        stroke-linecap/linejoin=round；stroke=currentColor；fill=none。
   用法：ICONS.edit(14) → '<svg …>'
   ========================================================================== */

  function svg(size, body, w) {
    size = size || 16;
    var sw = w || (size <= 16 ? 1.5 : 1.6);
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 20 20" fill="none" ' +
      'stroke="currentColor" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' + body + '</svg>';
  }
  function fillSvg(size, body) {
    size = size || 16;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 20 20" fill="currentColor" ' +
      'aria-hidden="true" focusable="false">' + body + '</svg>';
  }

  const ICONS = {
    /* ---- 导航 ---- */
    board: function (s) { return svg(s, '<rect x="3" y="3.6" width="3.8" height="12.8" rx="1.4"/><rect x="8.2" y="3.6" width="3.8" height="8.6" rx="1.4"/><rect x="13.4" y="3.6" width="3.6" height="11" rx="1.4"/>'); },
    list: function (s) { return svg(s, '<path d="M3.6 5.2h12.8M3.6 10h12.8M3.6 14.8h7.2"/>'); },
    calendar: function (s) { return svg(s, '<rect x="3" y="4.4" width="14" height="12.6" rx="2.2"/><path d="M3 8.2h14M6.8 4.4V2.8M13.2 4.4V2.8"/>'); },
    projects: function (s) { return svg(s, '<path d="M3.2 5.4A1.8 1.8 0 0 1 5 3.6h8l4 4v8a1.8 1.8 0 0 1-1.8 1.8H5A1.8 1.8 0 0 1 3.2 15.6Z"/><path d="M12.6 3.6v4.2h4.2"/>'); },
    review: function (s) { return svg(s, '<circle cx="10" cy="10" r="7.2"/><path d="M6.8 10.3 9 12.5l4.4-4.7"/>'); },
    /* 需求池：与导航「需求池」入口同一图标 */
    demand: function (s) { return svg(s, '<path d="M3.4 4.2h13.2v8.4l-3.2 3.2H3.4Z"/><path d="M13.4 15.8v-3.2h3.2"/><path d="M6.6 8h6.8M6.6 11.2h4.4"/>'); },
    stats: function (s) { return svg(s, '<path d="M4.4 16.2V11M10 16.2V4.6M15.6 16.2v-7"/>'); },
    trash: function (s) { return svg(s, '<path d="M3.6 5.6h12.8M8.2 5.6V3.8h3.6v1.8M5.4 5.6l.8 10.2h7.6l.8-10.2"/>'); },
    settings: function (s) { return svg(s, '<path d="M5.2 3.4v3.4M5.2 10.2v6.4M10 3.4v6M10 12.8v3.8M14.8 3.4v8.2M14.8 15v1.6"/><circle cx="5.2" cy="8.4" r="1.9"/><circle cx="10" cy="11" r="1.9"/><circle cx="14.8" cy="13.2" r="1.9"/>'); },
    users: function (s) { return svg(s, '<circle cx="7.4" cy="6.6" r="3"/><path d="M2.8 16.2c0-2.6 2-4.4 4.6-4.4s4.6 1.8 4.6 4.4"/><path d="M13.4 4.1a3 3 0 0 1 0 5.8M15 12.4c1.6.6 2.6 1.9 2.6 3.8"/>'); },
    user: function (s) { return svg(s, '<circle cx="10" cy="6.8" r="3.2"/><path d="M4.6 16.4c0-2.8 2.3-4.8 5.4-4.8s5.4 2 5.4 4.8"/>'); },
    /* git 分支：下面的圆是当前分支，右上角是目标分支，曲线表示即将合并 */
    branch: function (s) { return svg(s, '<circle cx="5.6" cy="4.4" r="1.9"/><circle cx="5.6" cy="15.6" r="1.9"/><circle cx="14.4" cy="6.6" r="1.9"/><path d="M5.6 6.3v7.4"/><path d="M14.4 8.5c0 3.4-2.2 5.4-5.2 5.4H5.6"/>'); },

    /* ---- 富文本编辑器 ---- */
    bold: function (s) { return svg(s, '<path d="M6.4 4.2h4a2.9 2.9 0 0 1 0 5.8h-4z"/><path d="M6.4 10h4.6a3.1 3.1 0 0 1 0 6.2H6.4z"/>'); },
    italic: function (s) { return svg(s, '<path d="M9.4 4.2h4.4M6.2 15.8h4.4M11.8 4.2 8.2 15.8"/>'); },
    underline: function (s) { return svg(s, '<path d="M6.2 3.6v5.6a3.8 3.8 0 0 0 7.6 0V3.6"/><path d="M4.6 16.4h10.8"/>'); },
    strike: function (s) { return svg(s, '<path d="M3.8 10h12.4"/><path d="M7.2 6.4a3.1 3.1 0 0 1 5.9.7c0 .8-.3 1.5-.9 2"/><path d="M12.8 13.1a3.1 3.1 0 0 1-5.9-.7c0-.8.3-1.5.9-2"/>'); },
    listUl: function (s) { return svg(s, '<path d="M7.6 5.6h8.6M7.6 10h8.6M7.6 14.4h8.6"/><path d="M4 5.6h.01M4 10h.01M4 14.4h.01"/>', 1.9); },
    listOl: function (s) { return svg(s, '<path d="M7.6 5.6h8.6M7.6 10h8.6M7.6 14.4h8.6"/><path d="M3.5 4.3h1.1v4.1M3.1 8.4h1.9"/><path d="M3.1 12.3h1.9v1.6H3.1z"/>'); },
    quote: function (s) { return svg(s, '<path d="M8.2 6.4c-1.7 0-2.9 1.3-2.9 3v4.4h3.9V9.4H6.1c0-1 .6-1.6 1.5-1.9z"/><path d="M15 6.4c-1.7 0-2.9 1.3-2.9 3v4.4h3.9V9.4h-3.1c0-1 .6-1.6 1.5-1.9z"/>'); },
    codeBlock: function (s) { return svg(s, '<path d="M7.4 7 4.6 10l2.8 3M12.6 7l2.8 3-2.8 3"/>'); },
    link: function (s) { return svg(s, '<path d="M8.6 11.4a3.2 3.2 0 0 0 4.5 0l1.3-1.3a3.2 3.2 0 0 0-4.5-4.5l-.6.6"/><path d="M11.4 8.6a3.2 3.2 0 0 0-4.5 0l-1.3 1.3a3.2 3.2 0 0 0 4.5 4.5l.6-.6"/>'); },
    hr: function (s) { return svg(s, '<path d="M3.6 10h12.8"/>', 1.9); },
    eraser: function (s) { return svg(s, '<path d="M8.2 14.2 14 8.4a2 2 0 0 1 2.8 2.8L12 16H9.4z"/><path d="M4.4 16.4h11.2"/>'); },
    undo: function (s) { return svg(s, '<path d="M7.2 4.8 4 8l3.2 3.2"/><path d="M4 8h5.6a4.4 4.4 0 0 1 0 8.8H7.8"/>'); },
    redo: function (s) { return svg(s, '<path d="M12.8 4.8 16 8l-3.2 3.2"/><path d="M16 8h-5.6a4.4 4.4 0 0 0 0 8.8h1.8"/>'); },
    rail: function (s) { return svg(s, '<path d="M11.2 5.2 7 10l4.2 4.8"/><path d="M15.4 5.2 11.2 10l4.2 4.8"/>'); },
    expand: function (s) { return svg(s, '<path d="M11.6 3.4h5v5"/><path d="M16.6 3.4 11 9"/><path d="M8.4 16.6h-5v-5"/><path d="M3.4 16.6 9 11"/>'); },
    compress: function (s) { return svg(s, '<path d="M9 3.4v5.2H3.8"/><path d="M9 8.6 3.6 3.2"/><path d="M11 16.6v-5.2h5.2"/><path d="M11 11.4l5.4 5.4"/>'); },

    /* ---- 箭头（需求列表树用） ---- */
    down: function (s) { return svg(s, '<path d="M5 7.8 10 12.8l5-5"/>'); },
    chevronRight: function (s) { return svg(s, '<path d="M7.6 4.6 13 10l-5.4 5.4"/>'); },

    /* ---- 操作 ---- */
    plus: function (s) { return svg(s, '<path d="M10 4.4v11.2M4.4 10h11.2"/>', 1.8); },
    minus: function (s) { return svg(s, '<path d="M4.4 10h11.2"/>', 1.8); },
    search: function (s) { return svg(s, '<circle cx="8.8" cy="8.8" r="5.4"/><path d="M12.9 12.9 17 17"/>'); },
    /* 图片预览：放大镜 + 加减号 */
    zoomIn: function (s) { return svg(s, '<circle cx="8.8" cy="8.8" r="5.4"/><path d="M12.9 12.9 17 17"/><path d="M6.6 8.8h4.4M8.8 6.6v4.4"/>'); },
    zoomOut: function (s) { return svg(s, '<circle cx="8.8" cy="8.8" r="5.4"/><path d="M12.9 12.9 17 17"/><path d="M6.6 8.8h4.4"/>'); },
    /* 旋转 90°：与 refresh 同形的左右两支 */
    rotateLeft: function (s) { return svg(s, '<path d="M3.6 10a6.4 6.4 0 1 0 1.9-4.6"/><path d="M3.4 3.6v4.2h4.2"/>'); },
    rotateRight: function (s) { return svg(s, '<path d="M16.4 10a6.4 6.4 0 1 1-1.9-4.6"/><path d="M16.6 3.6v4.2h-4.2"/>'); },
    filter: function (s) { return svg(s, '<path d="M3.6 6.2h12.8M5.8 10h8.4M8 13.8h4"/>'); },
    sort: function (s) { return svg(s, '<path d="M6 4.4v11.2M6 15.6 3.6 13.2M6 15.6l2.4-2.4M14 15.6V4.4M14 4.4l-2.4 2.4M14 4.4l2.4 2.4"/>'); },
    close: function (s) { return svg(s, '<path d="M3 3l14 14M17 3 3 17"/>', 1.8); },
    edit: function (s) { return svg(s, '<path d="M13.6 3.2l3.2 3.2L7 16.2l-4.2.8.8-4.2Z"/><path d="M12.2 4.6l3.2 3.2"/>'); },
    copy: function (s) { return svg(s, '<rect x="7.2" y="7.2" width="9.4" height="9.4" rx="2.2"/><path d="M12.8 4.2H5.4a2 2 0 0 0-2 2v7.4"/>'); },
    download: function (s) { return svg(s, '<path d="M10 3v9.6M6.2 8.8 10 12.6 13.8 8.8M4.4 15.6h11.2"/>'); },
    upload: function (s) { return svg(s, '<path d="M10 13.6V4M6.2 8.2 10 4.4 13.8 8.2M4.4 15.6h11.2"/>'); },
    extlink: function (s) { return svg(s, '<path d="M11.4 3.6h5v5"/><path d="M16.4 3.6 9.6 10.4"/><path d="M15.6 12.4v3a1.8 1.8 0 0 1-1.8 1.8H5.6a1.8 1.8 0 0 1-1.8-1.8V7.2a1.8 1.8 0 0 1 1.8-1.8h3"/>'); },
    more: function (s) { return fillSvg(s, '<circle cx="4.6" cy="10" r="1.4"/><circle cx="10" cy="10" r="1.4"/><circle cx="15.4" cy="10" r="1.4"/>'); },
    moreV: function (s) { return fillSvg(s, '<circle cx="10" cy="4.6" r="1.4"/><circle cx="10" cy="10" r="1.4"/><circle cx="10" cy="15.4" r="1.4"/>'); },
    check: function (s) { return svg(s, '<path d="M4.4 10.4 8 14l7.6-8"/>', 1.8); },
    refresh: function (s) { return svg(s, '<path d="M16.4 10a6.4 6.4 0 1 1-1.9-4.6"/><path d="M16.6 3.6v4.2h-4.2"/>'); },
    move: function (s) { return svg(s, '<path d="M10 3.4v13.2M3.4 10h13.2"/><path d="M10 3.4 7.8 5.6M10 3.4l2.2 2.2M10 16.6l-2.2-2.2M10 16.6l2.2-2.2M3.4 10l2.2-2.2M3.4 10l2.2 2.2M16.6 10l-2.2-2.2M16.6 10l-2.2 2.2"/>'); },
    folder: function (s) { return svg(s, '<path d="M3.2 6A2 2 0 0 1 5.2 4h3.2l1.8 2.2h5.6a2 2 0 0 1 2 2V14a2 2 0 0 1-2 2H5.2a2 2 0 0 1-2-2Z"/>'); },

    /* ---- 状态 ---- */
    bell: function (s) { return svg(s, '<path d="M10 2.6a5.2 5.2 0 0 0-5.2 5.2c0 3.6-1.4 4.8-1.4 4.8h13.2s-1.4-1.2-1.4-4.8A5.2 5.2 0 0 0 10 2.6Z"/><path d="M8.2 15.4a1.9 1.9 0 0 0 3.6 0"/>'); },
    alert: function (s) { return svg(s, '<path d="M10 3.2 18 16.6H2Z"/><path d="M10 8.2v3.4"/><path d="M10 14.2h.01"/>'); },
    alertCircle: function (s) { return svg(s, '<circle cx="10" cy="10" r="7.6"/><path d="M10 6.2v4.2"/><path d="M10 13.6h.01"/>'); },
    helpCircle: function (s) { return svg(s, '<circle cx="10" cy="10" r="7.6"/><path d="M7.9 7.4a2.2 2.2 0 0 1 4.2.9c0 1.4-2.1 1.6-2.1 2.9"/><path d="M10 14.2h.01"/>'); },
    checkCircle: function (s) { return svg(s, '<circle cx="10" cy="10" r="7.6"/><path d="M6.6 10.3 8.9 12.6l4.5-5"/>'); },
    infoCircle: function (s) { return svg(s, '<circle cx="10" cy="10" r="7.6"/><path d="M10 13.8V9.4"/><path d="M10 6.6h.01"/>'); },
    clock: function (s) { return svg(s, '<circle cx="10" cy="10" r="7.2"/><path d="M10 5.8V10l3 1.8"/>'); },
    recur: function (s) { return svg(s, '<path d="M4.2 8.4A5.8 5.8 0 0 1 15.6 8"/><path d="M15.6 3.8V8h-4.2"/><path d="M15.8 11.6A5.8 5.8 0 0 1 4.4 12"/><path d="M4.4 16.2V12h4.2"/>'); },
    undo: function (s) { return svg(s, '<path d="M7.2 6H12a4.4 4.4 0 1 1 0 8.8H6.4"/><path d="M9.6 3.2 6.4 6l3.2 2.8"/>'); },

    /* ---- 元信息 ---- */
    calSmall: function (s) { return svg(s, '<rect x="3.4" y="4.6" width="13.2" height="12" rx="2.2"/><path d="M3.4 8.4h13.2M6.8 4.6V3M13.2 4.6V3"/>'); },
    checklist: function (s) { return svg(s, '<path d="M3.6 5.6h13M3.6 10h13M3.6 14.4h7.4"/>'); },
    clip: function (s) { return svg(s, '<path d="M12.6 6.4 7.2 11.8a2.2 2.2 0 0 0 3.1 3.1l5.4-5.4a3.8 3.8 0 0 0-5.4-5.4L4.8 9.6a5.4 5.4 0 0 0 7.6 7.6l3.4-3.4"/>'); },
    timer: function (s) { return svg(s, '<circle cx="10" cy="11.4" r="6"/><path d="M10 7.8v3.6l2.4 1.4"/><path d="M7.6 3.4h4.8"/>'); },
    tag: function (s) { return svg(s, '<path d="M3.6 8.6V4.4a.8.8 0 0 1 .8-.8h4.2l7.8 7.8-5 5Z"/><circle cx="6.8" cy="6.8" r="1.1" fill="currentColor" stroke="none"/>'); },
    comment: function (s) { return svg(s, '<path d="M3.6 6.2A2.2 2.2 0 0 1 5.8 4h8.4a2.2 2.2 0 0 1 2.2 2.2v4.6a2.2 2.2 0 0 1-2.2 2.2H8.6L4.9 16.2v-3.2H5.8a2.2 2.2 0 0 1-2.2-2.2Z"/>'); },
    eye: function (s) { return svg(s, '<path d="M2.6 10S5.4 4.8 10 4.8 17.4 10 17.4 10 14.6 15.2 10 15.2 2.6 10 2.6 10Z"/><circle cx="10" cy="10" r="2.4"/>'); },
    /* 电子表格：外框 + 表头分隔 + 行线 */
    table: function (s) { return svg(s, '<rect x="3.4" y="4" width="13.2" height="12" rx="1.6"/><path d="M3.4 7.6h13.2M8.2 7.6v8.4M13 7.6v8.4"/>'); },

    /* ---- 播放 / 暂停 ---- */
    play: function (s) { return fillSvg(s, '<path d="M6.4 4.2 15 10l-8.6 5.8Z"/>'); },
    pause: function (s) { return fillSvg(s, '<rect x="5.4" y="4.4" width="3.4" height="11.2" rx="1"/><rect x="11.2" y="4.4" width="3.4" height="11.2" rx="1"/>'); },

    /* ---- 箭头 ---- */
    left: function (s) { return svg(s, '<path d="M12 4 6 10l6 6"/>', 1.8); },
    right: function (s) { return svg(s, '<path d="M8 4l6 6-6 6"/>', 1.8); },
    up: function (s) { return svg(s, '<path d="M10 15V5M5.6 9.4 10 5l4.4 4.4"/>', 1.8); },
    down: function (s) { return svg(s, '<path d="M10 5v10M5.6 10.6 10 15l4.4-4.4"/>', 1.8); },
    caretDown: function (s) { return svg(s, '<path d="M6 8l4 4 4-4"/>', 1.8); },

    /* ---- 品牌 / 其他 ---- */
    star: function (s) { return svg(s, '<path d="M10 2.4 12.3 7.4l5.3.5-4 3.5 1.2 5.2L10 13.8 5.2 16.6l1.2-5.2-4-3.5 5.3-.5Z"/>'); },
    link: function (s) { return svg(s, '<path d="M8.4 11.6a3.4 3.4 0 0 0 4.8 0l2.6-2.6a3.4 3.4 0 0 0-4.8-4.8L9.8 5.4"/><path d="M11.6 8.4a3.4 3.4 0 0 0-4.8 0L4.2 11a3.4 3.4 0 0 0 4.8 4.8l1.1-1.1"/>'); },
    logout: function (s) { return svg(s, '<path d="M8.2 3.4H5.6a2 2 0 0 0-2 2v9.2a2 2 0 0 0 2 2h2.6"/><path d="M12.6 6.4 16.2 10l-3.6 3.6M16 10H8.4"/>'); },
    grip: function (s) { return fillSvg(s, '<circle cx="7.6" cy="5.4" r="1.2"/><circle cx="12.4" cy="5.4" r="1.2"/><circle cx="7.6" cy="10" r="1.2"/><circle cx="12.4" cy="10" r="1.2"/><circle cx="7.6" cy="14.6" r="1.2"/><circle cx="12.4" cy="14.6" r="1.2"/>'); },
    inbox: function (s) { return svg(s, '<path d="M3.4 11.6 5.6 4.4h8.8l2.2 7.2v3a1.8 1.8 0 0 1-1.8 1.8H5.2a1.8 1.8 0 0 1-1.8-1.8Z"/><path d="M3.4 11.6h4l.9 2h3.4l.9-2h4"/>'); },
    filterOff: function (s) { return svg(s, '<path d="M3.6 6.2h8M13.6 6.2h2.8M5.8 10h3.4M12 10h4.2M8 13.8h4"/><path d="M16.4 3.6 3.6 16.4" stroke-width="1.4"/>'); },
    shield: function (s) { return svg(s, '<path d="M10 2.6 16.4 5v5c0 3.6-2.6 6.4-6.4 7.6C6.2 16.4 3.6 13.6 3.6 10V5Z"/><path d="M7.6 10.2 9.4 12l3.2-3.6"/>'); }
  };

export { ICONS };
export function icon(name, size) {
  return ICONS[name] ? ICONS[name](size) : "";
}
