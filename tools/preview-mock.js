/* 静态预览稿的演示数据（docs/ui-preview.html 专用，不连后端）
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
        totalMinutes: 520, estimateMinutes: 480 }),
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

  /* /api/tasks/list 的筛选在预览里也照做：筛选/分组/清除的界面效果才可验证 */
  function mockTaskList(url) {
    var p = new URLSearchParams(url.split("?")[1] || "");
    function list(name) { var v = p.get(name); return v ? v.split(",") : []; }
    var owners = list("owners"), pris = list("pris"), cats = list("cats"),
        reqs = list("reqs"), tags = list("tags");
    var kw = p.get("q") || "", due = p.get("due");
    var blockedOnly = p.get("blocked") === "true";
    var noDue = p.get("noDue") === "true";
    var todayIso = shift(0);
    var items = tasks.filter(function (t) {
      if (kw && (t.title || "").indexOf(kw) === -1 && (t.description || "").indexOf(kw) === -1) return false;
      if (owners.length && owners.indexOf(t.owner) === -1) return false;
      if (pris.length && pris.indexOf(t.priority) === -1) return false;
      if (cats.length && cats.indexOf(t.category) === -1) return false;
      if (reqs.length && reqs.indexOf(t.reqId) === -1) return false;
      if (tags.length && !(t.tags || []).some(function (x) { return tags.indexOf(x) !== -1; })) return false;
      if (noDue && t.dueDate) return false;
      if (blockedOnly && !t.blocked) return false;
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
    counts: { over: 3, today: 1, soon: 4 },
    meta: {
      owners: [{ name: "我", count: 12 }],
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
    catDist: [{ name: "后端", count: 3 }],
    /* 进行中：一条进度 60、一条进度 0（都因为"在进行中列"而出现） */
    progressTasks: doing,
    reqDist: [{ id: "R1", name: "流程引擎", status: "active", progressPct: 62, taskCount: 4, doneCount: 2 }],
    pendingDone: [],
    counts: { over: 3, today: 1, soon: 4 },
    workMinutes: { space: 2410, mine: 1255, spaceWeek: 705 },
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
      out.catDist = [{ name: "后端", count: 2 }];
      out.pendingDone = [];
      out.openP0 = 8;
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
      content: '<h1>目标</h1><p>把日终跑批拆成"取数 / 核对 / 落账"三段。</p>' +
        '<h2>拆分后的好处</h2><ul><li>某一段失败可以只重跑那一段</li><li>取数阶段能提前开始</li></ul>' },
    { id: "D4", reqId: "R2", reqName: "结算改造", title: "对账差异回溯", status: "draft",
      owner: "陈工", excerpt: null, taskCount: 0, doneCount: 0,
      createdAt: ts(-3, 14, 10), updatedAt: ts(-3, 14, 10),
      content: '<p>待补充：差异明细怎么存档、保留多久。</p>' },

    { id: "D2", reqId: "R1", reqName: "流程引擎", title: "对账落库需求", status: "draft",
      owner: "我", excerpt: "异常明细单独建表，附原流水号便于回溯",
      taskCount: 0, doneCount: 0, createdAt: ts(-5, 15, 0), updatedAt: ts(-2, 18, 0),
      content: '<h1>背景</h1><p>对账失败的单子目前只在日志里，查起来很痛苦。</p>' +
        '<h2>做法</h2><ul><li>异常明细单独建表</li><li>保留原流水号与失败原因</li></ul>' }
  ];

  /* 任务清单：任务完成快照（月度统计） */
  var completions = [
    { id: 4, workspaceId: "W1", taskId: "K7", title: "登录重构与验证码", description: "统一验证码与登录态，去掉重复的 token 刷新",
      reqId: "R1", reqName: "流程引擎", reqDocId: "D1", reqDocTitle: "权限校验需求",
      owner: "我", ownerUserId: "U1", category: "后端", priority: "P2",
      startDate: shift(-9), completedAt: shift(-1), firstStartedAt: ts(-9, 9, 10), lastEndedAt: ts(-1, 17, 30),
      totalMinutes: 480, createdAt: ts(-1, 17, 31) },
    { id: 3, workspaceId: "W1", taskId: "K8", title: "代理登录权限修正", description: "代理人登录后菜单权限未刷新",
      reqId: null, reqName: null, owner: "陈工", ownerUserId: "U2", category: "后端", priority: "P1",
      startDate: shift(-6), completedAt: shift(-3), firstStartedAt: ts(-6, 14, 0), lastEndedAt: ts(-3, 11, 20),
      totalMinutes: 205, createdAt: ts(-3, 11, 21) },
    { id: 2, workspaceId: "W1", taskId: "K15", title: "归档脚本重试机制", description: "失败批次隔 5 分钟重试，最多 3 次",
      reqId: "R1", reqName: "流程引擎", owner: "我", ownerUserId: "U1", category: "后端", priority: "P2",
      startDate: shift(-12), completedAt: shift(-7), firstStartedAt: null, lastEndedAt: null,
      totalMinutes: 0, createdAt: ts(-7, 18, 0) },
    { id: 1, workspaceId: "W1", taskId: "K16", title: "对账异常明细落库", description: "异常明细单独建表，附原流水号",
      reqId: "R1", reqName: "流程引擎", owner: "我", ownerUserId: "U1", category: "后端", priority: "P0",
      startDate: shift(-20), completedAt: shift(-14), firstStartedAt: ts(-20, 9, 0), lastEndedAt: ts(-14, 16, 40),
      totalMinutes: 900, createdAt: ts(-14, 16, 41) }
  ];

  var ws = {
    id: "W1", name: "我的看板", type: "personal", myRole: "owner", memberCount: 1, ownerId: "U1",
    notifyWebhook: null, notifyChannel: "webhook", notifyEnabled: true, notifyLastStatus: "success"
  };

  var routes = {
    /* 演示用：当前登录者是「普通用户」，同时是共享空间「团队空间」的空间主
       —— 设置页应只给邀请链接，不给"按登录名直接加人" */
    "/api/auth/me": { id: "U1", displayName: "我", username: "me", role: "user", lastWorkspaceId: "W2",
      workStartHour: 9, workEndHour: 18, workMaxHours: 8 },
    "/api/workspaces": [ws, { id: "W2", name: "团队空间", type: "shared", myRole: "owner", memberCount: 3, ownerId: "U1" }],
    "/api/board": board,
    "/api/tasks/list": { items: tasks, total: tasks.length },
    "/api/reqs": [
      { id: "R1", name: "流程引擎", status: "active", progressPct: 62, taskCount: 4, doneCount: 2, owner: "我" },
      { id: "R2", name: "结算改造", status: "active", progressPct: 20, taskCount: 2, doneCount: 0, owner: "我" }
    ],
    "/api/views": [{ id: "V1", name: "我的 P0", params: { pris: ["P0"] } }],
    /* 设置页「看板列 / 分类」用：之前缺这两条路由，预览会显示"加载失败" */
    "/api/columns": [
      { id: "backlog", name: "待处理", color: "#8a8578", sortOrder: 0, done: false },
      { id: "doing", name: "进行中", color: "#2563EB", sortOrder: 1, done: false },
      { id: "done", name: "已完成", color: "#12B76A", sortOrder: 2, done: true }
    ],
    "/api/categories": [
      { id: "C1", name: "后端", color: "#2563EB", sortOrder: 0 },
      { id: "C2", name: "前端", color: "#7C3AED", sortOrder: 1 },
      { id: "C3", name: "数据", color: "#0E9384", sortOrder: 2 }
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
      byCategory: [{ name: "后端", count: 8 }],
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
      status: "已就绪：调用会走你自己的额度",
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
    "/api/ai/config/test": { ok: true, latencyMs: 860, model: "deepseek-chat", reply: "正常", tokens: 42 },
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
      byCategory: [
        { category: "后端", sampleCount: 2, estimateTotal: 600, actualTotal: 1000, factor: 1.67 },
        { category: "运维", sampleCount: 1, estimateTotal: 120, actualTotal: 168, factor: 1.4 },
        { category: "前端", sampleCount: 1, estimateTotal: 300, actualTotal: 280, factor: 0.93 }
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
      suggestion: "你的估时偏乐观：过去 4 个已完成任务的实际投入是预估的 1.42 倍。下次填预估时，把心里的数乘 1.42 再填，会贴近真实。",
      note: "口径：实际 = 计时记录（只算工作时段、跳周末、每天封顶），不用开始/结束日期推算 —— 开始日期只代表什么时候接到的，不代表什么时候动手。样本 4 个已完成任务。另有 3 个已完成任务没开过计时，不计入（没记录 ≠ 干得快）。"
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
        { id: "done", name: "已完成", color: "#12B76A", segments: 0, totalSeconds: 0,
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
    if (clean === "/api/req-docs") {      return reqDocs.map(function (d) {
        return { id: d.id, reqId: d.reqId, reqName: d.reqName, title: d.title, status: d.status,
                 owner: d.owner, excerpt: d.excerpt, taskCount: d.taskCount, doneCount: d.doneCount,
                 createdAt: d.createdAt, updatedAt: d.updatedAt };
      });
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
    if (clean === "/api/completions") return completions;
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
      return [{ userId: "U1", displayName: "我", username: "me", role: "owner" }];
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

  window.fetch = function (url, opts) {
    var method = (opts && opts.method) || "GET";
    var u = String(url), clean = u.split("?")[0];
    var reqBody = null;
    if (opts && opts.body) { try { reqBody = JSON.parse(opts.body); } catch (e) { reqBody = null; } }
    var data;
    if (clean === "/api/calendar") {
      var mM = /[?&]month=(\d+)/.exec(u), yM = /[?&]year=(\d+)/.exec(u);
      data = { year: yM ? Number(yM[1]) : Y, month: mM ? Number(mM[1]) : M, tasks: calTasks };
    } else if (clean === "/api/tasks/list") {
      /* 列表/甘特/未排期共用：按查询参数筛选，并保持 {items,total} 结构 */
      data = mockTaskList(u);
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
