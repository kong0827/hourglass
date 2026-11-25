package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.SavedViewRequest;
import com.hourglass.entity.SavedView;
import com.hourglass.mapper.SavedViewMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.regex.Pattern;

@Service
public class SavedViewService {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int MAX_ARRAY_ITEMS = 50;
    private static final Pattern DATE = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");

    private final SavedViewMapper savedViewMapper;

    public SavedViewService(SavedViewMapper savedViewMapper) {
        this.savedViewMapper = savedViewMapper;
    }

    public List<SavedView> list(String userId, String workspaceId) {
        return savedViewMapper.selectAll(userId, workspaceId);
    }

    @Transactional
    public SavedView create(String userId, String workspaceId, SavedViewRequest req) {
        String name = req.getName().trim();
        String params = normalizeParams(req.getParams());
        SavedView existing = savedViewMapper.selectByName(userId, workspaceId, name, scopeOf(params));
        if (existing != null) {
            /* 同名保存只更新当前用户、当前空间下的参数，ID 与归属字段均不可变。 */
            savedViewMapper.updateParams(existing.getId(), userId, workspaceId, params);
            return savedViewMapper.selectById(existing.getId());
        }
        SavedView v = new SavedView();
        v.setId(Ids.gen("V"));
        v.setUserId(userId);
        v.setWorkspaceId(workspaceId);
        v.setName(name);
        v.setParams(params);
        savedViewMapper.insert(v);
        return savedViewMapper.selectById(v.getId());
    }

    @Transactional
    public void delete(String userId, String workspaceId, String id) {
        SavedView v = savedViewMapper.selectById(id);
        if (v == null || !userId.equals(v.getUserId()) || !workspaceId.equals(v.getWorkspaceId())) {
            throw AppException.notFound("视图不存在：" + id);
        }
        savedViewMapper.deleteById(id);
    }

    /**
     * 校验并规范化筛选参数：必须是 JSON 对象，字段类型逐一核对，只保留已知字段。
     * 非法参数在保存时就拒绝，避免"能存的存不住、存进去的前端应用时报错"。
     */
    private String normalizeParams(String params) {
        JsonNode root;
        try {
            root = JSON.readTree(params);
        } catch (Exception e) {
            throw AppException.badRequest("视图参数不是合法 JSON");
        }
        if (root == null || !root.isObject()) {
            throw AppException.badRequest("视图参数必须是 JSON 对象");
        }
        ObjectNode out = JSON.createObjectNode();
        /* scope 区分：任务视图（不存该字段）、需求池（demand）、文档（doc）、测试用例（testcase）、
           缺陷（defect）、分支（branch）、全局搜索（search） */
        copyEnum(root, out, "scope", "demand", "doc", "testcase", "defect", "branch", "search");
        String scope = root.path("scope").isTextual() ? root.get("scope").asText() : "";
        copyString(root, out, "q", 200);
        copyString(root, out, "due", 16);
        copyString(root, out, "doneScope", 16);
        copyEnum(root, out, "preset", "all", "mine", "doing", "over", "review", "pass", "plan", "done", "closed", "rej");
        copyEnum(root, out, "group", "none", "status", "owner", "priority", "project", "category", "version", "kind");
        copyEnum(root, out, "subgroup", "none", "status", "owner", "priority", "project", "category", "version");
        copyEnum(root, out, "sort", "default", "due", "priority", "estimate", "actual", "updated", "expect", "wsjf", "created",
                "title", "type", "column", "owner", "progress", "project", "version",
                "category", "startDate", "tags", "subtasks", "comments",
                /* 测试用例视图的排序值也要能存进视图 */
                "no", "executed", "module", "status", "manual");
        copyEnum(root, out, "sortDir", "asc", "desc");
        copyStringArray(root, out, "owners");
        copyStringArray(root, out, "pris");
        copyStringArray(root, out, "kinds");
        copyStringArray(root, out, "cats");
        copyStringArray(root, out, "reqs");
        copyStringArray(root, out, "tags");
        copyStringArray(root, out, "types");
        copyStringArray(root, out, "versions");
        copyStringArray(root, out, "columns");
        copyEnum(root, out, "completion", "open", "done");
        copyEnum(root, out, "pubState", "published", "unpublished");
        /* 自定义日期区间与「无截止日期」也是筛选条件，随视图保存 */
        copyDate(root, out, "dueFrom");
        copyDate(root, out, "dueTo");
        copyDate(root, out, "startFrom");
        copyDate(root, out, "startTo");
        JsonNode noDue = root.get("noDue");
        if (noDue != null && !noDue.isNull()) {
            if (!noDue.isBoolean()) {
                throw AppException.badRequest("视图参数不合法：noDue 应为布尔值");
            }
            out.put("noDue", noDue.asBoolean());
        }
        JsonNode focus = root.get("focus");
        if (focus != null && !focus.isNull()) {
            if (!focus.isBoolean()) {
                throw AppException.badRequest("视图参数不合法：focus 应为布尔值");
            }
            out.put("focus", focus.asBoolean());
        }
        /* N-4：「仅看被阻塞」也需要能存进视图（新增字段，历史视图不受影响） */
        JsonNode blocked = root.get("blocked");
        if (blocked != null && !blocked.isNull()) {
            if (!blocked.isBoolean()) {
                throw AppException.badRequest("视图参数不合法：blocked 应为布尔值");
            }
            out.put("blocked", blocked.asBoolean());
        }
        /* 列表视图：隐藏已完成是视图口径的一部分，需要随视图保存 */
        JsonNode hideDone = root.get("hideDone");
        if (hideDone != null && !hideDone.isNull()) {
            if (!hideDone.isBoolean()) {
                throw AppException.badRequest("视图参数不合法：hideDone 应为布尔值");
            }
            out.put("hideDone", hideDone.asBoolean());
        }
        /* 甘特图视图：筛选之外还要记住布局，应用视图时原样恢复 */
        copyEnum(root, out, "ganttSort", "start", "due", "priority", "owner", "progress");
        copyEnum(root, out, "ganttGroup", "none", "project", "owner", "status", "category", "priority");
        copyEnum(root, out, "ganttGroup2", "none", "project", "owner", "status", "category", "priority");
        copyEnum(root, out, "ganttDensity", "comfortable", "compact", "minimal");
        copyEnum(root, out, "ganttScale", "day", "week", "month");
        copyEnum(root, out, "ganttZoom", "20", "28", "40");
        copyEnum(root, out, "ganttRange", "auto", "month");
        copyStringArray(root, out, "ganttCols");
        JsonNode ganttShowDone = root.get("ganttShowDone");
        if (ganttShowDone != null && !ganttShowDone.isNull()) {
            if (!ganttShowDone.isBoolean()) {
                throw AppException.badRequest("视图参数不合法：ganttShowDone 应为布尔值");
            }
            out.put("ganttShowDone", ganttShowDone.asBoolean());
        }
        /* 文档视图：搜索词已由 q 承载，另存项目范围与展示方式 */
        if ("doc".equals(scope)) {
            copyString(root, out, "reqId", 32);
            copyEnum(root, out, "mode", "tree", "kanban", "read", "feed");
        }
        /* 测试用例视图：项目 + 执行结果 + 目录/优先级/执行人/需求/分组 + 仅看有缺陷 + 展示方式 */
        if ("testcase".equals(scope)) {
            copyString(root, out, "reqId", 32);
            copyString(root, out, "module", 50);
            copyString(root, out, "moduleId", 32);
            copyString(root, out, "pri", 20);
            copyString(root, out, "owner", 80);
            copyString(root, out, "demandId", 32);
            copyString(root, out, "setId", 32);
            copyEnum(root, out, "status", "all", "untested", "passed", "failed", "blocked", "skipped");
            copyEnum(root, out, "groupBy", "", "module", "priority", "status", "owner", "demand", "set");
            copyEnum(root, out, "mode", "cases", "coverage", "plans", "report");
            copyBool(root, out, "all");
            copyBool(root, out, "wide");
            copyBool(root, out, "moduleSub");
            copyBool(root, out, "setSub");
            copyInt(root, out, "pageSize");
            JsonNode bug = root.get("bug");
            if (bug != null && !bug.isNull()) {
                if (!bug.isBoolean()) {
                    throw AppException.badRequest("视图参数不合法：bug 应为布尔值");
                }
                out.put("bug", bug.asBoolean());
            }
        }
        /* 缺陷视图：项目范围 + 状态 / 严重度 / 优先级 / 负责人 / 发现版本；q 由上面的通用字段承载 */
        if ("defect".equals(scope)) {
            copyString(root, out, "reqId", 32);
            copyString(root, out, "severity", 20);
            copyString(root, out, "priority", 20);
            copyString(root, out, "status", 20);
            copyString(root, out, "owner", 80);
            copyString(root, out, "version", 32);
            copyString(root, out, "cat", 32);
            copyString(root, out, "tag", 32);
        }
        /* 分支视图：项目 / 状态 / 负责人 + 看板或列表 / 分组方式；q 由通用字段承载 */
        if ("branch".equals(scope)) {
            copyString(root, out, "project", 32);
            copyString(root, out, "status", 20);
            copyString(root, out, "owner", 80);
            copyString(root, out, "version", 32);
            copyEnum(root, out, "mode", "board", "list");
            copyEnum(root, out, "group", "status", "project");
            copyEnum(root, out, "listGroup", "none", "status", "owner", "project");
        }
        /* 全局搜索视图：只存搜索面板的六个范围，不混入任务筛选字段 */
        if ("search".equals(scope)) {
            copyString(root, out, "reqId", 32);
            copyString(root, out, "versionId", 32);
            copyEnum(root, out, "type", "project", "task", "doc", "demand", "case");
            /* 状态取值跨实体（看板列 / 文档 / 需求 / 用例），这里只做长度约束 */
            copyString(root, out, "status", 32);
            copyString(root, out, "owner", 80);
            copyDate(root, out, "from");
            copyDate(root, out, "to");
        }
        String json = out.toString();
        /* 与 sql/118 放宽后的列宽保持一致：搜索视图多一个维度也不会被截断 */
        if (json.length() > 1900) {
            throw AppException.badRequest("视图参数过长");
        }
        return json;
    }

    private static String scopeOf(String params) {
        try {
            JsonNode root = JSON.readTree(params);
            String scope = root == null ? "" : root.path("scope").asText("");
            return scope.isEmpty() ? "task" : scope;
        } catch (Exception e) {
            return "task";
        }
    }

    private void copyString(JsonNode root, ObjectNode out, String key, int maxLen) {
        JsonNode node = root.get(key);
        if (node == null || node.isNull()) {
            return;
        }
        if (!node.isTextual()) {
            throw AppException.badRequest("视图参数不合法：" + key + " 应为字符串");
        }
        out.put(key, Texts.cut(node.asText(), maxLen));
    }

    /** 视图里的开关字段：布尔值或 0/1 都接受（前端按 1/0 传） */
    private void copyBool(JsonNode root, ObjectNode out, String key) {
        JsonNode node = root.get(key);
        if (node == null || node.isNull()) {
            return;
        }
        if (node.isBoolean()) {
            out.put(key, node.asBoolean());
            return;
        }
        if (node.isInt() && (node.asInt() == 0 || node.asInt() == 1)) {
            out.put(key, node.asInt() == 1);
            return;
        }
        throw AppException.badRequest("视图参数不合法：" + key + " 应为布尔值");
    }

    private void copyInt(JsonNode root, ObjectNode out, String key) {
        JsonNode node = root.get(key);
        if (node == null || node.isNull()) {
            return;
        }
        if (!node.isInt()) {
            throw AppException.badRequest("视图参数不合法：" + key + " 应为整数");
        }
        out.put(key, node.asInt());
    }

    private void copyDate(JsonNode root, ObjectNode out, String key) {
        JsonNode node = root.get(key);
        if (node == null || node.isNull()) {
            return;
        }
        if (!node.isTextual() || !DATE.matcher(node.asText()).matches()) {
            throw AppException.badRequest("视图参数不合法：" + key + " 应为 yyyy-MM-dd 日期");
        }
        out.put(key, node.asText());
    }

    private void copyEnum(JsonNode root, ObjectNode out, String key, String... allowed) {
        JsonNode node = root.get(key);
        if (node == null || node.isNull()) {
            return;
        }
        if (!node.isTextual()) {
            throw AppException.badRequest("视图参数不合法：" + key + " 应为字符串");
        }
        String value = node.asText();
        for (String item : allowed) {
            if (item.equals(value)) {
                out.put(key, value);
                return;
            }
        }
        throw AppException.badRequest("视图参数不合法：" + key + " 不在允许范围内");
    }

    private void copyStringArray(JsonNode root, ObjectNode out, String key) {
        JsonNode node = root.get(key);
        if (node == null || node.isNull()) {
            return;
        }
        if (!node.isArray()) {
            throw AppException.badRequest("视图参数不合法：" + key + " 应为数组");
        }
        if (node.size() > MAX_ARRAY_ITEMS) {
            throw AppException.badRequest("视图参数不合法：" + key + " 元素过多");
        }
        ArrayNode arr = out.putArray(key);
        for (JsonNode item : node) {
            if (!item.isTextual()) {
                throw AppException.badRequest("视图参数不合法：" + key + " 的元素应为字符串");
            }
            arr.add(Texts.cut(item.asText(), 32));
        }
    }
}
