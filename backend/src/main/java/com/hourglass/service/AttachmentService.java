package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.entity.Attachment;
import com.hourglass.entity.Demand;
import com.hourglass.entity.Task;
import com.hourglass.entity.TaskLog;
import com.hourglass.entity.TestCase;
import com.hourglass.entity.TestCaseRun;
import com.hourglass.mapper.AttachmentMapper;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.TestCaseMapper;
import com.hourglass.mapper.TestCaseRunMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Service
public class AttachmentService {

    private static final Logger log = LoggerFactory.getLogger(AttachmentService.class);
    private static final Set<String> ALLOWED_EXT = new HashSet<String>(
            Arrays.asList("jpg", "jpeg", "png", "gif", "webp", "pdf", "txt", "md", "zip", "xlsx",
                    "doc", "docx", "xls", "ppt", "pptx"));

    /** 附件目标类型（sql/24 泛化）：任务 / 需求池需求 / 用例执行记录（失败证据）/ 任务评论 */
    public static final String KIND_TASK = "task";
    public static final String KIND_DEMAND = "demand";
    public static final String KIND_CASE_RUN = "case_run";
    public static final String KIND_COMMENT = "comment";

    private final AttachmentMapper attachmentMapper;
    private final TaskMapper taskMapper;
    private final TaskLogMapper logMapper;
    private final DemandMapper demandMapper;
    private final TestCaseMapper caseMapper;
    private final TestCaseRunMapper caseRunMapper;
    private final com.hourglass.mapper.TaskCommentMapper commentMapper;
    private final ProjectAccessService projectAccess;

    @Value("${app.attach.dir:./data/attachments}")
    private String attachDir;

    public AttachmentService(AttachmentMapper attachmentMapper, TaskMapper taskMapper,
                             TaskLogMapper logMapper, DemandMapper demandMapper,
                             TestCaseMapper caseMapper, TestCaseRunMapper caseRunMapper,
                             com.hourglass.mapper.TaskCommentMapper commentMapper,
                             ProjectAccessService projectAccess) {
        this.attachmentMapper = attachmentMapper;
        this.taskMapper = taskMapper;
        this.logMapper = logMapper;
        this.demandMapper = demandMapper;
        this.caseMapper = caseMapper;
        this.caseRunMapper = caseRunMapper;
        this.commentMapper = commentMapper;
        this.projectAccess = projectAccess;
    }

    /** 评论列表一次取全部附件，避免逐条评论 N+1 查询 */
    public List<Attachment> commentsAttachments(String workspaceId, List<String> commentIds) {
        if (commentIds == null || commentIds.isEmpty()) {
            return Collections.emptyList();
        }
        return attachmentMapper.selectByTargets(workspaceId, KIND_COMMENT, commentIds);
    }

    public List<Attachment> list(String workspaceId, String userId, String targetId, String kind) {
        projectAccess.assertView(workspaceId, userId, ensureTarget(workspaceId, targetId, kind));
        return attachmentMapper.selectByTarget(workspaceId, targetId, kind);
    }

    public Attachment get(String workspaceId, String id) {
        Attachment a = attachmentMapper.selectById(id);
        if (a == null || !workspaceId.equals(a.getWorkspaceId())) {
            throw AppException.notFound("附件不存在：" + id);
        }
        return a;
    }

    /** 下载/缩略图入口：按附件所属任务或需求校验项目可见性；目标已删除时直接拒绝 */
    public Attachment getVisible(String workspaceId, String userId, String id) {
        Attachment a = get(workspaceId, id);
        String projectId;
        if (KIND_DEMAND.equals(a.getTargetKind())) {
            Demand d = demandMapper.selectById(a.getTargetId());
            if (d == null || !workspaceId.equals(d.getWorkspaceId())) {
                throw AppException.notFound("附件所属需求不存在或已删除");
            }
            projectId = d.getReqId();
        } else if (KIND_CASE_RUN.equals(a.getTargetKind())) {
            TestCase c = caseOfRun(workspaceId, a.getTargetId());
            if (c == null) {
                throw AppException.notFound("附件所属执行记录不存在或已删除");
            }
            projectId = c.getReqId();
        } else if (KIND_COMMENT.equals(a.getTargetKind())) {
            Task t = taskOfComment(workspaceId, a.getTargetId());
            if (t == null) {
                throw AppException.notFound("附件所属评论或任务不存在");
            }
            projectId = t.getReqId();
        } else {
            Task t = taskMapper.selectById(a.getTargetId());
            if (t == null || !workspaceId.equals(t.getWorkspaceId())) {
                throw AppException.notFound("附件所属任务不存在或已删除");
            }
            projectId = t.getReqId();
        }
        projectAccess.assertView(workspaceId, userId, projectId);
        return a;
    }

    /** 目标删除时级联：记录随业务事务删，磁盘文件提交后再删 */
    @Transactional
    public void deleteByTarget(String workspaceId, String targetId, String kind) {
        List<Attachment> list = attachmentMapper.selectByTarget(workspaceId, targetId, kind);
        if (list.isEmpty()) {
            return;
        }
        attachmentMapper.deleteByTarget(workspaceId, targetId, kind);
        deleteFilesAfterCommit(list);
    }

    public File fileOf(Attachment attachment) {
        return new File(dir(), attachment.getStoredName());
    }

    @Transactional
    public Attachment upload(String userId, String workspaceId, String targetId, String kind, MultipartFile file) {
        projectAccess.assertWrite(workspaceId, userId, ensureTarget(workspaceId, targetId, kind));
        if (file == null || file.isEmpty()) {
            throw AppException.badRequest("请选择文件");
        }
        if (file.getSize() > 10L * 1024 * 1024) {
            throw AppException.badRequest("文件不能超过 10MB");
        }
        String original = Texts.trimToNull(file.getOriginalFilename());
        if (original == null) {
            original = "未命名文件";
        }
        original = Texts.cut(original.replaceAll("[\\\\/]+", "_"), 120);
        String ext = extOf(original);
        if (ext == null || !ALLOWED_EXT.contains(ext)) {
            throw AppException.badRequest("不支持的文件类型：" + (ext == null ? "未知" : ext));
        }

        String id = Ids.gen("A");
        String storedName = id + "." + ext;
        File finalFile = new File(dir(), storedName).getAbsoluteFile();
        File temp = new File(dir(), storedName + ".tmp-" + System.nanoTime());
        try {
            /* transferTo 传相对路径会被解析到 tomcat 上传临时目录，必须给绝对路径 */
            file.transferTo(temp);
        } catch (IOException e) {
            temp.delete();
            log.warn("附件保存失败", e);
            throw new AppException(500, "文件保存失败");
        }

        Attachment a = new Attachment();
        a.setId(id);
        a.setTargetId(targetId);
        a.setTargetKind(kind);
        a.setWorkspaceId(workspaceId);
        a.setFilename(original);
        a.setContentType(Texts.cut(file.getContentType(), 64));
        a.setSize(file.getSize());
        a.setStoredName(storedName);
        try {
            attachmentMapper.insert(a);
            replaceFileAfterCommit(temp, finalFile);
            logAction(userId, workspaceId, targetId, kind, "上传附件「" + original + "」");
        } catch (RuntimeException e) {
            temp.delete();
            throw e;
        }
        return attachmentMapper.selectById(id);
    }

    @Transactional
    public void delete(String userId, String workspaceId, String id) {
        Attachment a = get(workspaceId, id);
        projectAccess.assertWrite(workspaceId, userId, targetReqId(workspaceId, a.getTargetId(), a.getTargetKind()));
        attachmentMapper.deleteById(id);
        /* 记录先删、文件等事务提交后再删；回滚时记录和文件都还在 */
        deleteFilesAfterCommit(Collections.singletonList(a));
        logAction(userId, workspaceId, a.getTargetId(), a.getTargetKind(), "删除附件「" + a.getFilename() + "」");
    }

    /**
     * 在线编辑后整体覆盖保存（智能表格回写）：保留附件 id/文件名/记录，
     * 只换磁盘内容与 size；格式必须与原件一致（storedName = id.ext，扩展名不能变）。
     */
    @Transactional
    public Attachment overwriteContent(String userId, String workspaceId, String id, MultipartFile file) {
        Attachment a = get(workspaceId, id);
        projectAccess.assertWrite(workspaceId, userId, targetReqId(workspaceId, a.getTargetId(), a.getTargetKind()));
        if (file == null || file.isEmpty()) {
            throw AppException.badRequest("文件内容为空");
        }
        if (file.getSize() > 10L * 1024 * 1024) {
            throw AppException.badRequest("文件不能超过 10MB");
        }
        String oldExt = extOf(a.getFilename());
        String newExt = file.getOriginalFilename() == null ? null : extOf(file.getOriginalFilename());
        if (oldExt == null || newExt == null || !oldExt.equals(newExt)) {
            throw AppException.badRequest("保存格式需为 " + (oldExt == null ? "与原件一致" : ("." + oldExt)));
        }
        File target = fileOf(a).getAbsoluteFile();
        File temp = new File(dir(), a.getStoredName() + ".tmp-" + System.nanoTime());
        try {
            file.transferTo(temp);
        } catch (IOException e) {
            log.warn("附件覆盖保存失败", e);
            throw new AppException(500, "文件保存失败");
        }
        a.setSize(file.getSize());
        a.setContentType(Texts.cut(file.getContentType(), 64));
        /* 数据库提交成功后再替换原文件；失败则只丢弃临时文件，原内容不受影响 */
        replaceFileAfterCommit(temp, target);
        attachmentMapper.updateContent(a);
        logAction(userId, workspaceId, a.getTargetId(), a.getTargetKind(), "在线编辑附件「" + a.getFilename() + "」");
        return attachmentMapper.selectById(id);
    }

    /**
     * 任务被彻底删除（清空回收站/自动清理）时调用：记录随事务删，磁盘文件等事务提交后再删。
     * 提交前失败/回滚时文件仍在，避免"记录回滚了、文件已经没了"。
     */
    public void deleteByTasks(String workspaceId, List<String> taskIds) {
        if (taskIds == null || taskIds.isEmpty()) {
            return;
        }
        List<Attachment> list = attachmentMapper.selectByTaskIds(workspaceId, taskIds);
        attachmentMapper.deleteByTaskIds(workspaceId, taskIds);
        deleteFilesAfterCommit(list);
    }

    /** 评论随任务彻底删除时，其附件一并清理（记录随事务，文件提交后删） */
    public void deleteByCommentTasks(String workspaceId, List<String> taskIds) {
        if (taskIds == null || taskIds.isEmpty()) {
            return;
        }
        List<Attachment> list = attachmentMapper.selectByCommentTaskIds(workspaceId, taskIds);
        attachmentMapper.deleteByCommentTaskIds(workspaceId, taskIds);
        deleteFilesAfterCommit(list);
    }

    /** 导入覆盖/清空空间数据时调用 */
    public void deleteAllWithFiles(String workspaceId) {
        List<Attachment> list = attachmentMapper.selectAllByWorkspace(workspaceId);
        attachmentMapper.deleteAllByWorkspace(workspaceId);
        deleteFilesAfterCommit(list);
    }

    private void replaceFileAfterCommit(final File temp, final File target) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    moveTempIntoPlace(temp, target);
                }

                @Override
                public void afterCompletion(int status) {
                    if (status != STATUS_COMMITTED) {
                        temp.delete();
                    }
                }
            });
            return;
        }
        moveTempIntoPlace(temp, target);
    }

    private void moveTempIntoPlace(File temp, File target) {
        try {
            try {
                Files.move(temp.toPath(), target.toPath(),
                        StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(temp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            log.warn("附件替换失败，临时文件保留：{}", temp.getAbsolutePath(), e);
        }
    }

    private void deleteFilesAfterCommit(final List<Attachment> list) {
        if (list == null || list.isEmpty()) {
            return;
        }
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    for (Attachment a : list) {
                        deleteFile(a);
                    }
                }
            });
            return;
        }
        for (Attachment a : list) {
            deleteFile(a);
        }
    }

    private void deleteFile(Attachment a) {
        try {
            File f = fileOf(a);
            if (f.exists() && !f.delete()) {
                log.warn("附件文件删除失败：{}", f.getAbsolutePath());
            }
        } catch (Exception e) {
            log.warn("附件文件删除异常：{}", a.getStoredName(), e);
        }
    }

    /** 附件目标存在性校验，返回其所属项目 id 供可见性判断 */
    private String ensureTarget(String workspaceId, String targetId, String kind) {
        if (KIND_DEMAND.equals(kind)) {
            Demand d = demandMapper.selectById(targetId);
            if (d == null || !workspaceId.equals(d.getWorkspaceId())) {
                throw AppException.notFound("需求不存在：" + targetId);
            }
            return d.getReqId();
        }
        if (KIND_CASE_RUN.equals(kind)) {
            TestCase c = caseOfRun(workspaceId, targetId);
            if (c == null) {
                throw AppException.notFound("执行记录不存在：" + targetId);
            }
            return c.getReqId();
        }
        if (KIND_COMMENT.equals(kind)) {
            Task t = taskOfComment(workspaceId, targetId);
            if (t == null) {
                throw AppException.notFound("评论不存在：" + targetId);
            }
            if (t.getDeletedAt() != null) {
                throw AppException.badRequest("任务在回收站中，不能给评论添加附件");
            }
            return t.getReqId();
        }
        Task t = taskMapper.selectById(targetId);
        if (t == null || !workspaceId.equals(t.getWorkspaceId()) || t.getDeletedAt() != null) {
            throw AppException.notFound("任务不存在：" + targetId);
        }
        return t.getReqId();
    }

    /** 评论 → 所属任务；评论或任务不存在/不同空间返回 null */
    private Task taskOfComment(String workspaceId, String commentId) {
        long id;
        try {
            id = Long.parseLong(commentId);
        } catch (NumberFormatException e) {
            return null;
        }
        com.hourglass.entity.TaskComment c = commentMapper.selectById(id);
        if (c == null || !workspaceId.equals(c.getWorkspaceId())) {
            return null;
        }
        Task t = taskMapper.selectById(c.getTaskId());
        if (t == null || !workspaceId.equals(t.getWorkspaceId())) {
            return null;
        }
        return t;
    }

    /** 已存在的附件反查所属项目；任务在回收站中也允许追溯 */
    private String targetReqId(String workspaceId, String targetId, String kind) {
        if (KIND_DEMAND.equals(kind)) {
            Demand d = demandMapper.selectById(targetId);
            return d == null || !workspaceId.equals(d.getWorkspaceId()) ? null : d.getReqId();
        }
        if (KIND_CASE_RUN.equals(kind)) {
            TestCase c = caseOfRun(workspaceId, targetId);
            return c == null ? null : c.getReqId();
        }
        if (KIND_COMMENT.equals(kind)) {
            Task ct = taskOfComment(workspaceId, targetId);
            return ct == null ? null : ct.getReqId();
        }
        Task t = taskMapper.selectById(targetId);
        return t == null || !workspaceId.equals(t.getWorkspaceId()) ? null : t.getReqId();
    }

    /** 执行记录 → 用例（同空间）；任一不存在返回 null */
    private TestCase caseOfRun(String workspaceId, String runId) {
        TestCaseRun run = caseRunMapper.selectById(runId);
        if (run == null || !workspaceId.equals(run.getWorkspaceId())) {
            return null;
        }
        TestCase c = caseMapper.selectById(run.getCaseId());
        return c == null || !workspaceId.equals(c.getWorkspaceId()) ? null : c;
    }

    /** 用例/项目删除后清理遗留的执行证据（记录已删、文件等提交后删） */
    @Transactional
    public void deleteOrphanCaseRunAttachments(String workspaceId) {
        List<Attachment> list = attachmentMapper.selectOrphanCaseRuns(workspaceId);
        if (list.isEmpty()) {
            return;
        }
        attachmentMapper.deleteOrphanCaseRuns(workspaceId);
        deleteFilesAfterCommit(list);
    }

    private String extOf(String filename) {
        int idx = filename.lastIndexOf('.');
        if (idx < 0 || idx == filename.length() - 1) {
            return null;
        }
        return filename.substring(idx + 1).toLowerCase();
    }

    private File dir() {
        /* 必须是绝对路径：MultipartFile.transferTo 会把相对路径解析到 Tomcat 上传临时目录 */
        File d = new File(attachDir).getAbsoluteFile();
        if (!d.exists() && !d.mkdirs()) {
            log.warn("附件目录创建失败：{}", d.getAbsolutePath());
        }
        return d;
    }

    /** 任务附件写 task_log，需求附件写 demand_log；执行证据已由用例流水承载，不再重复记日志 */
    private void logAction(String userId, String workspaceId, String targetId, String kind, String detail) {
        if (KIND_DEMAND.equals(kind)) {
            demandMapper.insertLog(workspaceId, targetId, "update", detail, userId);
            return;
        }
        if (KIND_CASE_RUN.equals(kind)) {
            return;
        }
        String taskId = targetId;
        if (KIND_COMMENT.equals(kind)) {
            Task t = taskOfComment(workspaceId, targetId);
            if (t == null) {
                return;
            }
            taskId = t.getId();
        }
        TaskLog taskLog = new TaskLog();
        taskLog.setTaskId(taskId);
        taskLog.setWorkspaceId(workspaceId);
        taskLog.setActorId(userId);
        taskLog.setAction("update");
        taskLog.setDetail(detail);
        logMapper.insert(taskLog);
    }
}
