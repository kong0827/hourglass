package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.entity.Attachment;
import com.hourglass.entity.Task;
import com.hourglass.entity.TaskLog;
import com.hourglass.mapper.AttachmentMapper;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.TaskMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AttachmentServiceTest {

    @TempDir
    Path dir;

    @AfterEach
    void clearSynchronization() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    private AttachmentService service(AttachmentMapper mapper) throws Exception {
        AttachmentService svc = new AttachmentService(mapper, mock(TaskMapper.class), mock(TaskLogMapper.class),
                mock(DemandMapper.class), mock(ProjectAccessService.class));
        ReflectionTestUtils.setField(svc, "attachDir", dir.toString());
        return svc;
    }

    private Attachment attachment(String id, String storedName) {
        Attachment a = new Attachment();
        a.setId(id);
        a.setTargetId("K1");
        a.setTargetKind("task");
        a.setWorkspaceId("W1");
        a.setFilename(storedName);
        a.setStoredName(storedName);
        return a;
    }

    @Test
    void filesAreDeletedOnlyAfterCommit() throws Exception {
        AttachmentMapper mapper = mock(AttachmentMapper.class);
        when(mapper.selectByTaskIds("W1", Collections.singletonList("K1")))
                .thenReturn(Arrays.asList(attachment("A1", "A1.png"), attachment("A2", "A2.png")));
        Files.write(dir.resolve("A1.png"), new byte[]{1});
        Files.write(dir.resolve("A2.png"), new byte[]{2});

        AttachmentService svc = service(mapper);
        TransactionSynchronizationManager.initSynchronization();
        svc.deleteByTasks("W1", Collections.singletonList("K1"));

        verify(mapper).deleteByTaskIds("W1", Collections.singletonList("K1"));
        assertTrue(Files.exists(dir.resolve("A1.png")), "事务提交前不能删文件");
        assertTrue(Files.exists(dir.resolve("A2.png")), "事务提交前不能删文件");

        runAfterCommit();
        assertFalse(Files.exists(dir.resolve("A1.png")));
        assertFalse(Files.exists(dir.resolve("A2.png")));
    }

    @Test
    void filesSurviveRollback() throws Exception {
        AttachmentMapper mapper = mock(AttachmentMapper.class);
        when(mapper.selectByTaskIds("W1", Collections.singletonList("K1")))
                .thenReturn(Collections.singletonList(attachment("A1", "A1.png")));
        Files.write(dir.resolve("A1.png"), new byte[]{1});

        AttachmentService svc = service(mapper);
        TransactionSynchronizationManager.initSynchronization();
        svc.deleteByTasks("W1", Collections.singletonList("K1"));

        for (TransactionSynchronization sync : TransactionSynchronizationManager.getSynchronizations()) {
            sync.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK);
        }
        assertTrue(Files.exists(dir.resolve("A1.png")), "回滚后记录还在，文件必须保留");
    }

    @Test
    void deletesImmediatelyWithoutTransaction() throws Exception {
        AttachmentMapper mapper = mock(AttachmentMapper.class);
        when(mapper.selectByTaskIds("W1", Collections.singletonList("K1")))
                .thenReturn(Collections.singletonList(attachment("A1", "A1.png")));
        Files.write(dir.resolve("A1.png"), new byte[]{1});

        service(mapper).deleteByTasks("W1", Collections.singletonList("K1"));

        assertFalse(Files.exists(dir.resolve("A1.png")));
    }

    private void runAfterCommit() {
        List<TransactionSynchronization> syncs = TransactionSynchronizationManager.getSynchronizations();
        for (TransactionSynchronization sync : syncs) {
            sync.afterCommit();
        }
    }

    @Test
    void uploadAllowsXlsx() throws Exception {
        AttachmentMapper mapper = mock(AttachmentMapper.class);
        TaskMapper taskMapper = mock(TaskMapper.class);
        TaskLogMapper logMapper = mock(TaskLogMapper.class);
        Task task = new Task();
        task.setWorkspaceId("W1");
        when(taskMapper.selectById("K1")).thenReturn(task);
        AttachmentService svc = new AttachmentService(mapper, taskMapper, logMapper, mock(DemandMapper.class),
                mock(ProjectAccessService.class));
        ReflectionTestUtils.setField(svc, "attachDir", dir.toString());

        MockMultipartFile file = new MockMultipartFile("file", "计划.xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", new byte[]{1, 2, 3});
        svc.upload("U1", "W1", "K1", AttachmentService.KIND_TASK, file);

        verify(mapper).insert(argThat(a -> a.getStoredName().endsWith(".xlsx") && "计划.xlsx".equals(a.getFilename())));
        verify(logMapper).insert(argThat(l -> "上传附件「计划.xlsx」".equals(l.getDetail())));
    }

    @Test
    void uploadUsesAbsolutePathForTransferTo() throws Exception {
        AttachmentMapper mapper = mock(AttachmentMapper.class);
        TaskMapper taskMapper = mock(TaskMapper.class);
        Task task = new Task();
        task.setWorkspaceId("W1");
        when(taskMapper.selectById("K1")).thenReturn(task);
        when(mapper.selectById(anyString())).thenReturn(attachment("A1", "A1.md"));

        AttachmentService svc = new AttachmentService(mapper, taskMapper, mock(TaskLogMapper.class),
                mock(DemandMapper.class), mock(ProjectAccessService.class));
        /* 相对目录正是线上故障配置：transferTo 会把它解析到 Tomcat 上传临时目录 */
        ReflectionTestUtils.setField(svc, "attachDir", "./target/test-attach-relative");

        final List<File> transferred = new ArrayList<File>();
        MultipartFile file = mock(MultipartFile.class);
        when(file.isEmpty()).thenReturn(false);
        when(file.getSize()).thenReturn(2L);
        when(file.getOriginalFilename()).thenReturn("说明.md");
        when(file.getContentType()).thenReturn("text/markdown");
        doAnswer(inv -> {
            File dest = inv.getArgument(0);
            transferred.add(dest);
            Files.write(dest.toPath(), new byte[]{1, 2});
            return null;
        }).when(file).transferTo(any(File.class));

        svc.upload("U1", "W1", "K1", AttachmentService.KIND_TASK, file);

        assertEquals(1, transferred.size());
        assertTrue(transferred.get(0).isAbsolute(), "transferTo 必须传绝对路径");
    }

    @Test
    void overwriteContentKeepsIdAndUpdatesSize() throws Exception {
        AttachmentMapper mapper = mock(AttachmentMapper.class);
        TaskLogMapper logMapper = mock(TaskLogMapper.class);
        AttachmentService svc = new AttachmentService(mapper, mock(TaskMapper.class), logMapper,
                mock(DemandMapper.class), mock(ProjectAccessService.class));
        ReflectionTestUtils.setField(svc, "attachDir", dir.toString());

        Attachment a = attachment("A9", "A9.xlsx");
        a.setFilename("计划.xlsx");
        when(mapper.selectById("A9")).thenReturn(a);
        Files.write(dir.resolve("A9.xlsx"), new byte[]{1, 2});

        byte[] body = new byte[]{9, 9, 9, 9};
        MockMultipartFile file = new MockMultipartFile("file", "计划.xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body);
        Attachment saved = svc.overwriteContent("U1", "W1", "A9", file);

        assertTrue(Arrays.equals(body, Files.readAllBytes(dir.resolve("A9.xlsx"))), "磁盘内容应被覆盖");
        assertEquals(Long.valueOf(body.length), saved.getSize());
        verify(mapper).updateContent(argThat(x -> x.getId().equals("A9") && Long.valueOf(body.length).equals(x.getSize())));
        verify(logMapper).insert(argThat(l -> l.getDetail().contains("在线编辑附件「计划.xlsx」")));
    }

    @Test
    void overwriteContentRejectsMismatchedExt() throws Exception {
        AttachmentMapper mapper = mock(AttachmentMapper.class);
        AttachmentService svc = new AttachmentService(mapper, mock(TaskMapper.class), mock(TaskLogMapper.class),
                mock(DemandMapper.class), mock(ProjectAccessService.class));
        ReflectionTestUtils.setField(svc, "attachDir", dir.toString());

        Attachment a = attachment("A9", "A9.xlsx");
        a.setFilename("计划.xlsx");
        when(mapper.selectById("A9")).thenReturn(a);
        Files.write(dir.resolve("A9.xlsx"), new byte[]{1, 2});

        MockMultipartFile file = new MockMultipartFile("file", "改后缀.png", "image/png", new byte[]{9});
        assertThrows(AppException.class, () -> svc.overwriteContent("U1", "W1", "A9", file));
        assertTrue(Arrays.equals(new byte[]{1, 2}, Files.readAllBytes(dir.resolve("A9.xlsx"))), "拒绝时原件不动");
    }
}
