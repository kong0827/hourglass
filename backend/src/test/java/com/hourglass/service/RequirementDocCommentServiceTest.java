package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.ReqDocCommentRequest;
import com.hourglass.dto.ReqDocCommentView;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.entity.RequirementDocComment;
import com.hourglass.mapper.RequirementDocCommentMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.UserMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RequirementDocCommentServiceTest {

    private static final String WS = "W1";
    private static final String DOC = "D1";
    private static final String REQ = "R1";
    private static final String USER = "U1";
    private static final String OTHER = "U2";

    private final RequirementDocCommentMapper commentMapper = mock(RequirementDocCommentMapper.class);
    private final RequirementDocMapper docMapper = mock(RequirementDocMapper.class);
    private final UserMapper userMapper = mock(UserMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final WorkActivityService workActivityService = mock(WorkActivityService.class);
    private final AuditService auditService = mock(AuditService.class);
    private final RequirementDocCommentService service = new RequirementDocCommentService(
            commentMapper, docMapper, userMapper, access, workActivityService, auditService);

    @Test
    void listReturnsCommentsForVisibleDoc() {
        RequirementDoc doc = doc(REQ);
        when(docMapper.selectById(DOC)).thenReturn(doc);
        RequirementDocComment c = comment(USER, "hello");
        when(commentMapper.countByDoc(WS, DOC)).thenReturn(1);
        when(commentMapper.selectByDoc(WS, DOC, 0, 100)).thenReturn(Collections.singletonList(c));
        when(userMapper.selectByIds(Collections.singletonList(USER)))
                .thenReturn(Collections.singletonList(user(USER, "张三")));
        when(access.canWrite(WS, USER, REQ)).thenReturn(true);

        com.hourglass.dto.PageResult<ReqDocCommentView> page = service.list(WS, USER, DOC, 0, 100);

        assertEquals(1, page.getTotal());
        assertEquals(1, page.getItems().size());
        assertEquals("hello", page.getItems().get(0).getContent());
        assertEquals("张三", page.getItems().get(0).getUserName());
    }

    @Test
    void createRejectsViewer() {
        RequirementDoc doc = doc(REQ);
        when(docMapper.selectById(DOC)).thenReturn(doc);
        doThrow(new AppException(403, "只读")).when(access).assertWrite(WS, USER, REQ);

        ReqDocCommentRequest req = new ReqDocCommentRequest();
        req.setContent("hi");
        assertThrows(AppException.class, () -> service.create(USER, WS, DOC, req));
    }

    @Test
    void createAllowsMemberAndNotifiesNoOne() {
        RequirementDoc doc = doc(REQ);
        when(docMapper.selectById(DOC)).thenReturn(doc);
        when(access.roleOf(WS, USER)).thenReturn(ProjectAccessService.ROLE_MEMBER);
        when(userMapper.selectById(USER)).thenReturn(user(USER, "李四"));
        when(access.canWrite(WS, USER, REQ)).thenReturn(true);

        ReqDocCommentRequest req = new ReqDocCommentRequest();
        req.setContent(" looks good ");
        req.setQuoteText(" quote ");
        service.create(USER, WS, DOC, req);

        ArgumentCaptor<RequirementDocComment> captor = ArgumentCaptor.forClass(RequirementDocComment.class);
        verify(commentMapper).insert(captor.capture());
        RequirementDocComment saved = captor.getValue();
        assertEquals("looks good", saved.getContent());
        assertEquals("quote", saved.getQuoteText());
        assertEquals(USER, saved.getUserId());
    }

    @Test
    void deleteAllowsAuthor() {
        RequirementDoc doc = doc(REQ);
        when(docMapper.selectById(DOC)).thenReturn(doc);
        when(commentMapper.selectById("C1")).thenReturn(comment(USER, "x"));

        service.delete(USER, WS, DOC, "C1");

        verify(commentMapper).delete(WS, "C1");
        verify(workActivityService).record(eq(WS), eq(WorkActivityService.REQUIREMENT_DOC), eq(DOC),
                eq(USER), eq("update"), contains("删除了一条评论"));
        verify(auditService).recordCurrent(eq(WS), eq("comment_delete"), eq("comment"), eq("C1"),
                any(), eq(true), anyString(), isNull());
    }

    @Test
    void deleteRejectsReadOnlyAuthor() {
        RequirementDoc doc = doc(REQ);
        when(docMapper.selectById(DOC)).thenReturn(doc);
        when(commentMapper.selectById("C1")).thenReturn(comment(USER, "x"));
        doThrow(new AppException(403, "只读")).when(access).assertWrite(WS, USER, REQ);

        assertThrows(AppException.class, () -> service.delete(USER, WS, DOC, "C1"));
        verify(commentMapper, never()).delete(anyString(), anyString());
    }

    @Test
    void deleteAllowsNonAuthorWithWritePermission() {
        RequirementDoc doc = doc(REQ);
        when(docMapper.selectById(DOC)).thenReturn(doc);
        when(commentMapper.selectById("C1")).thenReturn(comment(OTHER, "x"));
        when(access.canWrite(WS, USER, REQ)).thenReturn(true);

        service.delete(USER, WS, DOC, "C1");

        verify(commentMapper).delete(WS, "C1");
    }

    @Test
    void deleteRejectsNonAuthorWithoutWritePermission() {
        RequirementDoc doc = doc(REQ);
        when(docMapper.selectById(DOC)).thenReturn(doc);
        when(commentMapper.selectById("C1")).thenReturn(comment(OTHER, "x"));
        doThrow(new AppException(403, "只读")).when(access).assertWrite(WS, USER, REQ);

        assertThrows(AppException.class, () -> service.delete(USER, WS, DOC, "C1"));
        verify(commentMapper, never()).delete(anyString(), anyString());
    }

    @Test
    void deletableFlagRequiresCurrentWritePermission() {
        RequirementDoc doc = doc(REQ);
        when(docMapper.selectById(DOC)).thenReturn(doc);
        when(commentMapper.countByDoc(WS, DOC)).thenReturn(2);
        when(commentMapper.selectByDoc(WS, DOC, 0, 100)).thenReturn(Arrays.asList(
                comment(USER, "own"),
                comment(OTHER, "other")));
        when(userMapper.selectByIds(Arrays.asList(USER, OTHER)))
                .thenReturn(Arrays.asList(user(USER, "Me"), user(OTHER, "Other")));
        when(access.canWrite(WS, USER, REQ)).thenReturn(false);

        com.hourglass.dto.PageResult<ReqDocCommentView> page = service.list(WS, USER, DOC, 0, 100);
        List<ReqDocCommentView> views = page.getItems();

        assertFalse(views.get(0).isDeletable(), "作者被降权后也不可删");
        assertFalse(views.get(1).isDeletable(), "非作者且无写权限不可删");
        verify(access).canWrite(WS, USER, REQ);
    }

    private RequirementDoc doc(String reqId) {
        RequirementDoc d = new RequirementDoc();
        d.setId(DOC);
        d.setWorkspaceId(WS);
        d.setReqId(reqId);
        d.setPublishedAt(java.time.LocalDateTime.now());
        return d;
    }

    private RequirementDocComment comment(String userId, String content) {
        RequirementDocComment c = new RequirementDocComment();
        c.setId("C1");
        c.setWorkspaceId(WS);
        c.setDocId(DOC);
        c.setUserId(userId);
        c.setContent(content);
        return c;
    }

    private AppUser user(String id, String name) {
        AppUser u = new AppUser();
        u.setId(id);
        u.setDisplayName(name);
        return u;
    }
}
