package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.CaseMeta;
import com.devstudio.kanban.common.Consts;
import com.devstudio.kanban.common.Ids;
import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.dto.BackupData;
import com.devstudio.kanban.dto.TaskTagRef;
import com.devstudio.kanban.entity.BoardColumn;
import com.devstudio.kanban.entity.Category;
import com.devstudio.kanban.entity.Demand;
import com.devstudio.kanban.entity.DemandDocLink;
import com.devstudio.kanban.entity.DevBranch;
import com.devstudio.kanban.entity.DocumentType;
import com.devstudio.kanban.entity.ProjectVersion;
import com.devstudio.kanban.entity.Requirement;
import com.devstudio.kanban.entity.RequirementDoc;
import com.devstudio.kanban.entity.RequirementDocComment;
import com.devstudio.kanban.entity.Subtask;
import com.devstudio.kanban.entity.Tag;
import com.devstudio.kanban.entity.TagTaskRow;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.TaskBaseline;
import com.devstudio.kanban.entity.TaskComment;
import com.devstudio.kanban.entity.TaskDependency;
import com.devstudio.kanban.entity.TestCase;
import com.devstudio.kanban.entity.TestCaseRun;
import com.devstudio.kanban.entity.TimeAgg;
import com.devstudio.kanban.entity.TimeLog;
import com.devstudio.kanban.mapper.AppNotificationMapper;
import com.devstudio.kanban.mapper.BoardColumnMapper;
import com.devstudio.kanban.mapper.CategoryMapper;
import com.devstudio.kanban.mapper.DemandMapper;
import com.devstudio.kanban.mapper.DevBranchMapper;
import com.devstudio.kanban.mapper.GanttShareMapper;
import com.devstudio.kanban.mapper.ProjectVersionMapper;
import com.devstudio.kanban.mapper.RequirementDocCommentMapper;
import com.devstudio.kanban.mapper.RequirementDocMapper;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.SubtaskMapper;
import com.devstudio.kanban.mapper.TagMapper;
import com.devstudio.kanban.mapper.TaskBaselineMapper;
import com.devstudio.kanban.mapper.TaskCommentMapper;
import com.devstudio.kanban.mapper.TaskDependencyMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.TestCaseMapper;
import com.devstudio.kanban.mapper.TestCaseRunMapper;
import com.devstudio.kanban.mapper.TimeLogMapper;
import com.devstudio.kanban.mapper.VersionTaskMapper;
import com.devstudio.kanban.mapper.WorkspaceMemberMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
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
    /** 旧版内置分类的原配色（导入时保留），其余自定义分类用默认灰 */
    private static final java.util.Map<String, String> LEGACY_CAT_COLORS = new java.util.HashMap<String, String>();
    static {
        LEGACY_CAT_COLORS.put("前端", "#5b83ad");
        LEGACY_CAT_COLORS.put("后端", "#5f7a4a");
        LEGACY_CAT_COLORS.put("设计", "#7a5c86");
        LEGACY_CAT_COLORS.put("缺陷", "#b23b33");
    }
    private static final String DEFAULT_CAT_COLOR = "#8a8578";
    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
    private static final DateTimeFormatter ISO_TS = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss");
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
    private final com.devstudio.kanban.mapper.WorkActivityMapper workActivityMapper;

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
                         com.devstudio.kanban.mapper.WorkActivityMapper workActivityMapper,
                         PlatformTransactionManager transactionManager) {
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
        this.txTemplate = new TransactionTemplate(transactionManager);
        /* 覆盖导入必须整体成功或整体回滚：外层事务包住所有阶段，批次只做语句切分 */
        this.txTemplate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRED);
    }

    public BackupData export(String workspaceId) {
        BackupData data = new BackupData();
        data.setV(10);
        data.setExportedAt(LocalDateTime.now().format(ISO_TS));

        /* 回收站任务也要进备份：导入会清空空间任务（含回收站），不导出就等于把回收站丢掉 */
        List<Task> all = new ArrayList<Task>(taskMapper.selectAll(workspaceId));
        all.addAll(taskMapper.selectDeleted(workspaceId));
        List<String> ids = new ArrayList<String>();
        for (Task t : all) {
            ids.add(t.getId());
        }
        Map<String, List<String>> tagMap = tagsOf(workspaceId, ids);

        /* v8：任务→版本是 1:1（version_task 以 task_id 为主键），直接挂回任务 */
        Map<String, String> versionByTask = new HashMap<String, String>();
        for (Task binding : versionTaskMapper.selectBindingsByWorkspace(workspaceId)) {
            if (binding != null && binding.getId() != null) {
                versionByTask.put(binding.getId(), binding.getVersionId());
            }
        }

        Map<String, List<BackupData.BackupSubtask>> subMap = new LinkedHashMap<String, List<BackupData.BackupSubtask>>();
        for (Subtask s : subtaskMapper.selectAll(workspaceId)) {
            List<BackupData.BackupSubtask> list = subMap.get(s.getTaskId());
            if (list == null) {
                list = new ArrayList<BackupData.BackupSubtask>();
                subMap.put(s.getTaskId(), list);
            }
            BackupData.BackupSubtask sb = new BackupData.BackupSubtask();
            sb.setTitle(s.getTitle());
            sb.setDone(s.getDone());
            list.add(sb);
        }

        Map<String, List<BackupData.BackupTimeLog>> timeMap = new LinkedHashMap<String, List<BackupData.BackupTimeLog>>();
        for (TimeLog tl : timeLogMapper.selectAllByWorkspace(workspaceId)) {
            List<BackupData.BackupTimeLog> list = timeMap.get(tl.getTaskId());
            if (list == null) {
                list = new ArrayList<BackupData.BackupTimeLog>();
                timeMap.put(tl.getTaskId(), list);
            }
            BackupData.BackupTimeLog item = new BackupData.BackupTimeLog();
            item.setUserId(tl.getUserId());
            item.setStartedAt(tl.getStartedAt().format(ISO_TS));
            item.setMinutes(tl.getMinutes());
            list.add(item);
        }

        List<BackupData.BackupTask> tasks = new ArrayList<BackupData.BackupTask>();
        for (Task t : all) {
            BackupData.BackupTask b = new BackupData.BackupTask();
            b.setId(t.getId());
            b.setTitle(t.getTitle());
            b.setDesc(t.getDescription());
            b.setPri(t.getPriority());
            b.setOwner(t.getOwner());
            b.setCat(t.getCategory());
            b.setCol(t.getBoardColumn());
            b.setStart(t.getStartDate() == null ? null : t.getStartDate().toString());
            b.setDue(t.getDueDate() == null ? null : t.getDueDate().toString());
            b.setProgress(t.getProgress());
            b.setIsMilestone(Boolean.TRUE.equals(t.getIsMilestone()));
            b.setNote(t.getNote());
            b.setReqId(t.getReqId());
            b.setReqDocId(t.getReqDocId());
            b.setBranchId(t.getBranchId());
            b.setEstimateMinutes(t.getEstimateMinutes());
            b.setBlocked(Boolean.TRUE.equals(t.getBlocked()));
            b.setBlockedReason(t.getBlockedReason());
            b.setOwnerUserId(t.getOwnerUserId());
            b.setRemindTarget(t.getRemindTarget());
            b.setCompletedAt(t.getCompletedAt() == null ? null : t.getCompletedAt().toString());
            b.setSubtasks(subMap.get(t.getId()));
            b.setTags(tagMap.get(t.getId()));
            b.setRecurType(t.getRecurType());
            b.setRecurNextId(t.getRecurNextId());
            b.setRemindAt(t.getRemindAt() == null ? null : t.getRemindAt().format(ISO_TS));
            b.setRemindSent(t.getRemindSent());
            b.setTimeLogs(timeMap.get(t.getId()));
            b.setCreatedAt(t.getCreatedAt() == null ? null : t.getCreatedAt().format(ISO_TS));
            b.setDeletedAt(t.getDeletedAt() == null ? null : t.getDeletedAt().format(ISO_TS));
            b.setItemType(t.getItemType());
            b.setEpicId(t.getEpicId());
            b.setDemandId(t.getDemandId());
            b.setSeverity(t.getSeverity());
            b.setEnvironment(t.getEnvironment());
            b.setReproduceSteps(t.getReproduceSteps());
            b.setFoundVersionId(t.getFoundVersionId());
            b.setRegressionStatus(t.getRegressionStatus());
            b.setVersionId(versionByTask.get(t.getId()));
            tasks.add(b);
        }
        data.setTasks(tasks);

        List<BackupData.BackupColumn> columns = new ArrayList<BackupData.BackupColumn>();
        for (BoardColumn c : boardColumnMapper.selectAll(workspaceId)) {
            BackupData.BackupColumn bc = new BackupData.BackupColumn();
            bc.setId(c.getId());
            bc.setName(c.getName());
            bc.setColor(c.getColor());
            columns.add(bc);
        }
        data.setColumns(columns);

        List<BackupData.BackupReq> reqs = new ArrayList<BackupData.BackupReq>();
        for (Requirement r : reqMapper.selectAll(workspaceId)) {
            BackupData.BackupReq b = new BackupData.BackupReq();
            b.setId(r.getId());
            b.setName(r.getName());
            b.setDesc(r.getDescription());
            b.setStatus(r.getStatus());
            b.setCreatedAt(r.getCreatedAt() == null ? null : r.getCreatedAt().toLocalDate().toString());
            b.setFirstReleasedAt(r.getFirstReleasedAt() == null ? null : r.getFirstReleasedAt().toString());
            reqs.add(b);
        }
        data.setReqs(reqs);

        /* 评论是用户内容：导入会清空评论，因此备份必须带上，否则“导出→导入”会静默丢讨论 */
        List<BackupData.BackupComment> comments = new ArrayList<BackupData.BackupComment>();
        for (TaskComment c : commentMapper.selectAllByWorkspace(workspaceId)) {
            BackupData.BackupComment bc = new BackupData.BackupComment();
            bc.setTaskId(c.getTaskId());
            bc.setAuthorId(c.getAuthorId());
            bc.setAuthorName(c.getAuthorName());
            bc.setContent(c.getContent());
            bc.setCreatedAt(c.getCreatedAt() == null ? null : c.getCreatedAt().format(ISO_TS));
            comments.add(bc);
        }
        data.setComments(comments);

        /* 甘特依赖与基线（v5）：只导出两端都在本次备份任务集合里的边，避免悬挂 */
        Set<String> exportedTaskIds = new HashSet<String>();
        for (Task t : all) {
            exportedTaskIds.add(t.getId());
        }
        List<BackupData.BackupDependency> deps = new ArrayList<BackupData.BackupDependency>();
        for (TaskDependency d : dependencyMapper.selectByWorkspace(workspaceId)) {
            if (!exportedTaskIds.contains(d.getFromTaskId()) || !exportedTaskIds.contains(d.getToTaskId())) {
                continue;
            }
            BackupData.BackupDependency bd = new BackupData.BackupDependency();
            bd.setFrom(d.getFromTaskId());
            bd.setTo(d.getToTaskId());
            bd.setType(d.getDepType());
            bd.setLag(d.getLagDays());
            deps.add(bd);
        }
        data.setDeps(deps);

        List<BackupData.BackupBaseline> baseline = new ArrayList<BackupData.BackupBaseline>();
        for (TaskBaseline tb : baselineMapper.selectByWorkspace(workspaceId)) {
            if (!exportedTaskIds.contains(tb.getTaskId())) {
                continue;
            }
            BackupData.BackupBaseline bb = new BackupData.BackupBaseline();
            bb.setTaskId(tb.getTaskId());
            bb.setStart(tb.getStartDate() == null ? null : tb.getStartDate().toString());
            bb.setDue(tb.getDueDate() == null ? null : tb.getDueDate().toString());
            baseline.add(bb);
        }
        data.setBaseline(baseline);
        LocalDateTime baselineAt = baselineMapper.selectCapturedAt(workspaceId);
        data.setBaselineAt(baselineAt == null ? null : baselineAt.format(ISO_TS));

        /* v6：需求文档（含正文）与分支池。分支操作时间线属于审计记录，不随备份迁移 */
        List<BackupData.BackupReqDoc> reqDocs = new ArrayList<BackupData.BackupReqDoc>();
        for (RequirementDoc d : requirementDocMapper.selectAllByWorkspace(workspaceId)) {
            BackupData.BackupReqDoc bd = new BackupData.BackupReqDoc();
            bd.setId(d.getId());
            bd.setReqId(d.getReqId());
            bd.setParentId(d.getParentId());
            bd.setTitle(d.getTitle());
            bd.setDocType(DocumentType.parseOrOther(d.getDocType()).getCode());
            bd.setContent(d.getContent());
            bd.setFormat(d.getFormat() == null ? "html" : d.getFormat());
            bd.setStatus(d.getStatus());
            bd.setPublishedAt(d.getPublishedAt() == null ? null : d.getPublishedAt().format(ISO_TS));
            bd.setOwner(d.getOwner());
            bd.setOwnerUserId(d.getOwnerUserId());
            bd.setSortOrder(d.getSortOrder());
            bd.setCreatedAt(d.getCreatedAt() == null ? null : d.getCreatedAt().format(ISO_TS));
            bd.setUpdatedAt(d.getUpdatedAt() == null ? null : d.getUpdatedAt().format(ISO_TS));
            reqDocs.add(bd);
        }
        data.setReqDocs(reqDocs);

        List<BackupData.BackupBranch> branches = new ArrayList<BackupData.BackupBranch>();
        for (DevBranch br : devBranchMapper.selectByWorkspace(workspaceId, null)) {
            BackupData.BackupBranch bb = new BackupData.BackupBranch();
            bb.setId(br.getId());
            bb.setReqId(br.getReqId());
            bb.setName(br.getName());
            bb.setStatus(br.getStatus());
            bb.setOwner(br.getOwner());
            bb.setOwnerUserId(br.getOwnerUserId());
            bb.setTargetBranch(br.getTargetBranch());
            bb.setNote(br.getNote());
            bb.setDevAt(br.getDevAt() == null ? null : br.getDevAt().format(ISO_TS));
            bb.setTestAt(br.getTestAt() == null ? null : br.getTestAt().format(ISO_TS));
            bb.setMergeAt(br.getMergeAt() == null ? null : br.getMergeAt().format(ISO_TS));
            bb.setReleasedAt(br.getReleasedAt() == null ? null : br.getReleasedAt().format(ISO_TS));
            bb.setSortOrder(br.getSortOrder());
            bb.setCreatedAt(br.getCreatedAt() == null ? null : br.getCreatedAt().format(ISO_TS));
            bb.setUpdatedAt(br.getUpdatedAt() == null ? null : br.getUpdatedAt().format(ISO_TS));
            branches.add(bb);
        }
        data.setBranches(branches);

        /* v8：项目版本与需求池。版本只归属项目，需求池通过 req_id / version_id 关联；
           需求流转日志属于审计记录，与分支时间线同口径不随备份迁移 */
        List<BackupData.BackupVersion> versions = new ArrayList<BackupData.BackupVersion>();
        for (ProjectVersion v : versionMapper.selectByWorkspace(workspaceId)) {
            BackupData.BackupVersion bv = new BackupData.BackupVersion();
            bv.setId(v.getId());
            bv.setReqId(v.getReqId());
            bv.setName(v.getName());
            bv.setDesc(v.getDescription());
            bv.setStatus(v.getStatus());
            bv.setTargetDate(v.getTargetDate() == null ? null : v.getTargetDate().toString());
            bv.setReleasedAt(v.getReleasedAt() == null ? null : v.getReleasedAt().format(ISO_TS));
            bv.setCreatedAt(v.getCreatedAt() == null ? null : v.getCreatedAt().format(ISO_TS));
            bv.setUpdatedAt(v.getUpdatedAt() == null ? null : v.getUpdatedAt().format(ISO_TS));
            versions.add(bv);
        }
        data.setVersions(versions);

        List<BackupData.BackupDemand> demands = new ArrayList<BackupData.BackupDemand>();
        for (Demand d : demandMapper.selectByWorkspace(workspaceId)) {
            BackupData.BackupDemand bd = new BackupData.BackupDemand();
            bd.setId(d.getId());
            bd.setReqId(d.getReqId());
            bd.setTitle(d.getTitle());
            bd.setDesc(d.getDescription());
            bd.setSource(d.getSource());
            bd.setItemKind(d.getItemKind());
            bd.setPriority(d.getPriority());
            bd.setStatus(d.getStatus());
            bd.setExpectDate(d.getExpectDate() == null ? null : d.getExpectDate().toString());
            bd.setAcceptText(d.getAcceptText());
            bd.setVersionId(d.getVersionId());
            bd.setReviewNote(d.getReviewNote());
            bd.setWsjfBusiness(d.getWsjfBusiness());
            bd.setWsjfUrgency(d.getWsjfUrgency());
            bd.setWsjfRisk(d.getWsjfRisk());
            bd.setWsjfEffort(d.getWsjfEffort());
            bd.setCreatedBy(d.getCreatedBy());
            bd.setCreatedAt(d.getCreatedAt() == null ? null : d.getCreatedAt().format(ISO_TS));
            bd.setUpdatedAt(d.getUpdatedAt() == null ? null : d.getUpdatedAt().format(ISO_TS));
            demands.add(bd);
        }
        data.setDemands(demands);

        List<BackupData.BackupDemandDocLink> demandDocLinks = new ArrayList<BackupData.BackupDemandDocLink>();
        for (DemandDocLink link : requirementDocMapper.selectAllDemandLinks(workspaceId)) {
            BackupData.BackupDemandDocLink b = new BackupData.BackupDemandDocLink();
            b.setDemandId(link.getDemandId());
            b.setDocId(link.getDocId());
            b.setCreatedBy(link.getCreatedBy());
            demandDocLinks.add(b);
        }
        data.setDemandDocLinks(demandDocLinks);

        List<BackupData.BackupTestCase> testCases = new ArrayList<BackupData.BackupTestCase>();
        for (TestCase c : testCaseMapper.selectByWorkspace(workspaceId)) {
            BackupData.BackupTestCase b = new BackupData.BackupTestCase();
            b.setId(c.getId());
            b.setReqId(c.getReqId());
            b.setTitle(c.getTitle());
            b.setPrecondition(c.getPrecondition());
            b.setSteps(c.getSteps());
            b.setLatestStatus(c.getLatestStatus());
            b.setLatestNote(c.getLatestNote());
            b.setLatestBy(c.getLatestBy());
            b.setLatestByUserId(c.getLatestByUserId());
            b.setLatestAt(ts(c.getLatestAt()));
            b.setLatestBugTaskId(c.getLatestBugTaskId());
            b.setCreatedAt(ts(c.getCreatedAt()));
            b.setUpdatedAt(ts(c.getUpdatedAt()));
            testCases.add(b);
        }
        data.setTestCases(testCases);

        List<BackupData.BackupTestCaseRun> testCaseRuns = new ArrayList<BackupData.BackupTestCaseRun>();
        for (TestCaseRun r : testCaseRunMapper.selectByWorkspace(workspaceId)) {
            BackupData.BackupTestCaseRun b = new BackupData.BackupTestCaseRun();
            b.setId(r.getId());
            b.setCaseId(r.getCaseId());
            b.setStatus(r.getStatus());
            b.setNote(r.getNote());
            b.setBugTaskId(r.getBugTaskId());
            b.setExecutedBy(r.getExecutedBy());
            b.setExecutedByUserId(r.getExecutedByUserId());
            b.setCreatedAt(ts(r.getCreatedAt()));
            testCaseRuns.add(b);
        }
        data.setTestCaseRuns(testCaseRuns);

        List<BackupData.BackupDocComment> docComments = new ArrayList<BackupData.BackupDocComment>();
        for (RequirementDocComment c : docCommentMapper.selectByWorkspace(workspaceId)) {
            BackupData.BackupDocComment b = new BackupData.BackupDocComment();
            b.setId(c.getId());
            b.setDocId(c.getDocId());
            b.setUserId(c.getUserId());
            b.setContent(c.getContent());
            b.setQuoteText(c.getQuoteText());
            b.setCreatedAt(ts(c.getCreatedAt()));
            docComments.add(b);
        }
        data.setDocComments(docComments);
        return data;
    }

    private static String ts(LocalDateTime value) {
        return value == null ? null : value.format(ISO_TS);
    }

    /**
     * 覆盖式导入（与旧版行为一致）：清空当前空间的任务类数据后写入备份内容（附件/时间线保留）。
     * 事务按阶段/批次拆分：清空 + 基础数据、每 500 条任务一批、关联数据、完成归档各自提交，
     * 不再把整次导入包成一个长事务。导入是覆盖式且幂等的，中途失败后重新导入同一文件即可恢复。
     */
    public BackupData.ImportResult importData(String userId, String workspaceId, BackupData data) {
        if (data == null || data.getTasks() == null) {
            throw AppException.badRequest("备份文件中未找到任务数据");
        }
        ImportState st = new ImportState(userId, workspaceId);
        st.existingTaskIds = existingTaskIdsInOtherWorkspaces(workspaceId, data);
        st.memberIds = memberIdsOf(workspaceId);

        return txTemplate.execute(txStatus -> {
            // 阶段 1：清空旧数据 + 项目/分支/文档/分类/列/标签
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
        // 附件文件与记录、操作时间线、保存视图、看板列与分类设置不在这里删除——避免"导入丢得比恢复得多"。
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

    /** 阶段 1b：项目/分支/需求文档/分类/看板列/标签先落库，供任务引用 */
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
                req.setDescription(Texts.cut(Texts.trimToNull(r.getDesc()), 160));
                req.setStatus(oneOf(r.getStatus(), REQ_STATUS, "active"));
                req.setFirstReleasedAt(parseDate(r.getFirstReleasedAt()));
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
                demand.setPriority(oneOf(bd.getPriority(), PRIORITIES, "P2"));
                demand.setStatus(oneOf(bd.getStatus(),
                        new String[]{"review", "pass", "plan", "rej"}, "review"));
                demand.setExpectDate(parseDate(bd.getExpectDate()));
                demand.setAcceptText(Texts.cut(Texts.trimToNull(bd.getAcceptText()), 2000));
                String versionId = Texts.trimToNull(bd.getVersionId());
                if (versionId != null && versionIdMap.containsKey(versionId)) {
                    versionId = versionIdMap.get(versionId);
                }
                /* 目标版本必须属于需求所在项目 */
                demand.setVersionId(versionId != null && reqId.equals(st.versionReqId.get(versionId))
                        ? versionId : null);
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
                String publishedAt = Texts.trimToNull(bd.getPublishedAt());
                if (publishedAt == null) {
                    /* 旧备份没有发布时间：按已发布回填（同 sql/42 迁移口径），
                       避免覆盖导入后文档全部变草稿、成员不可见 */
                    doc.setPublishedAt(doc.getCreatedAt() == null ? java.time.LocalDateTime.now() : doc.getCreatedAt());
                } else {
                    doc.setPublishedAt(parseTs(publishedAt));
                }
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

        // 分类：按备份中出现的分类名补齐分类表（旧四类保留原配色），空则落默认分类
        Set<String> catNames = new java.util.LinkedHashSet<String>();
        for (BackupData.BackupTask b : data.getTasks()) {
            if (b == null) {
                continue;
            }
            String cn = normalizeCatName(b.getCat());
            if (cn != null) {
                catNames.add(cn);
            }
        }
        int catOrder = 0;
        for (String cn : catNames) {
            Category cat = new Category();
            cat.setId(Ids.gen("G"));
            cat.setWorkspaceId(workspaceId);
            cat.setName(cn);
            String color = LEGACY_CAT_COLORS.get(cn);
            cat.setColor(color == null ? DEFAULT_CAT_COLOR : color);
            cat.setSortOrder(catOrder++);
            try {
                categoryMapper.insert(cat);
            } catch (Exception ignored) {
                // 同名分类已存在则跳过
            }
        }
        workspaceService.ensureDefaultsFor(workspaceId);
        List<Category> cats = categoryMapper.selectByWorkspace(workspaceId);
        st.defaultCat = cats.isEmpty() ? "" : cats.get(0).getName();

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
            t.setDescription(Texts.cut(Texts.trimToNull(b.getDesc()), 200));
            t.setPriority(oneOf(b.getPri(), PRIORITIES, "P2"));
            String owner = Texts.trimToNull(b.getOwner());
            if (owner != null) {
                owner = owner.replace(',', ' ').replace('，', ' ').trim();
            }
            t.setOwner(owner == null || owner.isEmpty() ? "我" : Texts.cut(owner, 32));
            String cat = normalizeCatName(b.getCat());
            t.setCategory(cat == null ? st.defaultCat : cat);
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
            t.setCreatedAt(parseTs(b.getCreatedAt()));
            String reqId = Texts.trimToNull(b.getReqId());
            if (reqId != null) {
                String mapped = st.reqIdMap.get(reqId);
                if (mapped != null) {
                    reqId = mapped;
                }
            }
            t.setReqId(reqId != null && st.reqIds.contains(reqId) ? reqId : null);
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
            String versionId = Texts.trimToNull(b.getVersionId());
            if (versionId != null && st.versionIdMap.containsKey(versionId)) {
                versionId = st.versionIdMap.get(versionId);
            }
            if (versionId != null && (!st.versionIds.contains(versionId) || t.getReqId() == null
                    || !t.getReqId().equals(st.versionReqId.get(versionId)))) {
                versionId = null;
            }
            if (versionId != null) {
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
                t.setRegressionStatus(oneOf(b.getRegressionStatus(),
                        new String[]{"pending", "passed", "failed"}, null));
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
            TestCase c = new TestCase();
            c.setId(Ids.gen("C"));
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
            String original = Texts.trimToNull(b.getId());
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

    /** CSV 导出（Excel 可直接打开，带 BOM） */
    public byte[] exportCsv(String workspaceId, java.util.Set<String> hiddenProjects) {
        List<Task> tasks = visibleTasks(hiddenProjects, taskMapper.selectAll(workspaceId));
        Map<String, String> reqNames = new HashMap<String, String>();
        for (Requirement r : reqMapper.selectAll(workspaceId)) {
            reqNames.put(r.getId(), r.getName());
        }
        Map<String, String> colNames = new HashMap<String, String>();
        for (BoardColumn c : boardColumnMapper.selectAll(workspaceId)) {
            colNames.put(c.getId(), c.getName());
        }
        colNames.put(Consts.COL_DONE, "已完成");
        List<String> ids = new ArrayList<String>();
        for (Task t : tasks) {
            ids.add(t.getId());
        }
        Map<String, List<String>> tagMap = tagsOf(workspaceId, ids);
        /* O-23：补上阻塞状态、卡点原因、提醒时间与累计工时，导出后可直接做统计 */
        Map<String, Integer> minutesByTask = new HashMap<String, Integer>();
        for (TimeAgg agg : timeLogMapper.sumByTaskByWorkspace(workspaceId)) {
            if (agg.getTaskId() != null) {
                minutesByTask.put(agg.getTaskId(), agg.getTotalMinutes() == null ? 0 : agg.getTotalMinutes());
            }
        }

        StringBuilder sb = new StringBuilder();
        sb.append('\uFEFF');
        sb.append("ID,标题,描述,优先级,分类,标签,负责人,看板列,截止日期,所属项目,进度%,进度备注,完成日期,创建时间,"
                + "是否阻塞,卡点原因,累计工时(分钟),提醒时间\r\n");
        for (Task t : tasks) {
            List<String> tags = tagMap.get(t.getId());
            Integer minutes = minutesByTask.get(t.getId());
            sb.append(csv(t.getId())).append(',')
              .append(csv(t.getTitle())).append(',')
              .append(csv(t.getDescription())).append(',')
              .append(csv(t.getPriority())).append(',')
              .append(csv(t.getCategory())).append(',')
              .append(csv(tags == null ? "" : String.join("/", tags))).append(',')
              .append(csv(t.getOwner())).append(',')
              .append(csv(colNames.containsKey(t.getBoardColumn()) ? colNames.get(t.getBoardColumn()) : t.getBoardColumn())).append(',')
              .append(csv(t.getDueDate() == null ? "" : t.getDueDate().toString())).append(',')
              .append(csv(t.getReqId() == null ? "" : reqNames.getOrDefault(t.getReqId(), ""))).append(',')
              .append(t.getProgress() == null ? 0 : t.getProgress()).append(',')
              .append(csv(t.getNote())).append(',')
              .append(csv(t.getCompletedAt() == null ? "" : t.getCompletedAt().toString())).append(',')
              .append(csv(t.getCreatedAt() == null ? "" : t.getCreatedAt().format(TS))).append(',')
              .append(Boolean.TRUE.equals(t.getBlocked()) ? "是" : "").append(',')
              .append(csv(t.getBlockedReason())).append(',')
              .append(minutes == null ? 0 : minutes).append(',')
              .append(csv(t.getRemindAt() == null ? "" : t.getRemindAt().format(TS)))
              .append("\r\n");
        }
        return sb.toString().getBytes(StandardCharsets.UTF_8);
    }

    /** CSV 是给当前用户看的导出：按项目可见范围过滤，不把隐藏项目的任务带出去 */
    private List<Task> visibleTasks(java.util.Set<String> hidden, List<Task> tasks) {
        if (hidden == null || hidden.isEmpty()) {
            return tasks;
        }
        List<Task> out = new ArrayList<Task>();
        for (Task t : tasks) {
            if (t.getReqId() == null || !hidden.contains(t.getReqId())) {
                out.add(t);
            }
        }
        return out;
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
        String defaultCat = "";
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

    private Map<String, List<String>> tagsOf(String workspaceId, List<String> taskIds) {
        Map<String, List<String>> map = new HashMap<String, List<String>>();
        if (taskIds.isEmpty()) {
            return map;
        }
        for (TagTaskRow row : tagMapper.selectByTaskIds(workspaceId, taskIds)) {
            List<String> list = map.get(row.getTaskId());
            if (list == null) {
                list = new ArrayList<String>();
                map.put(row.getTaskId(), list);
            }
            list.add(row.getName());
        }
        return map;
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

    /**
     * 分类名规范化（与 CategoryService 同规则）：筛选参数用逗号分隔，分类名不允许含逗号，
     * 统一替换为空格；空名返回 null。导入的分类补表与任务赋值必须用同一规则，否则会产生筛不到的"幽灵分类"。
     */
    private String normalizeCatName(String raw) {
        String name = Texts.trimToNull(raw);
        if (name == null) {
            return null;
        }
        name = name.replace(',', ' ').replace('，', ' ').trim();
        if (name.isEmpty()) {
            return null;
        }
        return Texts.cut(name, 12);
    }

    private String csv(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        // 防公式注入：= + - @ 及前导制表/回车会被 Excel 等当公式或命令解释，先加单引号转成文本
        char first = value.charAt(0);
        if (first == '=' || first == '+' || first == '-' || first == '@'
                || first == '\t' || first == '\r') {
            value = "'" + value;
        }
        if (value.indexOf(',') >= 0 || value.indexOf('"') >= 0
                || value.indexOf('\n') >= 0 || value.indexOf('\r') >= 0) {
            return "\"" + value.replace("\"", "\"\"") + "\"";
        }
        return value;
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
