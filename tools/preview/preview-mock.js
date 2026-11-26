/* 静态预览稿的演示数据（docs/preview/ui-preview.html 专用，不连后端）
   改这里就能改预览稿里看到的内容。 */
(function () {
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function shift(n) { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return iso(d); }
  function ts(n, hh, mm) {
    var d = new Date(); d.setDate(d.getDate() + n);
    return iso(d) + "T" + pad(hh || 9) + ":" + pad(mm || 0) + ":00";
  }
  var NOW = new Date(), Y = NOW.getFullYear(), M = NOW.getMonth() + 1;
  function dayIn(d) { return Y + "-" + pad(M) + "-" + pad(d); }

  function T(o) {
    return Object.assign({
      id: "K0", title: "任务", description: "", priority: "P2", category: "后端", owner: "我",
      ownerUserId: "U1", boardColumn: "backlog", startDate: null, dueDate: null, reqId: null, reqDocId: null,
      progress: 0, note: "", recurType: "", remindAt: null, remindTarget: "owner", tags: [],
      estimateMinutes: null,
      subtaskTotal: 0, subtaskDone: 0, totalMinutes: 0, attachmentCount: 0,
      blocked: false, blockedReason: null, blockedByTaskId: null, isMilestone: false,
      workspaceId: "W1", sortOrder: 0, deletedAt: null,
      createdAt: ts(-12, 10, 0), updatedAt: ts(-1, 16, 0)
    }, o || {});
  }

  /* 待处理列故意塞 8 条：演示"列内滚动"而不是把卡片压扁 */
  var backlogTitles = [
    "流程引擎-流程自动节点接入扩展",
    "流程引擎-流程引擎自动节点设计",
    "oa待办推送标题超80字节推送失败问题修复",
    "oa推送待办记录表页面查询功能开发",
    "oa推送待办记录表页面查询页面对接oa支持关闭待办",
    "oa推送待办记录表页面查询页面对接oa支持失败待办重发",
    "月度对账任务调度补数",
    "归档任务异常重试机制"
  ];
  var backlog = backlogTitles.map(function (title, i) {
    return T({
      id: "B" + (i + 1), title: title, priority: "P0", boardColumn: "backlog",
      dueDate: shift(i % 3 === 0 ? -1 : i), tags: ["工作"],
      blocked: i < 2, blockedReason: i < 2 ? "等对方接口" : null,
      totalMinutes: i === 0 ? 401 : 0
    });
  });

  var doing = [
    T({ id: "K1", title: "重构权限校验中间件", priority: "P0", boardColumn: "doing", progress: 60, reqId: "R1", reqDocId: "D1",
        branchId: "BR1", startDate: shift(-3), dueDate: shift(2), tags: ["权限"], subtaskTotal: 4, subtaskDone: 2,
        totalMinutes: 520, estimateMinutes: 480,
        testOwner: "李雷", testOwnerUserId: "U3", testRequestedAt: ts(-2, 10, 0), testStartedAt: ts(-1, 14, 0) }),
    T({ id: "K2", title: "导出 CSV 补工时列", priority: "P1", boardColumn: "doing", progress: 0,
        branchId: "BR2", startDate: shift(-1), dueDate: shift(4), blocked: true, blockedReason: "等确认工时口径",
        blockedByTaskId: "B1", totalMinutes: 200, estimateMinutes: 240 })
  ];
  var done = [
    T({ id: "K7", title: "登录重构与验证码", priority: "P2", boardColumn: "done", progress: 100,
        completedAt: shift(-1), dueDate: shift(-1), totalMinutes: 480 }),
    T({ id: "K8", title: "代理登录权限修正", priority: "P2", boardColumn: "done", progress: 100,
        completedAt: shift(-2), totalMinutes: 150 }),
    /* 故意让这条没有完成时间：演示"完成明细不会再整块消失" */
    T({ id: "K9", title: "历史任务（完成时间缺失）", priority: "P3", boardColumn: "done", progress: 100,
        completedAt: null })
  ];
  /* 甘特图演示任务：跨月、阻塞+逾期、仅截止、仅开始、不同负责人/项目，方便看筛选、分组和状态 */
  backlog.push(
    T({ id: "G3", title: "通知中心改造（仅截止）", priority: "P2", boardColumn: "backlog", progress: 0,
        owner: "陈工", ownerUserId: "U2", reqId: null, dueDate: shift(3) }),
    T({ id: "G5", title: "接口压测准备（仅开始）", priority: "P2", boardColumn: "backlog", progress: 20,
        owner: "我", reqId: "R1", startDate: shift(-2) }),
    T({ id: "G7", title: "里程碑：一期上线", priority: "P0", boardColumn: "backlog", progress: 0,
        startDate: shift(8), dueDate: shift(8), isMilestone: true, owner: "我", reqId: "R1" }),
    T({ id: "G6", title: "补充通知模板（未排期）", priority: "P3", boardColumn: "backlog", progress: 0,
        owner: "我", reqId: "R1" })
  );
  doing.push(
    T({ id: "G1", title: "结算批处理拆分（跨月）", priority: "P0", boardColumn: "doing", progress: 30,
        owner: "陈工", ownerUserId: "U2", reqId: "R2", startDate: shift(-20), dueDate: shift(12),
        estimateMinutes: 1200, totalMinutes: 300 }),
    T({ id: "G2", title: "对账差异回溯（阻塞+逾期）", priority: "P1", boardColumn: "doing", progress: 45,
        owner: "李雷", ownerUserId: "U3", reqId: "R2", startDate: shift(-6), dueDate: shift(-2),
        blocked: true, blockedReason: "等上游数据", blockedByTaskId: "G1" })
  );

  var tasks = backlog.concat(doing, done);
  /* 演示发布事实：每三条一条生产生效、一条人工补录，供各列表的发布徽标与筛选看效果 */
  tasks.forEach(function (t, i) {
    if (i % 3 === 0) { t.publicationState = "effective"; t.everPublished = true; t.publishedAt = shift(-2); t.publicationTargets = ["prod"]; }
    else if (i % 3 === 1) { t.manualPublished = true; t.manualPublishedAt = shift(-9); }
  });

  /* ---------------- 成员负载（名册 + 成员工作台） ---------------- */
  var workload = (function () {
    var base = new Date(); base.setHours(0, 0, 0, 0);
    var monday = new Date(base); monday.setDate(base.getDate() - ((base.getDay() + 6) % 7));
    var lastMonday = new Date(monday); lastMonday.setDate(monday.getDate() - 7);
    var todayIdx = (base.getDay() + 6) % 7;
    function reqName(id) { return id === "R1" ? "流程引擎" : (id === "R2" ? "结算改造" : null); }
    function taskOf(t) {
      return { id: t.id, title: t.title, priority: t.priority, boardColumn: t.boardColumn,
        processingRule: t.boardColumn === "backlog" ? "backlog" : "normal",
        dueDate: t.dueDate, reqId: t.reqId, reqName: reqName(t.reqId),
        estimateMinutes: t.estimateMinutes, totalMinutes: t.totalMinutes || 0,
        blocked: !!t.blocked, itemType: t.isMilestone ? "milestone" : "task", updatedAt: t.updatedAt };
    }
    var openTasks = tasks.filter(function (t) { return t.boardColumn !== "done"; });
    function ownedBy(uid) { return openTasks.filter(function (t) { return t.ownerUserId === uid; }); }
    function dayMinutes(pairs) {
      var out = [0, 0, 0, 0, 0, 0, 0];
      pairs.forEach(function (p) { out[p[0]] = p[1]; });
      return out;
    }
    function log(date, taskId, title, reqId, minutes, origin) {
      return { date: date, taskId: taskId, title: title, reqId: reqId, reqName: reqName(reqId),
        minutes: minutes, origin: origin || "timer" };
    }
    var lastLogDate = iso(new Date(lastMonday.getTime() + 2 * 86400000));
    var members = [
      { key: "U1", name: "我", companyName: "北京总部", jobTitle: "后端开发", roleTitles: ["后端开发"], secondaryRoleTitles: ["技术负责人"],
        remainingMinutes: 3600, workdays: 5, capacityMinutes: 2400, loadPct: 150, overloaded: true,
        weekMinutes: 390, lastWeekMinutes: 300,
        dayMinutes: dayMinutes(todayIdx > 0 ? [[todayIdx - 1, 210], [todayIdx, 180]] : [[todayIdx, 390]]),
        projects: [
          { reqId: "R1", name: "流程引擎", remainingMinutes: 1800, taskCount: 4, roleTitles: ["后端开发"] },
          { reqId: "", name: "未归类", remainingMinutes: 1800, taskCount: 9, roleTitles: ["后端开发"] }
        ],
        tasks: ownedBy("U1").map(taskOf),
        weekLogs: [
          log(todayIdx > 0 ? iso(new Date(monday.getTime() + (todayIdx - 1) * 86400000)) : shift(0), "K1", "重构权限校验中间件", "R1", 210),
          log(shift(0), "K1", "重构权限校验中间件", "R1", 180)
        ],
        lastWeekLogs: [log(lastLogDate, "K2", "导出 CSV 补工时列", null, 300)] },
      { key: "U2", name: "陈工", companyName: "北京总部", jobTitle: "后端开发", roleTitles: ["后端开发"], secondaryRoleTitles: [],
        remainingMinutes: 1140, workdays: 5, capacityMinutes: 2400, loadPct: 48, overloaded: false,
        weekMinutes: 240, lastWeekMinutes: 420,
        dayMinutes: dayMinutes([[Math.max(0, todayIdx - 1), 240]]),
        projects: [
          { reqId: "R2", name: "结算改造", remainingMinutes: 900, taskCount: 1, roleTitles: ["后端开发"] },
          { reqId: "", name: "未归类", remainingMinutes: 240, taskCount: 1, roleTitles: ["后端开发"] }
        ],
        tasks: ownedBy("U2").map(taskOf),
        weekLogs: [log(shift(0), "G1", "结算批处理拆分（跨月）", "R2", 240)],
        lastWeekLogs: [log(lastLogDate, "G1", "结算批处理拆分（跨月）", "R2", 420)] },
      { key: "U3", name: "李雷", companyName: "上海研发", jobTitle: "测试", roleTitles: ["测试"], secondaryRoleTitles: ["质量保障"],
        remainingMinutes: 600, workdays: 3, capacityMinutes: 1440, loadPct: 42, overloaded: false,
        weekMinutes: 150, lastWeekMinutes: 90,
        dayMinutes: dayMinutes([[todayIdx, 150]]),
        projects: [{ reqId: "R2", name: "结算改造", remainingMinutes: 600, taskCount: 1, roleTitles: ["测试"] }],
        tasks: ownedBy("U3").map(taskOf),
        weekLogs: [log(shift(0), "G2", "对账差异回溯（阻塞+逾期）", "R2", 150)],
        lastWeekLogs: [] },
      { key: "U4", name: "王芳", companyName: "上海研发", jobTitle: "产品经理", roleTitles: ["产品经理"], secondaryRoleTitles: [],
        remainingMinutes: 0, workdays: 0, capacityMinutes: 0, loadPct: 0, overloaded: false,
        weekMinutes: 210, lastWeekMinutes: 180,
        dayMinutes: dayMinutes(todayIdx > 0 ? [[todayIdx - 1, 120], [todayIdx, 90]] : [[todayIdx, 210]]),
        projects: [{ reqId: "R1", name: "流程引擎", remainingMinutes: 0, taskCount: 0, roleTitles: ["产品经理"] }],
        tasks: [],
        weekLogs: [
          log(todayIdx > 0 ? iso(new Date(monday.getTime() + (todayIdx - 1) * 86400000)) : shift(0), null, "权限矩阵接口联调", "R1", 120, "manual"),
          log(shift(0), null, "权限矩阵接口联调", "R1", 90, "manual")
        ],
        lastWeekLogs: [log(lastLogDate, null, "需求澄清会", "R1", 180)] }
    ];
    return {
      today: shift(0), capacityMinutesPerDay: 480, workdays: 5,
      weekStart: iso(monday), lastWeekStart: iso(lastMonday),
      projects: [{ id: "R1", name: "流程引擎" }, { id: "R2", name: "结算改造" }],
      members: members,
      filterOptions: { roleTitles: ["后端开发", "测试", "产品经理"], companyNames: ["北京总部", "上海研发"] },
      scope: { reqId: "", roleTitle: "", companyName: "" }
    };
  })();

  /* /api/tasks/list 的筛选在预览里也照做：筛选/分组/清除的界面效果才可验证 */
  function mockTaskList(url) {
    var p = new URLSearchParams(url.split("?")[1] || "");
    function list(name) { var v = p.get(name); return v ? v.split(",") : []; }
    var owners = list("owners"), pris = list("pris"), cats = list("cats"),
        reqs = list("reqs"), tags = list("tags");
    var kw = p.get("q") || "", due = p.get("due");
    var blockedOnly = p.get("blocked") === "true";
    var noDue = p.get("noDue") === "true";
    var pubState = p.get("pubState") || "";
    function published(t) {
      return !!(t.publishedAt || t.everPublished === true || t.manualPublished === true
        || (t.publicationState && t.publicationState !== "unpublished"));
    }
    var todayIso = shift(0);
    var items = tasks.filter(function (t) {
      /* 终态「已取消」不进口径默认列表：与生产一致，只在已取消入口里看 */
      if (t.boardColumn === "canceled") return false;
      if (kw && (t.title || "").indexOf(kw) === -1 && (t.description || "").indexOf(kw) === -1) return false;
      if (owners.length && owners.indexOf(t.owner) === -1) return false;
      if (pris.length && pris.indexOf(t.priority) === -1) return false;
      if (cats.length && cats.indexOf(t.category) === -1) return false;
      if (reqs.length && reqs.indexOf(t.reqId) === -1) return false;
      if (tags.length && !(t.tags || []).some(function (x) { return tags.indexOf(x) !== -1; })) return false;
      if (noDue && t.dueDate) return false;
      if (blockedOnly && !t.blocked) return false;
      if (pubState === "published" && !published(t)) return false;
      if (pubState === "unpublished" && published(t)) return false;
      if (due === "over" && !(t.dueDate && t.dueDate < todayIso && t.boardColumn !== "done")) return false;
      if (due === "today" && t.dueDate !== todayIso) return false;
      if (due === "soon") {
        var d = t.dueDate ? new Date(t.dueDate + "T00:00:00") : null;
        var diff = d ? Math.round((d - new Date(todayIso + "T00:00:00")) / 86400000) : -1;
        if (diff < 0 || diff > 3) return false;
      }
      return true;
    });
    return { items: items, total: items.length };
  }

  /* 已取消分页：原因筛选、总数与计数随恢复 / 取消动作实时变化，保证预览里的 chip 真的会筛 */
  function canceledRoute(u) {
    var p = new URLSearchParams(u.split("?")[1] || "");
    var reason = p.get("reason") || "";
    var offset = Number(p.get("offset") || 0);
    var limit = Number(p.get("limit") || 100);
    var all = routes["/api/tasks/canceled"].items;
    var counts = {};
    all.forEach(function (t) { var k = t.cancelReason || ""; counts[k] = (counts[k] || 0) + 1; });
    var matched = reason ? all.filter(function (t) { return (t.cancelReason || "") === reason; }) : all;
    var page = matched.slice(offset, offset + limit);
    return {
      items: page,
      total: all.length,
      matched: matched.length,
      hasMore: offset + page.length < matched.length,
      reasons: Object.keys(counts).sort().map(function (k) { return { name: k, count: counts[k] }; })
    };
  }
  function mockUncancel(taskId) {
    var bucket = routes["/api/tasks/canceled"].items;
    for (var i = 0; i < bucket.length; i++) {
      if (bucket[i].id !== taskId) continue;
      var t = bucket.splice(i, 1)[0];
      var to = t.cancelFrom || "backlog";
      /* 预览看板只有三列：取消前列不在其中时按待处理回填，保证回看板能看到 */
      if (to !== "doing" && to !== "done") to = "backlog";
      t.boardColumn = to;
      t.cancelFrom = null;
      t.cancelReason = null;
      t.canceledAt = null;
      (to === "doing" ? doing : (to === "done" ? done : backlog)).push(t);
      var col = board.columns[to];
      if (col) {
        col.total = (col.total || 0) + 1;
        col.matched = (col.matched || 0) + 1;
        col.allTotal = (col.allTotal || 0) + 1;
      }
      tasks.push(t);
      board.counts.canceled = bucket.length;
      return { task: t, from: "canceled", to: to };
    }
    return {};
  }
  function mockCancel(taskId, body) {
    var cols = [backlog, doing, done];
    for (var c = 0; c < cols.length; c++) {
      var arr = cols[c];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id !== taskId) continue;
        var t = arr.splice(i, 1)[0];
        var from = t.boardColumn || "backlog";
        t.cancelFrom = from;
        t.cancelReason = (body && body.reason) || "not_do";
        t.canceledAt = ts(0, 12, 0);
        t.boardColumn = "canceled";
        routes["/api/tasks/canceled"].items.unshift(t);
        var data = board.columns[from] || board.columns.backlog;
        if (data) {
          data.total = Math.max(0, (data.total || 0) - 1);
          data.matched = Math.max(0, (data.matched || 0) - 1);
          data.allTotal = Math.max(0, (data.allTotal || 0) - 1);
        }
        board.counts.canceled = routes["/api/tasks/canceled"].items.length;
        return { task: t, from: from, to: "canceled" };
      }
    }
    return {};
  }

  /* ---------------- 分支（空间级分支池） ---------------- */
  var branches = [
    { id: "BR1", workspaceId: "W1", name: "feature/permission-middleware", status: "dev",
      owner: "我", ownerUserId: "U1", targetBranch: "main", note: "权限校验中间件改造，等测试环境排队",
      devAt: ts(-3, 10, 0), testAt: null, mergeAt: null, releasedAt: null,
      taskCount: 3, doneCount: 1, createdAt: ts(-3, 10, 0), updatedAt: ts(-1, 17, 20) },
    { id: "BR2", workspaceId: "W1", name: "feature/export-csv-hours", status: "testing",
      owner: "我", ownerUserId: "U1", targetBranch: "main", note: "导出补工时列，提测中",
      devAt: ts(-7, 9, 30), testAt: ts(-2, 15, 0), mergeAt: null, releasedAt: null,
      taskCount: 2, doneCount: 1, createdAt: ts(-7, 9, 30), updatedAt: ts(-2, 15, 0) },
    { id: "BR3", workspaceId: "W1", name: "hotfix/oa-push-oversize", status: "merging",
      owner: "我", ownerUserId: "U1", targetBranch: "release/1.2", note: "OA 待办标题超 80 字节被拒，等合并窗口",
      devAt: ts(-4, 11, 0), testAt: ts(-3, 16, 0), mergeAt: ts(-1, 9, 40), releasedAt: null,
      taskCount: 1, doneCount: 1, createdAt: ts(-4, 11, 0), updatedAt: ts(-1, 9, 40) },
    { id: "BR4", workspaceId: "W1", name: "feature/recur-task", status: "released",
      owner: "我", ownerUserId: "U1", targetBranch: "main", note: "循环任务",
      devAt: ts(-16, 9, 0), testAt: ts(-12, 14, 0), mergeAt: ts(-10, 10, 0), releasedAt: ts(-8, 18, 30),
      taskCount: 4, doneCount: 4, createdAt: ts(-16, 9, 0), updatedAt: ts(-8, 18, 30) }
  ];
  var branchLogs = {
    BR1: [
      { id: "L3", action: "status", fromStatus: "dev", toStatus: "dev", detail: "开发中 → 待测试 被退回：联调环境没权限", actorName: "我", createdAt: ts(-3, 18, 0) },
      { id: "L2", action: "update", fromStatus: "dev", toStatus: "dev", detail: "目标分支 （空） → main", actorName: "我", createdAt: ts(-3, 11, 20) },
      { id: "L1", action: "create", fromStatus: null, toStatus: "dev", detail: "创建分支（初始状态：开发中）", actorName: "我", createdAt: ts(-3, 10, 0) }
    ],
    BR3: [
      { id: "L5", action: "status", fromStatus: "testing", toStatus: "merging", detail: "待测试 → 待合并：测试通过，等周四合并窗口", actorName: "我", createdAt: ts(-1, 9, 40) },
      { id: "L4", action: "status", fromStatus: "dev", toStatus: "testing", detail: "开发中 → 待测试", actorName: "我", createdAt: ts(-3, 16, 0) }
    ]
  };


  var board = {
    columns: {
      backlog: { items: backlog, total: backlog.length, matched: backlog.length, allTotal: backlog.length, hasMore: false },
      doing: { items: doing, total: doing.length, matched: doing.length, allTotal: doing.length, hasMore: false },
      done: { items: done, total: done.length, matched: done.length, allTotal: done.length, hasMore: false }
    },
    columnDefs: [
      { id: "backlog", name: "待处理", color: "#c08a3e", done: false },
      { id: "doing", name: "进行中", color: "#5b83ad", done: false },
      { id: "done", name: "已完成", color: "#5f7a4a", done: true }
    ],
    counts: { over: 3, today: 1, soon: 4, canceled: 2 },
    meta: {
      owners: [{ name: "我", count: 12 }, { name: "陈工", count: 1 }],
      testOwners: [{ name: "李雷", count: 1 }],
      testOwnerUnassigned: 2,
      pris: [{ name: "P0", count: 10 }, { name: "P1", count: 1 }, { name: "P2", count: 2 }, { name: "P3", count: 1 }],
      cats: [{ name: "后端", count: 9 }, { name: "工作", count: 8 }],
      tags: [{ name: "工作", count: 8 }, { name: "权限", count: 1 }],
      reqs: [{ id: "R1", name: "流程引擎", count: 2 }]
    }
  };

  var review = {
    weekOffset: 0, weekStart: shift(-6), weekEnd: shift(0), label: "本周",
    completed: done,
    stats: { done: 3, withDue: 2, onTime: 2, onTimeRate: 100, members: 1, late: 0 },
    members: [{ name: "我", count: 3, minutes: 630 }],
    /* 进行中：一条进度 60、一条进度 0（都因为"在进行中列"而出现） */
    progressTasks: doing,
    reqDist: [{ id: "R1", name: "流程引擎", status: "active", progressPct: 62, taskCount: 4, doneCount: 2 }],
    pendingDone: [],
    counts: { over: 3, today: 1, soon: 4 },
    /* 个人口径只回传「我的」工时；space / spaceWeek 不再在页面展示 */
    workMinutes: { mine: 1255, mineWeek: 705 },
    openP0: 10, doing: 2, backlog: 8
  };

  /** 按 weekOffset 造一份回顾数据：翻周要看得出差别，否则测不出「AI 周报跟着周走」 */
  function reviewAt(off) {
    var o = (typeof off === "number" && !isNaN(off)) ? off : 0;
    var out = {};
    for (var k in review) if (Object.prototype.hasOwnProperty.call(review, k)) out[k] = review[k];
    out.weekOffset = o;
    out.label = o === 0 ? "本周" : (o === -1 ? "上周" : "该周期");
    out.weekStart = shift(-6 + o * 7);
    out.weekEnd = shift(o * 7);
    if (o !== 0) {
      out.completed = done.slice(0, 2);
      out.stats = { done: 2, withDue: 1, onTime: 1, onTimeRate: 100, members: 1, late: 0 };
      out.members = [{ name: "我", count: 2, minutes: 420 }];
      out.pendingDone = [];
      out.openP0 = 8;
      /* 历史周的工时跟着周走，否则工时卡与下钻明细对不上 */
      out.workMinutes = { mine: 1255, mineWeek: 420 };
    }
    return out;
  }

  var calTasks = [
    T({ id: "K11", title: "月度对账（跨天示例）", priority: "P1", boardColumn: "doing", progress: 45,
        startDate: dayIn(5), dueDate: dayIn(9) }),
    T({ id: "K12", title: "权限中间件（持续进行）", priority: "P0", boardColumn: "doing", progress: 60,
        startDate: dayIn(12), dueDate: shift(0) }),
    T({ id: "K13", title: "只在截止日出现", priority: "P2", boardColumn: "backlog", dueDate: dayIn(22) }),
    /* 提前完成示例：本月 1 号开始、月底截止，但昨天就做完了 → 日历只铺到昨天，后面的日子不再出现 */
    T({ id: "K14", title: "提前完成（只铺到完成日）", priority: "P1", boardColumn: "done", progress: 100,
        startDate: dayIn(1), dueDate: dayIn(28), completedAt: shift(-1) })
  ];

  /* 需求：挂在项目下（演示 2 份，列表用摘要、详情带正文） */
  var reqDocs = [
    { id: "D1", reqId: "R1", reqName: "流程引擎", title: "权限校验需求", status: "active",
      owner: "我", excerpt: "统一入口校验：先鉴权再进业务，覆盖角色与数据权限",
      taskCount: 3, doneCount: 1, createdAt: ts(-6, 10, 20), updatedAt: ts(-1, 17, 20),
      format: "html", docType: "requirement", parentId: null, publishedAt: ts(-6, 11, 0),
      content: '<h1>一、背景与目标</h1>' +
        '<h2>1.1 现状与问题</h2>' +
        '<p>所有对外接口各自判断权限，<b>先鉴权再进业务</b>的约定只写在文档里，实际有不少接口漏判。</p>' +
        '<ul><li>角色权限（菜单 / 操作）散落在各 Controller</li><li>数据权限按空间隔离，靠各 service 自觉</li></ul>' +
        '<h2>1.2 目标</h2>' +
        '<ol><li>未登录请求返回 401</li><li>越权访问返回 403 并记日志</li></ol>' +
        '<h1>二、方案</h1>' +
        '<h2>2.1 统一入口</h2>' +
        '<p>在网关层统一做一次鉴权，业务侧只取上下文里的身份。</p>' +
        '<h3>2.1.1 放行清单</h3>' +
        '<p>登录、健康检查、回调类接口走白名单，白名单单独维护在配置中心。</p>' +
        '<h2>2.2 角色矩阵</h2>' +
        '<table><thead><tr><th>角色</th><th>菜单</th><th>数据范围</th></tr></thead>' +
        '<tbody><tr><td>管理员</td><td>全部</td><td>全部空间</td></tr>' +
        '<tr><td>成员</td><td>看板 / 需求 / 报表</td><td>本空间</td></tr></tbody></table>' +
        '<h1>三、上线步骤</h1>' +
        '<h2>3.1 配置</h2><p>先把白名单配好，再打开开关。</p>' +
        '<h2>3.2 回滚</h2><p>开关关掉即回到旧逻辑，无需回滚代码。</p>' +
        '<blockquote>注意：系统接口放行清单要单独维护。</blockquote>' },
    { id: "D3", reqId: "R2", reqName: "结算改造", title: "日终批处理拆分", status: "active",
      owner: "我", excerpt: "把跑批拆成三个阶段，失败可单段重跑",
      taskCount: 2, doneCount: 0, createdAt: ts(-4, 9, 30), updatedAt: ts(-1, 11, 0),
      format: "html", docType: "solution", parentId: null, publishedAt: ts(-4, 10, 0),
      content: '<h1>目标</h1><p>把日终跑批拆成"取数 / 核对 / 落账"三段。</p>' +
        '<h2>拆分后的好处</h2><ul><li>某一段失败可以只重跑那一段</li><li>取数阶段能提前开始</li></ul>' },
    { id: "D4", reqId: "R2", reqName: "结算改造", title: "对账差异回溯", status: "draft",
      owner: "陈工", excerpt: null, taskCount: 0, doneCount: 0,
      createdAt: ts(-3, 14, 10), updatedAt: ts(-3, 14, 10),
      format: "markdown", docType: "other", parentId: "D3", publishedAt: null,
      content: "## 待补充\n\n- 差异明细怎么存档\n- 保留多久\n\n```sql\nselect batch_no, diff_type, count(*)\n  from recon_diff\n where batch_no = '20261125'\n group by batch_no, diff_type;\n```\n" },

    { id: "D2", reqId: "R1", reqName: "流程引擎", title: "对账落库需求", status: "done",
      owner: "我", excerpt: "异常明细单独建表，附原流水号便于回溯",
      taskCount: 0, doneCount: 0, createdAt: ts(-5, 15, 0), updatedAt: ts(-2, 18, 0),
      format: "html", docType: "requirement", parentId: "D1", publishedAt: ts(-5, 16, 0),
      content: '<h1>背景</h1><p>对账失败的单子目前只在日志里，查起来很痛苦。</p>' +
        '<h2>做法</h2><ul><li>异常明细单独建表</li><li>保留原流水号与失败原因</li></ul>' }
  ];

  /* 文档评论：角标与列表同源，避免出现「角标 3 条、列表为空」的错位 */
  var docComments = {
    D1: [
      { id: 1, userName: "李娜", createdAt: ts(-1, 16, 40), resolved: false,
        quoteText: "先鉴权再进业务", content: "这里的白名单要不要按环境区分？", deletable: false },
      { id: 2, userName: "王浩", createdAt: ts(-1, 18, 5), resolved: false,
        quoteText: "", content: "建议补一条越权访问的日志字段说明。", deletable: false },
      { id: 3, userName: "我", createdAt: ts(0, 9, 12), resolved: true,
        quoteText: "系统接口放行清单要单独维护", content: "放行清单已经加进配置中心，等下周验收。", deletable: true }
    ],
    D2: [
      { id: 4, userName: "陈工", createdAt: ts(-2, 10, 30), resolved: false,
        quoteText: "", content: "异常明细表要加索引吗？", deletable: false }
    ]
  };

  /* 文档最近动态：按天倒序，覆盖创建/更新/状态流转/发布几类操作 */
  var docActivities = [
    { id: 1, docId: "D1", docTitle: "权限校验需求", reqId: "R1", actorName: "我",
      action: "update", detail: "状态：进行中 → 已完成", createdAt: ts(0, 10, 12) },
    { id: 2, docId: "D4", docTitle: "对账差异回溯", reqId: "R2", actorName: "陈工",
      action: "create", detail: "创建了文档「对账差异回溯」", createdAt: ts(0, 9, 2) },
    { id: 3, docId: "D1", docTitle: "权限校验需求", reqId: "R1", actorName: "我",
      action: "update", detail: "更新了正文", createdAt: ts(-1, 17, 20) },
    { id: 4, docId: "D2", docTitle: "对账落库需求", reqId: "R1", actorName: "我",
      action: "update", detail: "状态：草稿 → 已完成", createdAt: ts(-2, 18, 0) },
    { id: 5, docId: "D1", docTitle: "权限校验需求", reqId: "R1", actorName: "我",
      action: "update", detail: "发布了文档「权限校验需求」，成员可见", createdAt: ts(-6, 11, 0) },
    { id: 6, docId: "D3", docTitle: "日终批处理拆分", reqId: "R2", actorName: "我",
      action: "create", detail: "创建了文档「日终批处理拆分」", createdAt: ts(-4, 9, 30) }
  ];

  /* 任务清单：任务完成快照（月度统计） */
  var completions = [
    { id: 4, workspaceId: "W1", taskId: "K7", title: "登录重构与验证码", description: "统一验证码与登录态，去掉重复的 token 刷新",
      reqId: "R1", reqName: "流程引擎", reqDocId: "D1", reqDocTitle: "权限校验需求",
      owner: "我", ownerUserId: "U1", category: "后端", priority: "P2",
      startDate: shift(-9), completedAt: shift(-1), firstStartedAt: ts(-9, 9, 10), lastEndedAt: ts(-1, 17, 30),
      totalMinutes: 480, createdAt: ts(-1, 17, 31),
      publicationState: "effective", everPublished: true, publishedAt: shift(-1), publicationTargets: ["prod"] },
    { id: 3, workspaceId: "W1", taskId: "K8", title: "代理登录权限修正", description: "代理人登录后菜单权限未刷新",
      reqId: null, reqName: null, owner: "陈工", ownerUserId: "U2", category: "后端", priority: "P1",
      startDate: shift(-6), completedAt: shift(-3), firstStartedAt: ts(-6, 14, 0), lastEndedAt: ts(-3, 11, 20),
      totalMinutes: 205, createdAt: ts(-3, 11, 21),
      manualPublished: true, manualPublishedAt: shift(-2) },
    { id: 2, workspaceId: "W1", taskId: "K15", title: "归档脚本重试机制", description: "失败批次隔 5 分钟重试，最多 3 次",
      reqId: "R1", reqName: "流程引擎", owner: "我", ownerUserId: "U1", category: "后端", priority: "P2",
      startDate: shift(-12), completedAt: shift(-7), firstStartedAt: null, lastEndedAt: null,
      totalMinutes: 0, createdAt: ts(-7, 18, 0),
      publicationState: "rolled_back", everPublished: true },
    { id: 1, workspaceId: "W1", taskId: "K16", title: "对账异常明细落库", description: "异常明细单独建表，附原流水号",
      reqId: "R1", reqName: "流程引擎", owner: "我", ownerUserId: "U1", category: "后端", priority: "P0",
      startDate: shift(-20), completedAt: shift(-14), firstStartedAt: ts(-20, 9, 0), lastEndedAt: ts(-14, 16, 40),
      totalMinutes: 900, createdAt: ts(-14, 16, 41) }
  ];

  var ws = {
    id: "W1", name: "我的看板", type: "personal", myRole: "owner", memberCount: 1, ownerId: "U1",
    notifyWebhook: null, notifyChannel: "webhook", notifyEnabled: true, notifyLastStatus: "success"
  };

  /* 版本页演示数据：进行中 1 个、计划中 1 个、已发布 4 个，够看焦点卡、分组折叠与阶段汇总 */
  function pv(id, name, status, startDate, targetDate, tasks, done, demands, est, act, dev, test, releasedAt) {
    return { id: id, reqId: "R1", name: name, status: status, startDate: startDate, targetDate: targetDate,
      taskCount: tasks, doneCount: done, demandCount: demands,
      estimateMinutes: est, workMinutes: act, devMinutes: dev, testMinutes: test,
      releasedAt: releasedAt || null, preLaunchCount: 0,
      canPublish: status !== "planned", canManageReleasePlan: true,
      branches: [], description: "" };
  }
  var previewVersions = [
    pv("V1", "1.2 权限改造", "active", shift(-10), shift(3), 6, 2, 3, 2880, 1200, 900, 300),
    pv("V2", "1.3 权限收官", "planned", "", shift(14), 0, 0, 2, 0, 0, 0, 0),
    pv("V3", "1.1 权限基线", "released", shift(-30), shift(-22), 5, 5, 2, 1200, 1180, 900, 280, shift(-22)),
    pv("V4", "1.0 权限上线", "released", shift(-46), shift(-38), 8, 8, 4, 1920, 2000, 1500, 500, shift(-38)),
    pv("V5", "0.9 灰度验证", "released", shift(-62), shift(-54), 4, 4, 1, 960, 900, 700, 200, shift(-54)),
    pv("V6", "0.8 权限初版", "released", shift(-80), shift(-70), 7, 7, 3, 1680, 1620, 1240, 380, shift(-70)),
    { id: "V7", reqId: "R2", name: "2.0 结算升级", status: "planned", startDate: "", targetDate: shift(20),
      taskCount: 0, doneCount: 0, demandCount: 1, estimateMinutes: 0, workMinutes: 0,
      devMinutes: 0, testMinutes: 0, releasedAt: null, preLaunchCount: 0,
      canPublish: false, canManageReleasePlan: true, branches: [], description: "" }
  ];

  var releasePlans = [
    { id: "P1", planNo: 12, reqId: "R1", versionId: "V1", versionIds: ["V1"], versionCount: 1, releasedVersionCount: 0,
      projectNames: "流程引擎", versionNames: "1.2 权限改造",
      plannedAt: shift(3) + "T20:00:00", status: "ready", environment: "production", coverage: "full",
      plannedTaskIds: ["K1", "K2", "K7", "K8", "K9", "K11"], plannedDemandIds: ["D1"], revision: 3 },
    { id: "P2", planNo: 13, reqId: "R2", versionId: "V7", versionCount: 1, releasedVersionCount: 0,
      projectNames: "结算改造", versionNames: "2.0 结算升级",
      plannedAt: shift(-1) + "T09:30:00", status: "ready", environment: "production", coverage: "partial",
      plannedTaskIds: [], plannedDemandIds: [], revision: 1 },
    { id: "P3", planNo: 14, reqId: "R1", versionId: "V2", versionCount: 1, releasedVersionCount: 0,
      projectNames: "流程引擎", versionNames: "1.3 权限收官",
      plannedAt: shift(10) + "T14:00:00", status: "draft", environment: "staging", coverage: "unknown",
      plannedTaskIds: [], plannedDemandIds: [], revision: 0 },
    /* 多版本计划的样例：芯片收成「2 枚 + N」，行仍只从主版本进入 */
    { id: "P4", planNo: 15, reqId: "R1", versionId: "V1", versionIds: ["V1", "V2", "V7"], versionCount: 3, releasedVersionCount: 0,
      projectNames: "流程引擎 / 结算改造", versionNames: "1.2 权限改造 / 1.3 权限收官 / 2.0 结算升级",
      plannedAt: shift(21) + "T10:00:00", status: "draft", environment: "production", coverage: "unknown",
      plannedTaskIds: [], plannedDemandIds: [], revision: 0 }
  ];
  var releaseRecords = [
    { id: "RR1", releaseNo: 11, reqId: "R1", versionId: "V1", versionName: "1.2 权限改造", planId: "P1",
      environment: "production", operation: "deploy", result: "success",
      occurredAt: ts(-6, 20, 10), publishedOn: shift(-6), recordedAt: ts(-6, 20, 12), planPlannedAt: ts(-6, 20, 0),
      targetKeys: ["app-web", "gateway"], coverage: "full", artifactRef: "hourglass-web@1.2.0",
      artifactDigest: "9f2c41d7e0b85a36c1d0f4b7a2e8c9d1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3",
      recordedByName: "我", executorName: "陈工", notes: "按计划窗口发布，回滚脚本已演练。",
      items: [
        { taskId: "K1", taskItemNo: "WI-101", title: "重构权限校验中间件", demandId: "D1", demandNo: "REQ-021", demandTitle: "权限中台统一鉴权",
          ownerName: "我", completedAt: ts(-7, 18, 0), disposition: "已发布" },
        { taskId: "K2", taskItemNo: "WI-102", title: "导出 CSV 补工时列", demandId: "D1", demandNo: "REQ-021", demandTitle: "权限中台统一鉴权",
          ownerName: "我", completedAt: ts(-8, 16, 30), disposition: "已发布" }
      ] },
    { id: "RR2", releaseNo: 10, reqId: "R1", versionId: "V1", versionName: "1.2 权限改造", planId: null,
      environment: "staging", operation: "deploy", result: "failed",
      occurredAt: ts(-9, 15, 20), publishedOn: shift(-9), recordedAt: ts(-9, 15, 26),
      targetKeys: ["staging"], coverage: "partial", artifactRef: "hourglass-web@1.2.0-rc3",
      failureReason: "网关配置未同步，验证环境登录 502", recordedByName: "陈工", executorName: "陈工",
      items: [] }
  ];

  var routes = {
    /* 演示用：当前登录者是「普通用户」，同时是共享空间「团队空间」的空间主
       —— 设置页应只给邀请链接，不给"按登录名直接加人" */
    "/api/auth/me": { id: "U1", displayName: "我", username: "me", role: "user", lastWorkspaceId: "W2",
      workStartHour: 9, workEndHour: 18, workMaxHours: 8 },
    "/api/workspaces": [ws, { id: "W2", name: "团队空间", type: "shared", myRole: "owner", memberCount: 3, ownerId: "U1" }],
    /* 版本页只读首版上线时间；阶段卡不在预览范围 */
    "/api/phase/stats": { firstReleasedAt: null, mvp: {}, post: {} },
    "/api/board": board,
    "/api/tasks/list": { items: tasks, total: tasks.length },
    /* 终态「已取消」：不占看板列，只在工具条入口进去看归档与恢复 */
    "/api/tasks/canceled": {
      items: [
        T({ id: "C1", title: "旧版导出脚本下线", owner: "我", reqId: "R1", reqName: "流程引擎",
            boardColumn: "canceled", cancelReason: "deferred", cancelFrom: "doing", canceledAt: ts(-1, 15, 20) }),
        T({ id: "C2", title: "通知模板迁移（并入新模板）", owner: "陈工", reqId: "R1", reqName: "流程引擎",
            boardColumn: "canceled", cancelReason: "dup", cancelFrom: "backlog", canceledAt: ts(-4, 11, 5) })
      ],
      total: 2, matched: 2, hasMore: false,
      reasons: [{ name: "dup", count: 1 }, { name: "deferred", count: 1 }]
    },
    /* 生产接口分页返回 {items,total,hasMore}，前端统一走 getAllPages */
    "/api/reqs": {
      items: [
        { id: "R1", name: "流程引擎", status: "active", setId: null, containerKind: null, firstReleasedAt: "2026-06-15",
          progressPct: 62, taskCount: 4, doneCount: 2, mvpWorkMinutes: 960, postWorkMinutes: 240, onTimePct: 50, owner: "我" },
        { id: "R2", name: "结算改造", status: "active", setId: null, containerKind: null, firstReleasedAt: "2026-07-18",
          progressPct: 20, taskCount: 2, doneCount: 0, mvpWorkMinutes: 120, postWorkMinutes: 0, onTimePct: null, owner: "我" },
        { id: "R3", name: "风控规则引擎", status: "active", setId: null, containerKind: null, firstReleasedAt: "2026-09-02",
          progressPct: 48, taskCount: 3, doneCount: 1, mvpWorkMinutes: 720, postWorkMinutes: 180, onTimePct: 100, owner: "陈工" }
      ],
      total: 2, hasMore: false
    },
    "/api/manager/workload": workload,
    "/api/views": [{ id: "V1", name: "我的 P0", params: JSON.stringify({ pris: ["P0"] }) }],
    /* 设置页「看板列 / 分类」用：之前缺这两条路由，预览会显示"加载失败" */
    "/api/columns": [
      { id: "backlog", name: "待处理", color: "#8a8578", sortOrder: 0, processingRule: "backlog", done: false },
      { id: "doing", name: "进行中", color: "#2563EB", sortOrder: 1, processingRule: "normal", done: false },
      { id: "test", name: "待测试", color: "#8b6fb5", sortOrder: 2, processingRule: "waiting", done: false },
      { id: "testing", name: "测试中", color: "#b06f9a", sortOrder: 3, processingRule: "normal", done: false },
      { id: "done", name: "已完成", color: "#5f7a4a", sortOrder: 4, processingRule: "done", done: true }
    ],
    /* 工作流页的优先级显示名；缺这条会让整块配置显示「加载失败」 */
    "/api/priorities": [
      { code: "P0", name: "紧急", color: "#F04438" },
      { code: "P1", name: "高", color: "#F79009" },
      { code: "P2", name: "中", color: "#2E90FA" },
      { code: "P3", name: "低", color: "#98A2B3" }
    ],
    /* 状态流转矩阵：列定义 + 规则；带一条「需填原因」才看得到三种按钮样式 */
    "/api/columns/transitions": {
      columns: [
        { id: "backlog", name: "待处理", color: "#8a8578" },
        { id: "doing", name: "进行中", color: "#2563EB" },
        { id: "test", name: "待测试", color: "#8b6fb5" },
        { id: "testing", name: "测试中", color: "#b06f9a" },
        { id: "done", name: "已完成", color: "#5f7a4a" }
      ],
      rules: [
        { from: "done", to: "doing", rule: "reason" },
        { from: "backlog", to: "done", rule: "deny" }
      ]
    },
    "/api/categories": [
      { id: "C1", name: "后端", color: "#2563EB", sortOrder: 0, projectId: "R1" },
      { id: "C2", name: "前端", color: "#7C3AED", sortOrder: 1, projectId: "R1" },
      { id: "C3", name: "数据", color: "#0E9384", sortOrder: 2, projectId: "R2" }
    ],
    "/api/trash": [T({ id: "X1", title: "旧的定时任务配置", deletedAt: ts(-29, 10, 0) })],
    "/api/notifications/unread": { unread: 2 },
    "/api/notifications": {
      items: [
        { id: 21, workspaceId: "W1", type: "task_remind", title: "任务提醒：重构权限校验中间件",
          body: "优先级 P0 · 截止 " + shift(2), refTaskId: "K1", readAt: null, createdAt: ts(0, 9, 0), workspaceName: "我的看板" },
        { id: 20, workspaceId: "W2", type: "task_comment", title: "评论：「通知中心」有新评论",
          body: "记得把未读角标接到 SSE 上", refTaskId: "K1", readAt: null, createdAt: ts(0, 11, 30), workspaceName: "团队空间" }
      ],
      unread: 2
    },
    "/api/my-tasks": {
      items: [
        T({ id: "M1", title: "重构权限校验中间件", workspaceId: "W1", workspaceName: "我的看板", priority: "P0",
            startDate: shift(-3), dueDate: shift(2), progress: 60 }),
        T({ id: "M2", title: "流程引擎-流程自动节点接入扩展", workspaceId: "W2", workspaceName: "团队空间",
            priority: "P0", dueDate: shift(9), blocked: true, blockedReason: "等对方接口" })
      ],
      total: 2,
      spaces: [{ id: "W1", name: "我的看板" }, { id: "W2", name: "团队空间" }],
      matchedByNameOnly: 0
    },
    "/api/review": review,
    "/api/stats": {      weeks: [-4, -3, -2, -1, 0].map(function (dy) {
        return { start: shift(dy * 7 - 6), end: shift(dy * 7), created: 3, completed: 2 };
      }),
      byProject: [{ name: "R1", count: 8 }],
      byOwner: [{ name: "我", count: 9 }],
      current: { backlog: 8, doing: 2, done: 3, other: 0, overdue: 3, workMinutes: 1255, workMinutesWeek: 320,
                 workMinutesAll: 2410, workMinutesWeekAll: 705 }
    },
    "/api/activity": [],
    "/api/ai/config": {
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      hasKey: true,
      apiKeyMasked: "sk-****a1b2",
      enabled: true,
      keyBroken: false,
      status: "已就绪：调用走团队额度",
      prefer: "auto",
      source: "team",
      sourceName: "团队 AI",
      allowPersonal: true,
      team: { available: true, scope: "platform", provider: "deepseek", model: "deepseek-chat",
              status: "由平台管理员提供，费用由团队承担" },
      presets: [
        { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", keyHint: "platform.deepseek.com 创建 API Key" },
        { id: "qwen", name: "通义千问（阿里云）", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", keyHint: "阿里云百炼控制台创建 API Key" },
        { id: "moonshot", name: "月之暗面 Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-32k", keyHint: "platform.moonshot.cn 创建 API Key" },
        { id: "zhipu", name: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-plus", keyHint: "open.bigmodel.cn 创建 API Key" },
        { id: "hunyuan", name: "腾讯混元", baseUrl: "https://api.hunyuan.cloud.tencent.com/v1", model: "hunyuan-turbo", keyHint: "腾讯云控制台「混元大模型」创建 API Key" },
        { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", keyHint: "platform.openai.com 创建 API Key" },
        { id: "ollama", name: "本地 Ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5:7b", keyHint: "本地模型无需 Key，Ollama 默认不校验" },
        { id: "custom", name: "自定义 / 中转", baseUrl: "", model: "", keyHint: "任何 OpenAI 兼容服务：填 /v1 基址和模型名" }
      ]
    },
    "/api/ai/config/test": { ok: true, latencyMs: 860, model: "deepseek-chat", reply: "正常", tokens: 42, source: "team", sourceLabel: "团队 AI" },
    "/api/admin/ai-settings": {
      enabled: true, provider: "deepseek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat",
      hasKey: true, apiKeyMasked: "sk-****9f3c", keyBroken: false, allowPersonal: true,
      status: "已就绪：全员调用走团队额度", updatedBy: "平台管理员", updatedAt: ts(-2, 15, 30),
      presets: [
        { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", keyHint: "platform.deepseek.com 创建 API Key" },
        { id: "qwen", name: "通义千问（阿里云）", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", keyHint: "阿里云百炼控制台创建 API Key" },
        { id: "custom", name: "自定义 / 中转", baseUrl: "", model: "", keyHint: "任何 OpenAI 兼容服务：填 /v1 基址和模型名" }
      ]
    },
    "/api/admin/ai-settings/test": { ok: true, latencyMs: 920, model: "deepseek-chat", reply: "正常", tokens: 40, source: "team" },
    /* 回顾页「AI 周报」：预览稿里给一段不用后端也能看的示例输出 */
    "/api/ai/review/polish": {
      weekOffset: 0, label: "本周", weekStart: shift(-6), weekEnd: shift(0),
      report: "## 本周完成\n"
        + "- 完成登录重构与验证码改造，登录链路收敛到统一入口\n"
        + "- 修正代理登录权限判断，代理人登录后可正确落到本人空间\n"
        + "- 补齐历史任务（完成时间缺失）的数据，回顾统计不再漏项\n\n"
        + "## 进行中\n"
        + "- 权限校验中间件改造：四个入口已切换，准备提测（进度 60%）\n"
        + "- 导出 CSV 补工时列：字段已加，待前端联调（进度 35%）\n\n"
        + "## 风险与阻塞\n"
        + "- 3 项任务已逾期，其中「月度对账」卡在等对方接口\n"
        + "- 10 项 P0 未关闭，权限中间件不完成会挡住后续三个需求\n\n"
        + "## 下周计划\n"
        + "- 推动权限中间件提测并修复回归问题\n"
        + "- 完成导出工时列的联调与验收\n",
      source: { completed: 3, progress: 2, pendingDone: 0, truncated: false, chars: 1240, withNote: false },
      usage: { model: "deepseek-chat", promptTokens: 1580, completionTokens: 320, totalTokens: 1900, jsonMode: false }
    },
    "/api/estimate/stats": {
      tasksTotal: 13, tasksWithEstimate: 7, sampleCount: 4, noTimeCount: 3,
      overallFactor: 1.42, medianFactor: 1.45,
      underCount: 0, accurateCount: 1, overCount: 3,
      byProject: [
        { reqId: "R1", sampleCount: 2, estimateTotal: 600, actualTotal: 1000, factor: 1.67 },
        { reqId: "", sampleCount: 1, estimateTotal: 120, actualTotal: 168, factor: 1.4 },
        { reqId: "R2", sampleCount: 1, estimateTotal: 300, actualTotal: 280, factor: 0.93 }
      ],
      atRisk: [
        { id: "K1", title: "重构权限校验中间件", category: "后端", column: "doing",
          estimateMinutes: 480, actualMinutes: 520, ratio: 1.08, level: "danger" },
        { id: "K2", title: "导出 CSV 补工时列", category: "前端", column: "doing",
          estimateMinutes: 240, actualMinutes: 200, ratio: 0.83, level: "warn" }
      ],
      overrun: [
        { id: "D3", title: "次席出金接口幂等校验", category: "后端", column: "done",
          estimateMinutes: 240, actualMinutes: 420, ratio: 1.75, level: "danger" },
        { id: "D4", title: "归档任务异常重试机制", category: "后端", column: "done",
          estimateMinutes: 120, actualMinutes: 180, ratio: 1.5, level: "danger" }
      ],
      suggestion: "你的估时偏乐观：过去 4 个已完成工作项的实际投入是预估的 1.42 倍。下次填预估时，把心里的数乘 1.42 再填，会贴近真实。",
      note: "口径：实际 = 计时记录（只算工作时段、跳周末、每天封顶），不用开始/结束日期推算 —— 开始日期只代表什么时候接到的，不代表什么时候动手。样本 4 个已完成工作项。另有 3 个已完成工作项没开过计时，不计入（没记录 ≠ 干得快）。"
    },
    "/api/flow-health": {
      rangeDays: 90,
      since: shift(-90),
      generatedAt: ts(0, 9, 0).replace("T", " ").slice(0, 16),
      coverage: {
        moveEvents: 46, usableMoves: 44, tasksTotal: 13, tasksWithMoves: 9, completedInRange: 5,
        note: "近 90 天共 46 次移动，其中 44 次能定位到具体列（早期记录只有列名文本，列改名过的会对不上）；「已完成」列不作为在制停留统计。"
      },
      columns: [
        { id: "backlog", name: "待处理", color: "#8a8578", segments: 18, totalSeconds: 486000,
          avgSeconds: 27000, medianSeconds: 21600, p90Seconds: 61200, share: 0.52,
          ongoingCount: 8, ongoingMaxSeconds: 1036800, ongoingAvgSeconds: 432000, bottleneck: true },
        { id: "doing", name: "进行中", color: "#2563EB", segments: 12, totalSeconds: 302400,
          avgSeconds: 25200, medianSeconds: 18000, p90Seconds: 50400, share: 0.32,
          ongoingCount: 2, ongoingMaxSeconds: 259200, ongoingAvgSeconds: 172800, bottleneck: false },
        { id: "done", name: "已完成", color: "#5f7a4a", segments: 0, totalSeconds: 0,
          avgSeconds: 0, medianSeconds: 0, p90Seconds: 0, share: 0,
          ongoingCount: 0, ongoingMaxSeconds: 0, ongoingAvgSeconds: 0, bottleneck: false }
      ],
      bottleneckId: "backlog",
      bottleneckName: "待处理",
      bottleneckShare: 0.52,
      rework: { totalMoves: 44, backMoves: 9, backRate: 0.2045, completedTasks: 5, firstPassTasks: 3, firstPassRate: 0.6 },
      priority: [
        { priority: "P0", tasks: 6, avgMoves: 3.2 },
        { priority: "P1", tasks: 4, avgMoves: 1.8 },
        { priority: "P2", tasks: 3, avgMoves: 1.2 }
      ],
      reqDocs: {
        total: 5, withTasks: 3, noTask: 2, avgLeadHours: 30.4,
        noTaskList: [
          { id: "D9", title: "结算改造-对账口径调整", ageDays: 12 },
          { id: "D8", title: "流程引擎-节点超时告警", ageDays: 4 }
        ]
      },
      insights: [
        { level: "warn", title: "最堵的是「待处理」",
          text: "它吃掉了全流程 52% 的停留时间，平均 7.5 小时。瓶颈在这一列，加人加班在别处都没用。" },
        { level: "warn", title: "返工偏多",
          text: "近 90 天 44 次跨列移动里有 9 次是往回退（20%）。退回通常意味着进入下一列的门槛不清 —— 验收标准写在需求里会好很多。" },
        { level: "warn", title: "2 份需求还没拆出任务",
          text: "共 5 份需求，其中 2 份一个任务都没有。挂得最久的是「结算改造-对账口径调整」，已经 12 天没拆出任务。" },
        { level: "warn", title: "P0 反而更折腾",
          text: "P0 任务平均被移动 3.2 次，P2 只有 1.2 次。要么 P0 的定义太宽（什么都标 P0），要么它们总是在需求不清的时候就开工了。" }
      ]
    },
    "/api/notify/status": { enabled: true, channel: "webhook", lastStatus: "success", effectiveEnabled: true }
  };

  function pick(clean) {
    if (Object.prototype.hasOwnProperty.call(routes, clean)) return routes[clean];
    /* 单条工作项：已取消列表的行不在看板缓存里，打开详情要靠这条按 id 回查 */
    var taskM = clean.match(/^\/api\/task\/([A-Za-z0-9_-]+)$/);
    if (taskM) {
      var all = tasks.concat((routes["/api/tasks/canceled"] || {}).items || []);
      for (var ti = 0; ti < all.length; ti++) if (all[ti].id === taskM[1]) return all[ti];
    }
    /* AI 的三次交互都是 POST，且路径带需求 id —— 用正则匹配 */
    if (/^\/api\/ai\/reqdoc\/[A-Za-z0-9_-]+\/split$/.test(clean)) {
      return {
        reqDocId: "D1", reqDocTitle: "权限校验中间件改造", docChars: 1840,
        tasks: [
          { title: "梳理现有权限校验入口并列出调用方", description: "把所有走鉴权的入口列清楚，产出清单作为后续改动基线", priority: "P1", dependsOnIndex: -1, reason: "文档第一部分列了 4 个入口，先固化范围", selected: true },
          { title: "重构权限校验中间件为可插拔结构", description: "抽出校验链，支持按接口配置不同策略", priority: "P0", dependsOnIndex: 0, reason: "核心改造，后续策略都挂在这一层", selected: true },
          { title: "实现次席代码维度的权限过滤", description: "按次席代码隔离数据，越权返回 403", priority: "P0", dependsOnIndex: 1, reason: "需求明确要求按次席隔离", selected: true },
          { title: "补权限矩阵查询接口", description: "GET /api/perm/matrix 返回当前用户的权限项", priority: "P2", dependsOnIndex: 1, reason: "前端要根据它渲染按钮", selected: true },
          { title: "权限变更后清理相关缓存", description: "改角色时同步失效 Redis 里的鉴权缓存", priority: "P2", dependsOnIndex: -1, reason: "文档写了缓存一致性要求", selected: true }
        ],
        usage: { model: "deepseek-chat", promptTokens: 1520, completionTokens: 486, totalTokens: 2006, jsonMode: true }
      };
    }
    if (/^\/api\/ai\/reqdoc\/[A-Za-z0-9_-]+\/audit$/.test(clean)) {
      return {
        reqDocId: "D1", reqDocTitle: "权限校验中间件改造",
        coverage: 56, verdict: "partial",
        summary: "主体改造已完成，但次席维度的越权校验和下游通知还没落地，现在验收会漏。",
        nextStep: "补「次席代码越权返回 403」的任务 —— 这是文档里写死的规则，不能靠口头约定",
        totalPoints: 8, donePoints: 3, doingPoints: 2, todoPoints: 1, missingPoints: 2,
        points: [
          { point: "接口入口全部走统一的校验中间件", covered: true, status: "done", taskTitle: "重构权限校验中间件", note: "4 个入口已全部切换" },
          { point: "校验失败返回 403 而不是 500", covered: true, status: "done", taskTitle: "重构权限校验中间件", note: "统一异常处理已覆盖" },
          { point: "权限变更后 Redis 缓存同步失效", covered: true, status: "done", taskTitle: "权限变更后清理相关缓存", note: "改角色时主动清 key" },
          { point: "按次席代码隔离数据", covered: true, status: "doing", taskTitle: "实现次席代码维度的权限过滤", note: "过滤逻辑写了，还没接进查询" },
          { point: "角色权限矩阵可配置", covered: true, status: "doing", taskTitle: "补权限矩阵查询接口", note: "只读接口在做，写接口没有" },
          { point: "审计日志记录每次越权尝试", covered: true, status: "todo", taskTitle: "（未建任务，需求里提到了）", note: "文档第 3 节提到要留痕，但没有对应任务" },
          { point: "次席代码越权时返回 403 并带错误码", covered: false, status: "missing", taskTitle: "", note: "文档写死了错误码 4013，任务里完全没提到" },
          { point: "权限变更通知下游系统", covered: false, status: "missing", taskTitle: "", note: "需求要求同步告知清算，找不到任何相关任务" }
        ],
        tasks: [
          { id: "K1", title: "重构权限校验中间件", column: "doing", progress: 60, done: false },
          { id: "K2", title: "导出 CSV 补工时列", column: "doing", progress: 0, done: false }
        ],
        usage: { model: "deepseek-chat", promptTokens: 1680, completionTokens: 720, totalTokens: 2400, jsonMode: true }
      };
    }
    if (/^\/api\/ai\/reqdoc\/[A-Za-z0-9_-]+\/tasks$/.test(clean)) {
      return { created: 5, skipped: 0, failed: [] };
    }
    /* 分支：带子路径的要先判断，否则会被单 id 那条正则先吃掉 */
    if (clean === "/api/branches") return branches;
    if (/^\/api\/branches\/[A-Za-z0-9_-]+\/logs$/.test(clean)) {
      return branchLogs[clean.split("/")[3]] || [];
    }
    if (/^\/api\/branches\/[A-Za-z0-9_-]+\/tasks$/.test(clean)) {
      var bid = clean.split("/")[3];
      return tasks.filter(function (t) { return t.branchId === bid; });
    }
    if (/^\/api\/branches\/[A-Za-z0-9_-]+$/.test(clean)) {
      var brId = clean.split("/").pop();
      for (var bi = 0; bi < branches.length; bi++) if (branches[bi].id === brId) return branches[bi];
      return branches[0];
    }
    /* 文档分类是扁平数组；缺这条会落到通用兜底返回对象，文档树在 cats.forEach 处直接抛错 */
    if (clean === "/api/doc-categories") { return []; }
    /* 用例分组同样是扁平数组：覆盖团队共享 / 指定成员 / 仅自己、可编辑与不可编辑、含子组的情况 */
    if (clean === "/api/case-sets") {
      return [
        { id: "S1", name: "登录与鉴权", parentId: "", visibility: "team", editable: true, caseCount: 4, subtreeCount: 6, note: "" },
        { id: "S1-1", name: "令牌续期", parentId: "S1", visibility: "team", editable: true, caseCount: 2, subtreeCount: 2, note: "" },
        { id: "S2", name: "日终批处理", parentId: "", visibility: "members", editable: false, caseCount: 3, subtreeCount: 3, note: "李娜等 2 人可见" },
        { id: "S3", name: "我的回归清单", parentId: "", visibility: "personal", editable: true, kind: "dynamic", caseCount: 2, subtreeCount: 2, note: "P0 且近 30 天改动" }
      ];
    }
    if (clean === "/api/req-docs") {
      /* 生产接口分页返回 {items,total,hasMore}，前端统一走 getAllPages（读 page.items）；
         这里必须给出同样的形状，否则列表/阅读树都拿不到数据 */
      var docRows = reqDocs.map(function (d) {
        return { id: d.id, reqId: d.reqId, reqName: d.reqName, title: d.title, status: d.status,
                 owner: d.owner, excerpt: d.excerpt, taskCount: d.taskCount, doneCount: d.doneCount,
                 createdAt: d.createdAt, updatedAt: d.updatedAt, sortOrder: d.sortOrder || 0,
                 format: d.format || "html", docType: d.docType || "other",
                 parentId: d.parentId || null, publishedAt: d.publishedAt || null };
      });
      return { items: docRows, total: docRows.length, hasMore: false };
    }
    /* 动态流要在单 id 正则之前判断，否则 "activities" 会被当成文档 id */
    if (clean === "/api/req-docs/activities") { return docActivities; }
    /* 评论条数角标 / 评论列表：同样要先于单 id 判断，且都从 docComments 取数 */
    var cCountM = /^\/api\/req-docs\/([A-Za-z0-9_-]+)\/comments\/counts$/.exec(clean);
    if (cCountM) {
      var cRows0 = docComments[cCountM[1]] || [];
      var unresolved0 = cRows0.filter(function (c) { return !c.resolved; }).length;
      return { total: cRows0.length, unresolved: unresolved0 };
    }
    var cListM = /^\/api\/req-docs\/([A-Za-z0-9_-]+)\/comments$/.exec(clean);
    if (cListM) {
      var cRows1 = docComments[cListM[1]] || [];
      return { items: cRows1, total: cRows1.length, hasMore: false };
    }
    if (/^\/api\/req-docs\/[A-Za-z0-9_-]+$/.test(clean)) {
      var did = clean.split("/").pop();
      for (var di = 0; di < reqDocs.length; di++) if (reqDocs[di].id === did) return reqDocs[di];
      return reqDocs[0];
    }
    if (clean === "/api/my-running-timer") {
      /* 演示：K1 正在计时（看板上那张卡会显示「计时中」+ 实时工时） */
      return { running: true, taskId: "K1", workspaceId: "W1", workspaceName: "我的看板",
               taskTitle: "重构权限校验中间件", startedAt: ts(0, 9, 12), elapsedMinutes: 48 };
    }
    if (/^\/api\/notifications\/\d+\/read$/.test(clean)) return {};
    if (clean === "/api/notifications/read-all") return {};
    if (/^\/api\/task\/[A-Za-z0-9_-]+$/.test(clean)) {
      var id = clean.split("/").pop();
      for (var i = 0; i < tasks.length; i++) if (tasks[i].id === id) return tasks[i];
      for (var j = 0; j < calTasks.length; j++) if (calTasks[j].id === id) return calTasks[j];
      return tasks[0];
    }
    if (/^\/api\/tasks\/[A-Za-z0-9_-]+\/logs$/.test(clean)) {
      return [{ id: 1, action: "create", detail: "创建任务", actorName: "我", createdAt: ts(-12, 10, 0) }];
    }
    if (/\/api\/tasks\/[A-Za-z0-9_-]+\/work$/.test(clean)) {
      return { running: false, startedAt: null, elapsedMinutes: 0, totalMinutes: 320, myTotalMinutes: 320 };
    }
    if (/\/api\/tasks\/[A-Za-z0-9_-]+\/(subtasks|attachments)$/.test(clean)) return [];
    if (clean.indexOf("/api/workspaces/") === 0 && clean.indexOf("/members") > 0) {
      /* 项目花名册返回 {members}；空间成员返回数组 —— 两条路由共用这段判断，按路径区分 */
      var roster = [
        { userId: "U1", displayName: "我", username: "me", role: "owner", access: "write",
          companyName: "北京总部", jobTitle: "前端开发", effectiveRoleTitle: "前端开发", secondaryRoleTitles: [] },
        { userId: "U2", displayName: "陈工", username: "chen", role: "member", access: "write",
          companyName: "北京总部", jobTitle: "后端开发", effectiveRoleTitle: "后端开发", secondaryRoleTitles: [] },
        { userId: "U3", displayName: "李雷", username: "lilei", role: "member", access: "write",
          companyName: "上海研发", jobTitle: "测试", effectiveRoleTitle: "测试", secondaryRoleTitles: ["质量保障"] }
      ];
      return /\/projects\/[A-Za-z0-9_-]+\/members$/.test(clean) ? { members: roster } : roster;
    }
    return {};
  }


  /* ==================== 甘特图 V1.4 演示数据 ==================== */
  var ganttDeps = [
    { id: "D1", workspaceId: "W1", fromTaskId: "G1", toTaskId: "G2", depType: "FS", lagDays: 0 },
    { id: "D2", workspaceId: "W1", fromTaskId: "B1", toTaskId: "K2", depType: "FS", lagDays: 0 },
    { id: "D3", workspaceId: "W1", fromTaskId: "G1", toTaskId: "K1", depType: "SS", lagDays: 2 }
  ];
  var ganttBaseline = {
    G1: { startDate: shift(-24), dueDate: shift(8) },
    G2: { startDate: shift(-8), dueDate: shift(-3) },
    K1: { startDate: shift(-4), dueDate: shift(1) }
  };
  var ganttBaselineAt = ts(-2, 18, 0);

  /* 区间工时演示数据：只在本周/上周之外的区间里额外出现，便于看出「近30天 / 本月」差异 */
  var workloadExtraLogs = {
    U1: [{ date: shift(-25), minutes: 240 }, { date: shift(-11), minutes: 150 }],
    U2: [{ date: shift(-18), minutes: 90 }],
    U3: [{ date: shift(-11), minutes: 45 }],
    U4: [{ date: shift(-18), minutes: 60 }]
  };
  function isoAdd(isoDate, days) {
    var p = isoDate.split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + days);
    return iso(d);
  }
  function workdaysBetween(from, to) {
    var count = 0, p = from.split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    var end = new Date(Number(to.split("-")[0]), Number(to.split("-")[1]) - 1, Number(to.split("-")[2]));
    while (d <= end) {
      var dow = d.getDay();
      if (dow !== 0 && dow !== 6) count++;
      d.setDate(d.getDate() + 1);
    }
    return count;
  }
  function mockWorkload(u) {
    var fm = /[?&]from=(\d{4}-\d{2}-\d{2})/.exec(u), tm = /[?&]to=(\d{4}-\d{2}-\d{2})/.exec(u);
    if (!fm || !tm) return workload;
    var from = fm[1], to = tm[1];
    if (from > to) { var swap = from; from = to; to = swap; }
    /* 与后端一致：超过 92 天从终点往前截断 */
    if (isoAdd(to, -91) > from) from = isoAdd(to, -91);
    var out = JSON.parse(JSON.stringify(workload));
    out.rangeFrom = from;
    out.rangeTo = to;
    out.rangeWorkdays = workdaysBetween(from, to);
    out.members.forEach(function (m) {
      var minutes = 0;
      (m.weekLogs || []).concat(m.lastWeekLogs || []).forEach(function (l) {
        if (l.date >= from && l.date <= to) minutes += Number(l.minutes) || 0;
      });
      (workloadExtraLogs[m.key] || []).forEach(function (l) {
        if (l.date >= from && l.date <= to) minutes += Number(l.minutes) || 0;
      });
      m.rangeMinutes = minutes;
    });
    return out;
  }

  /* 任务清单分页：明细按 offset/limit 切页，统计字段按全月口径汇总（与后端一致） */
  function mockCompletions(u) {
    var off = Number((/[?&]offset=(\d+)/.exec(u) || [])[1] || 0);
    var lim = Number((/[?&]limit=(\d+)/.exec(u) || [])[1] || 100);
    lim = Math.min(Math.max(lim, 1), 100);
    var pubM = /[?&]pub=(published|unpublished)/.exec(u);
    var pub = pubM ? pubM[1] : "";
    /* 发布态在本清单内过滤，统计字段同步按过滤后口径（与后端 SQL 一致） */
    function publishedRow(r) {
      return !!(r.publishedAt || r.everPublished === true || r.manualPublished === true
        || (r.publicationState && r.publicationState !== "unpublished")
        || (Array.isArray(r.publicationTargets) && r.publicationTargets.length));
    }
    var rows = (completions || []).filter(function (r) {
      if (pub === "published") return publishedRow(r);
      if (pub === "unpublished") return !publishedRow(r);
      return true;
    });
    var page = rows.slice(off, off + lim);
    var totalMinutes = 0, counts = {};
    rows.forEach(function (r) {
      totalMinutes += Number(r.totalMinutes) || 0;
      var o = r.owner || "未指派";
      counts[o] = (counts[o] || 0) + 1;
    });
    var owners = Object.keys(counts);
    var top = owners.slice().sort(function (a, b) { return counts[b] - counts[a]; })[0];
    return {
      items: page, total: rows.length, offset: off, limit: lim,
      hasMore: off + page.length < rows.length,
      totalMinutes: totalMinutes, ownerCount: owners.length,
      topOwner: top || null, topOwnerCount: top ? counts[top] : 0
    };
  }

  function mockGantt(u) {
    /* 与后端一致：区间只筛已排期任务，未排期单独返回；都在 filters 之后 */
    var all = mockTaskList(u).items;
    var fromM = /[?&]from=(\d{4}-\d{2}-\d{2})/.exec(u);
    var toM = /[?&]to=(\d{4}-\d{2}-\d{2})/.exec(u);
    var from = fromM ? fromM[1] : null, to = toM ? toM[1] : null;
    function effS(t) { return t.startDate || t.dueDate; }
    function effE(t) { return t.dueDate || t.startDate; }
    var scheduled = [], unplanned = [];
    all.forEach(function (t) {
      if (!t.startDate && !t.dueDate) { unplanned.push(t); return; }
      if (from && effE(t) < from) return;
      if (to && effS(t) > to) return;
      scheduled.push(t);
    });
    scheduled.sort(function (a, b) {
      var sa = effS(a), sb = effS(b);
      if (sa !== sb) return sa < sb ? -1 : 1;
      var ea = effE(a), eb = effE(b);
      if (ea !== eb) return ea < eb ? -1 : 1;
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
    var off = Number((/[?&]offset=(\d+)/.exec(u) || [])[1] || 0);
    var lim = Number((/[?&]limit=(\d+)/.exec(u) || [])[1] || 300);
    var page = scheduled.slice(off, off + lim);
    var res = {
      items: page, total: scheduled.length, offset: off, limit: lim,
      hasMore: off + page.length < scheduled.length,
      unscheduledCount: unplanned.length,
      unscheduled: unplanned.slice(0, 200)
    };
    if (off === 0) {
      res.deps = ganttDeps;
      res.baseline = ganttBaseline;
      res.baselineAt = ganttBaselineAt;
    }
    return res;
  }

  function mondayOf(d) {
    var x = new Date(d.getTime());
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }
  function mockGanttLoad(u) {
    var fromM = /[?&]from=(\d{4}-\d{2}-\d{2})/.exec(u);
    var base = fromM ? new Date(Number(fromM[1].slice(0, 4)), Number(fromM[1].slice(5, 7)) - 1, Number(fromM[1].slice(8, 10))) : new Date();
    var start = mondayOf(base);
    var weeks = [];
    for (var i = 0; i < 6; i++) {
      var d = new Date(start.getTime());
      d.setDate(d.getDate() + i * 7);
      weeks.push(iso(d));
    }
    var members = ["我", "陈工", "李雷"].map(function (name, idx) {
      return {
        name: name,
        buckets: weeks.map(function (w, j) {
          return {
            weekStart: w,
            estimateMinutes: Math.max(0, 600 + idx * 480 + j * (idx === 1 ? 420 : 120) - (j > 3 ? 900 : 0)),
            actualMinutes: idx === 0 ? 400 + j * 90 : idx * 60,
            capacityMinutes: 2400
          };
        })
      };
    });
    return { from: weeks[0], to: weeks[weeks.length - 1], weeks: weeks, members: members };
  }

  function mockShare() {
    return {
      workspaceName: "我的看板",
      generatedAt: ts(0, 10, 0),
      baselineAt: ganttBaselineAt,
      tasks: tasks,
      deps: ganttDeps,
      baseline: ganttBaseline
    };
  }

  /* 发布检查：预览稿没有真实测试数据，用一份与演示数据同口径的结论，
     让「发布检查」「策略保存」在预览里也是完整可点的流程，而不是 undefined */
  function mockReleaseCheck(url) {
    var pm = /[?&]planId=([^&]+)/.exec(url);
    var planId = pm ? decodeURIComponent(pm[1]) : null;
    var failedCase = { caseId: "C1", caseNo: 3, title: "启动性能", demandTitle: "首页加载优化",
                       result: "failed", required: true };
    var check = {
      versionId: "V1", planId: planId, planRevision: planId ? 4 : null,
      policy: routes["/api/preview/release-policy"] || "standard", verdict: "block",
      blockers: ["发布必测用例失败或阻塞 1 条"],
      reminders: [],
      caseTotal: 4, caseExecuted: 4, casePassed: 2, caseFailed: 1, caseBlocked: 1, caseSkipped: 0, caseUntested: 0,
      requiredTotal: 1, requiredPassed: 0, requiredFailed: 1, requiredUntested: 0,
      demandsTotal: 3, demandsCovered: 1, workItemsTotal: 17, workItemsCovered: 3,
      requiredFailures: [failedCase], requiredUnexecuted: [], demandTitles: ["首页加载优化"],
      checkedAt: ts(0, 10, 0)
    };
    if (!planId) check.reminders.push("未关联发布计划：按本版本全部测试计划核对发布必测用例，覆盖分母为版本范围");
    return check;
  }

  /* 关注与协作：预览稿在内存里维护名单，关注/取消/代他人增删都能看到回流 */
  var watchDemo = {};
  var WATCH_NAMES = { U1: "我", U2: "陈工", U3: "李雷" };
  function watchBox(taskId) {
    if (!watchDemo[taskId]) {
      watchDemo[taskId] = { self: false, list: [{ userId: "U2", userName: "陈工", createdAt: ts(-3, 9, 30) }] };
    }
    return watchDemo[taskId];
  }
  function watchResult(taskId) {
    var box = watchBox(taskId);
    return { watching: box.self, count: box.list.length, canManage: true, watchers: box.list };
  }
  function mockTaskWatch(taskId, method) {
    var box = watchBox(taskId);
    if (method === "POST") {
      box.self = true;
      if (!box.list.some(function (w) { return w.userId === "U1"; })) {
        box.list.unshift({ userId: "U1", userName: "我", createdAt: ts(0, 10, 0) });
      }
    } else if (method === "DELETE") {
      box.self = false;
      box.list = box.list.filter(function (w) { return w.userId !== "U1"; });
    }
    return watchResult(taskId);
  }
  function mockTaskWatcher(taskId, method, userId, body) {
    var box = watchBox(taskId);
    if (method === "POST") {
      var uid = body && body.userId;
      if (uid && !box.list.some(function (w) { return w.userId === uid; })) {
        box.list.push({ userId: uid, userName: WATCH_NAMES[uid] || uid, createdAt: ts(0, 10, 0) });
      }
    } else if (method === "DELETE" && userId) {
      box.list = box.list.filter(function (w) { return w.userId !== userId; });
      if (userId === "U1") box.self = false;
    }
    return watchResult(taskId);
  }

  window.fetch = function (url, opts) {
    var method = (opts && opts.method) || "GET";
    var u = String(url), clean = u.split("?")[0];
    /* 预览稿里 config.js 拿不到 currentScript.src，apiBase 回退成 "/hourglass"，
       请求会带这个前缀；路由表统一按 "/api/…" 登记，这里把前缀剥掉再匹配 */
    var apiAt = clean.indexOf("/api/");
    if (apiAt > 0) clean = clean.slice(apiAt);
    var reqBody = null;
    if (opts && opts.body) { try { reqBody = JSON.parse(opts.body); } catch (e) { reqBody = null; } }
    var data;
    if (clean === "/api/calendar") {
      var mM = /[?&]month=(\d+)/.exec(u), yM = /[?&]year=(\d+)/.exec(u);
      data = { year: yM ? Number(yM[1]) : Y, month: mM ? Number(mM[1]) : M, tasks: calTasks };
    } else if (clean === "/api/tasks/list") {
      /* 列表/甘特/未排期共用：按查询参数筛选，并保持 {items,total} 结构 */
      data = mockTaskList(u);
    } else if (clean === "/api/tasks/canceled") {
      data = canceledRoute(u);
    } else if (method === "POST" && /^\/api\/tasks\/[A-Za-z0-9_-]+\/cancel$/.test(clean)) {
      data = mockCancel(clean.split("/")[3], reqBody);
    } else if (method === "POST" && /^\/api\/tasks\/[A-Za-z0-9_-]+\/uncancel$/.test(clean)) {
      data = mockUncancel(clean.split("/")[3]);
    } else if (/^\/api\/tasks\/[A-Za-z0-9_-]+\/watch$/.test(clean)) {
      /* 本人的关注开关：GET 读状态，POST/DELETE 切关注态 */
      data = mockTaskWatch(clean.split("/")[3], method);
    } else if (/^\/api\/tasks\/[A-Za-z0-9_-]+\/watchers(\/[A-Za-z0-9_-]+)?$/.test(clean)) {
      /* 代他人添加/移除关注人 */
      data = mockTaskWatcher(clean.split("/")[3], method, clean.split("/")[5], reqBody);
    } else if (clean === "/api/demands/page") {
      /* 工作项抽屉的「关联需求」候选：生产分页返回，这里给两条可关联 + 一条待评审 */
      var dpM = /[?&]reqId=([^&]*)/.exec(u);
      var dpReq = dpM ? decodeURIComponent(dpM[1]) : "";
      var demoDemands = [
        { id: "D1", title: "权限中台统一鉴权", status: "plan", reqId: "R1", versionStatus: "planned",
          itemKind: "新功能", priority: "P1", wsjfScore: 6.4, expectDate: "2026-12-05",
          versionId: "V1", versionName: "1.2 权限改造", plannedStart: "2026-11-14", plannedEnd: "2026-11-27",
          source: "客户反馈", createdAt: "2026-11-10 10:20" },
        { id: "D2", title: "结算对账异常治理", status: "review", reqId: "R2", versionStatus: "",
          itemKind: "体验优化", priority: "P0", wsjfScore: 8.1, expectDate: "2026-11-28",
          source: "线上问题", createdAt: "2026-11-18 14:05" },
        { id: "D3", title: "导出能力增强", status: "pass", reqId: "R1", versionStatus: "",
          itemKind: "新功能", priority: "P2", wsjfScore: 3.2, expectDate: "2026-12-12",
          source: "内部规划", createdAt: "2026-11-16 09:40" }
      ];
      var dpRows = demoDemands.filter(function (d) { return !dpReq || d.reqId === dpReq; });
      data = { items: dpRows, total: dpRows.length, hasMore: false };
    } else if (clean === "/api/branches/options") {
      /* 工作项抽屉的分支候选：生产按项目返回分页结果，这里给可演示的三档状态 */
      var bpoM = /[?&]project=([^&]*)/.exec(u);
      var bpoProject = bpoM ? decodeURIComponent(bpoM[1]) : "";
      var bpoRows = branches.map(function (b, i) {
        return { id: b.id, name: b.name, status: b.status, targetBranch: b.targetBranch, reqId: i === 2 ? "R2" : "R1" };
      }).filter(function (b) { return !bpoProject || b.reqId === bpoProject; });
      data = { items: bpoRows, total: bpoRows.length, hasMore: false };
    } else if (clean === "/api/release-plan-tasks") {
      /* 多版本计划的候选池：生产返回工作项数组，前端直接 forEach；
         回空对象会抛 "source.forEach is not a function"，计划页签整块空白 */
      data = tasks;
    } else if (clean === "/api/manager/workload") {
      data = mockWorkload(u);
    } else if (/^\/api\/projects\/[A-Za-z0-9_-]+\/release-policy$/.test(clean)) {
      /* 策略即时保存：写回内存，重新打开项目也保持刚才的选择 */
      if (method === "PUT") {
        var policyM = /[?&]policy=([^&]+)/.exec(u);
        routes["/api/preview/release-policy"] = policyM ? decodeURIComponent(policyM[1]) : "standard";
      }
      data = routes["/api/preview/release-policy"] || "standard";
    } else if (/^\/api\/versions\/[A-Za-z0-9_-]+\/release-check$/.test(clean)) {
      data = mockReleaseCheck(u);
    } else if (method === "POST" && /^\/api\/versions\/[A-Za-z0-9_-]+\/release-preview$/.test(clean)) {
      var previewCheck = mockReleaseCheck("");
      data = {
        versionId: "V1", planId: reqBody && reqBody.planId, planRevision: reqBody && reqBody.planId ? 4 : null,
        occurredAt: reqBody && reqBody.occurredAt, publishedOn: shift(0),
        environment: reqBody && reqBody.environment, targetKeys: (reqBody && reqBody.targetKeys) || [],
        coverage: reqBody && reqBody.coverage, actualTaskIds: (reqBody && reqBody.actualTaskIds) || [],
        plannedTaskIds: (reqBody && reqBody.actualTaskIds) || [], candidates: [], excluded: [], warnings: [],
        requiresDeviationReason: false, testCheck: previewCheck, canPublish: true,
        scopeToken: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      };
    } else if (method === "PUT" && /^\/api\/tasks\/[A-Za-z0-9_-]+$/.test(clean)) {
      /* 预览稿里把改期写回内存数组，拖动/撤销/排期才能看到真实回流 */
      var putId = clean.split("/").pop(), hit = null;
      for (var ti = 0; ti < tasks.length; ti++) if (tasks[ti].id === putId) { hit = tasks[ti]; break; }
      if (!hit) {
        for (var ci = 0; ci < calTasks.length; ci++) if (calTasks[ci].id === putId) { hit = calTasks[ci]; break; }
      }
      if (hit && reqBody) {
        for (var pk in reqBody) if (Object.prototype.hasOwnProperty.call(reqBody, pk)) hit[pk] = reqBody[pk];
      }
      data = hit || {};
    } else if (method === "PUT" && /^\/api\/req-docs\/[A-Za-z0-9_-]+\/status$/.test(clean)) {
      /* 看板拖拽：状态写回内存数组，界面能看到卡片真的换了列 */
      var sId = clean.split("/")[3], sDoc = null;
      for (var si = 0; si < reqDocs.length; si++) if (reqDocs[si].id === sId) { sDoc = reqDocs[si]; break; }
      if (sDoc && reqBody) {
        sDoc.status = reqBody.status;
        var now = new Date();
        sDoc.updatedAt = ts(0, now.getHours(), now.getMinutes());
      }
      data = sDoc || {};
    } else if (method === "PUT" && /^\/api\/req-docs\/[A-Za-z0-9_-]+\/publish$/.test(clean)) {
      /* 发布/收回发布：写回内存里的 publishedAt，列表与正文徽标才能切到「已发布」 */
      var pId = clean.split("/")[3], pDoc = null;
      for (var pi = 0; pi < reqDocs.length; pi++) if (reqDocs[pi].id === pId) { pDoc = reqDocs[pi]; break; }
      if (pDoc) {
        var pNow = new Date();
        pDoc.publishedAt = (reqBody && reqBody.published) ? ts(0, pNow.getHours(), pNow.getMinutes()) : null;
        pDoc.updatedAt = ts(0, pNow.getHours(), pNow.getMinutes());
      }
      data = pDoc || {};
    } else if (method === "PUT" && /^\/api\/req-docs\/[A-Za-z0-9_-]+\/title$/.test(clean)) {
      /* 行内重命名：标题写回内存，左树/列表/阅读器标题同步 */
      var tId = clean.split("/")[3], tDoc = null;
      for (var tli = 0; tli < reqDocs.length; tli++) if (reqDocs[tli].id === tId) { tDoc = reqDocs[tli]; break; }
      if (tDoc && reqBody && reqBody.title) {
        tDoc.title = reqBody.title;
        tDoc.updatedAt = ts(0, new Date().getHours(), new Date().getMinutes());
      }
      data = tDoc || {};
    } else if (method === "POST" && clean === "/api/req-docs/reorder") {
      /* 阅读树拖拽排序/移动：sortOrder 与 parentId 写回内存，重绘后顺序不回跳 */
      var rItems = (reqBody && reqBody.items) || [];
      for (var ri = 0; ri < rItems.length; ri++) {
        for (var rj = 0; rj < reqDocs.length; rj++) if (reqDocs[rj].id === rItems[ri].id) {
          if (rItems[ri].sortOrder !== undefined) reqDocs[rj].sortOrder = rItems[ri].sortOrder;
          reqDocs[rj].parentId = rItems[ri].parentId || null;
        }
      }
      data = { ok: true };
    } else if (method === "PUT" && /^\/api\/req-docs\/[A-Za-z0-9_-]+$/.test(clean)) {
      /* 编辑器保存：把标题/正文/状态写回内存，重新打开还能看到刚保存的内容 */
      var eId = clean.split("/").pop(), eDoc = null;
      for (var ei = 0; ei < reqDocs.length; ei++) if (reqDocs[ei].id === eId) { eDoc = reqDocs[ei]; break; }
      if (eDoc && reqBody) {
        ["title", "content", "status", "format", "docType", "parentId"].forEach(function (k) {
          if (reqBody[k] !== undefined) eDoc[k] = reqBody[k];
        });
        eDoc.updatedAt = ts(0, new Date().getHours(), new Date().getMinutes());
      }
      data = eDoc || {};
    } else if (clean === "/api/categories" && method === "GET") {
      var cpm = /[?&]project=([^&]+)/.exec(u);
      var cpid = cpm ? decodeURIComponent(cpm[1]) : "";
      var allCats = routes["/api/categories"];
      data = cpid ? allCats.filter(function (c) { return c.projectId === cpid; }) : allCats;
    } else if (clean === "/api/categories" && method === "POST") {
      var npm = /[?&]project=([^&]+)/.exec(u);
      var np = npm ? decodeURIComponent(npm[1]) : "";
      var cats = routes["/api/categories"];
      var nc = { id: "C" + (cats.length + 1), name: (reqBody && reqBody.name) || "新模块",
                 color: (reqBody && reqBody.color) || "#98A2B3", sortOrder: cats.length, projectId: np };
      cats.push(nc);
      data = nc;
    } else if (clean === "/api/categories/order" && method === "PUT") {
      var orderIds = (reqBody && reqBody.ids) || [];
      var catAll = routes["/api/categories"].slice(), catOrdered = [];
      orderIds.forEach(function (id) {
        for (var oi = 0; oi < catAll.length; oi++) if (catAll[oi].id === id) { catOrdered.push(catAll[oi]); break; }
      });
      catAll.forEach(function (c) { if (orderIds.indexOf(c.id) < 0) catOrdered.push(c); });
      routes["/api/categories"] = catOrdered;
      data = {};
    } else if (/^\/api\/categories\/[A-Za-z0-9_-]+$/.test(clean) && method === "PUT") {
      var cedit = clean.split("/").pop();
      routes["/api/categories"].forEach(function (c) {
        if (c.id === cedit && reqBody) {
          if (reqBody.name) c.name = reqBody.name;
          if (reqBody.color) c.color = reqBody.color;
        }
      });
      data = {};
    } else if (/^\/api\/categories\/[A-Za-z0-9_-]+$/.test(clean) && method === "DELETE") {
      var cdel = clean.split("/").pop();
      routes["/api/categories"] = routes["/api/categories"].filter(function (c) { return c.id !== cdel; });
      data = {};
    } else if (clean === "/api/versions" && method === "GET") {
      /* 工作项抽屉的「计划版本」候选与版本页共用一份，生产按项目过滤 */
      var vqM = /[?&]reqId=([^&]*)/.exec(u);
      var vqReq = vqM ? decodeURIComponent(vqM[1]) : "";
      data = previewVersions.filter(function (v) { return !vqReq || v.reqId === vqReq; });
    } else if (/^\/api\/versions\/[A-Za-z0-9_-]+\/release-plans$/.test(clean)) {
      var rpVid = clean.split("/")[3];
      data = releasePlans.filter(function (p) { return (p.versionIds || []).indexOf(rpVid) >= 0; });
    } else if (/^\/api\/versions\/[A-Za-z0-9_-]+\/release-records$/.test(clean)) {
      var rrVid = clean.split("/")[3];
      data = releaseRecords.filter(function (r) { return r.versionId === rrVid; });
    } else if (clean === "/api/release-plans" && method === "GET") {
      data = releasePlans;
    } else if (clean === "/api/release-plan-options") {
      data = { projects: ["R1", "R2"].map(function (rid) {
        return { id: rid, name: rid === "R1" ? "流程引擎" : "结算改造",
          versions: previewVersions.filter(function (v) { return v.reqId === rid; })
            .map(function (v) { return { id: v.id, name: v.name, status: v.status, targetDate: v.targetDate }; }) };
      }) };
    } else if (clean === "/api/versions/stats" && method === "GET") {
      var vsM = /[?&]reqId=([^&]*)/.exec(u);
      var vsReq = vsM ? decodeURIComponent(vsM[1]) : "";
      var vsRows = previewVersions.filter(function (v) { return !vsReq || v.reqId === vsReq; });
      data = { versions: vsRows, unbound: { taskCount: 5, doneCount: 2, estimateMinutes: 600, workMinutes: 480, devMinutes: 380, testMinutes: 100 } };
    } else if (clean === "/api/versions/task-options") {
      /* 工作项抽屉的「所属史诗」候选：生产由后端按项目过滤，这里给两条演示史诗 */
      var optM = /[?&]reqId=([^&]*)/.exec(u);
      var optReq = optM ? decodeURIComponent(optM[1]) : "";
      var epicRows = [
        { id: "E1", title: "权限体系重构（史诗）", itemType: "epic", reqId: "R1", epicId: null },
        { id: "E2", title: "结算链路升级（史诗）", itemType: "epic", reqId: "R2", epicId: null }
      ];
      data = epicRows.concat(tasks.map(function (t, i) {
        var row = { id: t.id, title: t.title, itemType: t.itemType || "task", epicId: t.epicId || null, reqId: t.reqId || null,
          /* 版本页焦点卡 / 阶段汇总演示：流程引擎的工作项挂 V1，结算项目挂 V7 */
          versionIds: t.reqId === "R2" ? ["V7"] : (t.reqId === "R1" ? ["V1"] : []),
          owner: t.owner || "我", categoryId: null, demandId: null,
          estimateMinutes: t.estimateMinutes || (t.reqId === "R1" ? 480 : 0), totalMinutes: t.totalMinutes || 0,
          testMinutes: t.id === "K1" ? 120 : 0, blocked: !!t.blocked, boardColumn: t.boardColumn };
        /* 演示发布状态：每四条一条生产生效、一条人工补录，供版本「管理工作项」的徽标/筛选/分组页看效果 */
        if (i % 4 === 0) {
          row.publicationState = "effective";
          row.everPublished = true;
          row.publishedAt = "2026-11-10";
          row.publicationTargets = ["prod"];
        } else if (i % 4 === 1) {
          row.manualPublished = true;
          row.manualPublishedAt = "2026-10-22";
        }
        return row;
      })).filter(function (t) { return !optReq || t.reqId === optReq; });
      /* 焦点卡按「6 个工作项 · 2 项已完成 · 48h 预估」演示；补两条已完成工作项，
         让单版本阶段汇总与卡片口径一致 */
      if (!optReq || optReq === "R1") {
        data = data.concat([
          { id: "K1D1", title: "权限矩阵联动校验", itemType: "task", epicId: null, reqId: "R1", versionIds: ["V1"],
            owner: "我", categoryId: null, demandId: "D1", estimateMinutes: 480, totalMinutes: 300,
            testMinutes: 0, blocked: false, boardColumn: "done" },
          { id: "K1D2", title: "压测脚本与基线", itemType: "task", epicId: null, reqId: "R1", versionIds: ["V1"],
            owner: "我", categoryId: null, demandId: "D1", estimateMinutes: 480, totalMinutes: 420,
            testMinutes: 0, blocked: false, boardColumn: "done" }
        ]);
      }
    } else if (clean === "/api/completions") {
      data = mockCompletions(u);
    } else if (clean === "/api/gantt") {
      data = mockGantt(u);
    } else if (clean === "/api/gantt/deps" && method === "GET") {
      data = ganttDeps;
    } else if (clean === "/api/gantt/deps" && method === "POST") {
      var nd = { id: "D" + (ganttDeps.length + 1), workspaceId: "W1", fromTaskId: reqBody.fromTaskId,
                 toTaskId: reqBody.toTaskId, depType: reqBody.depType || "FS", lagDays: reqBody.lagDays || 0 };
      ganttDeps.push(nd);
      data = nd;
    } else if (/^\/api\/gantt\/deps\/[A-Za-z0-9_-]+$/.test(clean) && method === "PUT") {
      var did2 = clean.split("/").pop();
      ganttDeps.forEach(function (d) { if (d.id === did2) { d.depType = reqBody.depType; d.lagDays = reqBody.lagDays; } });
      data = {};
    } else if (/^\/api\/gantt\/deps\/[A-Za-z0-9_-]+$/.test(clean) && method === "DELETE") {
      var did3 = clean.split("/").pop();
      ganttDeps = ganttDeps.filter(function (d) { return d.id !== did3; });
      data = {};
    } else if (clean === "/api/gantt/baseline" && method === "GET") {
      data = { baseline: ganttBaseline, baselineAt: ganttBaselineAt };
    } else if (clean === "/api/gantt/baseline" && method === "POST") {
      ganttBaseline = {};
      tasks.forEach(function (t) {
        if (t.startDate || t.dueDate) ganttBaseline[t.id] = { startDate: t.startDate, dueDate: t.dueDate };
      });
      ganttBaselineAt = ts(0, 12, 0);
      data = { baseline: ganttBaseline, baselineAt: ganttBaselineAt };
    } else if (clean === "/api/gantt/baseline" && method === "DELETE") {
      ganttBaseline = {};
      ganttBaselineAt = null;
      data = {};
    } else if (clean === "/api/gantt/load") {
      data = mockGanttLoad(u);
    } else if (clean === "/api/gantt/share" && method === "GET") {
      data = { token: "previewtoken", workspaceId: "W1", createdAt: ts(0, 9, 0), expiresAt: ts(30, 9, 0) };
    } else if (clean === "/api/gantt/share" && method === "POST") {
      data = { token: "previewtoken", workspaceId: "W1", createdAt: ts(0, 9, 0), expiresAt: ts(30, 9, 0) };
    } else if (clean === "/api/gantt/share" && method === "DELETE") {
      data = {};
    } else if (clean === "/api/share/gantt") {
      data = { workspaceName: "我的看板", generatedAt: ts(0, 10, 0), baselineAt: ganttBaselineAt,
               tasks: tasks, deps: ganttDeps, baseline: ganttBaseline };
    } else if (clean === "/api/review") {
      /* 带上 weekOffset：翻上一周要看到不同的数据，否则测不出「AI 周报跟着周走」 */
      var wM = /[?&]weekOffset=(-?\d+)/.exec(u);
      data = reviewAt(wM ? Number(wM[1]) : 0);
    } else if (clean === "/api/review/hour-logs") {
      /* 工时卡下钻：分钟数与 review 的 workMinutes 对齐（本周 705 = 11h45m，上周 420） */
      var hM = /[?&]weekOffset=(-?\d+)/.exec(u);
      var hOff = hM ? Number(hM[1]) : 0;
      var hItems = hOff === 0
        ? [
            { id: 1, date: shift(-5), member: "我", taskId: "K1", title: "重构权限校验中间件", reqId: "R1", reqName: "流程引擎", minutes: 240, origin: "auto" },
            { id: 2, date: shift(-3), member: "我", taskId: "K2", title: "导出 CSV 补工时列", reqId: "R1", reqName: "流程引擎", minutes: 120, origin: "auto" },
            { id: 3, date: shift(-2), member: "我", taskId: "K8", title: "代理登录权限修正", reqId: null, reqName: null, minutes: 225, origin: "manual" },
            { id: 4, date: shift(-1), member: "我", taskId: "K7", title: "登录重构与验证码", reqId: null, reqName: null, minutes: 120, origin: "auto" }
          ]
        : [
            { id: 5, date: shift(hOff * 7 - 1), member: "我", taskId: "K7", title: "登录重构与验证码", reqId: null, reqName: null, minutes: 240, origin: "auto" },
            { id: 6, date: shift(hOff * 7 - 3), member: "我", taskId: "K8", title: "代理登录权限修正", reqId: null, reqName: null, minutes: 180, origin: "auto" }
          ];
      data = {
        weekOffset: hOff, weekStart: shift(-6 + hOff * 7), weekEnd: shift(hOff * 7),
        total: hItems.length, offset: 0, limit: 100, hasMore: false,
        totalMinutes: hItems.reduce(function (sum, x) { return sum + x.minutes; }, 0),
        items: hItems
      };
    } else if (clean === "/api/ai/review/polish") {
      /* 周报接口的返回值跟着请求里的 weekOffset 走（预览稿里没有真模型，body 里就是刚填的补充说明） */
      var off = reqBody && typeof reqBody.weekOffset === "number" ? reqBody.weekOffset : 0;
      var pol = routes["/api/ai/review/polish"];
      data = {
        weekOffset: off, label: off === 0 ? "本周" : (off === -1 ? "上周" : "该周期"),
        weekStart: shift(-6 + off * 7), weekEnd: shift(off * 7),
        report: pol.report, source: pol.source, usage: pol.usage
      };
      if (off !== 0) {
        data.report = "## 本周完成\n- 完成登录重构与验证码改造\n- 修正代理登录权限判断\n\n"
          + "## 进行中\n- 权限校验中间件改造（进度 60%）\n\n"
          + "## 风险与阻塞\n- 8 项 P0 未关闭\n\n"
          + "## 下周计划\n- 推进权限中间件提测\n";
        data.source = { completed: 2, progress: 2, pendingDone: 0, truncated: false, chars: 980, withNote: !!reqBody.note };
      }
    } else if (method === "PUT" && clean === "/api/admin/ai-settings") {
      /* 管理员保存写回内存：切换总开关 / 个人 Key 限制后再打开仍保持刚才的选择 */
      var adminAi = routes["/api/admin/ai-settings"];
      var ab = reqBody || {};
      if (ab.provider) adminAi.provider = ab.provider;
      if (typeof ab.baseUrl === "string") adminAi.baseUrl = ab.baseUrl;
      if (typeof ab.model === "string") adminAi.model = ab.model;
      if (typeof ab.enabled === "boolean") adminAi.enabled = ab.enabled;
      if (typeof ab.allowPersonal === "boolean") adminAi.allowPersonal = ab.allowPersonal;
      if (ab.clearKey) { adminAi.hasKey = false; adminAi.apiKeyMasked = ""; }
      else if (ab.apiKey) { adminAi.hasKey = true; adminAi.apiKeyMasked = "sk-****" + String(ab.apiKey).slice(-4); }
      adminAi.keyBroken = false;
      adminAi.status = !adminAi.enabled ? "团队 AI 未启用"
        : (adminAi.hasKey && adminAi.model ? "已就绪：全员调用走团队额度" : "已保存，但还缺 Key 或模型");
      adminAi.updatedBy = "平台管理员";
      adminAi.updatedAt = ts(0, 12, 0);
      var meAi = routes["/api/ai/config"];
      meAi.allowPersonal = adminAi.allowPersonal;
      meAi.team = { available: !!(adminAi.enabled && adminAi.hasKey && adminAi.model),
                    scope: "platform", provider: adminAi.provider, model: adminAi.model,
                    status: adminAi.enabled ? "由平台管理员提供，费用由团队承担" : "平台尚未启用团队 AI" };
      data = adminAi;
    } else if (method === "PUT" && clean === "/api/ai/config") {
      /* 成员切换来源写回内存：保存后状态与来源标签跟着变 */
      var me = routes["/api/ai/config"];
      var mb = reqBody || {};
      if (mb.prefer) me.prefer = mb.prefer;
      if (typeof mb.enabled === "boolean") me.enabled = mb.enabled;
      if (typeof mb.apiKey === "string" && mb.apiKey) {
        me.hasKey = true;
        me.apiKeyMasked = "sk-****" + mb.apiKey.slice(-4);
      }
      var teamOn = me.prefer !== "personal" && me.team.available;
      me.source = teamOn ? "team" : "personal";
      me.sourceName = teamOn ? "团队 AI" : "我的 API Key";
      me.status = !me.enabled ? "AI 已关闭" : (teamOn ? "已就绪：调用走团队额度" : "已就绪：调用走我的额度");
      data = me;
    } else if (method === "POST" && /^\/api\/req-docs\/[A-Za-z0-9_-]+\/comments$/.test(clean)) {
      /* 发表评论写回内存：侧栏与角标刷新后能看到新评论 */
      var cDocId = clean.split("/")[3];
      var cBucket = docComments[cDocId] || (docComments[cDocId] = []);
      var cNew = { id: 90 + cBucket.length, userName: "我", createdAt: ts(0, 12, 0), resolved: false,
                   quoteText: (reqBody && reqBody.quoteText) || "",
                   content: (reqBody && reqBody.content) || "", deletable: true };
      cBucket.push(cNew);
      data = cNew;
    } else if (method === "DELETE" && /^\/api\/req-docs\/[A-Za-z0-9_-]+\/comments\/[A-Za-z0-9_-]+$/.test(clean)) {
      var cDelId = clean.split("/").pop();
      Object.keys(docComments).forEach(function (k) {
        docComments[k] = docComments[k].filter(function (c) { return String(c.id) !== cDelId; });
      });
      data = {};
    } else {
      /* 非 GET 也要走 pick：AI 的拆分/体检都是 POST，返回空对象会让界面直接报错 */
      var picked = pick(clean);
      data = (picked === undefined) ? {} : picked;
    }
    /* AI 周报在真机上是 10-30 秒的长请求：这里故意拖 400ms，
       否则「生成中」的置灰与骨架屏一帧就闪过去了，界面上什么都看不到 */
    var waitMs = clean === "/api/ai/review/polish" ? 400 : 0;
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          status: 200,
          ok: true,
          /* api.js 的 ETag 协商会读 res.headers.get("ETag")：预览没有 ETag，返回 null 即可 */
          headers: { get: function () { return null; } },
          text: function () { return Promise.resolve(JSON.stringify({ code: 0, data: data })); }
        });
      }, waitMs);
    });
  };

  try {
    localStorage.removeItem("ds.view");
    localStorage.setItem("ds.kbdSeen", "1");
  } catch (e) { /* noop */ }
})();
