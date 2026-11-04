package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.entity.Attachment;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.TaskLog;
import com.devstudio.kanban.mapper.AttachmentMapper;
import com.devstudio.kanban.mapper.DemandMapper;
import com.devstudio.kanban.mapper.TaskLogMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.argThat;
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
