package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.dto.ReqDocShareResponse;
import com.devstudio.kanban.entity.ReqDocShare;
import com.devstudio.kanban.entity.RequirementDoc;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.mapper.DemandMapper;
import com.devstudio.kanban.mapper.ReqDocShareMapper;
import com.devstudio.kanban.mapper.RequirementDocMapper;
import com.devstudio.kanban.mapper.RequirementDocHistoryMapper;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.mapper.WorkspaceMapper;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 文档草稿/发布可见性与只读分享：发布、分享令牌、公开读取。 */
class RequirementDocPublishShareTest {

    private static final String WS = "W1";
    private static final String AUTHOR = "U1";
    private static final String OTHER = "U2";
    private static final String DOC_ID = "D1";

    private final RequirementDocMapper docs = mock(RequirementDocMapper.class);
    private final ReqDocShareMapper shares = mock(ReqDocShareMapper.class);
    private final WorkspaceMapper workspaces = mock(WorkspaceMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final RequirementDocService service = new RequirementDocService(docs,
            mock(RequirementDocHistoryMapper.class), mock(com.devstudio.kanban.mapper.RequirementDocCommentMapper.class),
            mock(RequirementMapper.class), mock(UserMapper.class),
            mock(TaskMapper.class), mock(WorkActivityService.class), mock(DemandMapper.class), access,
            mock(NotificationEventService.class), shares, workspaces);

    /* ---------------- canSeeDraft 口径 ---------------- */

    @Test
    void draftVisibleToAuthorPrivilegedAndPublished() {
        assertTrue(RequirementDocService.canSeeDraft(AUTHOR, null, AUTHOR, "member"), "作者可见自己的草稿");
        assertTrue(RequirementDocService.canSeeDraft(AUTHOR, null, OTHER, "admin"), "空间管理员可见草稿");
        assertTrue(RequirementDocService.canSeeDraft(AUTHOR, LocalDateTime.now(), OTHER, "member"), "已发布对成员可见");
        assertFalse(RequirementDocService.canSeeDraft(AUTHOR, null, OTHER, "member"), "普通成员不可见他人草稿");
    }

    /* ---------------- 发布 / 收回发布 ---------------- */

    private RequirementDoc doc(boolean published) {
        RequirementDoc d = new RequirementDoc();
        d.setId(DOC_ID);
        d.setWorkspaceId(WS);
        d.setReqId("R1");
        d.setTitle("测试文档");
        d.setOwnerUserId(AUTHOR);
        d.setPublishedAt(published ? LocalDateTime.now() : null);
        return d;
    }

    private void stubVisible(RequirementDoc d, String userId, String role) {
        when(docs.selectById(DOC_ID)).thenReturn(d);
        when(access.roleOf(WS, userId)).thenReturn(role);
    }

    @Test
    void publishDraftAsAuthorSetsPublishedAt() {
        RequirementDoc d = doc(false);
        stubVisible(d, AUTHOR, "member");
        when(docs.selectById(DOC_ID)).thenReturn(d);

        service.publish(AUTHOR, WS, DOC_ID, true);

        verify(docs).updatePublished(anyString(), any(LocalDateTime.class));
    }

    @Test
    void unpublishSetsPublishedAtNull() {
        RequirementDoc d = doc(true);
        stubVisible(d, AUTHOR, "member");
        when(docs.selectById(DOC_ID)).thenReturn(d);

        service.publish(AUTHOR, WS, DOC_ID, false);

        verify(docs).updatePublished(DOC_ID, null);
    }

    @Test
    void publishIdempotentNoWrite() {
        RequirementDoc d = doc(true);
        stubVisible(d, AUTHOR, "member");

        service.publish(AUTHOR, WS, DOC_ID, true);

        verify(docs, never()).updatePublished(anyString(), any());
    }

    @Test
    void publishByNonWriterPrivilegedForbidden() {
        RequirementDoc d = doc(false);
        stubVisible(d, OTHER, "admin");
        when(access.canWrite(WS, OTHER, "R1")).thenReturn(false);

        AppException ex = assertThrows(AppException.class, () -> service.publish(OTHER, WS, DOC_ID, true));
        assertEquals(403, ex.getCode());
    }

    @Test
    void publishByProjectWriterAllowed() {
        RequirementDoc d = doc(false);
        stubVisible(d, OTHER, "admin");
        when(access.canWrite(WS, OTHER, "R1")).thenReturn(true);
        when(docs.selectById(DOC_ID)).thenReturn(d);

        service.publish(OTHER, WS, DOC_ID, true);

        verify(docs).updatePublished(anyString(), any(LocalDateTime.class));
    }

    /* ---------------- 分享链接 ---------------- */

    @Test
    void createShareRequiresPublished() {
        RequirementDoc d = doc(false);
        stubVisible(d, AUTHOR, "member");

        assertThrows(AppException.class, () -> service.createShare(AUTHOR, WS, DOC_ID));
    }

    @Test
    void createShareAsAuthorUpserts() {
        RequirementDoc d = doc(true);
        stubVisible(d, AUTHOR, "member");
        ReqDocShare saved = new ReqDocShare();
        saved.setToken("TOKEN1");
        when(shares.selectByDoc(WS, DOC_ID)).thenReturn(saved);

        ReqDocShare out = service.createShare(AUTHOR, WS, DOC_ID);

        verify(shares).upsert(any(ReqDocShare.class));
        assertEquals("TOKEN1", out.getToken());
    }

    @Test
    void shareInfoExpiredReturnsNull() {
        RequirementDoc d = doc(true);
        stubVisible(d, AUTHOR, "member");
        ReqDocShare share = new ReqDocShare();
        share.setExpiresAt(LocalDateTime.now().minusDays(1));
        when(shares.selectByDoc(WS, DOC_ID)).thenReturn(share);

        assertNull(service.shareInfo(AUTHOR, WS, DOC_ID));
    }

    @Test
    void revokeShareByNonWriterForbidden() {
        RequirementDoc d = doc(true);
        stubVisible(d, OTHER, "member");
        when(access.canWrite(WS, OTHER, "R1")).thenReturn(false);

        AppException ex = assertThrows(AppException.class, () -> service.revokeShare(OTHER, WS, DOC_ID));
        assertEquals(403, ex.getCode());
    }

    /* ---------------- 公开只读 ---------------- */

    private ReqDocShare share(boolean expired) {
        ReqDocShare s = new ReqDocShare();
        s.setWorkspaceId(WS);
        s.setDocId(DOC_ID);
        s.setToken("TOKEN1");
        s.setExpiresAt(expired ? LocalDateTime.now().minusHours(1) : LocalDateTime.now().plusDays(1));
        return s;
    }

    @Test
    void publicShareReturnsContent() {
        when(shares.selectByToken("TOKEN1")).thenReturn(share(false));
        RequirementDoc d = doc(true);
        d.setContent("正文内容");
        d.setFormat("markdown");
        when(docs.selectById(DOC_ID)).thenReturn(d);
        Workspace ws = new Workspace();
        ws.setName("演示空间");
        when(workspaces.selectById(WS)).thenReturn(ws);

        ReqDocShareResponse resp = service.publicShare("TOKEN1");

        assertEquals("测试文档", resp.getTitle());
        assertEquals("正文内容", resp.getContent());
        assertEquals("演示空间", resp.getWorkspaceName());
        assertNotNull(resp.getGeneratedAt());
    }

    @Test
    void publicShareExpiredNotFound() {
        when(shares.selectByToken("TOKEN1")).thenReturn(share(true));

        assertThrows(AppException.class, () -> service.publicShare("TOKEN1"));
    }

    @Test
    void publicShareUnpublishedDocNotFound() {
        when(shares.selectByToken("TOKEN1")).thenReturn(share(false));
        when(docs.selectById(DOC_ID)).thenReturn(doc(false));

        assertThrows(AppException.class, () -> service.publicShare("TOKEN1"));
    }

    @Test
    void publicShareBlankTokenNotFound() {
        assertThrows(AppException.class, () -> service.publicShare("  "));
    }
}
