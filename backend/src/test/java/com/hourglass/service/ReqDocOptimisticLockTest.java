package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.ReqDocSaveRequest;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.RequirementDocHistoryMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.UserMapper;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 文档保存乐观锁：版本不一致（他人先保存）必须整篇拒绝（409），不能静默覆盖 */
class ReqDocOptimisticLockTest {

    private final RequirementDocMapper docs = mock(RequirementDocMapper.class);
    private final RequirementMapper reqs = mock(RequirementMapper.class);
    private final WorkActivityService activities = mock(WorkActivityService.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final RequirementDocService service = new RequirementDocService(docs,
            mock(RequirementDocHistoryMapper.class), mock(com.hourglass.mapper.RequirementDocCommentMapper.class), reqs,
            mock(UserMapper.class), mock(TaskMapper.class), activities,
            mock(DemandMapper.class), access, mock(NotificationEventService.class),
            mock(com.hourglass.mapper.ReqDocShareMapper.class),
            mock(com.hourglass.mapper.WorkspaceMapper.class), mock(DocPreviewService.class),
            mock(DeletionTraceService.class));

    @Test
    void staleVersionIsRejectedWithConflict() {
        when(docs.selectById("D1")).thenReturn(existing());
        when(reqs.selectById("R1")).thenReturn(project("R1"));
        when(docs.update(any(RequirementDoc.class), any(LocalDateTime.class))).thenReturn(0);

        ReqDocSaveRequest req = saveRequest();
        req.setUpdatedAt("2026-11-03T10:00:00");

        AppException error = assertThrows(AppException.class,
                () -> service.update("U1", "W1", "D1", req));

        assertEquals(409, error.getCode());
    }

    @Test
    void matchingVersionPassesOldUpdatedAtToMapper() {
        when(docs.selectById("D1")).thenReturn(existing());
        when(reqs.selectById("R1")).thenReturn(project("R1"));
        LocalDateTime oldVersion = LocalDateTime.of(2026, 11, 3, 10, 0, 0);
        when(docs.update(any(RequirementDoc.class), any(LocalDateTime.class))).thenReturn(1);

        ReqDocSaveRequest req = saveRequest();
        req.setUpdatedAt("2026-11-03T10:00:00");

        service.update("U1", "W1", "D1", req);

        verify(docs).update(any(RequirementDoc.class), eq(oldVersion));
    }

    @Test
    void blankVersionSkipsLockForLegacyClients() {
        when(docs.selectById("D1")).thenReturn(existing());
        when(reqs.selectById("R1")).thenReturn(project("R1"));
        when(docs.update(any(RequirementDoc.class), isNull())).thenReturn(1);

        ReqDocSaveRequest req = saveRequest();

        service.update("U1", "W1", "D1", req);

        verify(docs).update(any(RequirementDoc.class), isNull());
    }

    @Test
    void malformedVersionIsRejectedAsBadRequest() {
        when(docs.selectById("D1")).thenReturn(existing());

        ReqDocSaveRequest req = saveRequest();
        req.setUpdatedAt("不是时间");

        AppException error = assertThrows(AppException.class,
                () -> service.update("U1", "W1", "D1", req));

        assertEquals(400, error.getCode());
    }

    private RequirementDoc existing() {
        RequirementDoc d = new RequirementDoc();
        d.setId("D1");
        d.setWorkspaceId("W1");
        d.setReqId("R1");
        d.setTitle("旧标题");
        d.setFormat("markdown");
        d.setDocType("other");
        d.setSortOrder(0);
        d.setStatus("draft");
        d.setPublishedAt(java.time.LocalDateTime.now());
        return d;
    }

    private Requirement project(String id) {
        Requirement r = new Requirement();
        r.setId(id);
        r.setWorkspaceId("W1");
        return r;
    }

    private ReqDocSaveRequest saveRequest() {
        ReqDocSaveRequest req = new ReqDocSaveRequest();
        req.setReqId("R1");
        req.setTitle("新标题");
        req.setFormat("markdown");
        req.setContent("正文");
        req.setStatus("draft");
        req.setOwner("张三");
        return req;
    }
}
