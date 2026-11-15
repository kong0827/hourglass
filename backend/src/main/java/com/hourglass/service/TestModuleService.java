package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Texts;
import com.hourglass.dto.CaseModuleNode;
import com.hourglass.dto.CategoryRequest;
import com.hourglass.dto.TestModuleSaveRequest;
import com.hourglass.entity.Category;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 用例目录适配层：目录本体已经合并进项目目录树（category），本类保留原有
 * /api/test-modules 语义与审计动作，实际读写统一走 CategoryService。
 * 任务、需求、用例看到的是同一棵树；目录计数仍是单归属，不重复。
 */
@Service
public class TestModuleService {

    private final CategoryService categoryService;
    private final AuditService auditService;

    public TestModuleService(CategoryService categoryService, AuditService auditService) {
        this.categoryService = categoryService;
        this.auditService = auditService;
    }

    /* ---------- 查询 ---------- */

    public List<CaseModuleNode> tree(String workspaceId, String userId, String reqId) {
        return categoryService.tree(workspaceId, userId, reqId);
    }

    public Category requireNode(String workspaceId, String reqId, String moduleId) {
        return categoryService.requireNode(workspaceId, reqId, moduleId);
    }

    public List<String> scopeIds(String workspaceId, String reqId, String moduleId, boolean includeSub) {
        return categoryService.scopeIds(workspaceId, reqId, moduleId, includeSub);
    }

    @Transactional
    public Category resolveForCase(String workspaceId, String reqId, String moduleId, String moduleText) {
        return categoryService.resolveForCase(workspaceId, reqId, moduleId, moduleText);
    }

    /* ---------- 写入 ---------- */

    @Transactional
    public CaseModuleNode create(String userId, String workspaceId, TestModuleSaveRequest req) {
        String reqId = Texts.trimToNull(req.getReqId());
        if (reqId == null) {
            throw AppException.badRequest("请选择所属项目");
        }
        CategoryRequest body = new CategoryRequest();
        body.setName(req.getName());
        body.setParentId(req.getParentId());
        Category c = categoryService.create(workspaceId, userId, reqId, body);
        int level = levelOf(workspaceId, userId, reqId, c.getId());
        auditService.recordCurrent(workspaceId, "test_module_create", "test_module", c.getId(), c.getName(), true,
                "新建用例目录「" + c.getName() + "」" + (level <= 1 ? "（顶级）" : "（第 " + level + " 级）"), null);
        return nodeOf(c, level);
    }

    @Transactional
    public CaseModuleNode update(String userId, String workspaceId, String id, TestModuleSaveRequest req) {
        Category existing = categoryService.requireNodeById(workspaceId, id);
        CategoryRequest body = new CategoryRequest();
        body.setName(req.getName());
        body.setParentId(req.getParentId());
        Category c = categoryService.update(workspaceId, userId, id, body);
        int level = levelOf(workspaceId, userId, existing.getProjectId(), c.getId());
        auditService.recordCurrent(workspaceId, "test_module_update", "test_module", id, c.getName(), true,
                "编辑用例目录「" + c.getName() + "」" + (level <= 1 ? "" : "（第 " + level + " 级）"), null);
        return nodeOf(c, level);
    }

    @Transactional
    public void order(String userId, String workspaceId, String reqId, String parentId, List<String> ids) {
        categoryService.order(workspaceId, userId, reqId, parentId, ids);
        auditService.recordCurrent(workspaceId, "test_module_update", "project", reqId, null, true,
                "调整用例目录同级顺序", null);
    }

    @Transactional
    public void delete(String userId, String workspaceId, String id, String targetId) {
        Category c = categoryService.requireNodeById(workspaceId, id);
        categoryService.delete(workspaceId, userId, id, targetId);
        auditService.recordCurrent(workspaceId, "test_module_delete", "test_module", id, c.getName(), true,
                "删除用例目录「" + c.getName() + "」", null);
    }

    private int levelOf(String workspaceId, String userId, String reqId, String id) {
        for (CaseModuleNode node : categoryService.tree(workspaceId, userId, reqId)) {
            if (node.getId().equals(id)) {
                return node.getLevel();
            }
        }
        return 1;
    }

    private static CaseModuleNode nodeOf(Category c, int level) {
        CaseModuleNode node = new CaseModuleNode();
        node.setId(c.getId());
        node.setParentId(c.getParentId() == null ? "" : c.getParentId());
        node.setName(c.getName());
        node.setLevel(level);
        node.setSortOrder(c.getSortOrder() == null ? 0 : c.getSortOrder());
        return node;
    }
}
