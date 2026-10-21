package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.Consts;
import com.devstudio.kanban.common.Ids;
import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.dto.BackupData;
import com.devstudio.kanban.entity.BoardColumn;
import com.devstudio.kanban.entity.Category;
import com.devstudio.kanban.entity.Requirement;
import com.devstudio.kanban.entity.Subtask;
import com.devstudio.kanban.entity.Tag;
import com.devstudio.kanban.entity.TagTaskRow;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.TimeAgg;
import com.devstudio.kanban.entity.TimeLog;
import com.devstudio.kanban.mapper.AppNotificationMapper;
import com.devstudio.kanban.mapper.BoardColumnMapper;
import com.devstudio.kanban.mapper.CategoryMapper;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.SubtaskMapper;
import com.devstudio.kanban.mapper.TagMapper;
import com.devstudio.kanban.mapper.TaskCommentMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.TimeLogMapper;
import com.devstudio.kanban.mapper.WorkspaceMemberMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
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
    private final AppNotificationMapper appNotificationMapper;

    public BackupService(TaskMapper taskMapper, RequirementMapper reqMapper,
                         SubtaskMapper subtaskMapper, TagMapper tagMapper, TimeLogMapper timeLogMapper,
                         BoardColumnMapper boardColumnMapper, CategoryMapper categoryMapper,
                         WorkspaceService workspaceService, WorkspaceMemberMapper memberMapper,
                         TaskCommentMapper commentMapper,
                         AppNotificationMapper appNotificationMapper) {
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
        this.appNotificationMapper = appNotificationMapper;
    }

    public BackupData export(String workspaceId) {
        BackupData data = new BackupData();
        data.setV(3);
        data.setExportedAt(LocalDateTime.now().format(ISO_TS));

        List<Task> all = taskMapper.selectAll(workspaceId);
        List<String> ids = new ArrayList<String>();
        for (Task t : all) {
            ids.add(t.getId());
        }
        Map<String, List<String>> tagMap = tagsOf(workspaceId, ids);

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
            b.setNote(t.getNote());
            b.setReqId(t.getReqId());
            b.setCompletedAt(t.getCompletedAt() == null ? null : t.getCompletedAt().toString());
            b.setSubtasks(subMap.get(t.getId()));
            b.setTags(tagMap.get(t.getId()));
            b.setRecurType(t.getRecurType());
            b.setRecurNextId(t.getRecurNextId());
            b.setRemindAt(t.getRemindAt() == null ? null : t.getRemindAt().format(ISO_TS));
            b.setRemindSent(t.getRemindSent());
            b.setTimeLogs(timeMap.get(t.getId()));
            b.setCreatedAt(t.getCreatedAt() == null ? null : t.getCreatedAt().format(ISO_TS));
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
            reqs.add(b);
        }
        data.setReqs(reqs);
        return data;
    }

    /** 覆盖式导入（与旧版行为一致）：清空当前空间的任务类数据后写入备份内容（附件/时间线保留） */
    @Transactional
    public BackupData.ImportResult importData(String userId, String workspaceId, BackupData data) {
        if (data == null || data.getTasks() == null) {
            throw AppException.badRequest("备份文件中未找到任务数据");
        }
        // 覆盖范围：任务类数据（任务/项目/子任务/标签/工时/评论，含回收站）。
        // 附件文件与记录、操作时间线、保存视图、看板列与分类设置不在这里删除——避免"导入丢得比恢复得多"
        taskMapper.deleteAllByWorkspace(workspaceId);
        reqMapper.deleteAllByWorkspace(workspaceId);
        subtaskMapper.deleteAllByWorkspace(workspaceId);
        tagMapper.deleteAllTaskTagsByWorkspace(workspaceId);
        tagMapper.deleteTagsByWorkspace(workspaceId);
        timeLogMapper.deleteAllByWorkspace(workspaceId);
        /* 第九轮审查 #1/#2：评论与任务通知随任务一起清，与"操作时间线保留"的口径区分开——
           时间线是审计记录，而评论与通知会把内容直接展示给用户；
           导入后任务 ID 可能被复用/重映射，留着旧记录就是可见的数据错乱（旧评论挂到新任务上）。 */
        commentMapper.deleteAllByWorkspace(workspaceId);
        appNotificationMapper.deleteAllByWorkspace(workspaceId);

        Set<String> reqIds = new HashSet<String>();
        Set<String> seenReqIds = new HashSet<String>();
        /** 备份里项目ID → 实际落库ID（跨空间导入时 ID 被占用会重新生成，需回指任务关联） */
        Map<String, String> reqIdMap = new HashMap<String, String>();
        int reqCount = 0;
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
                reqMapper.insert(req);
                reqCount++;
            }
        }

        Map<String, Integer> colSeq = new HashMap<String, Integer>();

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
        String defaultCat = cats.isEmpty() ? "" : cats.get(0).getName();

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
        Set<String> colIds = new HashSet<String>();
        Map<String, String> colNameToId = new HashMap<String, String>();
        for (BoardColumn c : boardColumnMapper.selectAll(workspaceId)) {
            colIds.add(c.getId());
            colNameToId.put(c.getName(), c.getId());
        }

        Set<String> taskIds = new HashSet<String>();
        Set<String> seenTaskIds = new HashSet<String>();
        /** 备份任务ID → 实际落库ID（含跨空间重映射），导入完成后据此恢复循环派生关联 */
        Map<String, String> taskIdMap = new HashMap<String, String>();
        /** (落库任务ID, 备份中的 recurNextId)：全部任务落库后再校验并恢复 */
        List<String[]> recurLinks = new ArrayList<String[]>();
        int taskCount = 0;
        for (BackupData.BackupTask b : data.getTasks()) {
            if (b == null) {
                continue;
            }
            String original = Ids.sanitize(Texts.trimToNull(b.getId()));
            if (original != null && !seenTaskIds.add(original)) {
                continue; // 备份内重复ID，跳过
            }
            String id;
            if (original == null || taskMapper.selectById(original) != null) {
                // 跨空间复制导入：ID 已被其他空间占用 → 重新生成
                id = Ids.gen("K");
            } else {
                id = original;
            }
            if (!taskIds.add(id)) {
                continue;
            }
            if (original != null) {
                taskIdMap.put(original, id);
            }
            String recurNext = Ids.sanitize(Texts.trimToNull(b.getRecurNextId()));
            if (recurNext != null) {
                recurLinks.add(new String[]{id, recurNext});
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
            t.setCategory(cat == null ? defaultCat : cat);
            String col = mapColumn(b.getCol(), colIds, colNameToId);
            t.setBoardColumn(col);
            t.setStartDate(parseDate(b.getStart()));
            t.setDueDate(parseDate(b.getDue()));
            t.setCompletedAt(parseDate(b.getCompletedAt()));
            t.setCreatedAt(parseTs(b.getCreatedAt()));
            String reqId = Texts.trimToNull(b.getReqId());
            if (reqId != null) {
                String mapped = reqIdMap.get(reqId);
                if (mapped != null) {
                    reqId = mapped;
                }
            }
            t.setReqId(reqId != null && reqIds.contains(reqId) ? reqId : null);
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

            Integer seq = colSeq.get(col);
            int sortOrder = seq == null ? 0 : seq;
            t.setSortOrder(sortOrder);
            colSeq.put(col, sortOrder + 1);

            taskMapper.insert(t);

            if (b.getSubtasks() != null) {
                for (BackupData.BackupSubtask sb : b.getSubtasks()) {
                    if (sb == null) {
                        continue;
                    }
                    String subTitle = Texts.trimToNull(sb.getTitle());
                    if (subTitle == null) {
                        continue;
                    }
                    Subtask st = new Subtask();
                    st.setTaskId(id);
                    st.setWorkspaceId(workspaceId);
                    st.setTitle(Texts.cut(subTitle, 60));
                    st.setDone(sb.getDone() != null && sb.getDone());
                    subtaskMapper.insert(st);
                }
            }
            if (b.getTags() != null) {
                Set<String> seen = new HashSet<String>();
                int n = 0;
                for (String raw : b.getTags()) {
                    String name = Texts.trimToNull(raw);
                    if (name == null) {
                        continue;
                    }
                    name = name.replace(',', ' ').replace('，', ' ').trim();
                    if (name.isEmpty()) {
                        continue;
                    }
                    name = Texts.cut(name, 16);
                    if (!seen.add(name)) {
                        continue;
                    }
                    if (++n > 8) {
                        break;
                    }
                    Tag tag = findOrCreateTag(workspaceId, name);
                    if (tag != null) {
                        tagMapper.insertTaskTag(id, tag.getId(), workspaceId);
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
                    if (logUserId == null || memberMapper.selectMember(workspaceId, logUserId) == null) {
                        logUserId = userId;
                    }
                    TimeLog tl = new TimeLog();
                    tl.setTaskId(id);
                    tl.setWorkspaceId(workspaceId);
                    tl.setUserId(logUserId);
                    tl.setStartedAt(started);
                    tl.setEndedAt(started.plusMinutes(mins));
                    tl.setMinutes(mins);
                    timeLogMapper.insertCompleted(tl);
                }
            }
            taskCount++;
        }

        // 恢复循环派生关联：等到全部任务落库后，按 ID 映射校验目标存在性再写回（旧备份无此字段则跳过）
        for (String[] link : recurLinks) {
            String nextId = taskIdMap.get(link[1]);
            if (nextId == null || taskMapper.selectById(nextId) == null) {
                continue; // 派生的下一次任务不在本次导入中：保持无关联，完成时会重新生成
            }
            taskMapper.setRecurNext(link[0], nextId);
        }

        BackupData.ImportResult result = new BackupData.ImportResult();
        result.setTasks(taskCount);
        result.setReqs(reqCount);
        return result;
    }

    /** CSV 导出（Excel 可直接打开，带 BOM） */
    public byte[] exportCsv(String workspaceId) {
        List<Task> tasks = taskMapper.selectAll(workspaceId);
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
}
