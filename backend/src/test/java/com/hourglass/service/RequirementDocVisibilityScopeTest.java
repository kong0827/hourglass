package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.ReqDocSaveRequest;
import com.hourglass.entity.ReqDocShare;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.ReqDocShareMapper;
import com.hourglass.mapper.RequirementDocHistoryMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMapper;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 文档可见范围（照用例分组三档）：已发布文档叠加团队共享 / 指定成员 / 仅负责人；
 * 草稿规则不变；空间管理员不在名单同样不可见；收窄只允许负责人操作；公开分享仅团队共享档。
 */
class RequirementDocVisibilityScopeTest {

    private static final String WS = "W1";
    private static final String DOC = "D1";
    private static final String OWNER = "U1";
    private static final String OTHER = "U2";
    private static final String ADMIN = "U3";

    private final RequirementDocMapper docs = mock(RequirementDocMapper.class);
    private final ReqDocShareMapper shares = mock(ReqDocShareMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final RequirementDocService service = new RequirementDocService(docs,
            mock(RequirementDocHistoryMapper.class),
            mock(com.hourglass.mapper.RequirementDocCommentMapper.class),
            mock(RequirementMapper.class), mock(UserMapper.class), mock(TaskMapper.class),
            mock(WorkActivityService.class), mock(DemandMapper.class), access,
            mock(NotificationEventService.class), shares, mock(WorkspaceMapper.class),
            mock(DocPreviewService.class), mock(DeletionTraceService.class));

    @Test
    void publishedVisibilityMatrix() {
        assertTrue(RequirementDocService.canSeePublished("team", OWNER, OTHER, false), "团队共享对项目成员开放");
        assertFalse(RequirementDocService.canSeePublished("members", OWNER, OTHER, false), "指定成员：名单外不可见");
        assertTrue(RequirementDocService.canSeePublished("members", OWNER, OTHER, true), "指定成员：名单内可见");
        assertTrue(RequirementDocService.canSeePublished("members", OWNER, OWNER, false), "负责人始终可见");
        assertFalse(RequirementDocService.canSeePublished("personal", OWNER, OTHER, false), "仅负责人：他人不可见");
        assertFalse(RequirementDocService.canSeePublished("personal", OWNER, ADMIN, true),
                "仅负责人：即便在遗留名单里也不放宽（管理员同理）");
    }

    @Test
    void draftRuleIsUnchangedByVisibility() {
        assertTrue(RequirementDocService.canSeeDoc("personal", OWNER, null, OWNER, "member", false));
        assertTrue(RequirementDocService.canSeeDoc("personal", OWNER, null, OTHER, "admin", false),
                "草稿仍对空间管理员可见（可见范围只约束已发布）");
        assertFalse(RequirementDocService.canSeeDoc("personal", OWNER, null, OTHER, "member", false));
    }

    @Test
    void listedMemberCanReadRestrictedPublishedDoc() {
        when(docs.selectById(DOC)).thenReturn(published("members", OWNER));
        when(access.roleOf(WS, OTHER)).thenReturn(ProjectAccessService.ROLE_MEMBER);
        when(docs.countVisibilityMember(DOC, OTHER)).thenReturn(1);
        when(docs.selectVisibilityMemberIds(DOC)).thenReturn(Collections.singletonList(OTHER));

        RequirementDoc d = service.getVisible(WS, OTHER, DOC);

        assertEquals("members", d.getVisibility());
        assertEquals(Collections.singletonList(OTHER), d.getMemberIds());
    }

    @Test
    void unlistedMemberAndAdminGetNotFound() {
        when(docs.selectById(DOC)).thenReturn(published("members", OWNER));
        when(access.roleOf(WS, OTHER)).thenReturn(ProjectAccessService.ROLE_MEMBER);
        when(access.roleOf(WS, ADMIN)).thenReturn(ProjectAccessService.ROLE_ADMIN);
        when(docs.countVisibilityMember(eq(DOC), anyString())).thenReturn(0);

        assertThrows(AppException.class, () -> service.getVisible(WS, OTHER, DOC));
        assertThrows(AppException.class, () -> service.getVisible(WS, ADMIN, DOC),
                "管理员不在名单也受文档可见范围限制（与用例分组口径一致）");
    }

    @Test
    void createDefaultsToTeam() {
        ReqDocSaveRequest req = saveRequest("团队文档", null, null);
        when(docs.selectById(anyString())).thenReturn(null);

        service.create(OWNER, WS, req);

        verify(docs).insert(org.mockito.ArgumentMatchers.argThat(
                d -> RequirementDocService.VIS_TEAM.equals(d.getVisibility())));
    }

    @Test
    void createMembersRequiresAtLeastOnePerson() {
        ReqDocSaveRequest req = saveRequest("名单文档", "members", Collections.<String>emptyList());

        AppException ex = assertThrows(AppException.class, () -> service.create(OWNER, WS, req));
        assertEquals(400, ex.getCode());
    }

    @Test
    void createMembersRejectsPeopleWhoCannotSeeProject() {
        ReqDocSaveRequest req = saveRequest("名单文档", "members", Collections.singletonList(OTHER));
        when(access.canView(WS, OTHER, null)).thenReturn(false);

        AppException ex = assertThrows(AppException.class, () -> service.create(OWNER, WS, req));
        assertEquals(400, ex.getCode());
    }

    @Test
    void createMembersStoresDedupedList() {
        ReqDocSaveRequest req = saveRequest("名单文档", "members", Arrays.asList(OTHER, OTHER));
        when(access.canView(WS, OTHER, null)).thenReturn(true);
        when(docs.selectById(anyString())).thenReturn(null);

        service.create(OWNER, WS, req);

        verify(docs).insertVisibilityMembers(eq(WS), anyString(), eq(Collections.singletonList(OTHER)));
    }

    @Test
    void narrowingTeamDocRequiresItsOwner() {
        when(docs.selectById(DOC)).thenReturn(published("team", OTHER));
        when(access.roleOf(WS, OWNER)).thenReturn(ProjectAccessService.ROLE_ADMIN);
        when(access.canManage(WS, OWNER)).thenReturn(true);
        ReqDocSaveRequest req = saveRequest("收窄", "personal", null);

        AppException ex = assertThrows(AppException.class, () -> service.update(OWNER, WS, DOC, req));
        assertEquals(400, ex.getCode());
        verify(docs, never()).update(any(RequirementDoc.class), any());
    }

    @Test
    void narrowingRevokesShareAndSavesMembers() {
        RequirementDoc d = published("team", OWNER);
        when(docs.selectById(DOC)).thenReturn(d);
        when(access.roleOf(WS, OWNER)).thenReturn(ProjectAccessService.ROLE_MEMBER);
        when(access.canView(WS, OTHER, null)).thenReturn(true);
        when(docs.update(any(RequirementDoc.class), any())).thenReturn(1);
        ReqDocSaveRequest req = saveRequest("收窄", "members", Collections.singletonList(OTHER));

        service.update(OWNER, WS, DOC, req);

        verify(shares).deleteByDoc(WS, DOC);
        verify(docs).deleteVisibilityMembersByDoc(WS, DOC);
        verify(docs).insertVisibilityMembers(eq(WS), eq(DOC), eq(Collections.singletonList(OTHER)));
    }

    @Test
    void editorSaveKeepsMembersWhenListedPersonLostProjectAccess() {
        RequirementDoc d = published("members", OWNER);
        when(docs.selectById(DOC)).thenReturn(d);
        when(access.roleOf(WS, OWNER)).thenReturn(ProjectAccessService.ROLE_MEMBER);
        when(docs.selectVisibilityMemberIds(DOC)).thenReturn(Collections.singletonList(OTHER));
        when(access.canView(WS, OTHER, null)).thenReturn(false);
        when(docs.update(any(RequirementDoc.class), any())).thenReturn(1);
        /* 编辑器保存正文不带 memberIds：名单成员后来被移出项目不该阻断保存 */
        ReqDocSaveRequest req = saveRequest("改正文", null, null);

        service.update(OWNER, WS, DOC, req);

        verify(access, never()).canView(WS, OTHER, null);
        verify(docs).insertVisibilityMembers(eq(WS), eq(DOC), eq(Collections.singletonList(OTHER)));
    }

    @Test
    void shareLinkOnlyForTeamDocs() {
        RequirementDoc d = published("members", OWNER);
        when(docs.selectById(DOC)).thenReturn(d);
        when(access.roleOf(WS, OWNER)).thenReturn(ProjectAccessService.ROLE_MEMBER);
        when(docs.selectVisibilityMemberIds(DOC)).thenReturn(Collections.singletonList(OWNER));

        AppException ex = assertThrows(AppException.class, () -> service.createShare(OWNER, WS, DOC));
        assertEquals(400, ex.getCode());
    }

    @Test
    void oldPublicLinkDiesWhenDocIsRestricted() {
        ReqDocShare share = new ReqDocShare();
        share.setDocId(DOC);
        share.setWorkspaceId(WS);
        share.setExpiresAt(LocalDateTime.now().plusDays(1));
        when(shares.selectByToken("tk")).thenReturn(share);
        when(docs.selectById(DOC)).thenReturn(published("personal", OWNER));

        assertThrows(AppException.class, () -> service.publicShare("tk"),
                "收窄后旧分享链接一律 404，不能绕过名单");
    }

    @Test
    void changeVisibilityNarrowingRequiresOwner() {
        when(docs.selectById(DOC)).thenReturn(published("team", OTHER));
        when(access.roleOf(WS, OWNER)).thenReturn(ProjectAccessService.ROLE_ADMIN);
        when(access.canManage(WS, OWNER)).thenReturn(true);

        AppException ex = assertThrows(AppException.class,
                () -> service.changeVisibility(OWNER, WS, DOC, "personal", null));
        assertEquals(400, ex.getCode());
        verify(docs, never()).updateVisibility(anyString(), anyString(), anyString(), any(), any());
    }

    @Test
    void changeVisibilityToMembersSavesListAndRevokesShare() {
        when(docs.selectById(DOC)).thenReturn(published("team", OWNER));
        when(access.roleOf(WS, OWNER)).thenReturn(ProjectAccessService.ROLE_MEMBER);
        when(access.canView(WS, OTHER, null)).thenReturn(true);

        service.changeVisibility(OWNER, WS, DOC, "members", Collections.singletonList(OTHER));

        verify(docs).updateVisibility(WS, DOC, "members", null, OWNER);
        verify(docs).insertVisibilityMembers(eq(WS), eq(DOC), eq(Collections.singletonList(OTHER)));
        verify(shares).deleteByDoc(WS, DOC);
    }

    @Test
    void changeVisibilityToMembersNeedsAtLeastOnePerson() {
        when(docs.selectById(DOC)).thenReturn(published("team", OWNER));
        when(access.roleOf(WS, OWNER)).thenReturn(ProjectAccessService.ROLE_MEMBER);

        AppException ex = assertThrows(AppException.class,
                () -> service.changeVisibility(OWNER, WS, DOC, "members", Collections.<String>emptyList()));
        assertEquals(400, ex.getCode());
        verify(docs, never()).updateVisibility(anyString(), anyString(), anyString(), any(), any());
    }

    private RequirementDoc published(String visibility, String ownerUserId) {
        RequirementDoc d = new RequirementDoc();
        d.setId(DOC);
        d.setWorkspaceId(WS);
        d.setReqId(null);
        d.setTitle("文档");
        d.setDocType("other");
        d.setContent("正文");
        d.setFormat("markdown");
        d.setStatus("active");
        d.setPublishedAt(LocalDateTime.now());
        d.setVisibility(visibility);
        d.setOwnerUserId(ownerUserId);
        return d;
    }

    private ReqDocSaveRequest saveRequest(String title, String visibility,
                                          java.util.List<String> memberIds) {
        ReqDocSaveRequest req = new ReqDocSaveRequest();
        req.setTitle(title);
        req.setVisibility(visibility);
        req.setMemberIds(memberIds);
        return req;
    }
}
