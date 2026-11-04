package com.devstudio.kanban.service;

import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.mapper.AppNotificationMapper;
import com.devstudio.kanban.mapper.DemandMapper;
import com.devstudio.kanban.mapper.DevBranchMapper;
import com.devstudio.kanban.mapper.GanttShareMapper;
import com.devstudio.kanban.mapper.ProjectVersionMapper;
import com.devstudio.kanban.mapper.RequirementDocMapper;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.SubtaskMapper;
import com.devstudio.kanban.mapper.TagMapper;
import com.devstudio.kanban.mapper.TaskBaselineMapper;
import com.devstudio.kanban.mapper.TaskCommentMapper;
import com.devstudio.kanban.mapper.TaskDependencyMapper;
import com.devstudio.kanban.mapper.TaskLogMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.TimeLogMapper;
import com.devstudio.kanban.mapper.VersionTaskMapper;
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
            "app_notification",
            "subtask",
            "task_tag",
            "attachment",
            "time_log",
            "task_dependency",
            "task_baseline",
            "version_task"));

    /** 带任务引用、但彻底删除任务时保留的表（BUG-6 A：历史快照不随任务消失） */
    public static final List<String> PRESERVED_TASK_REF_TABLES = Collections.singletonList(
            "task_completion_record");

    /** 所有带任务引用的表，供 schema 扫描测试核对 */
    public static final List<String> TASK_REF_TABLES;

    static {
        List<String> all = new ArrayList<String>(TASK_CHILD_TABLES);
        all.addAll(PRESERVED_TASK_REF_TABLES);
        TASK_REF_TABLES = Collections.unmodifiableList(all);
    }

    /**
     * 清空空间（含删除空间）/覆盖导入时清理的任务与任务归属表，顺序即执行顺序。
     * 看板列、分类、保存视图属于空间配置，不在此列，由调用方按场景处理。
     */
    public static final List<String> WORKSPACE_TASK_TABLES = Collections.unmodifiableList(Arrays.asList(
            "task_log",
            "task_dependency",
            "task_baseline",
            "gantt_share",
            "task",
            "requirement",
            "requirement_doc",
            "task_completion_record",
            "subtask",
            "task_tag",
            "tag",
            "time_log",
            "attachment",
            "task_comment",
            "app_notification",
            "dev_branch_log",
            "dev_branch",
            "version_task",
            "project_version",
            "demand_log",
            "demand"));

    private final TaskMapper taskMapper;
    private final TaskLogMapper logMapper;
    private final TaskCommentMapper commentMapper;
    private final AppNotificationMapper appNotificationMapper;
    private final SubtaskMapper subtaskMapper;
    private final TagMapper tagMapper;
    private final TimeLogMapper timeLogMapper;
    private final AttachmentService attachmentService;
    private final TaskDependencyMapper dependencyMapper;
    private final TaskBaselineMapper baselineMapper;
    private final GanttShareMapper ganttShareMapper;
    private final RequirementMapper reqMapper;
    private final RequirementDocMapper requirementDocMapper;
    private final TaskCompletionService completionService;
    private final DevBranchMapper devBranchMapper;
    private final VersionTaskMapper versionTaskMapper;
    private final ProjectVersionMapper versionMapper;
    private final DemandMapper demandMapper;

    public TaskCascade(TaskMapper taskMapper, TaskLogMapper logMapper,
                       TaskCommentMapper commentMapper, AppNotificationMapper appNotificationMapper,
                       SubtaskMapper subtaskMapper, TagMapper tagMapper, TimeLogMapper timeLogMapper,
                       AttachmentService attachmentService,
                       TaskDependencyMapper dependencyMapper, TaskBaselineMapper baselineMapper,
                       GanttShareMapper ganttShareMapper, RequirementMapper reqMapper,
                       RequirementDocMapper requirementDocMapper,
                       TaskCompletionService completionService, DevBranchMapper devBranchMapper,
                       VersionTaskMapper versionTaskMapper, ProjectVersionMapper versionMapper,
                       DemandMapper demandMapper) {
        this.taskMapper = taskMapper;
        this.logMapper = logMapper;
        this.commentMapper = commentMapper;
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
        this.completionService = completionService;
        this.devBranchMapper = devBranchMapper;
        this.versionTaskMapper = versionTaskMapper;
        this.versionMapper = versionMapper;
        this.demandMapper = demandMapper;
    }

    /**
     * 彻底删除同一空间的任务：先清子表再删任务行，调用方负责事务边界。
     * 附件记录随事务删，磁盘文件在事务提交后删；完成快照保留。
     */
    public int purgeTasks(String workspaceId, List<String> taskIds) {
        if (taskIds == null || taskIds.isEmpty()) {
            return 0;
        }
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
            deleteTaskChildren(entry.getKey(), entry.getValue());
            taskMapper.deleteByIds(entry.getValue());
        }
        return allIds.size();
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
        commentMapper.deleteByTaskIds(workspaceId, taskIds);
        appNotificationMapper.deleteByTaskIds(workspaceId, taskIds);
        /* 甘特图：依赖与基线跟着任务一起清理，避免 ID 复用后把旧关系挂到新任务上 */
        dependencyMapper.deleteByTaskIds(workspaceId, taskIds);
        baselineMapper.deleteByTaskIds(workspaceId, taskIds);
        /* 版本绑定同理：任务行消失后 version_task 留存会让 ID 复用时误挂旧版本 */
        versionTaskMapper.deleteByTaskIds(workspaceId, taskIds);
    }

    /**
     * 清空空间/覆盖导入共用的任务类数据（任务、项目、任务子表、分享 token）。
     * 不含操作时间线、附件文件、需求文档、分支：这些各场景口径不同，由下面两个方法补充。
     */
    public void purgeWorkspaceTaskData(String workspaceId, boolean clearSnapshots) {
        /* 甘特图数据没有外键，任务删掉后必须显式清，避免空间 ID 残留 */
        dependencyMapper.deleteByWorkspace(workspaceId);
        baselineMapper.deleteByWorkspace(workspaceId);
        ganttShareMapper.deleteByWorkspace(workspaceId);
        taskMapper.deleteAllByWorkspace(workspaceId);
        reqMapper.deleteAllByWorkspace(workspaceId);
        /* 版本绑定跟着任务走；版本/需求池条目强归属项目，但备份导入会重建同名项目，
           保留它们可延续绑定关系，只在整空间删除时清（wipeWorkspaceData） */
        versionTaskMapper.deleteByWorkspace(workspaceId);
        if (clearSnapshots) {
            /* 完成归档是任务的派生物；整体替换时先清，再按导入后的任务重建 */
            completionService.clearWorkspace(workspaceId);
        }
        subtaskMapper.deleteAllByWorkspace(workspaceId);
        tagMapper.deleteAllTaskTagsByWorkspace(workspaceId);
        tagMapper.deleteTagsByWorkspace(workspaceId);
        timeLogMapper.deleteAllByWorkspace(workspaceId);
        commentMapper.deleteAllByWorkspace(workspaceId);
        appNotificationMapper.deleteAllByWorkspace(workspaceId);
    }

    /** 清空空间：共用任务数据 + 操作时间线 + 附件（含文件）+ 需求文档 + 分支时间线 + 版本/需求池 */
    public void wipeWorkspaceData(String workspaceId) {
        logMapper.deleteAllByWorkspace(workspaceId);
        purgeWorkspaceTaskData(workspaceId, true);
        requirementDocMapper.deleteDemandLinksByWorkspace(workspaceId);
        requirementDocMapper.deleteAllByWorkspace(workspaceId);
        attachmentService.deleteAllWithFiles(workspaceId);
        devBranchMapper.deleteLogsByWorkspace(workspaceId);
        devBranchMapper.deleteByWorkspace(workspaceId);
        versionMapper.deleteByWorkspace(workspaceId);
        demandMapper.deleteLogsByWorkspace(workspaceId);
        demandMapper.deleteByWorkspace(workspaceId);
    }

    /**
     * 备份覆盖导入前清空：共用任务数据 + 按备份内容决定是否清需求文档/分支/版本/需求池。
     * 操作时间线、附件与空间配置保留，避免“导入丢得比恢复得多”。
     */
    public void clearWorkspaceDataForImport(String workspaceId, boolean clearRequirementDocs,
                                            boolean clearBranches, boolean clearVersions,
                                            boolean clearDemands) {
        purgeWorkspaceTaskData(workspaceId, true);
        if (clearRequirementDocs) {
            requirementDocMapper.deleteDemandLinksByWorkspace(workspaceId);
            requirementDocMapper.deleteAllByWorkspace(workspaceId);
        }
        if (clearBranches) {
            devBranchMapper.deleteLogsByWorkspace(workspaceId);
            devBranchMapper.deleteByWorkspace(workspaceId);
        }
        if (clearDemands) {
            demandMapper.deleteLogsByWorkspace(workspaceId);
            demandMapper.deleteByWorkspace(workspaceId);
        }
        /* 版本必须在需求池之后删：需求池通过 version_id 指向版本 */
        if (clearVersions) {
            versionMapper.deleteByWorkspace(workspaceId);
        }
    }
}
