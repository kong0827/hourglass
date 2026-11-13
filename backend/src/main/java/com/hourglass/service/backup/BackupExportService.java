package com.hourglass.service.backup;

import com.hourglass.common.Consts;
import com.hourglass.dto.BackupData;
import com.hourglass.entity.BoardColumn;
import com.hourglass.entity.Category;
import com.hourglass.entity.Demand;
import com.hourglass.entity.DemandDocLink;
import com.hourglass.entity.DevBranch;
import com.hourglass.entity.DocumentType;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.entity.RequirementDocComment;
import com.hourglass.entity.Subtask;
import com.hourglass.entity.TagTaskRow;
import com.hourglass.entity.Task;
import com.hourglass.entity.TaskBaseline;
import com.hourglass.entity.TaskComment;
import com.hourglass.entity.TaskDependency;
import com.hourglass.entity.TestCase;
import com.hourglass.entity.TestCaseRun;
import com.hourglass.entity.TimeAgg;
import com.hourglass.entity.TimeLog;
import com.hourglass.mapper.BoardColumnMapper;
import com.hourglass.mapper.CategoryMapper;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.DevBranchMapper;
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

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 备份导出：JSON 全量导出与 CSV 导出（只读，不涉及导入事务）。
 * 由 BackupService 委托调用；拆分后导入逻辑留在 BackupService，两边互不影响。
 */
public class BackupExportService {

    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
    private static final DateTimeFormatter ISO_TS = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss");

    private final TaskMapper taskMapper;
    private final RequirementMapper reqMapper;
    private final SubtaskMapper subtaskMapper;
    private final TagMapper tagMapper;
    private final TimeLogMapper timeLogMapper;
    private final BoardColumnMapper boardColumnMapper;
    private final CategoryMapper categoryMapper;
    private final TaskCommentMapper commentMapper;
    private final TestCaseMapper testCaseMapper;
    private final TestCaseRunMapper testCaseRunMapper;
    private final RequirementDocCommentMapper docCommentMapper;
    private final RequirementDocMapper requirementDocMapper;
    private final DevBranchMapper devBranchMapper;
    private final TaskDependencyMapper dependencyMapper;
    private final TaskBaselineMapper baselineMapper;
    private final ProjectVersionMapper versionMapper;
    private final VersionTaskMapper versionTaskMapper;
    private final DemandMapper demandMapper;

    public BackupExportService(TaskMapper taskMapper, RequirementMapper reqMapper, SubtaskMapper subtaskMapper, TagMapper tagMapper, TimeLogMapper timeLogMapper, BoardColumnMapper boardColumnMapper, CategoryMapper categoryMapper, TaskCommentMapper commentMapper, TestCaseMapper testCaseMapper, TestCaseRunMapper testCaseRunMapper, RequirementDocCommentMapper docCommentMapper, RequirementDocMapper requirementDocMapper, DevBranchMapper devBranchMapper, TaskDependencyMapper dependencyMapper, TaskBaselineMapper baselineMapper, ProjectVersionMapper versionMapper, VersionTaskMapper versionTaskMapper, DemandMapper demandMapper) {
        this.taskMapper = taskMapper;
        this.reqMapper = reqMapper;
        this.subtaskMapper = subtaskMapper;
        this.tagMapper = tagMapper;
        this.timeLogMapper = timeLogMapper;
        this.boardColumnMapper = boardColumnMapper;
        this.categoryMapper = categoryMapper;
        this.commentMapper = commentMapper;
        this.testCaseMapper = testCaseMapper;
        this.testCaseRunMapper = testCaseRunMapper;
        this.docCommentMapper = docCommentMapper;
        this.requirementDocMapper = requirementDocMapper;
        this.devBranchMapper = devBranchMapper;
        this.dependencyMapper = dependencyMapper;
        this.baselineMapper = baselineMapper;
        this.versionMapper = versionMapper;
        this.versionTaskMapper = versionTaskMapper;
        this.demandMapper = demandMapper;
    }

    public BackupData export(String workspaceId) {
        if (!taskMapper.selectSuccessfulVersionIds(workspaceId).isEmpty()) {
            throw com.hourglass.common.AppException.badRequest("JSON 不迁移已冻结的正式发布版本内容，请使用数据库备份");
        }
        BackupData data = new BackupData();
        data.setV(BackupData.FORMAT_VERSION);
        data.setExportedAt(LocalDateTime.now().format(ISO_TS));

        /* 回收站任务也要进备份：导入会清空空间任务（含回收站），不导出就等于把回收站丢掉 */
        List<Task> all = new ArrayList<Task>(taskMapper.selectAll(workspaceId));
        all.addAll(taskMapper.selectDeleted(workspaceId));
        List<String> ids = new ArrayList<String>();
        for (Task t : all) {
            ids.add(t.getId());
        }
        Map<String, List<String>> tagMap = tagsOf(workspaceId, ids);

        Map<String, List<String>> versionByTask = new HashMap<String, List<String>>();
        for (com.hourglass.dto.TaskVersionBinding binding : versionTaskMapper.selectBindingsByWorkspace(workspaceId)) {
            versionByTask.computeIfAbsent(binding.getTaskId(), key -> new ArrayList<String>()).add(binding.getVersionId());
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
            item.setOrigin(tl.getOrigin());
            item.setNote(tl.getNote());
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
            b.setCat(t.getCategoryId());
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
            b.setTestStartedAt(t.getTestStartedAt() == null ? null : t.getTestStartedAt().toString());
            b.setTestFinishedAt(t.getTestFinishedAt() == null ? null : t.getTestFinishedAt().toString());
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
            b.setVersionIds(new ArrayList<String>(versionByTask.getOrDefault(t.getId(), java.util.Collections.emptyList())));
            tasks.add(b);
        }
        data.setTasks(tasks);

        List<BackupData.BackupColumn> columns = new ArrayList<BackupData.BackupColumn>();
        for (BoardColumn c : boardColumnMapper.selectAll(workspaceId)) {
            BackupData.BackupColumn bc = new BackupData.BackupColumn();
            bc.setId(c.getId());
            bc.setName(c.getName());
            bc.setColor(c.getColor());
            bc.setProcessingRule(c.getProcessingRule());
            columns.add(bc);
        }
        data.setColumns(columns);

        /* v11：模块字典随备份导出（任务/需求里的模块已是 ID，导入按 ID 校验补表）；模块挂在项目下 */
        List<BackupData.BackupCategory> cats = new ArrayList<BackupData.BackupCategory>();
        for (Category c : categoryMapper.selectByWorkspace(workspaceId)) {
            BackupData.BackupCategory bc = new BackupData.BackupCategory();
            bc.setId(c.getId());
            bc.setProjectId(c.getProjectId());
            bc.setName(c.getName());
            bc.setColor(c.getColor());
            bc.setSortOrder(c.getSortOrder());
            cats.add(bc);
        }
        data.setCategories(cats);

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
            if ("released".equals(v.getStatus()) || v.getReleasedAt() != null) {
                throw com.hourglass.common.AppException.badRequest("JSON 不迁移已发布版本内容或正式事实，请使用数据库备份；版本：" + v.getId());
            }
            BackupData.BackupVersion bv = new BackupData.BackupVersion();
            bv.setId(v.getId());
            bv.setReqId(v.getReqId());
            bv.setName(v.getName());
            bv.setDesc(v.getDescription());
            bv.setStatus(v.getStatus());
            bv.setStartDate(v.getStartDate() == null ? null : v.getStartDate().toString());
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
            bd.setCategoryId(d.getCategoryId());
            bd.setPriority(d.getPriority());
            bd.setStatus(d.getStatus());
            bd.setCloseReason(d.getCloseReason());
            bd.setCloseStage(d.getCloseStage());
            bd.setExpectDate(d.getExpectDate() == null ? null : d.getExpectDate().toString());
            bd.setPlannedStart(d.getPlannedStart() == null ? null : d.getPlannedStart().toString());
            bd.setPlannedEnd(d.getPlannedEnd() == null ? null : d.getPlannedEnd().toString());
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

    /** CSV 导出（Excel 可直接打开，带 BOM） */
    public byte[] exportCsv(String workspaceId, java.util.Set<String> hiddenProjects) {
        List<Task> tasks = visibleTasks(hiddenProjects, taskMapper.selectAll(workspaceId));
        versionTaskMapper.enrichTasks(workspaceId, tasks);
        Map<String, String> reqNames = new HashMap<String, String>();
        for (Requirement r : reqMapper.selectAll(workspaceId)) {
            reqNames.put(r.getId(), r.getName());
        }
        Map<String, String> colNames = new HashMap<String, String>();
        for (BoardColumn c : boardColumnMapper.selectAll(workspaceId)) {
            colNames.put(c.getId(), c.getName());
        }
        colNames.put(Consts.COL_DONE, "已完成");
        Map<String, String> catNames = new HashMap<String, String>();
        for (Category c : categoryMapper.selectByWorkspace(workspaceId)) {
            catNames.put(c.getId(), c.getName());
        }
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
        sb.append("ID,标题,描述,优先级,模块,标签,负责人,看板列,截止日期,所属项目,进度%,进度备注,完成日期,创建时间,"
                + "是否阻塞,卡点原因,累计工时(分钟),提醒时间,规划版本\r\n");
        for (Task t : tasks) {
            List<String> tags = tagMap.get(t.getId());
            Integer minutes = minutesByTask.get(t.getId());
            sb.append(csv(t.getId())).append(',')
              .append(csv(t.getTitle())).append(',')
              .append(csv(t.getDescription())).append(',')
              .append(csv(t.getPriority())).append(',')
              .append(csv(catNames.getOrDefault(t.getCategoryId(), ""))).append(',')
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
              .append(csv(t.getRemindAt() == null ? "" : t.getRemindAt().format(TS))).append(',')
              .append(csv(String.join("/", t.getVersionNames())))
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
}
