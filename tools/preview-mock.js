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
      subtaskTotal: 0, subtaskDone: 0, totalMinutes: 0, attachmentCount: 0,
      blocked: false, blockedReason: null, blockedByTaskId: null,
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
        startDate: shift(-3), dueDate: shift(2), tags: ["权限"], subtaskTotal: 4, subtaskDone: 2, totalMinutes: 320 }),
    T({ id: "K2", title: "导出 CSV 补工时列", priority: "P1", boardColumn: "doing", progress: 0,
        startDate: shift(-1), dueDate: shift(4), blocked: true, blockedReason: "等确认工时口径" })
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
  var tasks = backlog.concat(doing, done);

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
    "/api/auth/me": { id: "U1", displayName: "我", username: "me", role: "user", lastWorkspaceId: "W1" },
    "/api/workspaces": [ws, { id: "W2", name: "团队空间", type: "shared", myRole: "member", memberCount: 3, ownerId: "U2" }],
    "/api/board": board,
    "/api/tasks/list": { items: tasks, total: tasks.length },
    "/api/reqs": [
      { id: "R1", name: "流程引擎", status: "active", progressPct: 62, taskCount: 4, doneCount: 2, owner: "我" },
      { id: "R2", name: "结算改造", status: "active", progressPct: 20, taskCount: 2, doneCount: 0, owner: "我" }
    ],
    "/api/views": [{ id: "V1", name: "我的 P0", params: { pris: ["P0"] } }],
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
    "/api/stats": {
      weeks: [-4, -3, -2, -1, 0].map(function (dy) {
        return { start: shift(dy * 7 - 6), end: shift(dy * 7), created: 3, completed: 2 };
      }),
      byCategory: [{ name: "后端", count: 8 }],
      byOwner: [{ name: "我", count: 9 }],
      current: { backlog: 8, doing: 2, done: 3, other: 0, overdue: 3, workMinutes: 1255, workMinutesWeek: 320,
                 workMinutesAll: 2410, workMinutesWeekAll: 705 }
    },
    "/api/activity": [],
    "/api/notify/status": { enabled: true, channel: "webhook", lastStatus: "success", effectiveEnabled: true }
  };

  function pick(clean) {
    if (Object.prototype.hasOwnProperty.call(routes, clean)) return routes[clean];
    if (clean === "/api/req-docs") {
      return reqDocs.map(function (d) {
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

  window.fetch = function (url, opts) {
    var method = (opts && opts.method) || "GET";
    var u = String(url), clean = u.split("?")[0];
    var data;
    if (clean === "/api/calendar") {
      var mM = /[?&]month=(\d+)/.exec(u), yM = /[?&]year=(\d+)/.exec(u);
      data = { year: yM ? Number(yM[1]) : Y, month: mM ? Number(mM[1]) : M, tasks: calTasks };
    } else {
      data = (method === "GET") ? pick(clean) : {};
    }
    return Promise.resolve({
      status: 200,
      text: function () { return Promise.resolve(JSON.stringify({ code: 0, data: data })); }
    });
  };

  try {
    localStorage.removeItem("ds.view");
    localStorage.setItem("ds.kbdSeen", "1");
  } catch (e) { /* noop */ }
})();
