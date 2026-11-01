package com.devstudio.kanban.service;

import com.devstudio.kanban.entity.Attachment;
import com.devstudio.kanban.mapper.AttachmentMapper;
import com.devstudio.kanban.mapper.TaskLogMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
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
        AttachmentService svc = new AttachmentService(mapper, mock(TaskMapper.class), mock(TaskLogMapper.class));
        ReflectionTestUtils.setField(svc, "attachDir", dir.toString());
        return svc;
    }

    private Attachment attachment(String id, String storedName) {
        Attachment a = new Attachment();
        a.setId(id);
        a.setTaskId("K1");
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
}
