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

@Service
public class SavedViewService {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int MAX_ARRAY_ITEMS = 50;

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
        SavedView existing = savedViewMapper.selectByName(userId, workspaceId, name);
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
        /* scope 区分：任务视图（不存该字段）、需求池（demand）、文档（doc）、测试用例（testcase） */
        copyEnum(root, out, "scope", "demand", "doc", "testcase");
        String scope = root.path("scope").isTextual() ? root.get("scope").asText() : "";
        copyString(root, out, "q", 200);
        copyString(root, out, "due", 16);
        copyString(root, out, "doneScope", 16);
        copyEnum(root, out, "preset", "all", "mine", "doing", "over", "review", "pass", "plan", "rej");
        copyEnum(root, out, "group", "none", "status", "owner", "priority", "project", "kind");
        copyEnum(root, out, "subgroup", "none", "status", "owner", "priority", "project");
        copyEnum(root, out, "sort", "default", "due", "priority", "estimate", "actual", "updated", "expect", "wsjf", "created",
                "title", "type", "column", "owner", "progress", "project", "version",
                "category", "startDate", "tags", "subtasks", "comments");
        copyEnum(root, out, "sortDir", "asc", "desc");
        copyStringArray(root, out, "owners");
        copyStringArray(root, out, "pris");
        copyStringArray(root, out, "kinds");
        copyStringArray(root, out, "cats");
        copyStringArray(root, out, "reqs");
        copyStringArray(root, out, "tags");
        copyStringArray(root, out, "types");
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
        /* 文档视图：搜索词已由 q 承载，另存项目范围与展示方式 */
        if ("doc".equals(scope)) {
            copyString(root, out, "reqId", 32);
            copyEnum(root, out, "mode", "tree", "kanban", "read", "feed");
        }
        /* 测试用例视图：项目 + 执行结果 + 模块/优先级/执行人 + 仅看有缺陷 + 展示方式 */
        if ("testcase".equals(scope)) {
            copyString(root, out, "reqId", 32);
            copyString(root, out, "module", 50);
            copyString(root, out, "pri", 20);
            copyString(root, out, "owner", 80);
            copyEnum(root, out, "status", "all", "untested", "passed", "failed", "blocked");
            copyEnum(root, out, "mode", "cases", "coverage");
            JsonNode bug = root.get("bug");
            if (bug != null && !bug.isNull()) {
                if (!bug.isBoolean()) {
                    throw AppException.badRequest("视图参数不合法：bug 应为布尔值");
                }
                out.put("bug", bug.asBoolean());
            }
        }
        String json = out.toString();
        if (json.length() > 600) {
            throw AppException.badRequest("视图参数过长");
        }
        return json;
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
