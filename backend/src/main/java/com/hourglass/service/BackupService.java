package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.CaseMeta;
import com.hourglass.common.Consts;
import com.hourglass.common.DefectMeta;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.BackupData;
import com.hourglass.dto.TaskTagRef;
import com.hourglass.entity.BoardColumn;
import com.hourglass.entity.Category;
import com.hourglass.entity.Demand;
import com.hourglass.entity.DevBranch;
import com.hourglass.entity.DocumentType;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.entity.RequirementDocComment;
import com.hourglass.entity.Subtask;
import com.hourglass.entity.Tag;
import com.hourglass.entity.Task;
import com.hourglass.entity.TaskBaseline;
import com.hourglass.entity.TaskComment;
import com.hourglass.entity.TaskDependency;
import com.hourglass.entity.TestCase;
import com.hourglass.entity.TestCaseRun;
import com.hourglass.entity.TimeLog;
import com.hourglass.mapper.AppNotificationMapper;
import com.hourglass.mapper.BoardColumnMapper;
import com.hourglass.mapper.CategoryMapper;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.DevBranchMapper;
import com.hourglass.mapper.GanttShareMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.RequirementDocCommentMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.SubtaskMapper;
import com.hourglass.mapper.TagMapper;
import com.hourglass.mapper.TaskBaselineMapper;
import com.hourglass.mapper.TaskCommentMapper;
import com.hourglass.mapper.TaskDependencyMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.TestCaseMapper;
import com.hourglass.mapper.TestCaseRunMapper;
import com.hourglass.mapper.TimeLogMapper;
import com.hourglass.mapper.VersionTaskMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import com.hourglass.service.backup.BackupExportService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

/**
 * 备份：JSON 导出/导入（与旧版前端备份文件互通、按用户隔离）、CSV 导出
 */
@Service
public class BackupService {

    private static final String[] PRIORITIES = {"P0", "P1", "P2", "P3"};
    private static final String[] REQ_STATUS = {"active", "done", "hold"};
    private static final String DEFAULT_CAT_COLOR = "#8a8578";
    /** 导入：每条多值 INSERT / 每个事务处理的业务行数 */
    private static final int IMPORT_BATCH_SIZE = 500;
    /** 完成归档每批条数：每条要读工时汇总再 upsert，单独切小 */
    private static final int ARCHIVE_BATCH_SIZE = 100;

    private final TaskMapper taskMapper;
    private final RequirementMapper reqMapper;
    private final SubtaskMapper subtaskMapper;
    private final TagMapper tagMapper;
    private final TimeLogMapper timeLogMapper;
    private final BoardColumnMapper boardColumnMapper;
    private final CategoryMapper categoryMapper;
    private final WorkspaceService workspaceService;
    private final WorkspaceMemberMapper memberMapper;
    private final TaskCommentMapper commentMapper;
    private final TestCaseMapper testCaseMapper;
    private final TestCaseRunMapper testCaseRunMapper;
    private final RequirementDocCommentMapper docCommentMapper;
    private final AppNotificationMapper appNotificationMapper;
    private final RequirementDocMapper requirementDocMapper;
    private final DevBranchMapper devBranchMapper;
    private final TaskDependencyMapper dependencyMapper;
    private final TaskBaselineMapper baselineMapper;
    private final GanttShareMapper ganttShareMapper;
    private final ProjectVersionMapper versionMapper;
    private final VersionTaskMapper versionTaskMapper;
    private final DemandMapper demandMapper;
    private final TaskCompletionService completionService;
    /** 覆盖导入前清空任务类数据的清单统一收口在 TaskCascade */
    private final TaskCascade cascade;
    /** 导入按阶段/批次提交，避免整次导入占用一个长事务 */
    private final TransactionTemplate txTemplate;
    /** 配置审计（导入是破坏性覆盖操作，必须留痕） */
    private final ActivityService activityService;
    private final com.hourglass.mapper.WorkActivityMapper workActivityMapper;
    private final BackupExportService exportService;
    private final DeliveryScopeLock scopeLock;

    public BackupService(TaskMapper taskMapper, RequirementMapper reqMapper,
                         SubtaskMapper subtaskMapper, TagMapper tagMapper, TimeLogMapper timeLogMapper,
                         BoardColumnMapper boardColumnMapper, CategoryMapper categoryMapper,
                         WorkspaceService workspaceService, WorkspaceMemberMapper memberMapper,
                         TaskCommentMapper commentMapper,
                         TestCaseMapper testCaseMapper,
                         TestCaseRunMapper testCaseRunMapper,
                         RequirementDocCommentMapper docCommentMapper,
                         AppNotificationMapper appNotificationMapper,
                         RequirementDocMapper requirementDocMapper,
                         DevBranchMapper devBranchMapper,
                         TaskDependencyMapper dependencyMapper,
                         TaskBaselineMapper baselineMapper,
                         GanttShareMapper ganttShareMapper,
                         ProjectVersionMapper versionMapper,
                         VersionTaskMapper versionTaskMapper,
                         DemandMapper demandMapper,
                         TaskCompletionService completionService,
                         TaskCascade cascade,
                         ActivityService activityService,
                         com.hourglass.mapper.WorkActivityMapper workActivityMapper,
                         PlatformTransactionManager transactionManager, DeliveryScopeLock scopeLock) {
        this.scopeLock = scopeLock;
        this.taskMapper = taskMapper;
        this.reqMapper = reqMapper;
        this.subtaskMapper = subtaskMapper;
        this.tagMapper = tagMapper;
        this.timeLogMapper = timeLogMapper;
        this.boardColumnMapper = boardColumnMapper;
        this.categoryMapper = categoryMapper;
        this.workspaceService = workspaceService;
        this.memberMapper = memberMapper;
        this.commentMapper = commentMapper;
        this.testCaseMapper = testCaseMapper;
        this.testCaseRunMapper = testCaseRunMapper;
        this.docCommentMapper = docCommentMapper;
        this.appNotificationMapper = appNotificationMapper;
        this.requirementDocMapper = requirementDocMapper;
        this.devBranchMapper = devBranchMapper;
        this.dependencyMapper = dependencyMapper;
        this.baselineMapper = baselineMapper;
        this.ganttShareMapper = ganttShareMapper;
        this.versionMapper = versionMapper;
        this.versionTaskMapper = versionTaskMapper;
        this.demandMapper = demandMapper;
        this.completionService = completionService;
        this.cascade = cascade;
        this.activityService = activityService;
        this.workActivityMapper = workActivityMapper;
        this.exportService = new BackupExportService(taskMapper, reqMapper, subtaskMapper, tagMapper,
                timeLogMapper, boardColumnMapper, categoryMapper, commentMapper, testCaseMapper,
                testCaseRunMapper, docCommentMapper, requirementDocMapper, devBranchMapper,
                dependencyMapper, baselineMapper, versionMapper, versionTaskMapper, demandMapper);
        this.txTemplate = new TransactionTemplate(transactionManager);
        /* 覆盖导入必须整体成功或整体回滚：外层事务包住所有阶段，批次只做语句切分 */
        this.txTemplate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRED);
    }

    /** 导出委托给 BackupExportService；导入仍留在本类（导入需要 TaskCascade 与批次事务） */
    public BackupData export(String workspaceId) {
        return exportService.export(workspaceId);
    }

    public byte[] exportCsv(String workspaceId, java.util.Set<String> hiddenProjects) {
        return exportService.exportCsv(workspaceId, hiddenProjects);
    }

    /** 批量语句共用外层事务，任何阶段失败都恢复导入前状态。 */
    public BackupData.ImportResult importData(String userId, String workspaceId, BackupData data) {
        if (data == null || data.getTasks() == null) {
            throw AppException.badRequest("备份文件中未找到任务数据");
        }
        validateTransfer(data);
        validateDemandDates(data);
        ImportState st = new ImportState(userId, workspaceId);
        st.existingTaskIds = existingTaskIdsInOtherWorkspaces(workspaceId, data);
        st.memberIds = memberIdsOf(workspaceId);

        return txTemplate.execute(txStatus -> {
            // 先锁项目并当前读全部交付计划/历史；拒绝时连旧活动轨迹也不能删除。
            cascade.assertWorkspaceCanBeRebuilt(workspaceId);
            // 阶段 1：清空旧数据 + 项目/分支/文档/模块/列/标签
            txTemplate.execute(status -> {
                clearWorkspaceTaskData(workspaceId, data);
                importReferenceData(data, st);
                importDocComments(data, st);
                return null;
            });
            // 阶段 2：任务与子表，按批执行语句，但同属外层事务
            importTaskBatches(data, st);
            // 阶段 3：依赖/基线/循环关联/评论/测试用例
            importLinks(data, st);
            importTestCases(data, st);
            importDemandDocLinks(data, st);
            importComments(data, st);
            // 阶段 4：完成归档重建（读工时汇总后 upsert）
            archiveDone(st);

            BackupData.ImportResult result = new BackupData.ImportResult();
            result.setTasks(st.taskCount);
            result.setReqs(st.reqCount);
            result.setComments(st.commentCount);
            result.setReqDocs(st.reqDocCount);
            result.setBranches(st.branchCount);
            result.setVersions(st.versionCount);
            result.setDemands(st.demandCount);
            result.setTestCases(st.testCaseCount);
            result.setDocComments(st.docCommentCount);
            activityService.logConfig(workspaceId, userId, "导入覆盖备份（任务 " + st.taskCount
                    + " / 项目 " + st.reqCount + " / 评论 " + st.commentCount
                    + " / 需求 " + st.reqDocCount + " / 分支 " + st.branchCount
                    + " / 版本 " + st.versionCount + " / 需求池 " + st.demandCount
                    + " / 用例 " + st.testCaseCount + " / 文档评论 " + st.docCommentCount + "）");
            return result;
        });
    }

    /** 阶段 1a：清空当前空间的任务类数据（附件/时间线保留） */
    private void clearWorkspaceTaskData(String workspaceId, BackupData data) {
        /* 导入会替换项目/文档，旧实体的活动轨迹不能留下，否则同 ID 重建会混入旧历史 */
        workActivityMapper.deleteAllByWorkspace(workspaceId);
        // 覆盖范围：任务类数据（任务/项目/子任务/标签/工时/评论，含回收站）。
        // 附件文件与记录、操作时间线、保存视图、看板列与模块设置不在这里删除——避免"导入丢得比恢复得多"。
        // v6：备份带了需求文档/分支时按“覆盖”处理；旧备份没有这两个字段则保留现状。
        // v8：版本/需求池同口径——只有备份确实包含该字段才覆盖，旧备份不误删。
        // v10：用例依赖项目、文档评论依赖文档；字段不全时保留现有数据，避免清了又恢复不回来。
        boolean withTestCases = data.getTestCases() != null && data.getReqs() != null;
        boolean withDocComments = data.getDocComments() != null && data.getReqDocs() != null;
        cascade.clearWorkspaceDataForImport(workspaceId,
                data.getReqDocs() != null, data.getBranches() != null,
                data.getVersions() != null, data.getDemands() != null,
                withTestCases, withDocComments);
        /* 版本被覆盖但需求池未随备份恢复时，旧 version_id 已指向不存在的版本 */
        if (data.getVersions() != null && data.getDemands() == null) {
            demandMapper.clearVersionRefsByWorkspace(workspaceId);
        }
    }

    /** 阶段 1b：项目/分支/需求文档/模块/看板列/标签先落库，供任务引用 */
    private void importReferenceData(BackupData data, ImportState st) {
        String workspaceId = st.workspaceId;
        Set<String> reqIds = st.reqIds;
        Set<String> seenReqIds = new HashSet<String>();
        /** 备份里项目ID → 实际落库ID（跨空间导入时 ID 被占用会重新生成，需回指任务关联） */
        Map<String, String> reqIdMap = st.reqIdMap;
        if (data.getReqs() != null) {
            for (BackupData.BackupReq r : data.getReqs()) {
                if (r == null) {
                    continue;
                }
                String original = Ids.sanitize(Texts.trimToNull(r.getId()));
                if (original != null && !seenReqIds.add(original)) {
                    continue; // 备份内重复ID，跳过
                }
                String id;
                if (original == null) {
                    id = Ids.gen("R");
                } else if (reqMapper.selectById(original) != null) {
                    // 跨空间复制导入：ID 已被其他空间占用 → 重新生成并记录映射
                    id = Ids.gen("R");
                    reqIdMap.put(original, id);
                } else {
                    id = original;
                }
                if (!reqIds.add(id)) {
                    continue;
                }
                Requirement req = new Requirement();
                req.setId(id);
                req.setWorkspaceId(workspaceId);
                String name = Texts.trimToNull(r.getName());
                req.setName(name == null ? "未命名项目" : Texts.cut(name, 40));
                req.setDescription(Texts.cut(Texts.trimToNull(r.getDesc()), 1000));
                req.setStatus(oneOf(r.getStatus(), REQ_STATUS, "active"));
                req.setFirstReleasedAt(parseDate(r.getFirstReleasedAt()));
                /* 按备份里的项目顺序编号，恢复后列表与下拉框保持一致 */
                req.setSortOrder(st.reqCount);
                reqMapper.insert(req);
                st.reqCount++;
            }
        }

        /* v8：版本先落库（需求池的 version_id、任务的 version_task 都依赖它） */
        Map<String, String> versionIdMap = st.versionIdMap;
        if (data.getVersions() != null) {
            Set<String> seenVersionIds = new HashSet<String>();
            for (BackupData.BackupVersion bv : data.getVersions()) {
                if (bv == null) {
                    continue;
                }
                String versionName = Texts.trimToNull(bv.getName());
                if (versionName == null) {
                    continue;
                }
                String backupReqId = Texts.trimToNull(bv.getReqId());
                String reqId = backupReqId == null ? null : reqIdMap.get(backupReqId);
                if (reqId == null) {
                    reqId = backupReqId;
                }
                if (reqId == null || !reqIds.contains(reqId)) {
                    continue;
                }
                String original = Ids.sanitize(Texts.trimToNull(bv.getId()));
                if (original != null && !seenVersionIds.add(original)) {
                    continue;
                }
                String id;
                if (original == null) {
                    id = Ids.gen("V");
                } else if (versionMapper.selectById(original) != null) {
                    id = Ids.gen("V");
                } else {
                    id = original;
                }
                ProjectVersion version = new ProjectVersion();
                version.setId(id);
                version.setWorkspaceId(workspaceId);
                version.setReqId(reqId);
                version.setName(Texts.cut(versionName, 40));
                if (versionMapper.countByName(workspaceId, reqId, version.getName(), null) > 0) {
                    continue; // 备份内同名版本：跳过，避免撞唯一键中断整次导入
                }
                version.setDescription(Texts.cut(Texts.trimToNull(bv.getDesc()), 500));
                version.setStatus(oneOf(bv.getStatus(), new String[]{"planned", "active", "released"}, "planned"));
                version.setStartDate(parseDate(bv.getStartDate()));
                version.setTargetDate(parseDate(bv.getTargetDate()));
                version.setReleasedAt(parseTs(bv.getReleasedAt()));
                version.setCreatedAt(parseTs(bv.getCreatedAt()));
                version.setUpdatedAt(parseTs(bv.getUpdatedAt()));
                versionMapper.insert(version);
                st.versionReqId.put(id, reqId);
                st.versionIds.add(id);
                if (original != null && !versionIdMap.containsKey(original)) {
                    versionIdMap.put(original, id);
                }
                st.versionCount++;
            }
        }

        /* v8：需求池依赖项目映射与版本映射；项目不存在的条目直接跳过（req_id 非空） */
        Map<String, String> demandIdMap = st.demandIdMap;
        if (data.getDemands() != null) {
            Set<String> seenDemandIds = new HashSet<String>();
            for (BackupData.BackupDemand bd : data.getDemands()) {
                if (bd == null) {
                    continue;
                }
                String demandTitle = Texts.trimToNull(bd.getTitle());
                if (demandTitle == null) {
                    continue;
                }
                String backupReqId = Texts.trimToNull(bd.getReqId());
                String reqId = backupReqId == null ? null : reqIdMap.get(backupReqId);
                if (reqId == null) {
                    reqId = backupReqId;
                }
                if (reqId == null || !reqIds.contains(reqId)) {
                    continue;
                }
                String original = Ids.sanitize(Texts.trimToNull(bd.getId()));
                if (original != null && !seenDemandIds.add(original)) {
                    continue;
                }
                String id;
                if (original == null) {
                    id = Ids.gen("D");
                } else if (demandMapper.selectById(original) != null) {
                    id = Ids.gen("D");
                    demandIdMap.put(original, id);
                } else {
                    id = original;
                }
                Demand demand = new Demand();
                demand.setId(id);
                demand.setWorkspaceId(workspaceId);
                demand.setReqId(reqId);
                demand.setTitle(Texts.cut(demandTitle, 80));
                demand.setDescription(Texts.cut(Texts.trimToNull(bd.getDesc()), 2000));
                demand.setSource(Texts.cut(Texts.trimToNull(bd.getSource()), 40));
                demand.setItemKind(oneOf(bd.getItemKind(),
                        new String[]{"新功能", "体验优化", "缺陷", "其他"}, "新功能"));
                /* v12 存模块ID；映射不到或不属于需求项目（旧备份名称文本 / 已删模块）回落「未指定」 */
                String demandCatId = st.catIdMap.get(Texts.trimToNull(bd.getCategoryId()));
                if (demandCatId != null) {
                    Category dcat = categoryMapper.selectById(workspaceId, demandCatId);
                    if (dcat == null || !reqId.equals(dcat.getProjectId())) {
                        demandCatId = null;
                    }
                }
                demand.setCategoryId(demandCatId);
                demand.setPriority(oneOf(bd.getPriority(), PRIORITIES, "P2"));
                demand.setStatus(oneOf(bd.getStatus(),
                        new String[]{"review", "pass", "plan", "rej", "canceled"}, "review"));
                demand.setExpectDate(parseDate(bd.getExpectDate()));
                demand.setPlannedStart(parseDate(bd.getPlannedStart()));
                demand.setPlannedEnd(parseDate(bd.getPlannedEnd()));
                demand.setAcceptText(Texts.cut(Texts.trimToNull(bd.getAcceptText()), 2000));
                String versionId = Texts.trimToNull(bd.getVersionId());
                if (versionId != null && versionIdMap.containsKey(versionId)) {
                    versionId = versionIdMap.get(versionId);
                }
                if (versionId != null && !reqId.equals(st.versionReqId.get(versionId))) {
                    throw AppException.badRequest("需求目标版本映射失效，已回滚导入：" + bd.getId());
                }
                demand.setVersionId(versionId);
                demand.setReviewNote(Texts.cut(Texts.trimToNull(bd.getReviewNote()), 500));
                demand.setWsjfBusiness(clampWsjf(bd.getWsjfBusiness()));
                demand.setWsjfUrgency(clampWsjf(bd.getWsjfUrgency()));
                demand.setWsjfRisk(clampWsjf(bd.getWsjfRisk()));
                demand.setWsjfEffort(clampWsjfEffort(bd.getWsjfEffort()));
                String createdBy = Texts.trimToNull(bd.getCreatedBy());
                demand.setCreatedBy(createdBy != null && st.memberIds.contains(createdBy) ? createdBy : null);
                demand.setCreatedAt(parseTs(bd.getCreatedAt()));
                demand.setUpdatedAt(parseTs(bd.getUpdatedAt()));
                demandMapper.insert(demand);
                st.demandReqId.put(id, reqId);
                st.demandIds.add(id);
                if (original != null && !demandIdMap.containsKey(original)) {
                    demandIdMap.put(original, id);
                }
                st.demandCount++;
            }
        }

        Map<String, Integer> colSeq = st.colSeq;

        /* v6：分支池先于任务导入，任务上的 branchId 才能按映射落位 */
        boolean withBranches = data.getBranches() != null;
        Map<String, String> branchIdMap = st.branchIdMap;
        if (withBranches) {
            Set<String> seenBranchIds = new HashSet<String>();
            for (BackupData.BackupBranch bb : data.getBranches()) {
                if (bb == null) {
                    continue;
                }
                String title0 = Texts.trimToNull(bb.getName());
                if (title0 == null) {
                    continue;
                }
                String original = Ids.sanitize(Texts.trimToNull(bb.getId()));
                if (original != null && !seenBranchIds.add(original)) {
                    continue;
                }
                String id;
                if (original == null) {
                    id = Ids.gen("B");
                } else if (devBranchMapper.selectById(original) != null) {
                    id = Ids.gen("B");
                    branchIdMap.put(original, id);
                } else {
                    id = original;
                }
                DevBranch br = new DevBranch();
                br.setId(id);
                br.setWorkspaceId(workspaceId);
                String backupReqId = Texts.trimToNull(bb.getReqId());
                String reqId = backupReqId == null ? null : reqIdMap.get(backupReqId);
                if (reqId == null) {
                    reqId = backupReqId;
                }
                br.setReqId(reqId != null && reqIds.contains(reqId) ? reqId : null);
                br.setName(Texts.cut(title0, 80));
                /* 同空间已有同名分支（手工改过的备份）时跳过，避免撞唯一键中断整次导入 */
                if (devBranchMapper.countByName(workspaceId, br.getName(), br.getReqId(), null) > 0) {
                    continue;
                }
                br.setStatus(oneOf(bb.getStatus(), new String[]{"dev", "testing", "merging", "released"}, "dev"));
                br.setOwner(Texts.cut(Texts.trimToNull(bb.getOwner()), 32));
                String ownerUserId = Texts.trimToNull(bb.getOwnerUserId());
                br.setOwnerUserId(ownerUserId != null && st.memberIds.contains(ownerUserId)
                        ? ownerUserId : null);
                br.setTargetBranch(Texts.cut(Texts.trimToNull(bb.getTargetBranch()), 80));
                br.setNote(Texts.cut(Texts.trimToNull(bb.getNote()), 200));
                br.setDevAt(parseTs(bb.getDevAt()));
                br.setTestAt(parseTs(bb.getTestAt()));
                br.setMergeAt(parseTs(bb.getMergeAt()));
                br.setReleasedAt(parseTs(bb.getReleasedAt()));
                br.setSortOrder(bb.getSortOrder() == null ? 0 : bb.getSortOrder());
                br.setCreatedAt(parseTs(bb.getCreatedAt()));
                br.setUpdatedAt(parseTs(bb.getUpdatedAt()));
                devBranchMapper.insert(br);
                st.branchCount++;
            }
        }
        /* 分支校验集合：分支被覆盖时是本次新导入的，未覆盖时是空间里原有的 */
        for (DevBranch br : devBranchMapper.selectByWorkspace(workspaceId, null)) {
            st.branchIds.add(br.getId());
        }

        /* v6：需求文档依赖项目映射；不存在的项目直接跳过，避免悬空引用 */
        boolean withReqDocs = data.getReqDocs() != null;
        Map<String, String> reqDocIdMap = st.reqDocIdMap;
        /* v7：层级按旧 id 映射到新 id，落库第二遍再补父引用 */
        Map<String, String> docIdByOriginal = new HashMap<String, String>();
        Map<String, String> docParentByOriginal = new HashMap<String, String>();
        Map<String, String> docReqIdByOriginal = new HashMap<String, String>();
        if (withReqDocs) {
            Set<String> seenDocIds = new HashSet<String>();
            for (BackupData.BackupReqDoc bd : data.getReqDocs()) {
                if (bd == null) {
                    continue;
                }
                String title0 = Texts.trimToNull(bd.getTitle());
                if (title0 == null) {
                    continue;
                }
                String backupReqId = Texts.trimToNull(bd.getReqId());
                String reqId = backupReqId == null ? null : reqIdMap.get(backupReqId);
                if (reqId == null) {
                    reqId = backupReqId;
                }
                if (reqId == null || !reqIds.contains(reqId)) {
                    continue;
                }
                String original = Ids.sanitize(Texts.trimToNull(bd.getId()));
                if (original != null && !seenDocIds.add(original)) {
                    continue;
                }
                String id;
                if (original == null) {
                    id = Ids.gen("D");
                } else if (requirementDocMapper.selectById(original) != null) {
                    id = Ids.gen("D");
                    reqDocIdMap.put(original, id);
                } else {
                    id = original;
                }
                String format = oneOf(bd.getFormat(), new String[]{"html", "markdown"}, "html");
                RequirementDoc doc = new RequirementDoc();
                doc.setId(id);
                doc.setWorkspaceId(workspaceId);
                doc.setReqId(reqId);
                doc.setTitle(Texts.cut(title0, 100));
                doc.setDocType(DocumentType.parseOrOther(bd.getDocType()).getCode());
                doc.setFormat(format);
                doc.setContent(RequirementDocService.contentOf(format, bd.getContent()));
                doc.setContentBrief("markdown".equals(format)
                        ? RequirementDocService.excerptOfMarkdown(doc.getContent())
                        : RequirementDocService.excerptOf(doc.getContent()));
                doc.setStatus(oneOf(bd.getStatus(), new String[]{"draft", "active", "done"}, "draft"));
                doc.setOwner(Texts.cut(Texts.trimToNull(bd.getOwner()), 32));
                String ownerUserId = Texts.trimToNull(bd.getOwnerUserId());
                doc.setOwnerUserId(ownerUserId != null && st.memberIds.contains(ownerUserId)
                        ? ownerUserId : null);
                doc.setSortOrder(bd.getSortOrder() == null ? 0 : bd.getSortOrder());
                doc.setCreatedAt(parseTs(bd.getCreatedAt()));
                doc.setUpdatedAt(parseTs(bd.getUpdatedAt()));
                doc.setPublishedAt(parseTs(bd.getPublishedAt()));
                requirementDocMapper.insert(doc);
                st.reqDocCount++;
                if (original != null) {
                    docIdByOriginal.put(original, id);
                    String parentOriginal = Texts.trimToNull(bd.getParentId());
                    if (parentOriginal != null) {
                        docParentByOriginal.put(original, parentOriginal);
                    }
                    docReqIdByOriginal.put(original, reqId);
                }
            }
            /* 第二遍补父文档：只接受同项目、且不成环的引用 */
            for (Map.Entry<String, String> e : docParentByOriginal.entrySet()) {
                String childOriginal = e.getKey();
                String parentOriginal = e.getValue();
                String childId = docIdByOriginal.get(childOriginal);
                String parentId = docIdByOriginal.get(parentOriginal);
                if (childId == null || parentId == null || childId.equals(parentId)) {
                    continue;
                }
                String reqId = docReqIdByOriginal.get(childOriginal);
                if (reqId == null || !reqId.equals(docReqIdByOriginal.get(parentOriginal))) {
                    continue;
                }
                if (wouldCycle(childOriginal, docParentByOriginal)) {
                    continue;
                }
                requirementDocMapper.updateParent(workspaceId, childId, parentId);
            }
        }
        /* 关联需求校验集合：id → 所属项目（覆盖导入时是本次新写入的） */
        for (RequirementDoc doc : requirementDocMapper.selectAllByWorkspace(workspaceId)) {
            st.reqDocReqId.put(doc.getId(), doc.getReqId());
        }

        // 模块：v12 备份带项目级模块字典，按 ID 补齐并建立映射；项目映射不到的模块跳过，
        // 任务/需求的模块值统一回落该项目默认模块（历史数据不回填）
        for (BackupData.BackupCategory bc : data.getCategories() == null
                ? java.util.Collections.<BackupData.BackupCategory>emptyList() : data.getCategories()) {
            if (bc == null) {
                continue;
            }
            String original = Texts.trimToNull(bc.getId());
            String cid = Ids.sanitize(original);
            String projectId = bc.getProjectId() == null ? null : st.reqIdMap.get(bc.getProjectId());
            if (cid == null || cid.length() > 32 || Texts.trimToNull(bc.getName()) == null
                    || projectId == null || st.catIdMap.containsKey(original)) {
                continue;
            }
            if (categoryMapper.selectById(workspaceId, cid) != null) {
                st.catIdMap.put(original, cid);
                continue;
            }
            Category cat = new Category();
            cat.setId(cid);
            cat.setWorkspaceId(workspaceId);
            cat.setProjectId(projectId);
            cat.setName(Texts.cut(bc.getName(), 12));
            String color = Texts.trimToNull(bc.getColor());
            cat.setColor(color != null && color.matches("^#[0-9a-fA-F]{6}$") ? color : DEFAULT_CAT_COLOR);
            cat.setSortOrder(bc.getSortOrder() == null ? 0 : bc.getSortOrder());
            try {
                categoryMapper.insert(cat);
                st.catIdMap.put(original, cid);
            } catch (Exception ignored) {
                // 同名/同 ID 冲突：映射缺失，相关任务/需求落默认模块
            }
        }
        workspaceService.ensureDefaultsFor(workspaceId);
        /* 项目默认模块映射：projectId → 项目内最靠前的模块（导入任务回落用） */
        for (Category c : categoryMapper.selectByWorkspace(workspaceId)) {
            if (!st.projectFirstCat.containsKey(c.getProjectId())) {
                st.projectFirstCat.put(c.getProjectId(), c.getId());
            }
        }

        // 看板列定义：按备份补齐缺失列（跨空间导入时自定义列才能落位；已存在的列不覆盖目标设置）
        if (data.getColumns() != null) {
            for (BackupData.BackupColumn c : data.getColumns()) {
                if (c == null) {
                    continue;
                }
                String cid = Ids.sanitize(Texts.trimToNull(c.getId()));
                // 跳过保留列 id（done 为系统列）与超出 board_column.id VARCHAR(16) 的旧数据
                if (cid == null || cid.length() > 16 || Consts.COL_DONE.equals(cid)
                        || boardColumnMapper.selectById(workspaceId, cid) != null) {
                    continue;
                }
                String cname = Texts.trimToNull(c.getName());
                String color = Texts.trimToNull(c.getColor());
                if (color == null || !color.matches("^#[0-9a-fA-F]{6}$")) {
                    color = "#8a8578";
                }
                BoardColumn bc = new BoardColumn();
                bc.setId(cid);
                bc.setWorkspaceId(workspaceId);
                bc.setName(cname == null ? cid : Texts.cut(cname, 12));
                bc.setColor(color);
                bc.setProcessingRule(BoardColumnService.normalizeProcessingRule(c.getProcessingRule()));
                bc.setSortOrder(boardColumnMapper.maxSortOrder(workspaceId) + 1);
                boardColumnMapper.insert(bc);
            }
        }
        for (BoardColumn c : boardColumnMapper.selectAll(workspaceId)) {
            st.colIds.add(c.getId());
            st.colNameToId.put(c.getName(), c.getId());
        }

        ensureTags(st, collectTagNames(data));
    }

    /** 阶段 2：任务与其子表，每 500 条一个事务 */
    private void importTaskBatches(BackupData data, ImportState st) {
        List<BackupData.BackupTask> all = data.getTasks();
        for (int from = 0; from < all.size(); from += IMPORT_BATCH_SIZE) {
            final List<BackupData.BackupTask> batch = all.subList(from,
                    Math.min(from + IMPORT_BATCH_SIZE, all.size()));
            txTemplate.execute(status -> {
                importTaskBatch(batch, st);
                return null;
            });
        }
    }

    /** 一个批次：先把任务行按 500 条多值写入，再落实子表（子表语句同样按 500 行切分） */
    private void importTaskBatch(List<BackupData.BackupTask> batch, ImportState st) {
        String workspaceId = st.workspaceId;
        List<Task> tasks = new ArrayList<Task>(batch.size());
        List<Subtask> subtasks = new ArrayList<Subtask>();
        List<TaskTagRef> tagLinks = new ArrayList<TaskTagRef>();
        List<TimeLog> timeLogs = new ArrayList<TimeLog>();
        for (BackupData.BackupTask b : batch) {
            if (b == null) {
                continue;
            }
            String original = Ids.sanitize(Texts.trimToNull(b.getId()));
            if (original != null && !st.seenTaskIds.add(original)) {
                continue; // 备份内重复ID，跳过
            }
            String id;
            if (original == null || st.existingTaskIds.contains(original)) {
                // 跨空间复制导入：ID 已被其他空间占用 → 重新生成
                id = Ids.gen("K");
            } else {
                id = original;
            }
            if (!st.taskIds.add(id)) {
                continue;
            }
            if (original != null) {
                st.taskIdMap.put(original, id);
            }
            String recurNext = Ids.sanitize(Texts.trimToNull(b.getRecurNextId()));
            if (recurNext != null) {
                st.recurLinks.add(new String[]{id, recurNext});
            }
            Task t = new Task();
            t.setId(id);
            t.setWorkspaceId(workspaceId);
            String title = Texts.trimToNull(b.getTitle());
            t.setTitle(title == null ? "未命名任务" : Texts.cut(title, 60));
            t.setDescription(Texts.cut(Texts.trimToNull(b.getDesc()), 2000));
            t.setPriority(oneOf(b.getPri(), PRIORITIES, "P2"));
            String owner = Texts.trimToNull(b.getOwner());
            if (owner != null) {
                owner = owner.replace(',', ' ').replace('，', ' ').trim();
            }
            t.setOwner(owner == null || owner.isEmpty() ? "我" : Texts.cut(owner, 32));
            String col = mapColumn(b.getCol(), st.colIds, st.colNameToId);
            t.setBoardColumn(col);
            t.setStartDate(parseDate(b.getStart()));
            t.setDueDate(parseDate(b.getDue()));
            t.setIsMilestone(Boolean.TRUE.equals(b.getIsMilestone()));
            if (Boolean.TRUE.equals(t.getIsMilestone())) {
                LocalDate milestoneDay = t.getStartDate() != null ? t.getStartDate() : t.getDueDate();
                if (milestoneDay != null) {
                    t.setStartDate(milestoneDay);
                    t.setDueDate(milestoneDay);
                }
            }
            t.setCompletedAt(parseDate(b.getCompletedAt()));
            t.setTestStartedAt(parseDate(b.getTestStartedAt()));
            t.setTestFinishedAt(parseDate(b.getTestFinishedAt()));
            t.setCreatedAt(parseTs(b.getCreatedAt()));
            String reqId = Texts.trimToNull(b.getReqId());
            if (reqId != null) {
                String mapped = st.reqIdMap.get(reqId);
                if (mapped != null) {
                    reqId = mapped;
                }
            }
            t.setReqId(reqId != null && st.reqIds.contains(reqId) ? reqId : null);
            /* 模块挂在项目下：v12 存模块ID；映射不到或不属于任务项目（旧备份名称文本 / 已删模块）
               回落该项目第一个模块；无项目任务保持「未指定」 */
            String catMapped = st.catIdMap.get(Texts.trimToNull(b.getCat()));
            if (catMapped != null) {
                Category cat = categoryMapper.selectById(workspaceId, catMapped);
                if (cat == null || t.getReqId() == null || !t.getReqId().equals(cat.getProjectId())) {
                    catMapped = null;
                }
            }
            if (catMapped != null) {
                t.setCategoryId(catMapped);
            } else {
                t.setCategoryId(t.getReqId() == null ? ""
                        : st.projectFirstCat.getOrDefault(t.getReqId(), ""));
            }
            /* v8：工作项类型 / Epic 归属 / 关联需求 / 所属版本。Epic 与版本绑定要等全部任务落库，先收集 */
            String itemType = oneOf(b.getItemType(), new String[]{"task", "story", "bug", "epic"}, "task");
            t.setItemType(itemType);
            String epicOriginal = Texts.trimToNull(b.getEpicId());
            if (epicOriginal != null && !"epic".equals(itemType)) {
                st.epicLinks.add(new String[]{id, epicOriginal});
            }
            String demandId = Texts.trimToNull(b.getDemandId());
            if (demandId != null && st.demandIdMap.containsKey(demandId)) {
                demandId = st.demandIdMap.get(demandId);
            }
            if (demandId != null && (!st.demandIds.contains(demandId) || t.getReqId() == null
                    || !t.getReqId().equals(st.demandReqId.get(demandId)))) {
                demandId = null;
            }
            t.setDemandId(demandId);
            for (String originalVersion : new java.util.TreeSet<String>(b.getVersionIds())) {
                String versionId = st.versionIdMap.getOrDefault(originalVersion, originalVersion);
                if (!st.versionIds.contains(versionId) || !java.util.Objects.equals(t.getReqId(), st.versionReqId.get(versionId))) {
                    throw AppException.badRequest("任务规划版本映射失效，导入已回滚：" + originalVersion);
                }
                st.versionLinks.add(new String[]{id, versionId});
            }
            /* v9：缺陷专属字段；非缺陷或引用失效时清空，避免脏数据 */
            if ("bug".equals(itemType)) {
                t.setSeverity(oneOf(b.getSeverity(),
                        new String[]{"blocker", "critical", "major", "minor"}, null));
                t.setEnvironment(Texts.trimToNull(b.getEnvironment()));
                t.setReproduceSteps(Texts.trimToNull(b.getReproduceSteps()));
                String foundVersionId = Texts.trimToNull(b.getFoundVersionId());
                if (foundVersionId != null && st.versionIdMap.containsKey(foundVersionId)) {
                    foundVersionId = st.versionIdMap.get(foundVersionId);
                }
                if (foundVersionId != null && (!st.versionIds.contains(foundVersionId) || t.getReqId() == null
                        || !t.getReqId().equals(st.versionReqId.get(foundVersionId)))) {
                    foundVersionId = null;
                }
                t.setFoundVersionId(foundVersionId);
                String regression = oneOf(b.getRegressionStatus(),
                        new String[]{"pending", "passed", "failed"}, null);
                /* 旧备份没有回归状态：按列推导，避免恢复后待回归缺陷又变回“未开始” */
                if (regression == null) {
                    regression = DefectMeta.regressionForTransition(null, null, t.getBoardColumn());
                }
                t.setRegressionStatus(regression);
            }
            /* 关联需求：必须存在、同空间，且属于任务当前项目；跨空间导入找不到就置空 */
            String reqDocId = Texts.trimToNull(b.getReqDocId());
            if (reqDocId != null && st.reqDocIdMap.containsKey(reqDocId)) {
                reqDocId = st.reqDocIdMap.get(reqDocId);
            }
            if (reqDocId != null) {
                String docReqId = st.reqDocReqId.get(reqDocId);
                if (docReqId == null || t.getReqId() == null || !t.getReqId().equals(docReqId)) {
                    reqDocId = null;
                }
            }
            t.setReqDocId(reqDocId);
            /* 关联分支：空间级分支池，必须存在且同空间 */
            String branchId = Texts.trimToNull(b.getBranchId());
            if (branchId != null && st.branchIdMap.containsKey(branchId)) {
                branchId = st.branchIdMap.get(branchId);
            }
            if (branchId != null && !st.branchIds.contains(branchId)) {
                branchId = null;
            }
            t.setBranchId(branchId);
            Integer est = b.getEstimateMinutes();
            t.setEstimateMinutes(est == null || est <= 0 ? null : Math.min(10080, est));
            t.setBlocked(Boolean.TRUE.equals(b.getBlocked()));
            t.setBlockedReason(Boolean.TRUE.equals(b.getBlocked())
                    ? Texts.cut(Texts.trimToNull(b.getBlockedReason()), 120) : null);
            /* 负责人账号只在目标空间成员内恢复；否则保留显示名文本，避免出现“幽灵账号” */
            String ownerUserId = Texts.trimToNull(b.getOwnerUserId());
            t.setOwnerUserId(ownerUserId != null && st.memberIds.contains(ownerUserId)
                    ? ownerUserId : null);
            t.setRemindTarget(oneOf(b.getRemindTarget(), new String[]{"owner", "owner+admin"}, "owner"));
            Integer progress = b.getProgress();
            t.setProgress(progress == null ? 0 : Math.max(0, Math.min(100, progress)));
            t.setNote(Texts.cut(Texts.trimToNull(b.getNote()), 80));
            String rec = Texts.trimToNull(b.getRecurType());
            if (rec != null && !"daily".equals(rec) && !"weekly".equals(rec) && !"monthly".equals(rec)) {
                rec = null;
            }
            t.setRecurType(rec);
            t.setRemindAt(parseTs(b.getRemindAt()));
            t.setRemindSent(b.getRemindSent() != null && b.getRemindSent());

            Integer seq = st.colSeq.get(col);
            int sortOrder = seq == null ? 0 : seq;
            t.setSortOrder(sortOrder);
            st.colSeq.put(col, sortOrder + 1);

            /* 回收站任务：按原删除时间放回回收站（不重新出现在看板） */
            t.setDeletedAt(parseTs(b.getDeletedAt()));
            tasks.add(t);
            if (Consts.COL_DONE.equals(t.getBoardColumn())) {
                st.importedDone.add(t);
            }

            if (b.getSubtasks() != null) {
                for (BackupData.BackupSubtask sb : b.getSubtasks()) {
                    if (sb == null) {
                        continue;
                    }
                    String subTitle = Texts.trimToNull(sb.getTitle());
                    if (subTitle == null) {
                        continue;
                    }
                    Subtask sub = new Subtask();
                    sub.setTaskId(id);
                    sub.setWorkspaceId(workspaceId);
                    sub.setTitle(Texts.cut(subTitle, 60));
                    sub.setDone(sb.getDone() != null && sb.getDone());
                    subtasks.add(sub);
                }
            }
            if (b.getTags() != null) {
                Set<String> seen = new HashSet<String>();
                int n = 0;
                for (String raw : b.getTags()) {
                    String name = normalizeTagName(raw);
                    if (name == null || !seen.add(name)) {
                        continue;
                    }
                    if (++n > 8) {
                        break;
                    }
                    Tag tag = st.tagByName.get(name);
                    if (tag == null) {
                        tag = findOrCreateTag(workspaceId, name);
                        if (tag != null) {
                            st.tagByName.put(name, tag);
                        }
                    }
                    if (tag != null) {
                        tagLinks.add(new TaskTagRef(id, tag.getId()));
                    }
                }
            }
            if (b.getTimeLogs() != null) {
                for (BackupData.BackupTimeLog item : b.getTimeLogs()) {
                    if (item == null) {
                        continue;
                    }
                    LocalDateTime started = parseTs(item.getStartedAt());
                    if (started == null) {
                        continue;
                    }
                    int mins = item.getMinutes() == null ? 1 : Math.max(1, item.getMinutes());
                    // 原计时人不在目标空间（跨空间导入）：归导入者，避免工时记录变成幽灵账号
                    String logUserId = Texts.trimToNull(item.getUserId());
                    if (logUserId == null || !st.memberIds.contains(logUserId)) {
                        logUserId = st.userId;
                    }
                    TimeLog tl = new TimeLog();
                    tl.setTaskId(id);
                    tl.setWorkspaceId(workspaceId);
                    tl.setUserId(logUserId);
                    tl.setStartedAt(started);
                    tl.setEndedAt(started.plusMinutes(mins));
                    tl.setMinutes(mins);
                    /* 旧备份没有 origin：按计时器回填（同 sql/44 迁移口径） */
                    tl.setOrigin("manual".equals(item.getOrigin()) ? "manual" : "timer");
                    tl.setNote(Texts.cut(Texts.trimToNull(item.getNote()), 200));
                    timeLogs.add(tl);
                }
            }
            st.taskCount++;
        }

        if (!tasks.isEmpty()) {
            taskMapper.insertBatch(tasks);
        }
        insertInBatches(subtasks, subtaskMapper::insertBatch);
        insertInBatches(tagLinks, rows -> tagMapper.insertTaskTags(workspaceId, rows));
        insertInBatches(timeLogs, timeLogMapper::insertCompletedBatch);
    }

    /** 阶段 3a：依赖 / 基线 / 循环派生关联 */
    private void importLinks(BackupData data, ImportState st) {
        String workspaceId = st.workspaceId;
        Map<String, String> taskIdMap = st.taskIdMap;
        Set<String> taskIds = st.taskIds;

        // 恢复依赖：任务 ID 可能被重映射；跳过自环、重复边与成环边
        List<TaskDependency> deps = new ArrayList<TaskDependency>();
        if (data.getDeps() != null) {
            Map<String, Set<String>> adj = new HashMap<String, Set<String>>();
            Set<String> seenEdges = new HashSet<String>();
            for (BackupData.BackupDependency d : data.getDeps()) {
                if (d == null) {
                    continue;
                }
                String depFrom = taskIdMap.get(Texts.trimToNull(d.getFrom()));
                String depTo = taskIdMap.get(Texts.trimToNull(d.getTo()));
                if (depFrom == null || depTo == null || depFrom.equals(depTo)) {
                    continue;
                }
                if (!taskIds.contains(depFrom) || !taskIds.contains(depTo)) {
                    continue;
                }
                if (!seenEdges.add(depFrom + ">" + depTo)) {
                    continue;
                }
                if (reachable(adj, depTo, depFrom)) {
                    continue;
                }
                String depType = oneOf(d.getType(), new String[]{"FS", "SS", "FF", "SF"}, "FS");
                int lag = d.getLag() == null ? 0 : Math.max(-365, Math.min(365, d.getLag()));
                TaskDependency dep = new TaskDependency();
                dep.setId(Ids.gen("D"));
                dep.setWorkspaceId(workspaceId);
                dep.setFromTaskId(depFrom);
                dep.setToTaskId(depTo);
                dep.setDepType(depType);
                dep.setLagDays(lag);
                deps.add(dep);
                Set<String> next = adj.get(depFrom);
                if (next == null) {
                    next = new HashSet<String>();
                    adj.put(depFrom, next);
                }
                next.add(depTo);
            }
            /* INSERT IGNORE：uk_edge 冲突时跳过该边（等价于旧的逐条 try/catch） */
            eachChunk(deps, dependencyMapper::insertBatch);
        }

        // 恢复基线：只保留本次导入里存在的任务
        if (data.getBaseline() != null) {
            LocalDateTime captured = parseTs(data.getBaselineAt());
            if (captured == null) {
                captured = LocalDateTime.now();
            }
            List<TaskBaseline> baselineRows = new ArrayList<TaskBaseline>();
            Set<String> seenBaseline = new HashSet<String>();
            for (BackupData.BackupBaseline bb : data.getBaseline()) {
                if (bb == null) {
                    continue;
                }
                String mapped = taskIdMap.get(Texts.trimToNull(bb.getTaskId()));
                if (mapped == null || !taskIds.contains(mapped) || !seenBaseline.add(mapped)) {
                    continue;
                }
                LocalDate start = parseDate(bb.getStart());
                LocalDate due = parseDate(bb.getDue());
                if (start == null && due == null) {
                    continue;
                }
                TaskBaseline tb = new TaskBaseline();
                tb.setWorkspaceId(workspaceId);
                tb.setTaskId(mapped);
                tb.setStartDate(start);
                tb.setDueDate(due);
                tb.setCapturedAt(captured);
                baselineRows.add(tb);
            }
            eachChunk(baselineRows, baselineMapper::insertBatch);
        }

        // v8：Epic 归属要等全部任务落库后按映射回指；目标不存在则保持无归属
        List<String[]> epicRows = new ArrayList<String[]>();
        for (String[] link : st.epicLinks) {
            String epicId = taskIdMap.get(link[1]);
            if (epicId == null || epicId.equals(link[0]) || !taskIds.contains(epicId)) {
                continue;
            }
            epicRows.add(new String[]{link[0], epicId});
        }
        eachChunk(epicRows, batch -> {
            for (String[] row : batch) {
                taskMapper.setEpic(row[0], row[1]);
            }
        });

        // v8：版本绑定（version_task 以 task_id 为主键，任务已去重，直接写）
        Map<String, List<String>> tasksByVersion = new LinkedHashMap<String, List<String>>();
        for (String[] link : st.versionLinks) {
            List<String> list = tasksByVersion.get(link[1]);
            if (list == null) {
                list = new ArrayList<String>();
                tasksByVersion.put(link[1], list);
            }
            list.add(link[0]);
        }
        for (Map.Entry<String, List<String>> entry : tasksByVersion.entrySet()) {
            eachChunk(entry.getValue(), batch ->
                    versionTaskMapper.insertBatch(workspaceId, entry.getKey(), batch));
        }

        // 恢复循环派生关联：等到全部任务落库后，按 ID 映射校验目标存在性再写回（旧备份无此字段则跳过）
        List<String[]> links = new ArrayList<String[]>();
        for (String[] link : st.recurLinks) {
            String nextId = st.taskIdMap.get(link[1]);
            if (nextId == null || !st.taskIds.contains(nextId)) {
                continue; // 派生的下一次任务不在本次导入中：保持无关联，完成时会重新生成
            }
            links.add(new String[]{link[0], nextId});
        }
        eachChunk(links, batch -> {
            for (String[] link : batch) {
                taskMapper.setRecurNext(link[0], link[1]);
            }
        });
    }

    /** 阶段 3：测试用例与执行流水（项目/任务 ID 可能因跨空间冲突被重映射） */
    private void importTestCases(BackupData data, ImportState st) {
        if (data.getTestCases() == null || data.getReqs() == null) {
            return;
        }
        Map<String, String> caseIdMap = new HashMap<String, String>();
        for (BackupData.BackupTestCase b : data.getTestCases()) {
            if (b == null) {
                continue;
            }
            String title = Texts.trimToNull(b.getTitle());
            String oldReqId = Texts.trimToNull(b.getReqId());
            if (title == null || oldReqId == null) {
                continue;
            }
            String reqId = st.reqIdMap.containsKey(oldReqId) ? st.reqIdMap.get(oldReqId) : oldReqId;
            if (!st.reqIds.contains(reqId)) {
                continue;
            }
            String original = Ids.sanitize(Texts.trimToNull(b.getId()));
            /* 同空间导入尽量复用原用例 ID：测试计划/计划圈选不在备份里，ID 复用后
               计划里的 case_id 仍然有效，不会出现“计划总数有、列表为空”。 */
            String caseId = original;
            if (caseId == null || testCaseMapper.selectById(caseId) != null) {
                caseId = Ids.gen("C");
            }
            TestCase c = new TestCase();
            c.setId(caseId);
            c.setWorkspaceId(st.workspaceId);
            c.setReqId(reqId);
            c.setTitle(Texts.cut(title, 100));
            c.setPrecondition(Texts.cut(Texts.trimToNull(b.getPrecondition()), 1000));
            c.setSteps(Texts.trimToNull(b.getSteps()));
            String latestStatus = Texts.trimToNull(b.getLatestStatus());
            c.setLatestStatus(CaseMeta.isRunStatus(latestStatus) ? latestStatus : null);
            c.setLatestNote(Texts.cut(Texts.trimToNull(b.getLatestNote()), 500));
            c.setLatestBy(Texts.cut(Texts.trimToNull(b.getLatestBy()), 32));
            String latestBy = Texts.trimToNull(b.getLatestByUserId());
            c.setLatestByUserId(latestBy != null && st.memberIds.contains(latestBy) ? latestBy : null);
            c.setLatestAt(parseTs(b.getLatestAt()));
            c.setLatestBugTaskId(mappedTaskId(st, b.getLatestBugTaskId()));
            c.setCreatedAt(parseTs(b.getCreatedAt()));
            c.setUpdatedAt(parseTs(b.getUpdatedAt()));
            testCaseMapper.insert(c);
            if (original != null) {
                caseIdMap.put(original, c.getId());
            }
            st.testCaseCount++;
        }
        if (data.getTestCaseRuns() == null) {
            return;
        }
        for (BackupData.BackupTestCaseRun b : data.getTestCaseRuns()) {
            if (b == null) {
                continue;
            }
            String status = Texts.trimToNull(b.getStatus());
            String originalCaseId = Texts.trimToNull(b.getCaseId());
            String caseId = originalCaseId == null ? null : caseIdMap.get(originalCaseId);
            if (caseId == null || !CaseMeta.isRunStatus(status)) {
                continue;
            }
            TestCaseRun run = new TestCaseRun();
            run.setId(Ids.gen("R"));
            run.setCaseId(caseId);
            run.setWorkspaceId(st.workspaceId);
            run.setStatus(status);
            run.setNote(Texts.cut(Texts.trimToNull(b.getNote()), 500));
            run.setBugTaskId(mappedTaskId(st, b.getBugTaskId()));
            run.setExecutedBy(Texts.cut(Texts.trimToNull(b.getExecutedBy()), 32));
            String executedBy = Texts.trimToNull(b.getExecutedByUserId());
            run.setExecutedByUserId(executedBy != null && st.memberIds.contains(executedBy) ? executedBy : null);
            run.setCreatedAt(parseTs(b.getCreatedAt()));
            testCaseRunMapper.insert(run);
        }
    }

    private String mappedTaskId(ImportState st, String originalTaskId) {
        String original = Texts.trimToNull(originalTaskId);
        if (original == null) {
            return null;
        }
        String mapped = st.taskIdMap.containsKey(original) ? st.taskIdMap.get(original) : original;
        return st.taskIds.contains(mapped) ? mapped : null;
    }

    /** 阶段 1c：需求文档评论（文档 ID 可能因跨空间冲突被重映射） */
    private void importDocComments(BackupData data, ImportState st) {
        if (data.getDocComments() == null || data.getReqDocs() == null) {
            return;
        }
        for (BackupData.BackupDocComment b : data.getDocComments()) {
            if (b == null) {
                continue;
            }
            String content = Texts.trimToNull(b.getContent());
            String originalDocId = Texts.trimToNull(b.getDocId());
            if (content == null || originalDocId == null) {
                continue;
            }
            String docId = st.reqDocIdMap.containsKey(originalDocId)
                    ? st.reqDocIdMap.get(originalDocId) : originalDocId;
            RequirementDoc doc = requirementDocMapper.selectById(docId);
            if (doc == null || !st.workspaceId.equals(doc.getWorkspaceId())) {
                continue;
            }
            RequirementDocComment c = new RequirementDocComment();
            c.setId(Ids.gen("DC"));
            c.setWorkspaceId(st.workspaceId);
            c.setDocId(docId);
            String author = Texts.trimToNull(b.getUserId());
            c.setUserId(author == null ? st.userId : author);
            c.setContent(content);
            c.setQuoteText(Texts.cut(Texts.trimToNull(b.getQuoteText()), 500));
            c.setCreatedAt(parseTs(b.getCreatedAt()));
            docCommentMapper.insert(c);
            st.docCommentCount++;
        }
    }

    /** 阶段 3b：需求池 ↔ 需求文档关联（按导入后的 demand/doc ID 重新挂接） */
    private void importDemandDocLinks(BackupData data, ImportState st) {
        if (data.getDemandDocLinks() == null) {
            return;
        }
        for (BackupData.BackupDemandDocLink b : data.getDemandDocLinks()) {
            if (b == null) {
                continue;
            }
            String oldDemand = Texts.trimToNull(b.getDemandId());
            String oldDoc = Texts.trimToNull(b.getDocId());
            if (oldDemand == null || oldDoc == null) {
                continue;
            }
            String demandId = st.demandIdMap.containsKey(oldDemand) ? st.demandIdMap.get(oldDemand) : oldDemand;
            String docId = st.reqDocIdMap.containsKey(oldDoc) ? st.reqDocIdMap.get(oldDoc) : oldDoc;
            if (!st.demandIds.contains(demandId) || requirementDocMapper.selectById(docId) == null) {
                continue;
            }
            requirementDocMapper.linkDemand(st.workspaceId, demandId, docId, st.userId);
        }
    }

    /** 阶段 3b：评论（任务 ID 可能因跨空间冲突被重映射，按 taskIdMap 回指） */
    private void importComments(BackupData data, ImportState st) {
        if (data.getComments() == null) {
            return;
        }
        String workspaceId = st.workspaceId;
        List<TaskComment> rows = new ArrayList<TaskComment>();
        for (BackupData.BackupComment c : data.getComments()) {
            if (c == null) {
                continue;
            }
            String originalTaskId = Texts.trimToNull(c.getTaskId());
            String mappedTaskId = originalTaskId == null ? null : st.taskIdMap.get(originalTaskId);
            if (mappedTaskId == null) {
                continue;
            }
            String content = Texts.cut(Texts.trimToNull(c.getContent()), 500);
            if (content == null) {
                continue;
            }
            TaskComment tc = new TaskComment();
            tc.setTaskId(mappedTaskId);
            tc.setWorkspaceId(workspaceId);
            tc.setAuthorId(Texts.cut(Texts.trimToNull(c.getAuthorId()), 32));
            tc.setAuthorName(Texts.cut(Texts.trimToNull(c.getAuthorName()), 32));
            tc.setContent(content);
            tc.setCreatedAt(parseTs(c.getCreatedAt()));
            rows.add(tc);
            st.commentCount++;
        }
        eachChunk(rows, commentMapper::insertBatch);
    }

    /** 阶段 4：完成归档是任务快照的派生物，按导入后的任务与工时重建「任务清单」 */
    private void archiveDone(ImportState st) {
        for (int from = 0; from < st.importedDone.size(); from += ARCHIVE_BATCH_SIZE) {
            final List<Task> batch = st.importedDone.subList(from,
                    Math.min(from + ARCHIVE_BATCH_SIZE, st.importedDone.size()));
            txTemplate.execute(status -> {
                for (Task t : batch) {
                    completionService.archive(t);
                }
                return null;
            });
        }
    }


    /* ==================== 导入批次工具 ==================== */

    private static final class ImportState {
        final String userId;
        final String workspaceId;
        /** 其它空间已占用的任务 ID（本空间任务已清空，可复用原 ID） */
        Set<String> existingTaskIds = new HashSet<String>();
        Set<String> memberIds = new HashSet<String>();
        final Set<String> reqIds = new HashSet<String>();
        final Map<String, String> reqIdMap = new HashMap<String, String>();
        /** 需求文档 id → 所属项目 id（本空间） */
        final Map<String, String> reqDocReqId = new HashMap<String, String>();
        final Set<String> branchIds = new HashSet<String>();
        final Set<String> colIds = new HashSet<String>();
        final Map<String, String> colNameToId = new HashMap<String, String>();
        /** 项目默认模块：projectId → 项目内最靠前的模块（导入任务回落用；模块挂在项目下） */
        final Map<String, String> projectFirstCat = new HashMap<String, String>();
        /** v12：备份模块 id → 落库模块 id（同空间还原为原 ID；查不到映射回落项目默认模块） */
        final Map<String, String> catIdMap = new HashMap<String, String>();
        /** 标签名 → 标签（阶段 1 预建，阶段 2 只读） */
        final Map<String, Tag> tagByName = new HashMap<String, Tag>();
        final Map<String, Integer> colSeq = new HashMap<String, Integer>();
        final Set<String> taskIds = new HashSet<String>();
        final Set<String> seenTaskIds = new HashSet<String>();
        final Map<String, String> taskIdMap = new HashMap<String, String>();
        final Map<String, String> branchIdMap = new HashMap<String, String>();
        final Map<String, String> reqDocIdMap = new HashMap<String, String>();
        /** v8：备份版本 id → 落库版本 id，以及版本所属项目 */
        final Map<String, String> versionIdMap = new HashMap<String, String>();
        final Map<String, String> versionReqId = new HashMap<String, String>();
        final Set<String> versionIds = new HashSet<String>();
        /** v8：备份需求池 id → 落库需求 id，以及需求所属项目 */
        final Map<String, String> demandIdMap = new HashMap<String, String>();
        final Map<String, String> demandReqId = new HashMap<String, String>();
        final Set<String> demandIds = new HashSet<String>();
        /** v8：阶段 2 收集、阶段 3 统一回指 [任务id, 旧epicId/落库versionId] */
        final List<String[]> epicLinks = new ArrayList<String[]>();
        final List<String[]> versionLinks = new ArrayList<String[]>();
        final List<String[]> recurLinks = new ArrayList<String[]>();
        final List<Task> importedDone = new ArrayList<Task>();
        int reqCount;
        int branchCount;
        int reqDocCount;
        int versionCount;
        int demandCount;
        int taskCount;
        int commentCount;
        int testCaseCount;
        int docCommentCount;

        ImportState(String userId, String workspaceId) {
            this.userId = userId;
            this.workspaceId = workspaceId;
        }
    }

    /** 只查其它空间的任务 ID：本空间任务会在阶段 1 清空，原 ID 可以复用 */
    private Set<String> existingTaskIdsInOtherWorkspaces(String workspaceId, BackupData data) {
        Set<String> originals = new LinkedHashSet<String>();
        for (BackupData.BackupTask b : data.getTasks()) {
            if (b == null) {
                continue;
            }
            String original = Ids.sanitize(Texts.trimToNull(b.getId()));
            if (original != null) {
                originals.add(original);
            }
        }
        Set<String> existing = new HashSet<String>();
        List<String> ids = new ArrayList<String>(originals);
        for (int from = 0; from < ids.size(); from += IMPORT_BATCH_SIZE) {
            List<String> chunk = ids.subList(from, Math.min(from + IMPORT_BATCH_SIZE, ids.size()));
            existing.addAll(taskMapper.selectIdsInOtherWorkspaces(workspaceId, chunk));
        }
        return existing;
    }

    private Set<String> memberIdsOf(String workspaceId) {
        return new HashSet<String>(memberMapper.selectUserIds(workspaceId));
    }

    /** 与任务循环里的标签处理同口径（去空白/逗号、截断 16、去重、每任务最多 8 个） */
    private String normalizeTagName(String raw) {
        String name = Texts.trimToNull(raw);
        if (name == null) {
            return null;
        }
        name = name.replace(',', ' ').replace('，', ' ').trim();
        if (name.isEmpty()) {
            return null;
        }
        return Texts.cut(name, 16);
    }

    private Set<String> collectTagNames(BackupData data) {
        Set<String> names = new LinkedHashSet<String>();
        Set<String> seenTaskIds = new HashSet<String>();
        for (BackupData.BackupTask b : data.getTasks()) {
            if (b == null) {
                continue;
            }
            /* 与任务循环一致：备份内的重复任务 ID 只按第一条处理，不给被跳过的条目建标签 */
            String original = Ids.sanitize(Texts.trimToNull(b.getId()));
            if (original != null && !seenTaskIds.add(original)) {
                continue;
            }
            if (b.getTags() == null) {
                continue;
            }
            Set<String> seen = new HashSet<String>();
            int n = 0;
            for (String raw : b.getTags()) {
                String name = normalizeTagName(raw);
                if (name == null || !seen.add(name)) {
                    continue;
                }
                if (++n > 8) {
                    break;
                }
                names.add(name);
            }
        }
        return names;
    }

    /** 阶段 1 预建标签：任务循环里不再逐个 selectByName */
    private void ensureTags(ImportState st, Set<String> names) {
        for (Tag tag : tagMapper.selectAllByWorkspace(st.workspaceId)) {
            st.tagByName.put(tag.getName(), tag);
        }
        for (String name : names) {
            if (st.tagByName.containsKey(name)) {
                continue;
            }
            Tag tag = new Tag();
            tag.setId(Ids.gen("T"));
            tag.setWorkspaceId(st.workspaceId);
            tag.setName(name);
            try {
                tagMapper.insert(tag);
                st.tagByName.put(name, tag);
            } catch (Exception e) {
                Tag existing = tagMapper.selectByName(st.workspaceId, name);
                if (existing != null) {
                    st.tagByName.put(name, existing);
                }
            }
        }
    }

    /** 当前事务内按批执行语句（用于一个任务批里的子表） */
    private <T> void insertInBatches(List<T> rows, Consumer<List<T>> inserter) {
        for (int from = 0; from < rows.size(); from += IMPORT_BATCH_SIZE) {
            inserter.accept(rows.subList(from, Math.min(from + IMPORT_BATCH_SIZE, rows.size())));
        }
    }

    /** 每批一个独立事务（用于依赖/基线/循环关联/评论） */
    private <T> void eachChunk(List<T> rows, Consumer<List<T>> action) {
        for (int from = 0; from < rows.size(); from += IMPORT_BATCH_SIZE) {
            final List<T> chunk = rows.subList(from, Math.min(from + IMPORT_BATCH_SIZE, rows.size()));
            txTemplate.execute(status -> {
                action.accept(chunk);
                return null;
            });
        }
    }

    private Tag findOrCreateTag(String workspaceId, String name) {
        Tag tag = tagMapper.selectByName(workspaceId, name);
        if (tag != null) {
            return tag;
        }
        tag = new Tag();
        tag.setId(Ids.gen("T"));
        tag.setWorkspaceId(workspaceId);
        tag.setName(name);
        try {
            tagMapper.insert(tag);
            return tag;
        } catch (Exception e) {
            return tagMapper.selectByName(workspaceId, name);
        }
    }

    /** 列映射：旧列 id 兼容 → 目标空间已有列 → 按列名匹配 → 兜底待处理 */
    private String mapColumn(String col, Set<String> colIds, Map<String, String> colNameToId) {
        if (col == null) {
            return Consts.COL_BACKLOG;
        }
        String c = col.trim();
        if ("todo".equals(c)) {
            return Consts.COL_BACKLOG;
        }
        if ("review".equals(c)) {
            return Consts.COL_DOING;
        }
        if (Consts.COL_DONE.equals(c) || colIds.contains(c)) {
            return c;
        }
        String byName = colNameToId.get(c);
        return byName != null ? byName : Consts.COL_BACKLOG;
    }

    private static boolean reachable(Map<String, Set<String>> adj, String from, String to) {
        if (from == null || to == null) {
            return false;
        }
        Set<String> seen = new HashSet<String>();
        List<String> stack = new ArrayList<String>();
        stack.add(from);
        while (!stack.isEmpty()) {
            String cur = stack.remove(stack.size() - 1);
            if (!seen.add(cur)) {
                continue;
            }
            if (cur.equals(to)) {
                return true;
            }
            Set<String> next = adj.get(cur);
            if (next != null) {
                stack.addAll(next);
            }
        }
        return false;
    }

    /** 备份里的父子引用可能互为上级：沿已有父链上溯，遇到自己就算成环 */
    private static boolean wouldCycle(String child, Map<String, String> parentByOriginal) {
        String cur = parentByOriginal.get(child);
        Set<String> seen = new HashSet<String>();
        while (cur != null && seen.add(cur)) {
            if (cur.equals(child)) {
                return true;
            }
            cur = parentByOriginal.get(cur);
        }
        return false;
    }

    private String oneOf(String value, String[] allowed, String fallback) {
        if (value != null) {
            for (String item : allowed) {
                if (item.equals(value.trim())) {
                    return item;
                }
            }
        }
        return fallback;
    }

    /** Transfer validation is pure and always runs before any destructive statement. */
    private void validateTransfer(BackupData data) {
        if (!Integer.valueOf(BackupData.FORMAT_VERSION).equals(data.getV())) {
            throw AppException.badRequest("仅支持 v13 新格式 JSON 工作项迁移，不支持旧格式或发布历史迁移");
        }
        if (data.getReqs() == null || data.getVersions() == null || data.getDemands() == null) {
            throw AppException.badRequest("新格式必须包含 reqs、versions、demands 字典（可为空数组）");
        }
        Set<String> projects = new HashSet<String>();
        for (BackupData.BackupReq project : data.getReqs()) {
            if (project == null || Texts.trimToNull(project.getId()) == null || !projects.add(project.getId()))
                throw AppException.badRequest("项目字典ID为空或重复");
        }
        Map<String, BackupData.BackupVersion> versions = new HashMap<String, BackupData.BackupVersion>();
        Set<String> versionNames = new HashSet<String>();
        for (BackupData.BackupVersion version : data.getVersions()) {
            if (version == null || Texts.trimToNull(version.getId()) == null || !projects.contains(version.getReqId())
                    || versions.put(version.getId(), version) != null)
                throw AppException.badRequest("版本字典ID或项目引用不合法");
            String versionName = Texts.trimToNull(version.getName());
            if (versionName == null || !versionNames.add(version.getReqId() + "\u0000" + versionName))
                throw AppException.badRequest("版本名称为空或在项目内重复：" + version.getId());
            LocalDate start = strictTransferDate(version.getStartDate());
            LocalDate end = strictTransferDate(version.getTargetDate());
            if (start != null && end != null && start.isAfter(end)) throw AppException.badRequest("版本开始日期不能晚于目标日期");
            if ("released".equals(version.getStatus()) || Texts.trimToNull(version.getReleasedAt()) != null)
                throw AppException.badRequest("JSON 不迁移已发布版本内容或正式事实，请使用数据库备份；版本：" + version.getId());
        }
        Map<String, BackupData.BackupDemand> demands = new HashMap<String, BackupData.BackupDemand>();
        for (BackupData.BackupDemand demand : data.getDemands()) {
            if (demand == null || Texts.trimToNull(demand.getId()) == null || !projects.contains(demand.getReqId())
                    || demands.put(demand.getId(), demand) != null)
                throw AppException.badRequest("需求字典ID或项目引用不合法");
            String target = Texts.trimToNull(demand.getVersionId());
            if (target != null && (versions.get(target) == null || !demand.getReqId().equals(versions.get(target).getReqId())))
                throw AppException.badRequest("需求目标版本不存在或跨项目：" + demand.getId());
        }
        Map<String, BackupData.BackupTask> tasks = new HashMap<String, BackupData.BackupTask>();
        for (BackupData.BackupTask task : data.getTasks()) {
            if (task == null || Texts.trimToNull(task.getId()) == null || tasks.put(task.getId(), task) != null)
                throw AppException.badRequest("任务ID为空或重复");
            if (task.getReqId() != null && !projects.contains(task.getReqId())) throw AppException.badRequest("任务引用不存在的项目");
            if (task.getVersionIds() == null) throw AppException.badRequest("每个任务必须显式提供 versionIds 数组");
            Set<String> unique = new HashSet<String>();
            for (String id : task.getVersionIds()) {
                BackupData.BackupVersion version = versions.get(id);
                if (version == null || !unique.add(id) || !java.util.Objects.equals(task.getReqId(), version.getReqId()))
                    throw AppException.badRequest("任务规划版本不存在、重复或跨项目：" + task.getId());
            }
            if (task.getFoundVersionId() != null && (versions.get(task.getFoundVersionId()) == null
                    || !java.util.Objects.equals(task.getReqId(), versions.get(task.getFoundVersionId()).getReqId())))
                throw AppException.badRequest("缺陷发现版本引用不合法：" + task.getId());
            if (task.getDemandId() != null && (demands.get(task.getDemandId()) == null
                    || !java.util.Objects.equals(task.getReqId(), demands.get(task.getDemandId()).getReqId())))
                throw AppException.badRequest("任务需求引用不合法：" + task.getId());
        }
        for (BackupData.BackupTask task : data.getTasks()) {
            if (task.getEpicId() == null) continue;
            BackupData.BackupTask epic = tasks.get(task.getEpicId());
            if (epic == null || epic == task || !"epic".equals(epic.getItemType()) || "epic".equals(task.getItemType())
                    || !java.util.Objects.equals(task.getReqId(), epic.getReqId()))
                throw AppException.badRequest("Epic 引用必须是同项目的独立史诗：" + task.getId());
        }
    }

    private LocalDate strictTransferDate(String raw) {
        if (Texts.trimToNull(raw) == null) return null;
        try { return LocalDate.parse(raw); }
        catch (RuntimeException ex) { throw AppException.badRequest("备份日期格式不合法：" + raw); }
    }

    /** 在覆盖删除前校验新增需求日期，与 DemandService 一样允许空/单边日期，拒绝倒置区间。 */
    private void validateDemandDates(BackupData data) {
        if (data.getDemands() == null) {
            return;
        }
        for (BackupData.BackupDemand demand : data.getDemands()) {
            if (demand == null) {
                continue;
            }
            LocalDate start = parseDemandDate(demand.getPlannedStart(), "plannedStart");
            LocalDate end = parseDemandDate(demand.getPlannedEnd(), "plannedEnd");
            if (start != null && end != null && start.isAfter(end)) {
                throw AppException.badRequest("计划开始日期不能晚于计划结束日期");
            }
        }
    }

    private LocalDate parseDemandDate(String value, String field) {
        String text = Texts.trimToNull(value);
        if (text == null) {
            return null;
        }
        try {
            return LocalDate.parse(text);
        } catch (java.time.format.DateTimeParseException e) {
            throw AppException.badRequest("需求计划日期格式不合法：" + field);
        }
    }

    private LocalDate parseDate(String value) {
        String text = Texts.trimToNull(value);
        if (text == null) {
            return null;
        }
        try {
            return LocalDate.parse(text);
        } catch (Exception e) {
            return null;
        }
    }

    private LocalDateTime parseTs(String value) {
        String text = Texts.trimToNull(value);
        if (text == null) {
            return null;
        }
        try {
            return LocalDateTime.parse(text);
        } catch (Exception e) {
            return null;
        }
    }

    private Integer clampWsjf(Integer value) {
        return value == null ? null : Math.max(0, Math.min(10, value));
    }

    private Integer clampWsjfEffort(Integer value) {
        return value == null ? null : Math.max(1, Math.min(10, value));
    }
}
