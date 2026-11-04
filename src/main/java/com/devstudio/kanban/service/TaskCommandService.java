package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.Consts;
import com.devstudio.kanban.common.Ids;
import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.dto.TaskSaveRequest;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.entity.Category;
import com.devstudio.kanban.entity.Demand;
import com.devstudio.kanban.entity.DevBranch;
import com.devstudio.kanban.entity.Requirement;
import com.devstudio.kanban.entity.RequirementDoc;
import com.devstudio.kanban.entity.Subtask;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.mapper.CategoryMapper;
import com.devstudio.kanban.mapper.DemandMapper;
import com.devstudio.kanban.mapper.DevBranchMapper;
import com.devstudio.kanban.mapper.ProjectVersionMapper;
import com.devstudio.kanban.mapper.RequirementDocMapper;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.SubtaskMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.mapper.VersionTaskMapper;
import com.devstudio.kanban.mapper.WorkspaceMemberMapper;
import com.devstudio.kanban.entity.ProjectVersion;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;

/**
 * BE-ARCH-1：任务新建 / 编辑 / 标签，以及保存时的关联校验。
 *
 * <p>关联校验都在这里，前端只需保证"选了项目才有需求"：项目、需求、分支、负责人成员身份、
 * 前置任务的有效性，任何一项不成立都返回 400，不落半条脏数据。
 */
@Service
public class TaskCommandService {

    /** 列内排序的稀疏步长（与 {@link TaskWorkflowService} 同一口径） */
    private static final int SORT_STEP = 1024;

    private final TaskMapper taskMapper;
    private final RequirementMapper reqMapper;
    private final SubtaskMapper subtaskMapper;
    private final CategoryMapper categoryMapper;
    private final UserMapper userMapper;
    private final RequirementDocMapper requirementDocMapper;
    private final DevBranchMapper devBranchMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final ProjectVersionMapper versionMapper;
    private final VersionTaskMapper versionTaskMapper;
    private final DemandMapper demandMapper;
    private final WorkspaceMetaCache metaCache;
    private final TaskSupport support;
    private final TaskCompletionService completionService;
    /** 改列时的移动语义（计时联动 / 完成归档 / 循环派生）统一走流程服务 */
    private final TaskWorkflowService workflow;
    private final TaskAuditLogger audit;
    private final NotificationEventService notificationEvents;
    private final ProjectAccessService projectAccess;

    public TaskCommandService(TaskMapper taskMapper, RequirementMapper reqMapper, SubtaskMapper subtaskMapper,
                              CategoryMapper categoryMapper, UserMapper userMapper,
                              RequirementDocMapper requirementDocMapper, DevBranchMapper devBranchMapper,
                              WorkspaceMemberMapper memberMapper,
                              ProjectVersionMapper versionMapper, VersionTaskMapper versionTaskMapper,
                              DemandMapper demandMapper,
                              WorkspaceMetaCache metaCache,
                              TaskSupport support, TaskCompletionService completionService,
                              TaskWorkflowService workflow, TaskAuditLogger audit,
                              NotificationEventService notificationEvents, ProjectAccessService projectAccess) {
        this.taskMapper = taskMapper;
        this.reqMapper = reqMapper;
        this.subtaskMapper = subtaskMapper;
        this.categoryMapper = categoryMapper;
        this.userMapper = userMapper;
        this.requirementDocMapper = requirementDocMapper;
        this.devBranchMapper = devBranchMapper;
        this.memberMapper = memberMapper;
        this.versionMapper = versionMapper;
        this.versionTaskMapper = versionTaskMapper;
        this.demandMapper = demandMapper;
        this.metaCache = metaCache;
        this.support = support;
        this.completionService = completionService;
        this.workflow = workflow;
        this.audit = audit;
        this.notificationEvents = notificationEvents;
        this.projectAccess = projectAccess;
    }

    @Transactional
    public Task create(String userId, String workspaceId, TaskSaveRequest req) {
        String rawId = Texts.trimToNull(req.getId());
        /* CFG 是配置审计日志的保留伪任务 ID，客户端不能占用 */
        if ("CFG".equalsIgnoreCase(rawId)) {
            throw AppException.badRequest("任务ID不可使用保留字：" + rawId);
        }
        String id = Ids.sanitize(rawId);
        if (id == null) {
            id = Ids.gen("K");
        } else if (taskMapper.selectById(id) != null) {
            /* ID 主键全局唯一，可能被其它空间占用：不提示“已存在”，避免跨空间探测 */
            throw new AppException(409, "该ID已被占用，请更换或留空由系统生成：" + id);
        } else if (taskMapper.countChildRefs(workspaceId, id) > 0) {
            // 覆盖导入会保留附件/日志等子记录但删除任务行，这类 ID 视为占用，防止旧记录误挂到新任务
            throw new AppException(409, "该ID仍关联历史附件/日志/工时记录（覆盖导入保留的旧数据），不能复用：" + id);
        } else if (completionService.hasSnapshot(workspaceId, id)) {
            /* 彻底删除后完成快照仍保留在任务清单里，复用 ID 会让新任务继承旧历史 */
            throw new AppException(409, "该ID的历史完成快照仍保留（任务清单），不能复用：" + id);
        }

        Task t = new Task();
        t.setId(id);
        t.setWorkspaceId(workspaceId);
        applyRequest(userId, workspaceId, t, req, null);
        projectAccess.assertWrite(workspaceId, userId, t.getReqId());
        t.setRecurType(Texts.trimToNull(req.getRecurType()));
        t.setRemindSent(Boolean.FALSE);
        t.setSortOrder(taskMapper.maxSortOrder(workspaceId, t.getBoardColumn()) + SORT_STEP);
        if (Consts.COL_DONE.equals(t.getBoardColumn())) {
            t.setCompletedAt(req.getCompletedAt() != null ? req.getCompletedAt() : LocalDate.now());
        }
        taskMapper.insert(t);
        support.saveTags(workspaceId, id, req.getTags());
        /* T1.2：影响版本绑定（version_task，一任务一版本；不选=待规划） */
        String versionNote = applyVersionBinding(workspaceId, id, t.getReqId(), req.getVersionId(), null);
        /* 直接建成已完成（含备份恢复）也要补完成快照，否则完成统计里查不到这条任务 */
        if (Consts.COL_DONE.equals(t.getBoardColumn())) {
            completionService.archive(t);
        }

        int subCount = 0;
        if (req.getSubtasks() != null) {
            for (TaskSaveRequest.SubtaskItem item : req.getSubtasks()) {
                if (item == null) {
                    continue;
                }
                String subTitle = Texts.trimToNull(item.getTitle());
                if (subTitle == null) {
                    continue;
                }
                Subtask s = new Subtask();
                s.setTaskId(id);
                s.setWorkspaceId(workspaceId);
                s.setTitle(Texts.cut(subTitle, 60));
                s.setDone(item.getDone() != null && item.getDone());
                subtaskMapper.insert(s);
                subCount++;
            }
        }
        audit.log(userId, workspaceId, id, "create", subCount > 0
                ? ("恢复任务「" + t.getTitle() + "」（含 " + subCount + " 项子任务）" + (versionNote == null ? "" : "，" + versionNote))
                : ("创建任务「" + t.getTitle() + "」" + (versionNote == null ? "" : "（" + versionNote + "）")));
        if (t.getOwnerUserId() != null && !t.getOwnerUserId().equals(userId)) {
            notificationEvents.notify(t.getOwnerUserId(), workspaceId,
                    UserNotificationPreferenceService.TASK_ASSIGNED,
                    "新任务指派：" + t.getTitle(), "任务「" + t.getTitle() + "」已指派给你", id, t.getReqId());
        }
        return taskMapper.selectById(id);
    }

    @Transactional
    public Task update(String userId, String workspaceId, String id, TaskSaveRequest req) {
        Task old = support.require(workspaceId, id);
        projectAccess.assertViewTask(workspaceId, userId, old);
        projectAccess.assertWrite(workspaceId, userId, old.getReqId());
        Task t = new Task();
        t.setId(id);
        t.setWorkspaceId(workspaceId);
        applyRequest(userId, workspaceId, t, req, old.getOwnerUserId());
        projectAccess.assertWrite(workspaceId, userId, t.getReqId());
        /* 旧客户端 / 快捷编辑没传里程碑时保留原值，避免被默认值清掉 */
        if (req.getIsMilestone() == null) {
            t.setIsMilestone(old.getIsMilestone());
            if (Boolean.TRUE.equals(old.getIsMilestone())) {
                LocalDate day = t.getStartDate() != null ? t.getStartDate() : t.getDueDate();
                if (day != null) {
                    t.setStartDate(day);
                    t.setDueDate(day);
                }
            }
        }
        t.setRecurType(old.getRecurType());
        if (req.getRecurType() != null) {
            t.setRecurType(Texts.trimToNull(req.getRecurType()));
        }
        t.setRecurNextId(old.getRecurNextId());
        boolean remindChanged = !sameMinute(old.getRemindAt(), req.getRemindAt());
        t.setRemindAt(req.getRemindAt());
        t.setRemindSent(remindChanged || old.getRemindSent() == null ? Boolean.FALSE : old.getRemindSent());

        List<String> oldTags = support.tagNames(workspaceId, id);
        boolean columnChanged = !old.getBoardColumn().equals(t.getBoardColumn());
        /* T0.5：编辑未传类型/归属时保留原值（与里程碑同一保留语义） */
        if (req.getItemType() == null) {
            t.setItemType(old.getItemType() == null ? "task" : old.getItemType());
        }
        if (req.getEpicId() == null) {
            t.setEpicId(old.getEpicId());
        }
        /* 目标类型是 Epic 时不保留旧归属（Epic 只作一层聚合） */
        if ("epic".equals(t.getItemType())) {
            t.setEpicId(null);
        }
        /* 关联需求池需求：未传保留原值；换了项目后旧需求自动失效（与版本绑定同一语义） */
        if (req.getDemandId() == null) {
            t.setDemandId(old.getDemandId());
        }
        if (t.getDemandId() != null) {
            Demand demand = demandMapper.selectById(t.getDemandId());
            if (demand == null || !workspaceId.equals(demand.getWorkspaceId())
                    || !java.util.Objects.equals(demand.getReqId(), t.getReqId())) {
                t.setDemandId(null);
            }
        }
        /* 保留的 Epic 归属失效时自动解除：换了项目 / Epic 被删或改了类型（与版本绑定同一语义，不阻断保存） */
        if (t.getEpicId() != null) {
            Task epic = taskMapper.selectById(t.getEpicId());
            if (epic == null || !workspaceId.equals(epic.getWorkspaceId()) || epic.getDeletedAt() != null
                    || !"epic".equals(epic.getItemType())
                    || !java.util.Objects.equals(epic.getReqId(), t.getReqId())) {
                t.setEpicId(null);
            }
        }
        if (columnChanged) {
            t.setSortOrder(taskMapper.maxSortOrder(workspaceId, t.getBoardColumn()) + SORT_STEP);
            if (Consts.COL_DONE.equals(t.getBoardColumn())) {
                t.setCompletedAt(LocalDate.now());
            } else {
                t.setCompletedAt(null);
            }
            /* 计时联动：完成停表+接力 / 回待处理停表（与拖拽 move 同一口径） */
            workflow.beforeEditColumnChange(userId, workspaceId, id, old.getBoardColumn(), t.getBoardColumn());
        } else {
            t.setSortOrder(old.getSortOrder());
            t.setCompletedAt(old.getCompletedAt());
        }
        List<String> changes = audit.diffParts(workspaceId, old, t, oldTags, req.getTags());
        /* T1.2：影响版本绑定变更并入审计（不传=不变；空串=解除；项目变更后旧绑定自动失效） */
        applyVersionBinding(workspaceId, id, t.getReqId(), req.getVersionId(), changes);
        taskMapper.update(t);
        /* Epic 改成其他类型时，其下子任务一并解除归属，避免悬空的 epic_id */
        if ("epic".equals(old.getItemType()) && !"epic".equals(t.getItemType())) {
            int cleared = taskMapper.clearEpicChildren(workspaceId, id);
            if (cleared > 0) {
                changes.add("解除 " + cleared + " 项子任务的 Epic 归属");
            }
        }
        // 先落最终标签，再派生下一次任务：保证循环任务的后续任务继承本次保存后的标签
        support.saveTags(workspaceId, id, req.getTags());
        /* 完成归档 / 取消完成撤档 / 循环派生 / 移动日志都在流程服务里 */
        workflow.afterEditColumnChange(userId, workspaceId, t, old.getBoardColumn());
        if (!columnChanged || !changes.isEmpty()) {
            String detail = changes.isEmpty()
                    ? "更新任务「" + t.getTitle() + "」（无字段变化）"
                    : Texts.cut("更新任务「" + t.getTitle() + "」：" + String.join("；", changes), 250);
            audit.log(userId, workspaceId, id, "update", detail);
        }
        boolean ownerChanged = !java.util.Objects.equals(old.getOwnerUserId(), t.getOwnerUserId());
        if (ownerChanged && t.getOwnerUserId() != null && !t.getOwnerUserId().equals(userId)) {
            // 同一次保存即使还改了标题、日期等，也只合并为一条负责人变更通知。
            notificationEvents.notify(t.getOwnerUserId(), workspaceId,
                    UserNotificationPreferenceService.TASK_ASSIGNED,
                    "任务负责人变更：" + t.getTitle(), "任务「" + t.getTitle() + "」已指派给你", id, t.getReqId());
        } else if (!ownerChanged && !changes.isEmpty() && t.getOwnerUserId() != null
                && !t.getOwnerUserId().equals(userId)) {
            notificationEvents.notify(t.getOwnerUserId(), workspaceId,
                    UserNotificationPreferenceService.TASK_UPDATED,
                    "任务更新：" + t.getTitle(), Texts.cut(String.join("；", changes), 400), id, t.getReqId());
        }
        Task result = taskMapper.selectById(id);
        result.setTags(support.tagNames(workspaceId, id));
        return result;
    }

    private void applyRequest(String userId, String workspaceId, Task t, TaskSaveRequest req,
                              String oldOwnerUserId) {
        t.setTitle(req.getTitle().trim());
        t.setDescription(Texts.trimToNull(req.getDescription()));
        t.setPriority(req.getPriority() == null ? "P2" : req.getPriority());
        String owner = Texts.trimToNull(req.getOwner());
        if (owner != null) {
            // 负责人拼接进筛选参数（逗号分隔），不允许含逗号
            owner = owner.replace(',', ' ').replace('，', ' ').trim();
        }
        /* N-2 身份绑定：给了账号ID就以账号为准，并用其当前显示名补齐文本；
           只给文本（含"非成员"历史值）时不绑定账号，保持向后兼容。 */
        String ownerUserId = Texts.trimToNull(req.getOwnerUserId());
        if (ownerUserId != null) {
            AppUser ou = userMapper.selectById(ownerUserId);
            if (ou == null) {
                throw AppException.badRequest("负责人账号不存在：" + ownerUserId);
            }
            if (memberMapper.selectMember(workspaceId, ownerUserId) == null
                    && !ownerUserId.equals(oldOwnerUserId)) {
                /* 成员已离开空间的历史任务允许原样保存，但不能再把任务新指派给非成员 */
                throw AppException.badRequest("负责人不是该空间成员：" + ownerUserId);
            }
            t.setOwnerUserId(ownerUserId);
            if (owner == null || owner.isEmpty()) {
                owner = ou.getDisplayName();
            }
        } else {
            t.setOwnerUserId(null);
        }
        t.setOwner(owner == null || owner.isEmpty() ? defaultOwner(userId) : Texts.cut(owner, 32));
        String category = Texts.trimToNull(req.getCategory());
        if (category != null) {
            if (categoryMapper.selectByName(workspaceId, category) == null) {
                throw AppException.badRequest("分类不存在：" + category);
            }
            t.setCategory(category);
        } else {
            t.setCategory(defaultCategory(workspaceId));
        }
        t.setBoardColumn(req.getBoardColumn() == null ? Consts.COL_BACKLOG : req.getBoardColumn());
        support.validateColumn(workspaceId, t.getBoardColumn());
        /* 开始日期：日历按 [startDate, dueDate] 区间逐日展示；为空则只在截止日出现 */
        if (req.getStartDate() != null && req.getDueDate() != null
                && req.getStartDate().isAfter(req.getDueDate())) {
            throw AppException.badRequest("开始日期不能晚于截止日期");
        }
        t.setStartDate(req.getStartDate());
        t.setDueDate(req.getDueDate());
        /* 里程碑是单日节点：只给了一端就补另一端；两端都给时以开始日为准 */
        if (Boolean.TRUE.equals(req.getIsMilestone())) {
            LocalDate milestoneDay = t.getStartDate() != null ? t.getStartDate() : t.getDueDate();
            if (milestoneDay != null) {
                t.setStartDate(milestoneDay);
                t.setDueDate(milestoneDay);
            }
        }
        String reqId = Texts.trimToNull(req.getReqId());
        if (reqId != null) {
            Requirement r = reqMapper.selectById(reqId);
            if (r == null || !workspaceId.equals(r.getWorkspaceId())) {
                throw AppException.badRequest("所属项目不存在：" + reqId);
            }
        }
        t.setReqId(reqId);
        /* 关联需求：必须存在、同空间、且属于任务所选的那个项目。
           项目为空 / 换了项目时，旧需求自动失效（前端也会在切项目时清空下拉）。 */
        String reqDocId = Texts.trimToNull(req.getReqDocId());
        if (reqDocId != null) {
            if (reqId == null) {
                throw AppException.badRequest("请先选择所属项目，再关联文档");
            }
            RequirementDoc doc = requirementDocMapper.selectById(reqDocId);
            if (doc == null || !workspaceId.equals(doc.getWorkspaceId()) || !reqId.equals(doc.getReqId())) {
                throw AppException.badRequest("所选文档不属于该项目");
            }
        }
        t.setReqDocId(reqDocId);
        /* 关联分支：空间级分支池，只校验存在性与同空间（分支不绑项目，换项目不影响关联） */
        String branchId = Texts.trimToNull(req.getBranchId());
        if (branchId != null) {
            DevBranch br = devBranchMapper.selectById(branchId);
            if (br == null || !workspaceId.equals(br.getWorkspaceId())) {
                throw AppException.badRequest("所选分支不存在：" + branchId);
            }
        }
        t.setBranchId(branchId);
        t.setProgress(req.getProgress() == null ? 0 : Math.max(0, Math.min(100, req.getProgress())));
        t.setIsMilestone(Boolean.TRUE.equals(req.getIsMilestone()));
        /* 预估耗时：0 与空等价，都表示"没估过"，不要存 0 去污染系数计算 */
        Integer est = req.getEstimateMinutes();
        t.setEstimateMinutes(est == null || est <= 0 ? null : est);
        t.setNote(Texts.trimToNull(req.getNote()));
        t.setRemindAt(req.getRemindAt());
        /* N-1：提醒谁（默认仅负责人；未知值归一，避免脏数据进入通知链路） */
        String remindTarget = Texts.trimToNull(req.getRemindTarget());
        t.setRemindTarget("owner+admin".equals(remindTarget) ? "owner+admin" : "owner");
        /* N-4：阻塞 / 卡点（取消阻塞时一并清空原因与依赖） */
        boolean blocked = Boolean.TRUE.equals(req.getBlocked());
        String reason = Texts.trimToNull(req.getBlockedReason());
        t.setBlocked(blocked);
        t.setBlockedReason(blocked && reason != null ? Texts.cut(reason, 120) : null);
        String blockedBy = blocked ? Texts.trimToNull(req.getBlockedByTaskId()) : null;
        if (blockedBy != null) {
            /* 前置任务只认同空间、未删除的有效任务；失效引用静默清空，避免历史任务被锁死无法保存 */
            Task pre = taskMapper.selectById(blockedBy);
            if (blockedBy.equals(t.getId()) || pre == null
                    || !workspaceId.equals(pre.getWorkspaceId()) || pre.getDeletedAt() != null) {
                blockedBy = null;
            }
        }
        t.setBlockedByTaskId(blockedBy);
        /* T0.5 工作项类型：空=默认 task */
        String itemType = Texts.trimToNull(req.getItemType());
        t.setItemType(itemType == null ? "task" : itemType);
        /* 关联需求池需求：须同空间且属于任务所选项目；基于需求创建时未选项目则自动带上需求所在项目 */
        String demandId = Texts.trimToNull(req.getDemandId());
        if (demandId != null) {
            Demand demand = demandMapper.selectById(demandId);
            if (demand == null || !workspaceId.equals(demand.getWorkspaceId())) {
                throw AppException.badRequest("关联需求不存在：" + demandId);
            }
            if (reqId == null) {
                reqId = demand.getReqId();
                t.setReqId(reqId);
            } else if (!reqId.equals(demand.getReqId())) {
                throw AppException.badRequest("所选需求池需求不属于该项目");
            }
            t.setDemandId(demandId);
        } else {
            t.setDemandId(null);
        }
        /* Epic 校验放在需求联动之后：需求可能把任务补到某个项目，归属必须与最终项目一致 */
        t.setEpicId(validateEpic(workspaceId, t, Texts.trimToNull(req.getEpicId())));
    }

    private String defaultOwner(String userId) {
        AppUser u = userMapper.selectById(userId);
        return u == null || Texts.trimToNull(u.getDisplayName()) == null ? "我" : u.getDisplayName();
    }

    /**
     * Epic 归属校验：只支持一层聚合——同空间、未删除、item_type=epic、
     * Epic 不能挂到其他 Epic 下、须与任务属于同一项目、不能形成循环归属。
     */
    private String validateEpic(String workspaceId, Task self, String epicId) {
        if (epicId == null) {
            return null;
        }
        if (epicId.equals(self.getId())) {
            throw AppException.badRequest("任务不能作为自己的 Epic");
        }
        if ("epic".equals(self.getItemType())) {
            throw AppException.badRequest("Epic 不能再挂到其他 Epic 下");
        }
        Task epic = taskMapper.selectById(epicId);
        if (epic == null || !workspaceId.equals(epic.getWorkspaceId()) || epic.getDeletedAt() != null) {
            throw AppException.badRequest("所属 Epic 不存在：" + epicId);
        }
        if (!"epic".equals(epic.getItemType())) {
            throw AppException.badRequest("所选任务不是 Epic：" + epic.getTitle());
        }
        if (!java.util.Objects.equals(epic.getReqId(), self.getReqId())) {
            throw AppException.badRequest("Epic 须与任务属于同一项目：" + epic.getTitle());
        }
        /* 历史数据可能已存在多级归属，沿祖先向上检查，防止 A→B→A 循环 */
        String cursor = epic.getEpicId();
        for (int depth = 0; cursor != null && depth < 32; depth++) {
            if (cursor.equals(self.getId())) {
                throw AppException.badRequest("不能形成循环的 Epic 归属");
            }
            Task parent = taskMapper.selectById(cursor);
            if (parent == null) {
                break;
            }
            cursor = parent.getEpicId();
        }
        return epicId;
    }

    /**
     * T1.2 影响版本绑定（version_task，一任务一版本）。
     * requestedRaw 为 null=保持现状（create 时即不绑定）；空串=解除绑定=待规划。
     * 任务换项目后旧绑定不再属于新项目时自动解绑，不阻断保存。
     *
     * @return create 审计用的说明（"影响版本 V1.2"）；update 时写进 changes 传 null 即可
     */
    private String applyVersionBinding(String workspaceId, String taskId, String reqId,
                                       String requestedRaw, List<String> changes) {
        String current = versionTaskMapper.selectVersionIdByTask(workspaceId, taskId);
        String target;
        if (requestedRaw == null) {
            target = current;
            if (target != null && !targetBelongsToReq(workspaceId, target, reqId)) {
                target = null;
            }
        } else {
            target = Texts.trimToNull(requestedRaw);
            if (target != null) {
                if (reqId == null) {
                    throw AppException.badRequest("请先选择所属项目，再绑定影响版本");
                }
                if (!targetBelongsToReq(workspaceId, target, reqId)) {
                    throw AppException.badRequest("影响版本不存在或不属于任务所在项目：" + target);
                }
            }
        }
        if (java.util.Objects.equals(current, target)) {
            return null;
        }
        versionTaskMapper.deleteByTaskId(workspaceId, taskId);
        if (target != null) {
            versionTaskMapper.insertBatch(workspaceId, target, java.util.Collections.singletonList(taskId));
        }
        String note = "影响版本：" + versionDisplayName(workspaceId, current) + " → " + versionDisplayName(workspaceId, target);
        if (changes != null) {
            changes.add(note);
        }
        return note;
    }

    private boolean targetBelongsToReq(String workspaceId, String versionId, String reqId) {
        ProjectVersion v = versionMapper.selectById(versionId);
        return v != null && workspaceId.equals(v.getWorkspaceId()) && v.getReqId().equals(reqId);
    }

    private String versionDisplayName(String workspaceId, String versionId) {
        if (versionId == null) {
            return "待规划";
        }
        ProjectVersion v = versionMapper.selectById(versionId);
        return v == null ? versionId : v.getName();
    }

    private String defaultCategory(String workspaceId) {
        List<Category> list = metaCache.categories(workspaceId);
        return list.isEmpty() ? "" : list.get(0).getName();
    }

    /** 提醒时间按分钟比较：前端 datetime-local 不带秒，避免编辑其他字段时误重置提醒状态 */
    private boolean sameMinute(LocalDateTime a, LocalDateTime b) {
        if (a == null && b == null) {
            return true;
        }
        if (a == null || b == null) {
            return false;
        }
        return a.truncatedTo(ChronoUnit.MINUTES).equals(b.truncatedTo(ChronoUnit.MINUTES));
    }
}
