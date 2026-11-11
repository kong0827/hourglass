package com.hourglass.service;

import com.hourglass.common.AiClient;
import com.hourglass.common.AppException;
import com.hourglass.dto.AiApplyResult;
import com.hourglass.dto.AiAuditResponse;
import com.hourglass.dto.AiConfig;
import com.hourglass.dto.AiSplitResponse;
import com.hourglass.dto.AiUsage;
import com.hourglass.dto.TaskSaveRequest;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.entity.Task;
import com.hourglass.mapper.TaskMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.springframework.stereotype.Service;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * AI 辅助文档：拆成任务草稿、体检完成度。
 *
 * <p>三条原则（改这里之前先读一遍）：
 * <ol>
 *   <li><b>AI 只做语义，程序做判定。</b>模型负责"读懂文档、拆成点、找对应任务"，
 *       覆盖率、结论、优先级合法值全部由服务端算 —— 让模型直接打分给不出可解释的数字。</li>
 *   <li><b>AI 产出永不直接落库。</b>拆分结果是草稿，用户勾选确认后才创建任务。</li>
 *   <li><b>只用调用者自己的额度。</b>配置从 {@link AiConfigService#resolve} 取，
 *       没配就直接报错，绝不回落到任何公共 key。</li>
 * </ol>
 */
@Service
public class AiReqDocService {

    /** 喂给模型的正文上限：再长就截断，避免一次调用烧掉用户太多额度 */
    private static final int MAX_DOC_CHARS = 12000;
    /** few-shot 用同项目已完成任务的标题，太多反而干扰 */
    private static final int FEW_SHOT_LIMIT = 8;
    private static final int MAX_DRAFT_TASKS = 15;

    private final RequirementDocService docService;
    private final TaskMapper taskMapper;
    private final AiConfigService configService;
    private final AiClient client;
    private final TaskCommandService taskService;
    private final ProjectAccessService projectAccess;
    private final ObjectMapper om = new ObjectMapper();

    public AiReqDocService(RequirementDocService docService, TaskMapper taskMapper,
                           AiConfigService configService, AiClient client, TaskCommandService taskService,
                           ProjectAccessService projectAccess) {
        this.docService = docService;
        this.taskMapper = taskMapper;
        this.configService = configService;
        this.client = client;
        this.taskService = taskService;
        this.projectAccess = projectAccess;
    }

    // ==================== 拆分成任务草稿 ====================

    public AiSplitResponse split(String userId, String workspaceId, String docId, Integer maxTasks) {
        AiConfig cfg = configService.resolve(userId);
        RequirementDoc doc = docService.getVisible(workspaceId, userId, docId);
        String text = docText(doc);
        if (text.trim().isEmpty()) {
            throw AppException.badRequest("文档正文还是空的，先写点内容再拆");
        }

        String fewShot = fewShotTitles(workspaceId, doc);
        boolean truncated = text.length() > MAX_DOC_CHARS;
        String body = truncated ? text.substring(0, MAX_DOC_CHARS) : text;

        int cap = maxTasks == null ? 8 : Math.max(1, Math.min(maxTasks, MAX_DRAFT_TASKS));

        String system = "你是资深软件工程师，负责把一份中文文档拆成可执行的任务清单。\n"
                + "硬性要求：\n"
                + "1. 只拆文档里明确写了的内容，绝不补充文档没提到的功能。文档没写清的地方不要臆造。\n"
                + "2. 每个任务是一个能在一个工作日内完成的工作单元（0.5~2 天）。粒度太大就拆开，太小就合并。\n"
                + "3. 标题不超过 30 个字，动词开头，必须包含具体对象（例：\"实现次席出金接口的幂等校验\"）。"
                + "禁止\"优化\"\"完善\"\"处理\"这类没有信息量的写法。\n"
                + "4. 按依赖顺序排列：前置任务在前，用 dependsOnIndex 指向它直接依赖的任务下标（无依赖填 -1）。\n"
                + "5. priority 按文档里的紧迫程度判断：P0 阻塞主流程，P1 核心功能，P2 常规，P3 可选。\n"
                + "6. description 写清\"做什么 + 怎么算完成\"，不超过 80 字。\n"
                + "7. 任务数量控制在 3~" + cap + " 个，宁少勿滥。\n"
                + "只输出 JSON，不要任何解释文字。";

        StringBuilder u = new StringBuilder();
        u.append("文档标题：").append(doc.getTitle()).append("\n");
        if (truncated) {
            u.append("（正文过长，以下只保留了前 ").append(MAX_DOC_CHARS).append(" 字）\n");
        }
        u.append("\n文档正文：\n---\n").append(body).append("\n---\n");
        if (!fewShot.isEmpty()) {
            u.append("\n项目里已有的任务标题（只用来参考命名风格，不要照抄，也不要重复它们）：\n")
                    .append(fewShot);
        }
        u.append("\n请输出 JSON：{\"tasks\":[{\"title\":\"\",\"description\":\"\",\"priority\":\"P2\","
                + "\"dependsOnIndex\":-1,\"reason\":\"\"}]}");

        AiClient.Reply reply = client.chat(cfg, system, u.toString(), true);
        JsonNode root = AiClient.extractJson(om, reply.content);

        AiSplitResponse res = new AiSplitResponse();
        res.setReqDocId(docId);
        res.setReqDocTitle(doc.getTitle());
        res.setDocChars(text.length());
        res.setUsage(AiUsage.of(reply.model, reply.promptTokens, reply.completionTokens, reply.jsonModeUsed));

        JsonNode arr = root.path("tasks");
        if (!arr.isArray()) {
            throw new AppException(502, "AI 返回的结构里没有 tasks 数组，请重试");
        }
        int idx = 0;
        Set<String> seen = new HashSet<String>();
        for (JsonNode n : arr) {
            if (idx >= MAX_DRAFT_TASKS) {
                break;
            }
            String title = trim(n.path("title").asText(""), 60);
            if (title.isEmpty() || !seen.add(title)) {
                continue;
            }
            AiSplitResponse.DraftTask t = new AiSplitResponse.DraftTask();
            t.setTitle(title);
            t.setDescription(trim(n.path("description").asText(""), 200));
            t.setPriority(normalizePriority(n.path("priority").asText("")));
            int dep = n.path("dependsOnIndex").asInt(-1);
            t.setDependsOnIndex(dep >= 0 && dep < MAX_DRAFT_TASKS ? dep : -1);
            t.setReason(trim(n.path("reason").asText(""), 120));
            res.getTasks().add(t);
            idx++;
        }
        if (res.getTasks().isEmpty()) {
            throw new AppException(502, "AI 没有拆出任何任务，可能是正文信息太少，补充细节后再试");
        }
        return res;
    }

    /** 同项目下已有任务标题，给模型学命名风格；SQL 只取该项目的前 N 条 */
    private String fewShotTitles(String workspaceId, RequirementDoc doc) {
        if (doc.getReqId() == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (String title : taskMapper.selectTitlesByReq(workspaceId, doc.getReqId(), FEW_SHOT_LIMIT)) {
            if (title == null || title.trim().isEmpty()) {
                continue;
            }
            sb.append("- ").append(title.trim()).append("\n");
        }
        return sb.toString();
    }

    // ==================== 完成度体检 ====================

    public AiAuditResponse audit(String userId, String workspaceId, String docId) {
        AiConfig cfg = configService.resolve(userId);
        RequirementDoc doc = docService.getVisible(workspaceId, userId, docId);
        String text = docText(doc);
        if (text.trim().isEmpty()) {
            throw AppException.badRequest("文档正文还是空的，没有可检查的内容");
        }

        List<Task> mine = taskMapper.selectByReqDoc(workspaceId, docId);

        String body = text.length() > MAX_DOC_CHARS ? text.substring(0, MAX_DOC_CHARS) : text;
        StringBuilder taskList = new StringBuilder();
        if (mine.isEmpty()) {
            taskList.append("（这份文档还没有关联工作项）\n");
        } else {
            for (int i = 0; i < mine.size(); i++) {
                Task t = mine.get(i);
                taskList.append(i + 1).append(". [").append(statusLabel(t)).append("] ")
                        .append(t.getTitle());
                String d = t.getDescription();
                if (d != null && !d.trim().isEmpty()) {
                    taskList.append(" —— ").append(trim(d, 120));
                }
                taskList.append("\n");
            }
        }

        String system = "你是资深研发负责人，负责审计\"文档中的工作是否真的做完了\"。\n"
                + "方法：\n"
                + "1. 把文档正文拆成若干「可验证的功能点」——每个点都必须能被回答\"做了还是没做\"。"
                + "典型颗粒度：一个接口、一个字段、一条业务规则、一种异常处理、一个页面元素。\n"
                + "2. 对每个功能点，在给定任务里找覆盖它的任务。判断依据是任务标题+描述+状态，不要只看关键词像不像。\n"
                + "3. 任务确实覆盖了这个点才 covered=true。有任务但没做完，status 记 doing 或 todo。\n"
                + "4. 找不到对应任务的，status=missing —— 这是最重要的输出，不要为了让结果好看而放过。\n"
                + "5. 不要臆造文档里没有的功能点，也不要因为任务数量多就认为已经覆盖。\n"
                + "status 只能用这四个值：done / doing / todo / missing。\n"
                + "只输出 JSON，不要任何解释文字。";

        StringBuilder u = new StringBuilder();
        u.append("文档标题：").append(doc.getTitle()).append("\n");
        u.append("\n文档正文：\n---\n").append(body).append("\n---\n");
        u.append("\n该文档关联的工作项（共 ").append(mine.size()).append(" 条）：\n").append(taskList);
        u.append("\n请输出 JSON：{\"summary\":\"一句话结论\",\"nextStep\":\"下一步最该做什么\","
                + "\"points\":[{\"point\":\"\",\"covered\":true,\"taskTitle\":\"\","
                + "\"status\":\"done\",\"note\":\"\"}]}");

        AiClient.Reply reply = client.chat(cfg, system, u.toString(), true);
        JsonNode root = AiClient.extractJson(om, reply.content);

        AiAuditResponse res = new AiAuditResponse();
        res.setReqDocId(docId);
        res.setReqDocTitle(doc.getTitle());
        res.setSummary(trim(root.path("summary").asText(""), 200));
        res.setNextStep(trim(root.path("nextStep").asText(""), 200));
        res.setUsage(AiUsage.of(reply.model, reply.promptTokens, reply.completionTokens, reply.jsonModeUsed));

        for (Task t : mine) {
            AiAuditResponse.TaskBrief b = new AiAuditResponse.TaskBrief();
            b.setId(t.getId());
            b.setTitle(t.getTitle());
            b.setColumn(t.getBoardColumn());
            b.setProgress(t.getProgress() == null ? 0 : t.getProgress());
            b.setDone("done".equals(t.getBoardColumn()));
            res.getTasks().add(b);
        }

        JsonNode pts = root.path("points");
        if (!pts.isArray()) {
            throw new AppException(502, "AI 返回的结构里没有 points 数组，请重试");
        }
        for (JsonNode n : pts) {
            String p = trim(n.path("point").asText(""), 120);
            if (p.isEmpty()) {
                continue;
            }
            AiAuditResponse.Point pt = new AiAuditResponse.Point();
            pt.setPoint(p);
            String st = normalizeStatus(n.path("status").asText(""), n.path("covered").asBoolean(false));
            pt.setStatus(st);
            pt.setCovered(!"missing".equals(st));
            pt.setTaskTitle(trim(n.path("taskTitle").asText(""), 60));
            pt.setNote(trim(n.path("note").asText(""), 120));
            res.getPoints().add(pt);
        }
        if (res.getPoints().isEmpty()) {
            throw new AppException(502, "AI 没有拆出任何功能点，请补充文档细节后再试");
        }

        /* ---- 分数与结论由程序算，不用模型给的口径 ---- */
        int done = 0, doing = 0, todo = 0, missing = 0;
        for (AiAuditResponse.Point pt : res.getPoints()) {
            if ("done".equals(pt.getStatus())) done++;
            else if ("doing".equals(pt.getStatus())) doing++;
            else if ("todo".equals(pt.getStatus())) todo++;
            else missing++;
        }
        int total = res.getPoints().size();
        double score = done * 1.0 + doing * 0.6 + todo * 0.3;
        int coverage = (int) Math.round(score / total * 100);

        res.setTotalPoints(total);
        res.setDonePoints(done);
        res.setDoingPoints(doing);
        res.setTodoPoints(todo);
        res.setMissingPoints(missing);
        res.setCoverage(coverage);
        res.setVerdict(verdictOf(coverage, missing, total));
        return res;
    }

    /** 结论只由覆盖率与缺失点数推导：有 missing 就永远不可能是"做完了" */
    static String verdictOf(int coverage, int missing, int total) {
        if (total == 0) {
            return "not_started";
        }
        if (coverage >= 95 && missing == 0) {
            return "done";
        }
        if (coverage >= 70) {
            return "mostly";
        }
        if (coverage >= 30) {
            return "partial";
        }
        return "not_started";
    }

    // ==================== 草稿落库 ====================

    public AiApplyResult applyTasks(String userId, String workspaceId, String docId,
                                    List<AiSplitResponse.DraftTask> drafts) {
        if (drafts == null || drafts.isEmpty()) {
            throw AppException.badRequest("没有选中的任务");
        }
        if (drafts.size() > 15) {
            throw AppException.badRequest("每次最多创建 15 个任务");
        }
        RequirementDoc doc = docService.getVisible(workspaceId, userId, docId);
        Set<String> titles = new HashSet<String>();
        for (String title : taskMapper.selectTitles(workspaceId,
                projectAccess.viewerScope(workspaceId, userId))) {
            if (title != null) {
                titles.add(title.trim());
            }
        }

        AiApplyResult out = new AiApplyResult();
        for (AiSplitResponse.DraftTask d : drafts) {
            String title = trim(d.getTitle(), 60);
            if (title.isEmpty()) {
                continue;
            }
            if (!titles.add(title)) {
                out.setSkipped(out.getSkipped() + 1);
                continue;
            }
            try {
                TaskSaveRequest req = new TaskSaveRequest();
                req.setTitle(title);
                req.setDescription(trim(d.getDescription(), 200));
                req.setPriority(normalizePriority(d.getPriority()));
                req.setBoardColumn("backlog");
                req.setReqId(doc.getReqId());
                req.setReqDocId(docId);
                req.setProgress(0);
                taskService.create(userId, workspaceId, req);
                out.setCreated(out.getCreated() + 1);
            } catch (Exception e) {
                out.getFailed().add(new AiApplyResult.Item(title, e.getMessage()));
            }
        }
        return out;
    }

    // ==================== 工具 ====================

    /** Markdown 正文本身就是纯文本，直接给模型；HTML 文档先抽纯文本 */
    static String docText(RequirementDoc doc) {
        String content = doc.getContent();
        return "markdown".equals(doc.getFormat())
                ? (content == null ? "" : content)
                : htmlToText(content);
    }

    /**
     * 富文本转纯文本。直接 {@code text()} 会把整张表格压成一行，
     * 模型就看不出"字段/规则"的边界了 —— 所以这里保留段落、标题、列表和表格行。
     */
    static String htmlToText(String html) {
        if (html == null || html.trim().isEmpty()) {
            return "";
        }
        Document d = Jsoup.parse(html);
        d.select("script,style").remove();
        d.select("br").append("\\n");
        d.select("p").prepend("\\n\\n");
        d.select("li").prepend("\\n- ");
        d.select("h1,h2,h3,h4,h5,h6").prepend("\\n\\n## ");
        for (Element tr : d.select("tr")) {
            StringBuilder cells = new StringBuilder("\\n");
            for (Element td : tr.select("td,th")) {
                String txt = td.text().trim();
                if (!txt.isEmpty()) {
                    cells.append(txt).append(" | ");
                }
            }
            tr.prepend(cells.toString());
        }
        return d.text().replace("\\n", "\n").replaceAll("\n{3,}", "\n\n").trim();
    }

    static String normalizePriority(String p) {
        String s = p == null ? "" : p.trim().toUpperCase(Locale.ROOT);
        if (s.equals("P0") || s.equals("P1") || s.equals("P2") || s.equals("P3")) {
            return s;
        }
        /* 模型有时会写 高/中/低 或 priority 数字，统一收口到 P0-P3 */
        String low = p == null ? "" : p.trim().toLowerCase(Locale.ROOT);
        if (low.equals("urgent") || low.equals("high") || low.equals("高") || low.equals("紧急")) {
            return "P0";
        }
        if (low.equals("medium") || low.equals("中") || low.equals("normal")) {
            return "P2";
        }
        if (low.equals("low") || low.equals("低")) {
            return "P3";
        }
        return "P2";
    }

    static String normalizeStatus(String status, boolean covered) {
        String s = status == null ? "" : status.trim().toLowerCase(Locale.ROOT);
        if (s.equals("done") || s.equals("completed") || s.equals("已完成") || s.equals("完成")) {
            return "done";
        }
        if (s.equals("doing") || s.equals("in_progress") || s.equals("inprogress")
                || s.equals("partial") || s.equals("进行中") || s.equals("部分完成")) {
            return "doing";
        }
        if (s.equals("todo") || s.equals("pending") || s.equals("待处理") || s.equals("未开始")) {
            return "todo";
        }
        if (s.equals("missing") || s.equals("none") || s.equals("缺失") || s.equals("未覆盖")) {
            return "missing";
        }
        /* 没给状态就看 covered：这是模型最容易漏填的字段 */
        return covered ? "done" : "missing";
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

    /** 供 Controller 组装响应，避免把 Task 实体整块吐出去 */
    public Map<String, Object> brief(Task t) {
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        m.put("id", t.getId());
        m.put("title", t.getTitle());
        return m;
    }
}
