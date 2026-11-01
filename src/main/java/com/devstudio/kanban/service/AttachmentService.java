package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.Ids;
import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.entity.Attachment;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.TaskLog;
import com.devstudio.kanban.mapper.AttachmentMapper;
import com.devstudio.kanban.mapper.TaskLogMapper;
import com.devstudio.kanban.mapper.TaskMapper;
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
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Service
public class AttachmentService {

    private static final Logger log = LoggerFactory.getLogger(AttachmentService.class);
    private static final Set<String> ALLOWED_EXT = new HashSet<String>(
            Arrays.asList("jpg", "jpeg", "png", "gif", "webp", "pdf", "txt", "md", "zip"));

    private final AttachmentMapper attachmentMapper;
    private final TaskMapper taskMapper;
    private final TaskLogMapper logMapper;

    @Value("${app.attach.dir:./data/attachments}")
    private String attachDir;

    public AttachmentService(AttachmentMapper attachmentMapper, TaskMapper taskMapper, TaskLogMapper logMapper) {
        this.attachmentMapper = attachmentMapper;
        this.taskMapper = taskMapper;
        this.logMapper = logMapper;
    }

    public List<Attachment> list(String workspaceId, String taskId) {
        ensureTask(workspaceId, taskId);
        return attachmentMapper.selectByTaskId(workspaceId, taskId);
    }

    public Attachment get(String workspaceId, String id) {
        Attachment a = attachmentMapper.selectById(id);
        if (a == null || !workspaceId.equals(a.getWorkspaceId())) {
            throw AppException.notFound("附件不存在：" + id);
        }
        return a;
    }

    public File fileOf(Attachment attachment) {
        return new File(dir(), attachment.getStoredName());
    }

    @Transactional
    public Attachment upload(String userId, String workspaceId, String taskId, MultipartFile file) {
        ensureTask(workspaceId, taskId);
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
        try {
            file.transferTo(new File(dir(), storedName));
        } catch (IOException e) {
            log.warn("附件保存失败", e);
            throw new AppException(500, "文件保存失败");
        }

        Attachment a = new Attachment();
        a.setId(id);
        a.setTaskId(taskId);
        a.setWorkspaceId(workspaceId);
        a.setFilename(original);
        a.setContentType(Texts.cut(file.getContentType(), 64));
        a.setSize(file.getSize());
        a.setStoredName(storedName);
        attachmentMapper.insert(a);
        log(userId, workspaceId, taskId, "上传附件「" + original + "」");
        return attachmentMapper.selectById(id);
    }

    @Transactional
    public void delete(String userId, String workspaceId, String id) {
        Attachment a = get(workspaceId, id);
        deleteFile(a);
        attachmentMapper.deleteById(id);
        log(userId, workspaceId, a.getTaskId(), "删除附件「" + a.getFilename() + "」");
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

    /** 导入覆盖/清空空间数据时调用 */
    public void deleteAllWithFiles(String workspaceId) {
        for (Attachment a : attachmentMapper.selectAllByWorkspace(workspaceId)) {
            deleteFile(a);
        }
        attachmentMapper.deleteAllByWorkspace(workspaceId);
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

    private void ensureTask(String workspaceId, String taskId) {
        Task t = taskMapper.selectById(taskId);
        if (t == null || !workspaceId.equals(t.getWorkspaceId()) || t.getDeletedAt() != null) {
            throw AppException.notFound("任务不存在：" + taskId);
        }
    }

    private String extOf(String filename) {
        int idx = filename.lastIndexOf('.');
        if (idx < 0 || idx == filename.length() - 1) {
            return null;
        }
        return filename.substring(idx + 1).toLowerCase();
    }

    private File dir() {
        File d = new File(attachDir);
        if (!d.exists() && !d.mkdirs()) {
            log.warn("附件目录创建失败：{}", d.getAbsolutePath());
        }
        return d;
    }

    private void log(String userId, String workspaceId, String taskId, String detail) {
        TaskLog taskLog = new TaskLog();
        taskLog.setTaskId(taskId);
        taskLog.setWorkspaceId(workspaceId);
        taskLog.setActorId(userId);
        taskLog.setAction("update");
        taskLog.setDetail(detail);
        logMapper.insert(taskLog);
    }
}
