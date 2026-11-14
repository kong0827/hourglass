package com.hourglass.service;

import com.hourglass.entity.Task;
import com.hourglass.mapper.AppNotificationMapper;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.DevBranchMapper;
import com.hourglass.mapper.GanttShareMapper;
import com.hourglass.mapper.MailDeliveryMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.ReqDocShareMapper;
import com.hourglass.mapper.RequirementDocCommentMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.RequirementDocHistoryMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.SubtaskMapper;
import com.hourglass.mapper.TagMapper;
import com.hourglass.mapper.TaskBaselineMapper;
import com.hourglass.mapper.TaskCommentMapper;
import com.hourglass.mapper.TaskDependencyMapper;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.TaskWatchMapper;
import com.hourglass.mapper.TestCaseMapper;
import com.hourglass.mapper.TestCaseRunMapper;
import com.hourglass.mapper.TimeLogMapper;
import com.hourglass.mapper.VersionTaskMapper;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 任务级联删除/空间清空的唯一清单。
 *
 * <p>三处调用方（回收站彻底删除、清空空间、备份覆盖导入）都走这里，新增带 task_id 的表时
 * 只改这一处，{@code TaskCascadeTest} 会通过清单快照和 sql/ 目录扫描拦住漏登记。
 *
 * <p>完成快照（task_completion_record）按 BUG-6 A 口径：彻底删除任务时保留历史快照，
 * 只有清空空间/覆盖导入才清。
 */
@Service
public class TaskCascade {

    /** 物理删除任务时一并清理的全部表（带 task_id / ref_task_id / from|to_task_id） */
    public static final List<String> TASK_CHILD_TABLES = Collections.unmodifiableList(Arrays.asList(
            "task_log",
            "task_comment",
            "task_watch",
            "app_notification",
            "subtask",
            "task_tag",
            "attachment",
            "time_log",
            "task_dependency",
            "task_baseline",
            "version_task",
            "project_milestone_task"));

    /** 带任务引用、但彻底删除任务时保留的表（BUG-6 A：历史快照不随任务消失） */
    public static final List<String> PRESERVED_TASK_REF_TABLES = Collections.unmodifiableList(Arrays.asList(
            "task_completion_record", "version_release_item", "version_release_plan_task"));

    /** 空间清空/覆盖导入不能删除或遗留的交付数据；存在任意行即拒绝重建。 */
    public static final List<String> PRESERVED_WORKSPACE_DELIVERY_TABLES = Collections.unmodifiableList(Arrays.asList(
            "version_release", "version_release_item", "version_release_plan", "version_release_plan_version",
            "version_release_plan_task", "version_log"));

    /** 所有带任务引用的表，供 schema 扫描测试核对 */
    public static final List<String> TASK_REF_TABLES;

    static {
        List<String> all = new ArrayList<String>(TASK_CHILD_TABLES);
        all.addAll(PRESERVED_TASK_REF_TABLES);
        TASK_REF_TABLES = Collections.unmodifiableList(all);
    }

    /**
     * 清空空间（含删除空间）/覆盖导入时清理的任务与任务归属表，顺序即执行顺序。
     * 看板列、模块、保存视图属于空间配置，不在此列，由调用方按场景处理。
     */
    public static final List<String> WORKSPACE_TASK_TABLES = Collections.unmodifiableList(Arrays.asList(
            "task_log",
            "task_dependency",
            "task_baseline",
            "gantt_share",
            "task",
            "test_case_run",
            "test_case",
            "requirement",
            "requirement_doc",
            "req_doc_share",
            "task_completion_record",
            "subtask",
            "task_tag",
            "tag",
            "time_log",
            "attachment",
            "task_comment",
            "task_watch",
            "app_notification",
            "dev_branch_log",
            "dev_branch",
            "version_task",
            "project_milestone_task",
            "project_milestone_log",
            "project_milestone",
            "project_version",
            "delivery_note_share",
            "delivery_note_snapshot",
            "delivery_note",
            "demand_log",
            "demand"));

    private final TaskMapper taskMapper;
    private final TaskLogMapper logMapper;
    private final TaskCommentMapper commentMapper;
    private final TaskWatchMapper watchMapper;
    private final AppNotificationMapper appNotificationMapper;
    private final SubtaskMapper subtaskMapper;
    private final TagMapper tagMapper;
    private final TimeLogMapper timeLogMapper;
    private final AttachmentService attachmentService;
    private final TaskDependencyMapper dependencyMapper;
    private final TaskBaselineMapper baselineMapper;
    private final GanttShareMapper ganttShareMapper;
    private final MailDeliveryMapper mailDeliveryMapper;
    private final RequirementMapper reqMapper;
    private final RequirementDocMapper requirementDocMapper;
    private final ReqDocShareMapper reqDocShareMapper;
    private final TaskCompletionService completionService;
    private final DevBranchMapper devBranchMapper;
    private final VersionTaskMapper versionTaskMapper;
    private final ProjectVersionMapper versionMapper;
    private final DemandMapper demandMapper;
    /** 需求人工判定随需求池一起清理，备份格式暂不包含该表 */
    private final com.hourglass.mapper.DemandDeliveryJudgementMapper demandJudgementMapper;
    /** 承诺基线快照随任务数据一起清：任务重建后旧基线的比较口径已失效 */
    private final com.hourglass.mapper.VersionCommitmentMapper versionCommitmentMapper;
    /** 里程碑条件引用任务：任务整体清空后条件不再成立，连同里程碑一起清 */
    private final com.hourglass.mapper.ProjectMilestoneMapper milestoneMapper;
    private final RequirementDocHistoryMapper docHistoryMapper;
    private final RequirementDocCommentMapper docCommentMapper;
    private final TestCaseMapper testCaseMapper;
    private final TestCaseRunMapper testCaseRunMapper;
    /** 交付说明强归属版本：版本整体清空时草稿、快照与分享令牌一起清，避免留下打不开的对外链接 */
    private final com.hourglass.mapper.DeliveryNoteMapper deliveryNoteMapper;
    private final DeliveryScopeLock scopeLock;

    public TaskCascade(TaskMapper taskMapper, TaskLogMapper logMapper,
                       TaskCommentMapper commentMapper, TaskWatchMapper watchMapper,
                       AppNotificationMapper appNotificationMapper,
                       SubtaskMapper subtaskMapper, TagMapper tagMapper, TimeLogMapper timeLogMapper,
                       AttachmentService attachmentService,
                       TaskDependencyMapper dependencyMapper, TaskBaselineMapper baselineMapper,
                       GanttShareMapper ganttShareMapper, RequirementMapper reqMapper,
                       RequirementDocMapper requirementDocMapper,
                       RequirementDocHistoryMapper docHistoryMapper,
                       RequirementDocCommentMapper docCommentMapper,
                       TaskCompletionService completionService, DevBranchMapper devBranchMapper,
                       VersionTaskMapper versionTaskMapper, ProjectVersionMapper versionMapper,
                       DemandMapper demandMapper, MailDeliveryMapper mailDeliveryMapper,
                       ReqDocShareMapper reqDocShareMapper,
                       TestCaseMapper testCaseMapper, TestCaseRunMapper testCaseRunMapper,
                       com.hourglass.mapper.DemandDeliveryJudgementMapper demandJudgementMapper,
                       com.hourglass.mapper.VersionCommitmentMapper versionCommitmentMapper,
                       com.hourglass.mapper.ProjectMilestoneMapper milestoneMapper,
                       com.hourglass.mapper.DeliveryNoteMapper deliveryNoteMapper,
                       DeliveryScopeLock scopeLock) {
        this.deliveryNoteMapper = deliveryNoteMapper;
        this.scopeLock = scopeLock;
        this.taskMapper = taskMapper;
        this.logMapper = logMapper;
        this.commentMapper = commentMapper;
        this.watchMapper = watchMapper;
        this.appNotificationMapper = appNotificationMapper;
        this.subtaskMapper = subtaskMapper;
        this.tagMapper = tagMapper;
        this.timeLogMapper = timeLogMapper;
        this.attachmentService = attachmentService;
        this.dependencyMapper = dependencyMapper;
        this.baselineMapper = baselineMapper;
        this.ganttShareMapper = ganttShareMapper;
        this.reqMapper = reqMapper;
        this.requirementDocMapper = requirementDocMapper;
        this.docHistoryMapper = docHistoryMapper;
        this.docCommentMapper = docCommentMapper;
        this.completionService = completionService;
        this.devBranchMapper = devBranchMapper;
        this.versionTaskMapper = versionTaskMapper;
        this.versionMapper = versionMapper;
        this.demandMapper = demandMapper;
        this.mailDeliveryMapper = mailDeliveryMapper;
        this.reqDocShareMapper = reqDocShareMapper;
        this.testCaseMapper = testCaseMapper;
        this.testCaseRunMapper = testCaseRunMapper;
        this.demandJudgementMapper = demandJudgementMapper;
        this.versionCommitmentMapper = versionCommitmentMapper;
        this.milestoneMapper = milestoneMapper;
    }

    /**
     * 彻底删除同一空间的任务：先清子表再删任务行，调用方负责事务边界。
     * 附件记录随事务删，磁盘文件在事务提交后删；完成快照保留。
     */
    public int purgeTasks(String workspaceId, List<String> taskIds) {
        if (taskIds == null || taskIds.isEmpty()) {
            return 0;
        }
        List<Task> tasks = new ArrayList<Task>();
        for (String id : taskIds) {
            Task task = taskMapper.selectById(id);
            if (task == null || !workspaceId.equals(task.getWorkspaceId())) {
                throw com.hourglass.common.AppException.notFound("任务不存在");
            }
            tasks.add(task);
        }
        lockPurgeTasks(tasks);
        assertNoPlanRefs(workspaceId, taskIds);
        taskMapper.clearRecurNextByTaskIds(taskIds);
        deleteTaskChildren(workspaceId, taskIds);
        taskMapper.deleteByIds(taskIds);
        return taskIds.size();
    }

    /** 彻底删除任务（可能跨空间）：按 workspace 分组批量清子表，调用方负责事务边界 */
    public int purgeTasks(List<Task> tasks) {
        if (tasks == null || tasks.isEmpty()) {
            return 0;
        }
        lockPurgeTasks(tasks);
        Map<String, List<String>> idsByWorkspace = new LinkedHashMap<String, List<String>>();
        List<String> allIds = new ArrayList<String>(tasks.size());
        for (Task t : tasks) {
            List<String> ids = idsByWorkspace.get(t.getWorkspaceId());
            if (ids == null) {
                ids = new ArrayList<String>();
                idsByWorkspace.put(t.getWorkspaceId(), ids);
            }
            ids.add(t.getId());
            allIds.add(t.getId());
        }
        // 任务行即将消失、ID 可被复用：清掉上游循环派生关联，避免之后误认到无关的新任务
        taskMapper.clearRecurNextByTaskIds(allIds);
        for (Map.Entry<String, List<String>> entry : idsByWorkspace.entrySet()) {
            assertNoPlanRefs(entry.getKey(), entry.getValue());
            deleteTaskChildren(entry.getKey(), entry.getValue());
            taskMapper.deleteByIds(entry.getValue());
        }
        return allIds.size();
    }

    /**
     * 发布计划任务行对 task 是 ON DELETE RESTRICT。计划属于不可变交付证据，
     * 不能靠物理删除把任务从计划里抠掉；这里直接拒绝，并让回收站清理在查询阶段就跳过。
     */
    private void assertNoPlanRefs(String workspaceId, List<String> taskIds) {
        List<String> referenced = taskMapper.selectPlanReferencedTaskIds(workspaceId, taskIds);
        if (referenced != null && !referenced.isEmpty()) {
            throw com.hourglass.common.AppException.badRequest(
                    "任务已被发布计划引用，不能彻底删除；请先从发布计划中移除该任务");
        }
    }

    private void lockPurgeTasks(List<Task> tasks) {
        // 跨空间批次也必须先取得全部项目锁，不能锁完一个空间的任务再补另一个空间的项目锁。
        Map<String, java.util.Set<String>> workspacesByProject = new java.util.TreeMap<String, java.util.Set<String>>();
        for (Task task : tasks) {
            if (task.getReqId() != null) {
                workspacesByProject.computeIfAbsent(task.getReqId(), key -> new java.util.TreeSet<String>())
                        .add(task.getWorkspaceId());
            }
        }
        for (Map.Entry<String, java.util.Set<String>> entry : workspacesByProject.entrySet()) {
            for (String workspaceId : entry.getValue()) {
                scopeLock.lockProjects(workspaceId, entry.getKey());
            }
        }
        List<Task> ordered = new ArrayList<Task>(tasks);
        ordered.sort(java.util.Comparator.comparing(Task::getId).thenComparing(Task::getWorkspaceId));
        for (Task observed : ordered) {
            Task current = scopeLock.lockTask(observed.getWorkspaceId(), observed.getId());
            if (!java.util.Objects.equals(observed.getReqId(), current.getReqId())) {
                throw new com.hourglass.common.AppException(409, "任务所属项目已变化，请重新清理");
            }
            if (!taskMapper.selectTaskPlanIdsForScope(current.getWorkspaceId(), current.getId()).isEmpty()) {
                throw com.hourglass.common.AppException.badRequest("任务仍被发布计划引用，不能物理删除；可保留在回收站");
            }
            for (String versionId : taskMapper.selectTaskVersionsForScope(current.getWorkspaceId(), current.getId())) {
                if (!taskMapper.selectVersionSuccessIdsForScope(current.getWorkspaceId(), versionId).isEmpty()) {
                    throw com.hourglass.common.AppException.badRequest("任务属于已冻结的正式发布版本，不能物理删除；可保留在回收站");
                }
            }
            if (current.getDeletedAt() == null) {
                throw com.hourglass.common.AppException.badRequest("任务已恢复，不能彻底删除");
            }
        }
    }

    /** 空间级清理先锁项目，再当前读交付数据；备份预检也共用，调用方需在事务内调用。 */
    public void assertWorkspaceCanBeRebuilt(String workspaceId) {
        String[] projects = taskMapper.selectProjectIdsForScope(workspaceId).toArray(new String[0]);
        scopeLock.lockProjects(workspaceId, projects);
        if (!taskMapper.selectReleaseIdsForScope(workspaceId).isEmpty()
                || !taskMapper.selectReleasePlanIdsForScope(workspaceId).isEmpty()
                || !taskMapper.selectReleasePlanTaskIdsForScope(workspaceId).isEmpty()
                || !taskMapper.selectVersionLogIdsForScope(workspaceId).isEmpty()
                || !taskMapper.selectReleaseItemIdsForScope(workspaceId).isEmpty()) {
            throw com.hourglass.common.AppException.badRequest("空间存在交付计划或发布历史（含失败记录），不能覆盖重建或清空，请将备份导入新空间");
        }
    }

    private void deleteTaskChildren(String workspaceId, List<String> taskIds) {
        /* 被删任务若作为 Epic，其子任务先解除归属，避免任务行消失后留下悬空 epic_id */
        taskMapper.clearEpicChildrenByTaskIds(workspaceId, taskIds);
        subtaskMapper.deleteByTaskIds(workspaceId, taskIds);
        tagMapper.deleteTaskTagsByTaskIds(workspaceId, taskIds);
        timeLogMapper.deleteByTaskIds(workspaceId, taskIds);
        attachmentService.deleteByTasks(workspaceId, taskIds);
        logMapper.deleteByTaskIds(workspaceId, taskIds);
        /* 完成快照不随任务删除：任务清单是历史快照，彻底删除后仍保留；
           ID 复用由 create() 里的 hasSnapshot 检查拦住。 */
        /* 第九轮审查 #1/#2：评论与应用内通知必须跟着任务一起清，否则已删除的任务 ID
           会被 countChildRefs 永久锁死，同 ID 还原时旧评论还会挂到新任务上。 */
        attachmentService.deleteByCommentTasks(workspaceId, taskIds);
        commentMapper.deleteByTaskIds(workspaceId, taskIds);
        watchMapper.deleteByTaskIds(workspaceId, taskIds);
        appNotificationMapper.deleteByTaskIds(workspaceId, taskIds);
        /* 甘特图：依赖与基线跟着任务一起清理，避免 ID 复用后把旧关系挂到新任务上 */
        dependencyMapper.deleteByTaskIds(workspaceId, taskIds);
        baselineMapper.deleteByTaskIds(workspaceId, taskIds);
        /* 版本绑定同理：任务行消失后 version_task 留存会让 ID 复用时误挂旧版本 */
        versionTaskMapper.deleteByTaskIds(workspaceId, taskIds);
        /* 里程碑条件引用同样按任务清除，避免 ID 复用时把旧条件挂到新任务上 */
        milestoneMapper.deleteTaskLinksByTaskIds(workspaceId, taskIds);
        /* 待发邮件引用了任务 ID：任务删除后必须取消，避免继续外发 */
        mailDeliveryMapper.deleteByReferenceIds(taskIds);
        /* 用例转出的缺陷任务被彻底删除后，用例与流水上的缺陷引用同步解除，
           否则列表会继续展示一个打不开的缺陷入口 */
        testCaseMapper.clearBugTaskRefs(workspaceId, taskIds);
        testCaseRunMapper.clearBugTaskRefs(workspaceId, taskIds);
    }

    /**
     * 清空空间/覆盖导入共用的任务类数据（任务、项目、任务子表、分享 token）。
     * 不含操作时间线、附件文件、需求文档、分支：这些各场景口径不同，由下面两个方法补充。
     */
    public void purgeWorkspaceTaskData(String workspaceId, boolean clearSnapshots, boolean clearTestCases) {
        assertWorkspaceCanBeRebuilt(workspaceId);
        /* 先取消引用本空间任务/需求的待发邮件，再删业务行 */
        mailDeliveryMapper.deleteByWorkspaceReferences(workspaceId);
        /* 甘特图数据没有外键，任务删掉后必须显式清，避免空间 ID 残留 */
        dependencyMapper.deleteByWorkspace(workspaceId);
        baselineMapper.deleteByWorkspace(workspaceId);
        ganttShareMapper.deleteByWorkspace(workspaceId);
        taskMapper.deleteAllByWorkspace(workspaceId);
        /* 任务整体清空后，用例上的缺陷任务引用一定失效；先解除再决定是否删用例。
           旧备份保留用例时也要解除，避免列表继续展示打不开的缺陷入口。 */
        testCaseMapper.clearAllBugTaskRefs(workspaceId);
        testCaseRunMapper.clearAllBugTaskRefs(workspaceId);
        /* 用例强归属项目：先清流水与用例，再删项目，避免空间级清理留下孤儿。
           旧备份没有用例字段时不清理，避免导入把现有用例误删。 */
        if (clearTestCases) {
            testCaseRunMapper.deleteByWorkspace(workspaceId);
            testCaseMapper.deleteByWorkspace(workspaceId);
        }
        reqMapper.deleteAllByWorkspace(workspaceId);
        /* 版本绑定跟着任务走；版本/需求池条目强归属项目，但备份导入会重建同名项目，
           保留它们可延续绑定关系，只在整空间删除时清（wipeWorkspaceData） */
        versionTaskMapper.deleteByWorkspace(workspaceId);
        versionCommitmentMapper.deleteByWorkspace(workspaceId);
        /* 里程碑条件引用的是被清空的任务；JSON 备份暂不迁移里程碑，导入后不保留旧条件 */
        milestoneMapper.deleteLogsByWorkspace(workspaceId);
        milestoneMapper.deleteTaskLinksByWorkspace(workspaceId);
        milestoneMapper.deleteByWorkspace(workspaceId);
        if (clearSnapshots) {
            /* 完成归档是任务的派生物；整体替换时先清，再按导入后的任务重建 */
            completionService.clearWorkspace(workspaceId);
        }
        subtaskMapper.deleteAllByWorkspace(workspaceId);
        tagMapper.deleteAllTaskTagsByWorkspace(workspaceId);
        tagMapper.deleteTagsByWorkspace(workspaceId);
        timeLogMapper.deleteAllByWorkspace(workspaceId);
        commentMapper.deleteAllByWorkspace(workspaceId);
        watchMapper.deleteAllByWorkspace(workspaceId);
        appNotificationMapper.deleteAllByWorkspace(workspaceId);
    }

    /** 清空空间：共用任务数据 + 操作时间线 + 附件（含文件）+ 需求文档（含历史快照）+ 分支时间线 + 版本/需求池 */
    public void wipeWorkspaceData(String workspaceId) {
        assertWorkspaceCanBeRebuilt(workspaceId);
        logMapper.deleteAllByWorkspace(workspaceId);
        /* 测试计划与用例模块强归属项目：整空间删除时一起清，避免留下指向已删项目/用例的孤儿行 */
        testCaseMapper.deletePlanCasesByWorkspace(workspaceId);
        testCaseMapper.deletePlansByWorkspace(workspaceId);
        testCaseMapper.deleteModulesByWorkspace(workspaceId);
        purgeWorkspaceTaskData(workspaceId, true, true);
        requirementDocMapper.deleteDemandLinksByWorkspace(workspaceId);
        docCommentMapper.deleteByWorkspace(workspaceId);
        docHistoryMapper.deleteAllByWorkspace(workspaceId);
        reqDocShareMapper.deleteByWorkspace(workspaceId);
        requirementDocMapper.deleteAllByWorkspace(workspaceId);
        attachmentService.deleteAllWithFiles(workspaceId);
        devBranchMapper.deleteLogsByWorkspace(workspaceId);
        devBranchMapper.deleteByWorkspace(workspaceId);
        versionMapper.deleteByWorkspace(workspaceId);
        deliveryNoteMapper.deleteSharesByWorkspace(workspaceId);
        deliveryNoteMapper.deleteSnapshotsByWorkspace(workspaceId);
        deliveryNoteMapper.deleteByWorkspace(workspaceId);
        demandMapper.deleteLogsByWorkspace(workspaceId);
        demandJudgementMapper.deleteByWorkspace(workspaceId);
        demandMapper.deleteByWorkspace(workspaceId);
    }

    /**
     * 备份覆盖导入前清空：共用任务数据 + 按备份内容决定是否清需求文档/分支/版本/需求池/用例/文档评论。
     * 操作时间线、附件与空间配置保留，避免“导入丢得比恢复得多”。
     */
    public void clearWorkspaceDataForImport(String workspaceId, boolean clearRequirementDocs,
                                            boolean clearBranches, boolean clearVersions,
                                            boolean clearDemands, boolean clearTestCases,
                                            boolean clearDocComments) {
        purgeWorkspaceTaskData(workspaceId, true, clearTestCases);
        if (clearRequirementDocs) {
            requirementDocMapper.deleteDemandLinksByWorkspace(workspaceId);
            if (clearDocComments) {
                docCommentMapper.deleteByWorkspace(workspaceId);
            }
            /* 文档历史不在备份格式里：导入时保留旧快照，避免“备份没带就直接删”。
               同空间导入文档 ID 通常复用，历史仍可对应；跨空间可能成为孤立历史，但不再静默丢数据。 */
            reqDocShareMapper.deleteByWorkspace(workspaceId);
            requirementDocMapper.deleteAllByWorkspace(workspaceId);
        }
        if (clearBranches) {
            devBranchMapper.deleteLogsByWorkspace(workspaceId);
            devBranchMapper.deleteByWorkspace(workspaceId);
        }
        if (clearDemands) {
            requirementDocMapper.deleteDemandLinksByWorkspace(workspaceId);
            /* 人工判定不在备份格式里：需求整体替换时一并清理，避免同 ID 重建混入旧判定 */
            demandJudgementMapper.deleteByWorkspace(workspaceId);
            /* 需求流转日志同样不在备份里：保留审计记录，不随导入清空 */
            demandMapper.deleteByWorkspace(workspaceId);
        }
        /* 版本必须在需求池之后删：需求池通过 version_id 指向版本 */
        if (clearVersions) {
            versionMapper.deleteByWorkspace(workspaceId);
            deliveryNoteMapper.deleteSharesByWorkspace(workspaceId);
            deliveryNoteMapper.deleteSnapshotsByWorkspace(workspaceId);
            deliveryNoteMapper.deleteByWorkspace(workspaceId);
        }
    }
}
