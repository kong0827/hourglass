package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.CaseMeta;
import com.hourglass.common.CurrentUser;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.CaseSelection;
import com.hourglass.dto.CaseSetSaveRequest;
import com.hourglass.dto.CaseSetView;
import com.hourglass.entity.CaseSet;
import com.hourglass.entity.TestCase;
import com.hourglass.mapper.CaseSetMapper;
import com.hourglass.mapper.TestCaseMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 用例集（自定义分组，多归属）：一条用例可进多个分组，成员是引用不是复制。
 * 手工分组由人挑选，动态分组由规则派生（读取时自愈刷新，成员仍物化在 case_set_item）。
 * 只有团队共享分组进交付说明与发布证据；个人 / 指定成员分组不进证据链，
 * 否则同一版本两个人算出的数字会不一致。
 */
@Service
public class CaseSetService {

    public static final String VIS_TEAM = "team";
    public static final String VIS_MEMBERS = "members";
    public static final String VIS_PERSONAL = "personal";
    public static final String KIND_MANUAL = "manual";
    public static final String KIND_DYNAMIC = "dynamic";

    /** 指定成员可见的名单上限：分组是整理工具，不是权限系统 */
    private static final int MAX_MEMBERS = 50;
    /** 保存动态分组时的规则命中上限，与按筛选批量动作同口径 */
    private static final int MAX_RULE_HITS = 2000;
    private static final int MAX_RULE_Q = 100;
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Set<String> RULE_STATUS = new HashSet<String>(Arrays.asList(
            CaseMeta.STATUS_PASSED, CaseMeta.STATUS_FAILED, CaseMeta.STATUS_BLOCKED,
            CaseMeta.STATUS_SKIPPED, "__untested"));
    private static final Set<String> RULE_PRI = new HashSet<String>(Arrays.asList("P0", "P1", "P2", "P3", "__none"));

    private final CaseSetMapper setMapper;
    private final TestCaseMapper caseMapper;
    private final TestCaseService caseService;
    private final ProjectAccessService projectAccess;
    private final AuditService auditService;

    public CaseSetService(CaseSetMapper setMapper, TestCaseMapper caseMapper, TestCaseService caseService,
                          ProjectAccessService projectAccess, AuditService auditService) {
        this.setMapper = setMapper;
        this.caseMapper = caseMapper;
        this.caseService = caseService;
        this.projectAccess = projectAccess;
        this.auditService = auditService;
    }

    /* ---------- 查询 ---------- */

    public List<CaseSetView> list(String workspaceId, String userId, String reqId) {
        projectAccess.assertView(workspaceId, userId, reqId);
        /* 动态分组先自愈，列表里的成员数才与规则一致 */
        caseService.refreshDynamicSets(workspaceId, reqId);
        boolean writable = projectAccess.canWrite(workspaceId, userId, reqId);
        List<CaseSetView> rows = setMapper.selectVisibleWithCounts(workspaceId, reqId, userId);
        for (CaseSetView v : rows) {
            v.setEditable(writable && (VIS_TEAM.equals(v.getVisibility()) || userId.equals(v.getOwnerUserId())));
            if (VIS_MEMBERS.equals(v.getVisibility())) {
                v.setMemberIds(setMapper.selectMemberIds(v.getId()));
            }
        }
        return rows;
    }

    /** 分组必须存在、属于该空间，且当前用户可见（个人 / 指定成员分组按名单判定） */
    public CaseSet requireVisible(String workspaceId, String userId, String setId) {
        CaseSet s = setMapper.selectById(setId);
        if (s == null || !workspaceId.equals(s.getWorkspaceId())) {
            throw AppException.notFound("分组不存在：" + setId);
        }
        if (!canSee(s, userId, membersOf(s))) {
            throw AppException.notFound("分组不存在：" + setId);
        }
        projectAccess.assertView(workspaceId, userId, s.getReqId());
        return s;
    }

    /** 可见性：team 全员可见；members 创建人 + 名单；personal 只有创建人 */
    public static boolean canSee(CaseSet s, String userId, List<String> memberIds) {
        if (VIS_TEAM.equals(s.getVisibility())) {
            return true;
        }
        if (userId != null && userId.equals(s.getOwnerUserId())) {
            return true;
        }
        return VIS_MEMBERS.equals(s.getVisibility()) && memberIds != null && memberIds.contains(userId);
    }

    /**
     * 团队分组证据口径：按最近一轮结果分布汇总，供发布检查与交付说明冻结。
     * 空分组也保留一行（0 条），便于看出「建了分组但没圈用例」的覆盖缺口。
     */
    public List<Map<String, Object>> teamSetEvidence(String workspaceId, String reqId) {
        caseService.refreshDynamicSets(workspaceId, reqId);
        Map<String, Map<String, Object>> byId = new LinkedHashMap<String, Map<String, Object>>();
        for (Map<String, Object> row : setMapper.countTeamSetResults(workspaceId, reqId)) {
            String id = String.valueOf(row.get("setId"));
            Map<String, Object> e = byId.get(id);
            if (e == null) {
                e = new LinkedHashMap<String, Object>();
                e.put("id", id);
                e.put("name", String.valueOf(row.get("name")));
                e.put("kind", String.valueOf(row.get("kind")));
                e.put("total", 0);
                e.put("passed", 0);
                e.put("failed", 0);
                e.put("blocked", 0);
                e.put("skipped", 0);
                e.put("untested", 0);
                byId.put(id, e);
            }
            int cnt = row.get("cnt") instanceof Number ? ((Number) row.get("cnt")).intValue() : 0;
            e.put("total", (Integer) e.get("total") + cnt);
            String key = resultKey(row.get("status"));
            e.put(key, (Integer) e.get(key) + cnt);
        }
        return new ArrayList<Map<String, Object>>(byId.values());
    }

    /* ---------- 写入 ---------- */

    @Transactional
    public CaseSetView create(String userId, String workspaceId, CaseSetSaveRequest req) {
        String reqId = Texts.trimToNull(req.getReqId());
        if (reqId == null) {
            throw AppException.badRequest("请选择所属项目");
        }
        projectAccess.assertWrite(workspaceId, userId, reqId);
        String visibility = visOf(req.getVisibility());
        String kind = kindOf(req.getKind());
        String name = Texts.cut(req.getName().trim(), 60);
        List<String> memberIds = memberIdsOf(workspaceId, reqId, visibility, req.getMemberIds());
        String ruleJson = null;
        if (KIND_DYNAMIC.equals(kind)) {
            ruleJson = ruleJsonOf(req.getRule(), name);
            assertRuleSize(workspaceId, reqId, userId, ruleJson, name);
        }
        CaseSet s = new CaseSet();
        s.setId(Ids.gen("CS"));
        s.setWorkspaceId(workspaceId);
        s.setReqId(reqId);
        s.setName(name);
        s.setNote(Texts.trimToNull(req.getNote()));
        s.setVisibility(visibility);
        s.setKind(kind);
        s.setRuleJson(ruleJson);
        s.setOwnerUserId(VIS_TEAM.equals(visibility) ? "" : userId);
        s.setCreatedBy(CurrentUser.get().getDisplayName());
        s.setCreatedByUserId(userId);
        try {
            setMapper.insert(s);
        } catch (DuplicateKeyException e) {
            throw AppException.badRequest("已有同名分组「" + s.getName() + "」");
        }
        if (!memberIds.isEmpty()) {
            setMapper.insertMembers(workspaceId, s.getId(), memberIds);
        }
        caseService.refreshDynamicSet(workspaceId, s);
        auditService.recordCurrent(workspaceId, "case_set_create", "case_set", s.getId(), s.getName(), true,
                "新建用例分组「" + s.getName() + "」（" + visLabel(visibility) + " · " + kindLabel(kind) + "）", null);
        return viewOf(s, setMapper.selectCaseIds(s.getId()).size(), true, memberIds);
    }

    @Transactional
    public CaseSetView update(String userId, String workspaceId, String setId, CaseSetSaveRequest req) {
        CaseSet s = requireVisible(workspaceId, userId, setId);
        assertManage(userId, workspaceId, s);
        String visibility = visOf(req.getVisibility());
        if (VIS_TEAM.equals(s.getVisibility()) && !VIS_TEAM.equals(visibility)
                && !userId.equals(s.getCreatedByUserId())) {
            throw AppException.badRequest("团队共享分组收窄可见范围需由创建人操作，避免其他成员突然看不到");
        }
        String kind = kindOf(req.getKind());
        String name = Texts.cut(req.getName().trim(), 60);
        List<String> memberIds = memberIdsOf(workspaceId, s.getReqId(), visibility, req.getMemberIds());
        String ruleJson = null;
        if (KIND_DYNAMIC.equals(kind)) {
            ruleJson = ruleJsonOf(req.getRule(), name);
            assertRuleSize(workspaceId, s.getReqId(), ruleViewer(s, userId), ruleJson, name);
        }
        String oldName = s.getName();
        String oldVis = s.getVisibility();
        String oldKind = s.getKind();
        s.setName(name);
        s.setNote(Texts.trimToNull(req.getNote()));
        s.setVisibility(visibility);
        s.setKind(kind);
        /* 动态改手工：保留当前已收录的成员作为手工挑选结果，不清空 */
        s.setRuleJson(ruleJson);
        s.setOwnerUserId(VIS_TEAM.equals(visibility) ? ""
                : (VIS_TEAM.equals(oldVis) ? userId : s.getOwnerUserId()));
        try {
            setMapper.update(s);
        } catch (DuplicateKeyException e) {
            throw AppException.badRequest("已有同名分组「" + s.getName() + "」");
        }
        setMapper.deleteMembersBySet(setId);
        if (!memberIds.isEmpty()) {
            setMapper.insertMembers(workspaceId, setId, memberIds);
        }
        caseService.refreshDynamicSet(workspaceId, s);
        StringBuilder what = new StringBuilder("编辑用例分组「").append(s.getName()).append("」");
        if (!oldName.equals(s.getName())) {
            what.append("，名称由「").append(oldName).append("」修改");
        }
        if (!oldVis.equals(visibility)) {
            what.append("，可见范围由").append(visLabel(oldVis)).append("改为").append(visLabel(visibility));
        }
        if (!oldKind.equals(kind)) {
            what.append("，类型由").append(kindLabel(oldKind)).append("改为").append(kindLabel(kind));
        }
        auditService.recordCurrent(workspaceId, "case_set_update", "case_set", setId, s.getName(), true,
                what.toString(), null);
        return viewOf(s, setMapper.selectCaseIds(setId).size(), true, memberIds);
    }

    /** 删除分组只解除引用，用例本体、执行历史与证据都保留 */
    @Transactional
    public void delete(String userId, String workspaceId, String setId) {
        CaseSet s = requireVisible(workspaceId, userId, setId);
        assertManage(userId, workspaceId, s);
        int members = setMapper.selectCaseIds(setId).size();
        setMapper.deleteMembersBySet(setId);
        setMapper.deleteItemsBySet(setId);
        setMapper.delete(workspaceId, setId);
        auditService.recordCurrent(workspaceId, "case_set_delete", "case_set", setId, s.getName(), true,
                "删除用例分组「" + s.getName() + "」，解除 " + members + " 条用例的引用（用例本体保留）", null);
    }

    /** 加入分组：勾选或按筛选全选都走这里，已在分组内的自动去重 */
    @Transactional
    public Map<String, Object> addMembers(String userId, String workspaceId, String setId, CaseSelection selection) {
        CaseSet s = requireVisible(workspaceId, userId, setId);
        assertManage(userId, workspaceId, s);
        assertManual(s);
        List<String> ids = caseService.selectionIds(userId, workspaceId, selection);
        assertCasesInProject(workspaceId, s.getReqId(), ids);
        Set<String> exists = new HashSet<String>(setMapper.selectCaseIds(setId));
        int already = 0;
        List<String> fresh = new ArrayList<String>();
        for (String id : ids) {
            if (exists.contains(id)) {
                already++;
            } else {
                fresh.add(id);
            }
        }
        int added = 0;
        for (List<String> chunk : chunks(fresh)) {
            added += setMapper.insertItems(workspaceId, setId, chunk, userId);
        }
        if (added > 0) {
            auditService.recordCurrent(workspaceId, "case_set_members_add", "case_set", setId, s.getName(), true,
                    "向用例分组「" + s.getName() + "」加入 " + added + " 条用例"
                            + (already > 0 ? "，跳过 " + already + " 条已在分组内" : ""), null);
        }
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("matched", ids.size());
        out.put("already", already);
        out.put("added", added);
        /* 撤销只移出本次真正新增的成员：按筛选加入时，范围里可能混着原本就在组内的用例 */
        out.put("addedIds", fresh);
        return out;
    }

    @Transactional
    public Map<String, Object> removeMembers(String userId, String workspaceId, String setId, CaseSelection selection) {
        CaseSet s = requireVisible(workspaceId, userId, setId);
        assertManage(userId, workspaceId, s);
        assertManual(s);
        List<String> ids = caseService.selectionIds(userId, workspaceId, selection);
        int removed = 0;
        for (List<String> chunk : chunks(ids)) {
            removed += setMapper.deleteItems(setId, chunk);
        }
        if (removed > 0) {
            auditService.recordCurrent(workspaceId, "case_set_members_remove", "case_set", setId, s.getName(), true,
                    "从用例分组「" + s.getName() + "」移出 " + removed + " 条用例（用例本体保留）", null);
        }
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("removed", removed);
        return out;
    }

    /* ---------- 内部 ---------- */

    private void assertManage(String userId, String workspaceId, CaseSet s) {
        projectAccess.assertWrite(workspaceId, userId, s.getReqId());
        if (!VIS_TEAM.equals(s.getVisibility()) && !userId.equals(s.getOwnerUserId())) {
            throw AppException.badRequest(VIS_MEMBERS.equals(s.getVisibility())
                    ? "指定成员可见的分组只有创建人可以修改" : "个人分组只有创建人可以修改");
        }
    }

    private void assertManual(CaseSet s) {
        if (KIND_DYNAMIC.equals(s.getKind())) {
            throw AppException.badRequest("「" + s.getName() + "」是动态分组，成员由规则自动收录；"
                    + "要手工增删请把分组类型改为手工挑选");
        }
    }

    private void assertCasesInProject(String workspaceId, String reqId, List<String> ids) {
        if (ids.isEmpty()) {
            throw AppException.badRequest("请先勾选用例，或让筛选条件命中用例");
        }
        for (List<String> chunk : chunks(ids)) {
            for (TestCase c : caseMapper.selectByIds(workspaceId, chunk)) {
                if (!reqId.equals(c.getReqId())) {
                    throw AppException.badRequest("分组只收录本项目用例，勾选里含其他项目的用例");
                }
            }
        }
    }

    private List<String> membersOf(CaseSet s) {
        return VIS_MEMBERS.equals(s.getVisibility())
                ? setMapper.selectMemberIds(s.getId()) : Collections.<String>emptyList();
    }

    /** 规则求值视角：创建人（团队分组没有 owner，用创建人账号） */
    private static String ruleViewer(CaseSet s, String fallback) {
        String owner = Texts.trimToNull(s.getOwnerUserId());
        if (owner != null) {
            return owner;
        }
        String creator = Texts.trimToNull(s.getCreatedByUserId());
        return creator != null ? creator : fallback;
    }

    private static String visOf(String raw) {
        if (VIS_PERSONAL.equals(raw)) {
            return VIS_PERSONAL;
        }
        return VIS_MEMBERS.equals(raw) ? VIS_MEMBERS : VIS_TEAM;
    }

    private static String kindOf(String raw) {
        return KIND_DYNAMIC.equals(raw) ? KIND_DYNAMIC : KIND_MANUAL;
    }

    /** 可见成员名单：去重、上限、且必须真的看得到本项目，否则授权没有意义 */
    private List<String> memberIdsOf(String workspaceId, String reqId, String visibility, List<String> raw) {
        if (!VIS_MEMBERS.equals(visibility)) {
            return Collections.emptyList();
        }
        List<String> ids = new ArrayList<String>();
        for (String id : raw == null ? Collections.<String>emptyList() : raw) {
            String uid = Texts.trimToNull(id);
            if (uid != null && !ids.contains(uid)) {
                ids.add(uid);
            }
        }
        if (ids.isEmpty()) {
            throw AppException.badRequest("「指定成员可见」至少要选一位成员");
        }
        if (ids.size() > MAX_MEMBERS) {
            throw AppException.badRequest("指定成员最多 " + MAX_MEMBERS + " 位，请改用团队共享");
        }
        for (String uid : ids) {
            if (!projectAccess.canView(workspaceId, uid, reqId)) {
                throw AppException.badRequest("所选成员里有人看不到本项目，请先在成员管理里授权");
            }
        }
        return ids;
    }

    /** 规则归一：只保留白名单字段，空串归 null，非法枚举与空规则明确报错 */
    private String ruleJsonOf(CaseSetSaveRequest.Rule raw, String name) {
        if (raw == null) {
            throw AppException.badRequest("动态分组「" + name + "」需要收录规则，请至少选择一个条件");
        }
        CaseSetSaveRequest.Rule r = new CaseSetSaveRequest.Rule();
        r.setStatus(enumOf(raw.getStatus(), RULE_STATUS, "执行结果"));
        r.setPri(enumOf(raw.getPri(), RULE_PRI, "优先级"));
        r.setModuleId(Texts.trimToNull(raw.getModuleId()));
        r.setModuleSub(raw.isModuleSub());
        r.setDemandId(Texts.trimToNull(raw.getDemandId()));
        r.setOwner(Texts.trimToNull(raw.getOwner()));
        r.setBugOnly(raw.isBugOnly());
        r.setRegression(raw.isRegression());
        r.setQ(Texts.trimToNull(raw.getQ()));
        r.setSearchWide(raw.isSearchWide());
        if (r.getQ() != null && r.getQ().length() > MAX_RULE_Q) {
            throw AppException.badRequest("规则关键词最多 " + MAX_RULE_Q + " 字");
        }
        if (r.getStatus() == null && r.getPri() == null && r.getModuleId() == null && r.getDemandId() == null
                && r.getOwner() == null && r.getQ() == null && !r.isBugOnly() && !r.isRegression()) {
            throw AppException.badRequest("动态分组至少要有一个收录条件，否则等于收录全部用例");
        }
        try {
            return JSON.writeValueAsString(r);
        } catch (Exception e) {
            throw AppException.badRequest("动态分组规则无法保存，请重试");
        }
    }

    private static String enumOf(String raw, Set<String> allowed, String label) {
        String v = Texts.trimToNull(raw);
        if (v == null) {
            return null;
        }
        if (!allowed.contains(v)) {
            throw AppException.badRequest("规则里的" + label + "取值不合法：" + v);
        }
        return v;
    }

    /** 保存前校验规则规模：顺带校验目录节点是否仍存在（scopeIds 会查节点） */
    private void assertRuleSize(String workspaceId, String reqId, String viewerId, String ruleJson, String name) {
        int hits = caseService.countRuleHits(workspaceId, reqId, viewerId, ruleJson, name);
        if (hits > MAX_RULE_HITS) {
            throw AppException.badRequest("动态分组「" + name + "」的规则当前命中 " + hits + " 条用例，超过 "
                    + MAX_RULE_HITS + " 条上限，请缩小条件");
        }
    }

    private static String resultKey(Object status) {
        String v = status == null ? "" : String.valueOf(status);
        if (CaseMeta.STATUS_PASSED.equals(v)) {
            return "passed";
        }
        if (CaseMeta.STATUS_FAILED.equals(v)) {
            return "failed";
        }
        if (CaseMeta.STATUS_BLOCKED.equals(v)) {
            return "blocked";
        }
        if (CaseMeta.STATUS_SKIPPED.equals(v)) {
            return "skipped";
        }
        return "untested";
    }

    private static List<List<String>> chunks(List<String> ids) {
        List<List<String>> out = new ArrayList<List<String>>();
        for (int i = 0; i < ids.size(); i += 500) {
            out.add(ids.subList(i, Math.min(ids.size(), i + 500)));
        }
        return out;
    }

    private static String visLabel(String visibility) {
        if (VIS_PERSONAL.equals(visibility)) {
            return "仅自己可见";
        }
        return VIS_MEMBERS.equals(visibility) ? "指定成员可见" : "团队共享";
    }

    private static String kindLabel(String kind) {
        return KIND_DYNAMIC.equals(kind) ? "动态" : "手工";
    }

    private static CaseSetView viewOf(CaseSet s, int caseCount, boolean editable, List<String> memberIds) {
        CaseSetView v = new CaseSetView();
        v.setId(s.getId());
        v.setReqId(s.getReqId());
        v.setName(s.getName());
        v.setNote(s.getNote());
        v.setVisibility(s.getVisibility());
        v.setOwnerUserId(s.getOwnerUserId());
        v.setKind(s.getKind());
        v.setRuleJson(s.getRuleJson());
        v.setMemberIds(memberIds == null ? new ArrayList<String>() : memberIds);
        v.setCreatedBy(s.getCreatedBy());
        v.setCreatedByUserId(s.getCreatedByUserId());
        v.setCreatedAt(s.getCreatedAt());
        v.setUpdatedAt(s.getUpdatedAt());
        v.setCaseCount(caseCount);
        v.setEditable(editable);
        return v;
    }
}