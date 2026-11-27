package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.PageResult;
import com.hourglass.dto.ReqDocView;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.RequirementDoc;
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
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 文档收藏（doc_favorite）与复制文档（duplicate）的服务层口径。 */
class RequirementDocFavoriteDuplicateTest {

    private static final String WS = "W1";
    private static final String USER = "U1";

    private final RequirementDocMapper docs = mock(RequirementDocMapper.class);
    private final UserMapper users = mock(UserMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final RequirementDocService service = new RequirementDocService(docs,
            mock(RequirementDocHistoryMapper.class), mock(RequirementDocCommentMapper.class),
            mock(RequirementMapper.class), users, mock(TaskMapper.class),
            mock(WorkActivityService.class), mock(DemandMapper.class), access,
            mock(NotificationEventService.class), mock(ReqDocShareMapper.class),
            mock(WorkspaceMapper.class), mock(DocPreviewService.class), mock(DeletionTraceService.class));

    private RequirementDoc publishedTeamDoc(String id, String title) {
        RequirementDoc d = new RequirementDoc();
        d.setId(id);
        d.setWorkspaceId(WS);
        d.setTitle(title);
        d.setFormat("markdown");
        d.setContent("# 目标\n正文");
        d.setContentBrief("正文");
        d.setStatus("active");
        d.setPublishedAt(LocalDateTime.now());
        d.setVisibility("team");
        d.setOwnerUserId("U2");
        return d;
    }

    private void stubVisible(RequirementDoc d) {
        when(docs.selectById(d.getId())).thenReturn(d);
        when(access.roleOf(WS, USER)).thenReturn(ProjectAccessService.ROLE_MEMBER);
        when(docs.countFavorite(WS, USER, d.getId())).thenReturn(0);
    }

    @Test
    void favoriteOnInsertsAndOffDeletes() {
        RequirementDoc d = publishedTeamDoc("D1", "结算方案");
        stubVisible(d);

        assertTrue(service.setFavorite(WS, USER, "D1", true));
        verify(docs).insertFavorite(WS, USER, "D1");

        assertFalse(service.setFavorite(WS, USER, "D1", false));
        verify(docs).deleteFavorite(WS, USER, "D1");
    }

    @Test
    void favoriteHiddenDocIsRejectedAsNotFound() {
        RequirementDoc d = publishedTeamDoc("D1", "结算方案");
        d.setVisibility("personal");
        stubVisible(d);

        assertThrows(AppException.class, () -> service.setFavorite(WS, USER, "D1", true));
    }

    @Test
    void favoritesListAppliesSameVisibilityScopeAsDocList() {
        when(access.viewerScope(WS, USER)).thenReturn(USER);
        when(access.roleOf(WS, USER)).thenReturn(ProjectAccessService.ROLE_MEMBER);
        when(docs.countFavoriteVisible(eq(WS), isNull(), isNull(), eq(false), isNull(), eq(USER), eq(USER), eq(false))).thenReturn(0);

        PageResult<ReqDocView> page = service.favorites(WS, USER, 0, 100);

        assertEquals(0, page.getItems().size());
        verify(docs).countFavoriteVisible(WS, null, null, false, null, USER, USER, false);
    }

    @Test
    void duplicateCopiesBodyAsDraftOwnedByOperator() {
        RequirementDoc src = publishedTeamDoc("D1", "结算方案");
        src.setReqId("R1");
        src.setCategoryId("CAT1");
        src.setParentId("P1");
        stubVisible(src);
        AppUser me = new AppUser();
        me.setId(USER);
        me.setDisplayName("张三");
        when(users.selectById(USER)).thenReturn(me);
        ArgumentCaptor<RequirementDoc> captor = ArgumentCaptor.forClass(RequirementDoc.class);
        when(docs.insert(captor.capture())).thenAnswer(inv -> {
            captor.getValue().setId("D2");
            return 1;
        });
        RequirementDoc saved = publishedTeamDoc("D2", "结算方案 副本");
        when(docs.selectById("D2")).thenReturn(saved);

        RequirementDoc copy = service.duplicate(USER, WS, "D1");

        RequirementDoc inserted = captor.getValue();
        assertEquals("结算方案 副本", inserted.getTitle());
        assertEquals("R1", inserted.getReqId());
        assertEquals("CAT1", inserted.getCategoryId());
        assertEquals("P1", inserted.getParentId());
        assertEquals(src.getContent(), inserted.getContent());
        assertEquals("draft", inserted.getStatus());
        assertNull(inserted.getPublishedAt());
        assertEquals(USER, inserted.getOwnerUserId());
        assertEquals("D2", copy.getId());
    }

    @Test
    void duplicateMembersVisibilityCopiesMemberList() {
        RequirementDoc src = publishedTeamDoc("D1", "方案");
        src.setVisibility("members");
        stubVisible(src);
        when(docs.countVisibilityMember("D1", USER)).thenReturn(1);
        when(docs.selectVisibilityMemberIds("D1")).thenReturn(Collections.singletonList("U9"));
        AppUser me = new AppUser();
        me.setId(USER);
        me.setDisplayName("张三");
        when(users.selectById(USER)).thenReturn(me);
        ArgumentCaptor<RequirementDoc> captor = ArgumentCaptor.forClass(RequirementDoc.class);
        when(docs.insert(captor.capture())).thenAnswer(inv -> {
            captor.getValue().setId("D2");
            return 1;
        });
        when(docs.selectById("D2")).thenReturn(publishedTeamDoc("D2", "方案 副本"));

        service.duplicate(USER, WS, "D1");

        verify(docs).insertVisibilityMembers(eq(WS), eq("D2"), eq(Collections.singletonList("U9")));
        assertEquals("members", captor.getValue().getVisibility());
    }

    @Test
    void duplicateReadOnlyProjectIsRejected() {
        RequirementDoc src = publishedTeamDoc("D1", "方案");
        src.setReqId("R1");
        stubVisible(src);
        org.mockito.Mockito.doThrow(new AppException(403, "只读"))
                .when(access).assertWrite(WS, USER, "R1");

        assertThrows(AppException.class, () -> service.duplicate(USER, WS, "D1"));
    }
}
