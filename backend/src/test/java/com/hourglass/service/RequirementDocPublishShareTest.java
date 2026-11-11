package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.ReqDocShareResponse;
import com.hourglass.entity.ReqDocShare;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.entity.Workspace;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.ReqDocShareMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.RequirementDocHistoryMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMapper;
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
import static org.mockito.Mockito.doThrow;
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
            mock(RequirementDocHistoryMapper.class), mock(com.hourglass.mapper.RequirementDocCommentMapper.class),
            mock(RequirementMapper.class), mock(UserMapper.class),
            mock(TaskMapper.class), mock(WorkActivityService.class), mock(DemandMapper.class), access,
            mock(NotificationEventService.class), shares, workspaces, mock(DocPreviewService.class),
            mock(DeletionTraceService.class));

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
        verify(shares).deleteByDoc(WS, DOC_ID);
    }

    @Test
    void publishDoesNotTouchExistingShares() {
        RequirementDoc d = doc(false);
        stubVisible(d, AUTHOR, "member");

        service.publish(AUTHOR, WS, DOC_ID, true);

        verify(shares, never()).deleteByDoc(anyString(), anyString());
    }

    @Test
    void republishAfterUnpublishNeedsFreshShare() {
        RequirementDoc d = doc(true);
        stubVisible(d, AUTHOR, "member");
        service.publish(AUTHOR, WS, DOC_ID, false);
        verify(shares).deleteByDoc(WS, DOC_ID);

        /* 旧令牌已删除：再次发布后按旧令牌访问应 404，而不是复活 */
        when(shares.selectByToken("TOKEN1")).thenReturn(null);
        d.setPublishedAt(LocalDateTime.now());
        assertThrows(AppException.class, () -> service.publicShare("TOKEN1"));
    }

    @Test
    void editingPublishedDocKeepsPublishStateOutOfFullUpdate() throws Exception {
        org.apache.ibatis.session.Configuration cfg = new org.apache.ibatis.session.Configuration();
        cfg.getTypeAliasRegistry().registerAliases("com.hourglass.entity");
        cfg.getTypeAliasRegistry().registerAliases("com.hourglass.dto");
        String file = "mapper/RequirementDocMapper.xml";
        try (java.io.InputStream input = getClass().getClassLoader().getResourceAsStream(file)) {
            assertNotNull(input);
            new org.apache.ibatis.builder.xml.XMLMapperBuilder(input, cfg, file, cfg.getSqlFragments()).parse();
        }
        java.util.Map<String, Object> params = new java.util.HashMap<String, Object>();
        params.put("doc", doc(true));
        params.put("oldUpdatedAt", null);
        String update = cfg.getMappedStatement("com.hourglass.mapper.RequirementDocMapper.update")
                .getBoundSql(params).getSql();
        assertFalse(update.contains("published_at"), "正文编辑不能改写发布状态");
        String publish = cfg.getMappedStatement("com.hourglass.mapper.RequirementDocMapper.updatePublished")
                .getBoundSql(params).getSql();
        assertTrue(publish.contains("updated_at = updated_at"), "发布/收回不推进乐观锁版本，打开中的编辑仍可保存");
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
        doThrow(new AppException(403, "只读")).when(access).assertWrite(WS, OTHER, "R1");

        AppException ex = assertThrows(AppException.class, () -> service.publish(OTHER, WS, DOC_ID, true));
        assertEquals(403, ex.getCode());
    }

    @Test
    void publishByReadOnlyAuthorForbidden() {
        RequirementDoc d = doc(false);
        stubVisible(d, AUTHOR, "viewer");
        doThrow(new AppException(403, "只读")).when(access).assertWrite(WS, AUTHOR, "R1");

        AppException ex = assertThrows(AppException.class, () -> service.publish(AUTHOR, WS, DOC_ID, true));

        assertEquals(403, ex.getCode());
        verify(docs, never()).updatePublished(anyString(), any());
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
    void shareInfoRejectsReadOnlyAuthor() {
        RequirementDoc d = doc(true);
        stubVisible(d, AUTHOR, "viewer");
        doThrow(new AppException(403, "只读")).when(access).assertWrite(WS, AUTHOR, "R1");

        assertThrows(AppException.class, () -> service.shareInfo(AUTHOR, WS, DOC_ID));
        verify(shares, never()).selectByDoc(anyString(), anyString());
    }

    @Test
    void revokeShareByNonWriterForbidden() {
        RequirementDoc d = doc(true);
        stubVisible(d, OTHER, "member");
        doThrow(new AppException(403, "只读")).when(access).assertWrite(WS, OTHER, "R1");

        AppException ex = assertThrows(AppException.class, () -> service.revokeShare(OTHER, WS, DOC_ID));
        assertEquals(403, ex.getCode());
    }

    /* ---------------- 排序与草稿可见性 ---------------- */

    private com.hourglass.dto.ReqDocReorderRequest reorderOf(String id, String parentId) {
        com.hourglass.dto.ReqDocReorderRequest req = new com.hourglass.dto.ReqDocReorderRequest();
        com.hourglass.dto.ReqDocReorderRequest.Item item = new com.hourglass.dto.ReqDocReorderRequest.Item();
        item.setId(id);
        item.setParentId(parentId);
        item.setSortOrder(1);
        req.setItems(java.util.Collections.singletonList(item));
        return req;
    }

    @Test
    void reorderOthersDraftIsNotFoundForMember() {
        RequirementDoc draft = doc(false);
        stubVisible(draft, OTHER, "member");

        AppException ex = assertThrows(AppException.class,
                () -> service.reorder(OTHER, WS, reorderOf(DOC_ID, null)));
        assertEquals(404, ex.getCode());
        verify(docs, never()).updateSortOrder(anyString(), anyString(), any(), any());
    }

    @Test
    void reorderUnderOthersDraftParentRejected() {
        RequirementDoc mine = doc(true);
        stubVisible(mine, OTHER, "member");
        RequirementDoc hiddenParent = doc(false);
        hiddenParent.setId("D2");
        when(docs.selectById("D2")).thenReturn(hiddenParent);

        assertThrows(AppException.class, () -> service.reorder(OTHER, WS, reorderOf(DOC_ID, "D2")));
        verify(docs, never()).updateSortOrder(anyString(), anyString(), any(), any());
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
