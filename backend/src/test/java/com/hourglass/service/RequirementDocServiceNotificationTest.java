package com.hourglass.service;

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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 文档变更通知：负责人保留原值，只有被他人编辑/删除时才通知。 */
class RequirementDocServiceNotificationTest {

    private static final String WS = "W1";

    private final RequirementDocMapper docs = mock(RequirementDocMapper.class);
    private final RequirementMapper reqs = mock(RequirementMapper.class);
    private final UserMapper users = mock(UserMapper.class);
    private final WorkActivityService activities = mock(WorkActivityService.class);
    private final NotificationEventService events = mock(NotificationEventService.class);
    private final RequirementDocService service = new RequirementDocService(docs,
            mock(RequirementDocHistoryMapper.class), mock(com.hourglass.mapper.RequirementDocCommentMapper.class),
            reqs, users,
            mock(TaskMapper.class), activities, mock(DemandMapper.class),
            mock(ProjectAccessService.class), events,
            mock(com.hourglass.mapper.ReqDocShareMapper.class),
            mock(com.hourglass.mapper.WorkspaceMapper.class), mock(DocPreviewService.class));

    @Test
    void updateByOtherUserKeepsOwnerAndNotifies() {
        RequirementDoc d = doc();
        when(docs.selectById("D1")).thenReturn(d);
        when(reqs.selectById("R1")).thenReturn(project());
        when(docs.update(any(RequirementDoc.class), any())).thenReturn(1);

        service.update("U1", WS, "D1", request("<p>new</p>"));

        assertEquals("U2", d.getOwnerUserId(), "未带负责人时编辑不能把负责人换成操作者");
        verify(events).notifyLinked("U2", WS, UserNotificationPreferenceService.DEMAND_STATUS,
                "文档「文档」已更新", "文档内容或属性有更新", "doc", "D1", "R1");
    }

    @Test
    void updateByOwnerDoesNotNotifySelf() {
        RequirementDoc d = doc();
        when(docs.selectById("D1")).thenReturn(d);
        when(reqs.selectById("R1")).thenReturn(project());
        when(docs.update(any(RequirementDoc.class), any())).thenReturn(1);

        service.update("U2", WS, "D1", request("<p>new</p>"));

        verifyNoInteractions(events);
    }

    @Test
    void deleteByOtherUserNotifiesOwner() {
        when(docs.selectById("D1")).thenReturn(doc());

        service.delete("U1", WS, "D1");

        verify(events).notifyLinked("U2", WS, UserNotificationPreferenceService.DEMAND_STATUS,
                "文档「文档」已被删除", "需求文档已删除，关联任务已解绑", "doc", "D1", "R1");
    }

    private RequirementDoc doc() {
        RequirementDoc d = new RequirementDoc();
        d.setId("D1");
        d.setWorkspaceId(WS);
        d.setReqId("R1");
        d.setTitle("文档");
        d.setDocType("requirement");
        d.setFormat("html");
        d.setContent("<p>old</p>");
        d.setStatus("draft");
        d.setOwner("Alice");
        d.setOwnerUserId("U2");
        d.setPublishedAt(java.time.LocalDateTime.now());
        return d;
    }

    private Requirement project() {
        Requirement r = new Requirement();
        r.setId("R1");
        r.setWorkspaceId(WS);
        r.setName("项目A");
        return r;
    }

    private ReqDocSaveRequest request(String content) {
        ReqDocSaveRequest req = new ReqDocSaveRequest();
        req.setReqId("R1");
        req.setTitle("文档");
        req.setDocType("requirement");
        req.setFormat("html");
        req.setContent(content);
        req.setStatus("draft");
        return req;
    }
}
