package com.hourglass.service;

import com.hourglass.dto.ReqDocSaveRequest;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.entity.RequirementDocHistory;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.ReqDocShareMapper;
import com.hourglass.mapper.RequirementDocCommentMapper;
import com.hourglass.mapper.RequirementDocHistoryMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 保存正文时，历史快照必须记录被替换掉的旧正文。 */
class RequirementDocHistorySnapshotTest {

    private static final String WS = "W1";
    private static final String DOC = "D1";
    private static final String REQ = "R1";
    private static final String USER = "U1";

    private final RequirementDocMapper docs = mock(RequirementDocMapper.class);
    private final RequirementDocHistoryMapper history = mock(RequirementDocHistoryMapper.class);
    private final RequirementMapper reqs = mock(RequirementMapper.class);
    private final UserMapper users = mock(UserMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final RequirementDocService service = new RequirementDocService(docs, history,
            mock(RequirementDocCommentMapper.class), reqs, users,
            mock(TaskMapper.class), mock(WorkActivityService.class), mock(DemandMapper.class),
            access, mock(NotificationEventService.class), mock(ReqDocShareMapper.class),
            mock(WorkspaceMapper.class), mock(DocPreviewService.class), mock(DeletionTraceService.class));

    @Test
    void updateSnapshotsPreviousContent() {
        RequirementDoc doc = new RequirementDoc();
        doc.setId(DOC);
        doc.setWorkspaceId(WS);
        doc.setReqId(REQ);
        doc.setTitle("旧标题");
        doc.setContent("OLD");
        doc.setFormat("html");
        doc.setStatus("active");
        doc.setOwnerUserId(USER);
        doc.setPublishedAt(LocalDateTime.now());
        when(docs.selectById(DOC)).thenReturn(doc);
        when(access.roleOf(WS, USER)).thenReturn("member");

        Requirement project = new Requirement();
        project.setId(REQ);
        project.setWorkspaceId(WS);
        project.setName("项目");
        when(reqs.selectById(REQ)).thenReturn(project);

        AppUser user = new AppUser();
        user.setDisplayName("张三");
        when(users.selectById(USER)).thenReturn(user);
        when(docs.update(any(RequirementDoc.class), nullable(LocalDateTime.class))).thenReturn(1);

        ReqDocSaveRequest req = new ReqDocSaveRequest();
        req.setReqId(REQ);
        req.setTitle("新标题");
        req.setContent("<p>NEW</p>");
        req.setFormat("html");
        req.setStatus("active");
        service.update(USER, WS, DOC, req);

        ArgumentCaptor<RequirementDocHistory> saved = ArgumentCaptor.forClass(RequirementDocHistory.class);
        verify(history).insert(saved.capture());
        assertEquals("旧标题", saved.getValue().getTitle());
        assertEquals("OLD", saved.getValue().getContent());
    }
}
