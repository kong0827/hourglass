package com.hourglass.service;

import com.hourglass.common.AiClient;
import com.hourglass.common.AppException;
import com.hourglass.dto.AiApplyResult;
import com.hourglass.dto.AiConfig;
import com.hourglass.dto.AiSplitResponse;
import com.hourglass.dto.AiUsage;
import com.hourglass.dto.GanttDepRequest;
import com.hourglass.dto.TaskSaveRequest;
import com.hourglass.entity.Demand;
import com.hourglass.entity.Task;
import com.hourglass.mapper.TaskMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * AI 把需求池需求拆成工作项草稿。
 *
 * <p>与文档拆分（{@link AiReqDocService}）同一条底线：模型只负责读懂描述、提出拆法，
 * 是否创建、建几条、改不改标题都由用户确认；服务端负责权限、去重、依赖和落库。
 *
 * <p>和文档拆分的两点差异：
 * <ol>
 *   <li>来源是需求详情里的「描述 + 验收标准」，并带上需求下已有工作项，
 *       让模型避开已经拆过的点，而不是只看一段正文。</li>
 *   <li>同名工作项不删掉，而是标记出来并默认不勾选 —— 用户能看到"AI 想拆什么、
 *       哪些已经有了"，再决定要不要调整标题。</li>
 * </ol>
 */
@Service
public class AiDemandSplitService {

    /** 需求正文上限：描述和验收标准拼起来再截断，避免一次调用烧掉太多额度 */
    private static final int MAX_SOURCE_CHARS = 8000;
    private static final int MAX_DRAFT_TASKS = 15;
    /** 已有工作项标题喂给模型的上限，太长会挤掉需求正文 */
    private static final int EXISTING_LIMIT = 30;

    private final DemandService demandService;
    private final TaskMapper taskMapper;
    private final AiConfigService configService;
    private final AiClient client;
    private final TaskCommandService taskService;
    private final ProjectAccessService projectAccess;
    private final GanttService ganttService;
    private final ObjectMapper om = new ObjectMapper();

    public AiDemandSplitService(DemandService demandService, TaskMapper taskMapper,
                                AiConfigService configService, AiClient client,
                                TaskCommandService taskService, ProjectAccessService projectAccess,
                                GanttService ganttService) {
        this.demandService = demandService;
        this.taskMapper = taskMapper;
        this.configService = configService;
        this.client = client;
        this.taskService = taskService;
        this.projectAccess = projectAccess;
        this.ganttService = ganttService;
    }

    // ==================== 拆成工作项草稿 ====================

    public AiSplitResponse split(String userId, String workspaceId, String demandId, Integer maxTasks) {
        AiConfig cfg = configService.resolve(userId, workspaceId);
        Demand demand = demandService.getVisible(workspaceId, userId, demandId);
        assertSplittable(demand);

        String source = sourceText(demand);
        if (source.trim().isEmpty()) {
            throw AppException.badRequest("需求描述和验收标准都是空的，先补充内容再拆");
        }

        List<Task> existing = taskMapper.selectByDemand(workspaceId, demandId);
        Map<String, String> existingTitles = existingTitleMap(existing);
        String existingList = existingTaskList(existing);

        boolean truncated = source.length() > MAX_SOURCE_CHARS;
        String body = truncated ? source.substring(0, MAX_SOURCE_CHARS) : source;
        int cap = maxTasks == null ? 8 : Math.max(1, Math.min(maxTasks, MAX_DRAFT_TASKS));

        String system = "你是资深研发负责人，负责把一条需求池需求拆成可执行的工作项。\n"
                + "硬性要求：\n"
                + "1. 只拆需求描述和验收标准里明确写了的内容，绝不补充没提到的功能。没写清的地方不要臆造。\n"
                + "2. 每个工作项是一个能在一个工作日内完成的工作单元（0.5~2 天）。粒度太大就拆开，太小就合并。\n"
                + "3. 标题不超过 30 个字，动词开头，必须包含具体对象（例：\"实现次席出金接口的幂等校验\"）。"
                + "禁止\"优化\"\"完善\"\"处理\"这类没有信息量的写法。\n"
                + "4. 按依赖顺序排列：前置工作项在前，用 dependsOnIndex 指向它直接依赖的草稿下标（无依赖填 -1）。\n"
                + "5. priority 按需求里的紧迫程度判断：P0 阻塞主流程，P1 核心功能，P2 常规，P3 可选。\n"
                + "6. description 写清\"做什么 + 怎么算完成\"，不超过 80 字；验收标准里的条件要落到对应工作项上。\n"
                + "7. 已有工作项已经覆盖的点不要重复拆。如果需求基本都覆盖了，就少拆，宁少勿滥。\n"
                + "8. 工作项数量控制在 1~" + cap + " 个。\n"
                + "9. summary 用一句话说明拆法，以及是否覆盖了验收标准（没有验收标准就说明按描述拆）。\n"
                + "只输出 JSON，不要任何解释文字。";

        StringBuilder u = new StringBuilder();
        u.append("需求标题：").append(demand.getTitle()).append("\n");
        if (demand.getItemKind() != null && !demand.getItemKind().trim().isEmpty()) {
            u.append("需求类型：").append(demand.getItemKind()).append("\n");
        }
        if (demand.getPriority() != null && !demand.getPriority().trim().isEmpty()) {
            u.append("需求优先级：").append(demand.getPriority()).append("\n");
        }
        if (truncated) {
            u.append("（内容过长，以下只保留了前 ").append(MAX_SOURCE_CHARS).append(" 字）\n");
        }
        u.append("\n需求内容：\n---\n").append(body).append("\n---\n");
        u.append("\n该需求下已有的工作项（共 ").append(existing.size()).append(" 条，不要重复拆）：\n")
                .append(existingList);
        u.append("\n请输出 JSON：{\"summary\":\"\",\"tasks\":[{\"title\":\"\",\"description\":\"\","
                + "\"priority\":\"P2\",\"dependsOnIndex\":-1,\"reason\":\"\"}]}");

        AiClient.Reply reply = client.chat(cfg, system, u.toString(), true);
        JsonNode root = AiClient.extractJson(om, reply.content);

        AiSplitResponse res = new AiSplitResponse();
        res.setDemandId(demandId);
        res.setDemandTitle(demand.getTitle());
        res.setDemandChars(source.length());
        res.setSummary(trim(root.path("summary").asText(""), 200));
        res.setUsage(AiUsage.of(reply));

        JsonNode arr = root.path("tasks");
        if (!arr.isArray()) {
            throw new AppException(502, "AI 返回的结构里没有 tasks 数组，请重试");
        }
        int accepted = 0;
        int rawIndex = -1;
        Set<String> seen = new HashSet<String>();
        for (JsonNode n : arr) {
            rawIndex++;
            if (accepted >= MAX_DRAFT_TASKS) {
                break;
            }
            String title = trim(n.path("title").asText(""), 60);
            String key = titleKey(title);
            if (title.isEmpty() || !seen.add(key)) {
                continue;
            }
            AiSplitResponse.DraftTask t = new AiSplitResponse.DraftTask();
            t.setTitle(title);
            t.setDescription(trim(n.path("description").asText(""), 200));
            t.setPriority(AiReqDocService.normalizePriority(n.path("priority").asText("")));
            int dep = n.path("dependsOnIndex").asInt(-1);
            t.setDependsOnIndex(dep >= 0 && dep < arr.size() ? dep : -1);
            t.setDraftIndex(rawIndex);
            t.setReason(trim(n.path("reason").asText(""), 120));
            String duplicateOf = existingTitles.get(key);
            if (duplicateOf != null) {
                t.setDuplicate(true);
                t.setDuplicateOf(duplicateOf);
                t.setSelected(false);
            }
            res.getTasks().add(t);
            accepted++;
        }
        if (res.getTasks().isEmpty()) {
            throw new AppException(502, "AI 没有拆出任何工作项，可能是需求信息太少，补充描述后再试");
        }
        return res;
    }

    // ==================== 草稿落库 ====================

    public AiApplyResult applyTasks(String userId, String workspaceId, String demandId,
                                    List<AiSplitResponse.DraftTask> drafts) {
        if (drafts == null || drafts.isEmpty()) {
            throw AppException.badRequest("没有选中的工作项");
        }
        if (drafts.size() > MAX_DRAFT_TASKS) {
            throw AppException.badRequest("每次最多创建 " + MAX_DRAFT_TASKS + " 个工作项");
        }
        Demand demand = demandService.getVisible(workspaceId, userId, demandId);
        assertSplittable(demand);
        /* 逐条创建会让每条单独校验权限，这里先一次性拦下只读成员，避免建到一半才报错 */
        projectAccess.assertWrite(workspaceId, userId, demand.getReqId());

        Set<String> titles = new HashSet<String>();
        for (String title : existingTitleMap(taskMapper.selectByDemand(workspaceId, demandId)).values()) {
            titles.add(titleKey(title));
        }

        AiApplyResult out = new AiApplyResult();
        Map<Integer, String> createdByIndex = new LinkedHashMap<Integer, String>();
        Map<String, Integer> dependsOn = new LinkedHashMap<String, Integer>();
        for (int pos = 0; pos < drafts.size(); pos++) {
            AiSplitResponse.DraftTask d = drafts.get(pos);
            String title = trim(d.getTitle(), 60);
            if (title.isEmpty()) {
                continue;
            }
            if (!titles.add(titleKey(title))) {
                out.setSkipped(out.getSkipped() + 1);
                continue;
            }
            try {
                TaskSaveRequest req = new TaskSaveRequest();
                req.setTitle(title);
                req.setDescription(trim(d.getDescription(), 200));
                req.setPriority(AiReqDocService.normalizePriority(d.getPriority()));
                req.setBoardColumn("backlog");
                req.setReqId(demand.getReqId());
                req.setDemandId(demandId);
                req.setCategoryId(demand.getCategoryId() == null || demand.getCategoryId().trim().isEmpty()
                        ? null : demand.getCategoryId());
                /* 与需求详情的手动「拆分为工作项」同一预填口径 */
                req.setStartDate(demand.getPlannedStart());
                req.setDueDate(demand.getPlannedEnd() != null ? demand.getPlannedEnd() : demand.getExpectDate());
                req.setProgress(0);
                Task t = taskService.create(userId, workspaceId, req);
                out.setCreated(out.getCreated() + 1);
                createdByIndex.put(d.getDraftIndex() == null ? pos : d.getDraftIndex(), t.getId());
                if (d.getDependsOnIndex() >= 0) {
                    dependsOn.put(t.getId(), d.getDependsOnIndex());
                }
            } catch (Exception e) {
                out.getFailed().add(new AiApplyResult.Item(title, e.getMessage()));
            }
        }
        /* 前置项也被选中并创建成功时才连线；连线失败（成环、达上限）不影响已建的工作项 */
        for (Map.Entry<String, Integer> e : dependsOn.entrySet()) {
            String from = createdByIndex.get(e.getValue());
            if (from == null || from.equals(e.getKey())) {
                continue;
            }
            try {
                GanttDepRequest dep = new GanttDepRequest();
                dep.setFromTaskId(from);
                dep.setToTaskId(e.getKey());
                dep.setDepType("FS");
                ganttService.createDep(workspaceId, userId, dep);
                out.setLinked(out.getLinked() + 1);
            } catch (AppException ignored) {
                // 依赖是附加信息，工作项本身已创建成功
            }
        }
        return out;
    }

    // ==================== 工具 ====================

    /** 需求描述放前面、验收标准放后面；两段都空才报错 */
    static String sourceText(Demand demand) {
        StringBuilder sb = new StringBuilder();
        String desc = demand.getDescription();
        if (desc != null && !desc.trim().isEmpty()) {
            sb.append("【需求描述】\n").append(desc.trim()).append("\n\n");
        }
        String accept = demand.getAcceptText();
        if (accept != null && !accept.trim().isEmpty()) {
            sb.append("【验收标准】\n").append(accept.trim()).append("\n");
        }
        return sb.toString().trim();
    }

    /** 已完成/已关闭的需求不允许再新增工作项，和前端 canSplit 口径一致 */
    private static void assertSplittable(Demand demand) {
        String st = demand.getStatus();
        if ("done".equals(st) || "closed".equals(st) || "rej".equals(st)
                || "canceled".equals(st) || "cancelled".equals(st)) {
            throw AppException.badRequest("已关闭或已完成的需求不能新拆工作项");
        }
    }

    /** 已有标题：规范化 key → 原标题，用于"同名但大小写/空格不同"也能识别 */
    private static Map<String, String> existingTitleMap(List<Task> tasks) {
        Map<String, String> map = new LinkedHashMap<String, String>();
        if (tasks == null) {
            return map;
        }
        for (Task t : tasks) {
            if (t == null || t.getTitle() == null) {
                continue;
            }
            String title = t.getTitle().trim();
            if (!title.isEmpty()) {
                map.put(titleKey(title), title);
            }
        }
        return map;
    }

    private static String existingTaskList(List<Task> tasks) {
        if (tasks == null || tasks.isEmpty()) {
            return "（还没有工作项）\n";
        }
        StringBuilder sb = new StringBuilder();
        int count = 0;
        for (Task t : tasks) {
            if (t == null || t.getTitle() == null) {
                continue;
            }
            if (count++ >= EXISTING_LIMIT) {
                sb.append("（其余 ").append(tasks.size() - EXISTING_LIMIT).append(" 条省略）\n");
                break;
            }
            sb.append("- [").append(statusLabel(t)).append("] ").append(t.getTitle()).append("\n");
        }
        return sb.toString();
    }

    private static String statusLabel(Task t) {
        if ("done".equals(t.getBoardColumn())) {
            return "已完成";
        }
        int p = t.getProgress() == null ? 0 : t.getProgress();
        if ("backlog".equals(t.getBoardColumn())) {
            return p > 0 ? "待处理 " + p + "%" : "待处理";
        }
        return p > 0 ? "进行中 " + p + "%" : "进行中";
    }

    private static String trim(String s, int max) {
        if (s == null) {
            return "";
        }
        String t = s.replaceAll("\\s+", " ").trim();
        return t.length() > max ? t.substring(0, max) : t;
    }

    static String titleKey(String title) {
        return title == null ? "" : title.replaceAll("\\s+", "").toLowerCase(Locale.ROOT);
    }
}
