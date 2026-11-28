import { ToolError } from "./hourglass.js";

const workspace = {
  type: "string",
  description: "空间 ID；先调 list_workspaces 取得，必须显式传"
};
const offset = { type: "integer", minimum: 0, description: "分页偏移，默认 0" };
const limit = { type: "integer", minimum: 1, maximum: 100, description: "每页条数 1–100，默认 100" };

function need(args, name, label) {
  const value = args[name];
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new ToolError(`缺少必填参数 ${name}${label ? `（${label}）` : ""}`);
  }
  return String(value).trim();
}

function numberOf(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function page(args) {
  return {
    offset: Math.max(0, Math.trunc(numberOf(args.offset, 0))),
    limit: Math.min(100, Math.max(1, Math.trunc(numberOf(args.limit, 100))))
  };
}

/** 只把调用方明确给出的筛选项带进 query string */
function pick(args, mapping) {
  const query = {};
  for (const [argument, parameter] of Object.entries(mapping)) {
    const value = args[argument];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    query[parameter] = typeof value === "boolean" ? value : String(value);
  }
  return query;
}

/** 写请求体只带明确给出的字段，避免把 undefined 变成 "undefined" 或覆盖默认值 */
function compact(source) {
  const body = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    body[key] = value;
  }
  return body;
}

const BOARD_FILTERS = {
  q: "q",
  owners: "owners",
  pris: "pris",
  cats: "cats",
  reqs: "reqs",
  tags: "tags",
  types: "types",
  versions: "versions",
  columns: "columns",
  completion: "completion",
  due: "due",
  sort: "sort",
  open: "open"
};

export const TOOL_SPECS = [
  {
    name: "list_workspaces",
    description: "列出当前令牌账号可见的空间（含个人空间与共享空间、我的角色）。其他工具的第一步。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    build: () => ({ path: "/api/workspaces", query: {} })
  },
  {
    name: "list_projects",
    description:
      "列出空间内的项目（产品里的「项目 / 需求容器」，含任务数、完成数与平均进度）。项目 ID 可传给 list_demands、list_docs、list_test_cases、list_versions 的 projectId。",
    inputSchema: {
      type: "object",
      properties: { workspaceId: workspace, offset, limit },
      required: ["workspaceId"],
      additionalProperties: false
    },
    build: (args) => ({
      path: "/api/projects",
      query: { workspace: need(args, "workspaceId"), ...page(args) }
    })
  },
  {
    name: "query_tasks",
    description:
      "按条件查询工作项（story / task / bug / epic），返回分页列表与总数。owners / pris / tags 等为逗号分隔的显示名或代码；sort 取 due / priority / updated / column；open=true 只看未完成。",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: workspace,
        q: { type: "string", description: "关键字（标题或编号，支持 WI-001 / wi1 / 纯数字）" },
        owners: { type: "string", description: "负责人显示名，逗号分隔" },
        pris: { type: "string", description: "优先级，逗号分隔" },
        cats: { type: "string", description: "分类 ID，逗号分隔" },
        reqs: { type: "string", description: "项目 ID，逗号分隔；__none 表示未归类" },
        tags: { type: "string", description: "标签名，逗号分隔，命中任意一个即匹配" },
        types: { type: "string", description: "类型 story/task/bug/epic，逗号分隔" },
        versions: { type: "string", description: "影响版本 ID，逗号分隔；__none 表示待规划" },
        columns: { type: "string", description: "看板列（状态）ID，逗号分隔" },
        completion: { type: "string", enum: ["open", "done"], description: "完成情况；不传为全部" },
        due: { type: "string", enum: ["over", "today", "soon"], description: "逾期 / 今天到期 / 即将到期" },
        sort: { type: "string", enum: ["due", "priority", "updated", "column"], description: "排序字段" },
        open: { type: "boolean", description: "true=只看未完成" },
        offset,
        limit
      },
      required: ["workspaceId"],
      additionalProperties: false
    },
    build: (args) => ({
      path: "/api/tasks/list",
      query: { workspace: need(args, "workspaceId"), ...pick(args, BOARD_FILTERS), ...page(args) }
    })
  },
  {
    name: "get_task",
    description: "读取单个工作项详情（任务、缺陷或需求拆解），不存在或无权限统一返回 404。",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: workspace,
        taskId: { type: "string", description: "工作项 ID（不是 WI 编号）" }
      },
      required: ["workspaceId", "taskId"],
      additionalProperties: false
    },
    build: (args) => ({
      path: `/api/task/${encodeURIComponent(need(args, "taskId", "工作项 ID"))}`,
      query: { workspace: need(args, "workspaceId") }
    })
  },
  {
    name: "task_logs",
    description: "读取工作项的操作时间线（含操作人、动作与时间），按时间倒序分页。",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: workspace,
        taskId: { type: "string", description: "工作项 ID" },
        offset,
        limit
      },
      required: ["workspaceId", "taskId"],
      additionalProperties: false
    },
    build: (args) => ({
      path: `/api/tasks/${encodeURIComponent(need(args, "taskId", "工作项 ID"))}/logs`,
      query: { workspace: need(args, "workspaceId"), ...page(args) }
    })
  },
  {
    name: "list_demands",
    description:
      "需求池分页查询。projectId 限某个项目，status 按主状态过滤，kinds 区分需求类型，q 搜标题/正文。",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: workspace,
        projectId: { type: "string", description: "项目 ID（后端参数 reqId），只查该项目下的需求" },
        status: { type: "string", description: "主状态代码，不传为全部" },
        q: { type: "string", description: "关键字" },
        pris: { type: "string", description: "优先级，逗号分隔" },
        kinds: { type: "string", description: "需求类型，逗号分隔" },
        cats: { type: "string", description: "分类 ID，逗号分隔" },
        deliveryStage: { type: "string", description: "交付阶段" },
        versionId: { type: "string", description: "版本 ID" },
        offset,
        limit
      },
      required: ["workspaceId"],
      additionalProperties: false
    },
    build: (args) => ({
      path: "/api/demands",
      query: {
        workspace: need(args, "workspaceId"),
        ...pick(args, {
          projectId: "reqId",
          status: "status",
          q: "q",
          pris: "pris",
          kinds: "kinds",
          cats: "cats",
          deliveryStage: "deliveryStage",
          versionId: "versionId"
        }),
        ...page(args)
      }
    })
  },
  {
    name: "get_demand",
    description: "读取单条需求详情（状态、优先级、负责人、期望上线、评审与交付字段）。",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: workspace,
        demandId: { type: "string", description: "需求 ID" }
      },
      required: ["workspaceId", "demandId"],
      additionalProperties: false
    },
    build: (args) => ({
      path: `/api/demands/${encodeURIComponent(need(args, "demandId", "需求 ID"))}`,
      query: { workspace: need(args, "workspaceId") }
    })
  },
  {
    name: "demand_tasks",
    description: "需求详情里的关联工作项（分页）。",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: workspace,
        demandId: { type: "string", description: "需求 ID" },
        offset,
        limit
      },
      required: ["workspaceId", "demandId"],
      additionalProperties: false
    },
    build: (args) => ({
      path: `/api/demands/${encodeURIComponent(need(args, "demandId", "需求 ID"))}/tasks`,
      query: { workspace: need(args, "workspaceId"), ...page(args) }
    })
  },
  {
    name: "list_docs",
    description:
      "需求文档列表（标题、所属项目、关联任务数、正文摘要，不含完整正文）。keyword 搜标题与正文。",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: workspace,
        projectId: { type: "string", description: "项目 ID（后端参数 reqId）" },
        categoryId: { type: "string", description: "分类 ID" },
        spaceOnly: { type: "boolean", description: "true=只看不挂项目的空间级文档" },
        keyword: { type: "string", description: "标题 / 正文关键字" },
        offset,
        limit
      },
      required: ["workspaceId"],
      additionalProperties: false
    },
    build: (args) => ({
      path: "/api/req-docs",
      query: {
        workspace: need(args, "workspaceId"),
        ...pick(args, {
          projectId: "reqId",
          categoryId: "categoryId",
          spaceOnly: "spaceOnly",
          keyword: "keyword"
        }),
        ...page(args)
      }
    })
  },
  {
    name: "get_doc",
    description: "读取需求文档详情，返回含 HTML 正文的完整文档；表格类文档正文是工作簿快照 JSON 字符串。",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: workspace,
        docId: { type: "string", description: "文档 ID" }
      },
      required: ["workspaceId", "docId"],
      additionalProperties: false
    },
    build: (args) => ({
      path: `/api/req-docs/${encodeURIComponent(need(args, "docId", "文档 ID"))}`,
      query: { workspace: need(args, "workspaceId") }
    })
  },
  {
    name: "list_test_cases",
    description:
      "测试用例分页查询，必须先选项目。status 取 passed / failed / blocked / skipped / __untested；moduleId 为分类目录节点，moduleSub=true 含子分类；q 默认只搜标题/编号/模块，searchWide 才搜步骤等大字段。",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: workspace,
        projectId: { type: "string", description: "项目 ID（后端参数 reqId），必填" },
        status: {
          type: "string",
          enum: ["passed", "failed", "blocked", "skipped", "__untested"],
          description: "执行状态"
        },
        moduleId: { type: "string", description: "分类目录节点 ID；__none 表示未归类" },
        moduleSub: { type: "boolean", description: "true=含子分类用例" },
        pri: { type: "string", description: "优先级" },
        owner: { type: "string", description: "最近执行人显示名" },
        demandId: { type: "string", description: "关联需求 ID；__none 表示未关联" },
        setId: { type: "string", description: "用例集 ID；__none 表示未加入分组" },
        q: { type: "string", description: "关键字（标题 / 编号 / 模块）" },
        searchWide: { type: "boolean", description: "true=搜索范围含前置条件、步骤等大字段" },
        sort: {
          type: "string",
          enum: ["created", "updated", "executed", "no", "pri", "module", "status", "manual"],
          description: "排序字段，默认 created"
        },
        sortDir: { type: "string", enum: ["asc", "desc"], description: "默认 desc" },
        offset,
        limit
      },
      required: ["workspaceId", "projectId"],
      additionalProperties: false
    },
    build: (args) => ({
      path: "/api/test-cases",
      query: {
        workspace: need(args, "workspaceId"),
        reqId: need(args, "projectId", "项目 ID"),
        ...pick(args, {
          status: "status",
          moduleId: "moduleId",
          moduleSub: "moduleSub",
          pri: "pri",
          owner: "owner",
          demandId: "demandId",
          setId: "setId",
          q: "q",
          searchWide: "searchWide",
          sort: "sort",
          sortDir: "sortDir"
        }),
        ...page(args)
      }
    })
  },
  {
    name: "list_versions",
    description: "列出某个项目下的版本（状态、计划与实际发布时间等）。必须先有 projectId。",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: workspace,
        projectId: { type: "string", description: "项目 ID（后端参数 reqId），必填" }
      },
      required: ["workspaceId", "projectId"],
      additionalProperties: false
    },
    build: (args) => ({
      path: "/api/versions",
      query: { workspace: need(args, "workspaceId"), reqId: need(args, "projectId", "项目 ID") }
    })
  },
  {
    name: "my_tasks",
    description:
      "「我的工作」工作项，跨空间聚合，不按当前空间过滤。view 取 dev（待我开发）/ test（待我测试）/ created（我发起）/ watched（我关注）；scope=all 含已完成与已取消。",
    inputSchema: {
      type: "object",
      properties: {
        view: { type: "string", enum: ["dev", "test", "created", "watched"], description: "视图" },
        scope: { type: "string", enum: ["all"], description: "all=含已完成与已取消" },
        q: { type: "string", description: "关键字" },
        offset,
        limit
      },
      additionalProperties: false
    },
    build: (args) => ({ path: "/api/my-tasks", query: { ...pick(args, { view: "view", scope: "scope", q: "q" }), ...page(args) } })
  },
  {
    name: "search",
    description: "当前空间内的全局搜索（工作项、需求、文档、用例等），返回命中摘要与跳转所需 ID。",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: workspace,
        q: { type: "string", description: "搜索词" },
        type: { type: "string", description: "限定结果类型，不传为全部" },
        limit
      },
      required: ["workspaceId"],
      additionalProperties: false
    },
    build: (args) => ({
      path: "/api/search",
      query: { workspace: need(args, "workspaceId"), ...pick(args, { q: "q", type: "type" }), limit: page(args).limit }
    })
  },
  {
    name: "create_task",
    method: "POST",
    description:
      "新建工作项（story / task / bug / epic），固定落在「待处理」列，之后用 move_task 流转。需要读写令牌；只读令牌会 403。itemType=bug 时必须给 severity。",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: workspace,
        title: { type: "string", description: "标题，60 字以内" },
        description: { type: "string", description: "描述正文" },
        projectId: { type: "string", description: "所属项目 ID（后端参数 reqId）" },
        itemType: { type: "string", enum: ["story", "task", "bug", "epic"], description: "默认 task" },
        priority: { type: "string", enum: ["P0", "P1", "P2", "P3"], description: "默认 P2" },
        severity: {
          type: "string",
          enum: ["blocker", "critical", "major", "minor"],
          description: "缺陷严重度；itemType=bug 时必填"
        },
        owner: { type: "string", description: "负责人显示名（须是空间成员）" },
        categoryId: { type: "string", description: "分类 / 模块 ID" },
        startDate: { type: "string", description: "开始日期 yyyy-MM-dd" },
        dueDate: { type: "string", description: "截止日期 yyyy-MM-dd" },
        estimateMinutes: { type: "integer", minimum: 0, maximum: 10080, description: "预估分钟数" },
        tags: { type: "array", items: { type: "string" }, maxItems: 8, description: "标签，最多 8 个" }
      },
      required: ["workspaceId", "title"],
      additionalProperties: false
    },
    build: (args) => ({
      path: "/api/tasks",
      query: { workspace: need(args, "workspaceId") },
      body: compact({
        title: need(args, "title", "标题"),
        description: args.description,
        reqId: args.projectId,
        itemType: args.itemType,
        priority: args.priority,
        severity: args.severity,
        owner: args.owner,
        categoryId: args.categoryId,
        startDate: args.startDate,
        dueDate: args.dueDate,
        estimateMinutes: args.estimateMinutes,
        tags: args.tags,
        boardColumn: "backlog",
        progress: 0
      })
    })
  },
  {
    name: "move_task",
    method: "POST",
    description:
      "把工作项移动到目标列（看板列 ID）。流转矩阵与权限由后端校验，禁止的流转会被拒绝；不强制、不越权。需要读写令牌。",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: workspace,
        taskId: { type: "string", description: "工作项 ID" },
        column: { type: "string", description: "目标列 ID（内置 backlog/doing/test/testing/done 或自定义列）" },
        reason: { type: "string", description: "移动说明，部分流转必填" }
      },
      required: ["workspaceId", "taskId", "column"],
      additionalProperties: false
    },
    build: (args) => ({
      path: `/api/tasks/${encodeURIComponent(need(args, "taskId", "工作项 ID"))}/move`,
      query: { workspace: need(args, "workspaceId") },
      body: compact({
        column: need(args, "column", "目标列"),
        reason: args.reason,
        force: false,
        autoTimer: true,
        autoResume: true
      })
    })
  },
  {
    name: "create_demand",
    method: "POST",
    description:
      "提交需求到需求池（状态从「待评审」开始）。需要读写令牌；项目必须可见且可写。",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: workspace,
        title: { type: "string", description: "需求标题，80 字以内" },
        projectId: { type: "string", description: "所属项目 ID（后端参数 reqId），必填" },
        description: { type: "string", description: "需求描述" },
        itemKind: { type: "string", enum: ["新功能", "体验优化", "缺陷", "其他"], description: "需求类型" },
        priority: { type: "string", enum: ["P0", "P1", "P2", "P3"], description: "优先级" },
        source: { type: "string", description: "来源，如「财务 · 刘」" },
        expectDate: { type: "string", description: "期望交付日期 yyyy-MM-dd" },
        acceptText: { type: "string", description: "验收标准" }
      },
      required: ["workspaceId", "title", "projectId"],
      additionalProperties: false
    },
    build: (args) => ({
      path: "/api/demands",
      query: { workspace: need(args, "workspaceId") },
      body: compact({
        reqId: need(args, "projectId", "项目 ID"),
        title: need(args, "title", "需求标题"),
        description: args.description,
        itemKind: args.itemKind,
        priority: args.priority,
        source: args.source,
        expectDate: args.expectDate,
        acceptText: args.acceptText
      })
    })
  },
  {
    name: "update_demand",
    method: "POST",
    description:
      "需求流转：pass 评审通过 / rej 驳回 / plan 排期 / replan 调整排期 / unpass 撤销通过 / unplan 撤销排期 / cancel 取消 / restore 恢复 / reopen 重新打开。需要读写令牌；rej / replan / unplan / cancel / restore 必须给 note。排期类动作会自动读取最新 revision 再做 CAS。",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: workspace,
        demandId: { type: "string", description: "需求 ID" },
        action: {
          type: "string",
          enum: ["pass", "rej", "plan", "replan", "unpass", "unplan", "cancel", "restore", "reopen"],
          description: "流转动作"
        },
        note: { type: "string", description: "原因 / 说明；rej、replan、unplan、cancel、restore 必填" }
      },
      required: ["workspaceId", "demandId", "action"],
      additionalProperties: false
    },
    build: (args) => ({
      path: `/api/demands/${encodeURIComponent(need(args, "demandId", "需求 ID"))}/${encodeURIComponent(need(args, "action", "流转动作"))}`,
      query: { workspace: need(args, "workspaceId") },
      body: compact({ note: args.note })
    }),
    /* 排期类动作要求 revision；先读一次详情，避免调用方必须先 get_demand */
    prepare: async (args, client, request) => {
      if (["plan", "replan", "unplan", "cancel", "restore"].indexOf(args.action) >= 0) {
        const demand = await client.get(`/api/demands/${encodeURIComponent(args.demandId)}`, {
          workspace: args.workspaceId
        });
        if (demand && demand.revision !== undefined && demand.revision !== null) {
          request.body.revision = demand.revision;
        }
      }
      return request;
    }
  }
];

const BY_NAME = new Map(TOOL_SPECS.map((spec) => [spec.name, spec]));

export function findTool(name) {
  return BY_NAME.get(name);
}

/** 执行一个工具，返回给 MCP 客户端的文本（后端 data 字段的 JSON） */
export async function runTool(spec, args, client) {
  let request = spec.build(args || {});
  if (spec.prepare) {
    request = await spec.prepare(args || {}, client, request);
  }
  const data = spec.method === "POST"
    ? await client.post(request.path, request.query, request.body || {})
    : await client.get(request.path, request.query);
  return JSON.stringify(data, null, 2);
}