package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.TaskComment;
import com.devstudio.kanban.entity.WorkspaceMember;
import com.devstudio.kanban.mapper.TaskCommentMapper;
import com.devstudio.kanban.mapper.TaskLogMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class TaskCommentServiceNotificationTest {

    private final TaskMapper tasks = mock(TaskMapper.class);
    private final UserMapper users = mock(UserMapper.class);
    private final NotificationEventService events = mock(NotificationEventService.class);
    private final TaskCommentMapper comments = mock(TaskCommentMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final WorkspaceMemberMapper members = mock(WorkspaceMemberMapper.class);
    private final TaskCommentService service = new TaskCommentService(comments, tasks,
            mock(TaskLogMapper.class), users, members, events, access, mock(TaskWatchService.class));

    @Test
    void commentNotifiesOwnerThroughEventPreferences() {
        prepare("U-owner", "U-author");

        service.create("U-author", "W1", "K1", "comment body");

        verify(events).notify(eq("U-owner"), eq("W1"), eq(UserNotificationPreferenceService.TASK_COMMENT),
                eq("「Task」有新评论"), anyString(), eq("K1"), isNull());
    }

    @Test
    void ownCommentDoesNotNotifySelf() {
        prepare("U-owner", "U-owner");

        service.create("U-owner", "W1", "K1", "comment body");

        verifyNoInteractions(events);
    }

    @Test
    void deleteIsRejectedWhenTaskProjectIsReadOnly() {
        Task task = new Task();
        task.setId("K1");
        task.setWorkspaceId("W1");
        task.setReqId("P1");
        when(tasks.selectById("K1")).thenReturn(task);
        TaskComment comment = new TaskComment();
        comment.setId(9L);
        comment.setWorkspaceId("W1");
        comment.setAuthorId("U-author");
        comment.setTaskId("K1");
        when(comments.selectById(9L)).thenReturn(comment);
        doThrow(new AppException(403, "你对该项目只有查看权限"))
                .when(access).assertWrite("W1", "U-author", "P1");

        assertThrows(AppException.class, () -> service.delete("U-author", "W1", 9L));
        verify(comments, never()).deleteById(9L);
    }

    @Test
    void deleteSucceedsWhenTaskIsWritable() {
        Task task = new Task();
        task.setId("K1");
        task.setWorkspaceId("W1");
        task.setReqId("P1");
        when(tasks.selectById("K1")).thenReturn(task);
        TaskComment comment = new TaskComment();
        comment.setId(9L);
        comment.setWorkspaceId("W1");
        comment.setAuthorId("U-author");
        comment.setTaskId("K1");
        when(comments.selectById(9L)).thenReturn(comment);

        service.delete("U-author", "W1", 9L);

        verify(comments).deleteById(9L);
    }

    @Test
    void mentionNotifiesMentionedMember() {
        prepare("U-owner", "U-author");
        when(members.selectByWorkspace("W1")).thenReturn(Arrays.asList(
                member("U-bob", "Bob"), member("U-owner", "Owner")));

        service.create("U-author", "W1", "K1", "@Bob 请看一下");

        verify(events).notify(eq("U-bob"), eq("W1"),
                eq(UserNotificationPreferenceService.TASK_MENTION),
                eq("「Task」提到了你"), anyString(), eq("K1"), isNull());
        verify(events).notify(eq("U-owner"), eq("W1"),
                eq(UserNotificationPreferenceService.TASK_COMMENT),
                eq("「Task」有新评论"), anyString(), eq("K1"), isNull());
    }

    @Test
    void mentionedOwnerGetsMentionInsteadOfComment() {
        prepare("U-owner", "U-author");
        when(members.selectByWorkspace("W1")).thenReturn(Arrays.asList(
                member("U-owner", "Owner")));

        service.create("U-author", "W1", "K1", "@Owner 请确认");

        verify(events).notify(eq("U-owner"), eq("W1"),
                eq(UserNotificationPreferenceService.TASK_MENTION),
                eq("「Task」提到了你"), anyString(), eq("K1"), isNull());
        verify(events, never()).notify(eq("U-owner"), eq("W1"),
                eq(UserNotificationPreferenceService.TASK_COMMENT),
                anyString(), anyString(), eq("K1"), isNull());
    }

    @Test
    void mentioningSelfDoesNotNotifySelf() {
        prepare("U-owner", "U-author");
        when(members.selectByWorkspace("W1")).thenReturn(Arrays.asList(
                member("U-author", "Author")));

        service.create("U-author", "W1", "K1", "@Author 记一下");

        verify(events).notify(eq("U-owner"), eq("W1"),
                eq(UserNotificationPreferenceService.TASK_COMMENT),
                anyString(), anyString(), eq("K1"), isNull());
        verify(events, never()).notify(eq("U-author"), eq("W1"),
                eq(UserNotificationPreferenceService.TASK_MENTION),
                anyString(), anyString(), eq("K1"), isNull());
    }

    @Test
    void mentionOfNonMemberIsIgnored() {
        prepare("U-owner", "U-author");
        when(members.selectByWorkspace("W1")).thenReturn(Arrays.asList(
                member("U-bob", "Bob")));

        service.create("U-author", "W1", "K1", "@NotAMember 看下");

        verify(events, never()).notify(anyString(), eq("W1"),
                eq(UserNotificationPreferenceService.TASK_MENTION),
                anyString(), anyString(), anyString(), isNull());
    }

    @Test
    void structuredMentionNotifiesPickedMemberEvenWithoutNameInText() {
        prepare("U-owner", "U-author");
        when(members.selectByWorkspace("W1")).thenReturn(Arrays.asList(
                member("U-bob", "Bob")));

        service.create("U-author", "W1", "K1", "请看一下", Collections.singletonList("U-bob"));

        verify(events).notify(eq("U-bob"), eq("W1"),
                eq(UserNotificationPreferenceService.TASK_MENTION),
                eq("「Task」提到了你"), anyString(), eq("K1"), isNull());
    }

    @Test
    void structuredMentionOfNonMemberIsIgnored() {
        prepare("U-owner", "U-author");
        when(members.selectByWorkspace("W1")).thenReturn(Arrays.asList(
                member("U-bob", "Bob")));

        service.create("U-author", "W1", "K1", "请看一下", Collections.singletonList("U-outsider"));

        verify(events, never()).notify(eq("U-outsider"), anyString(), anyString(),
                anyString(), anyString(), anyString(), isNull());
    }

    @Test
    void structuredMentionDeduplicatesParsedTextMention() {
        prepare("U-owner", "U-author");
        when(members.selectByWorkspace("W1")).thenReturn(Arrays.asList(
                member("U-bob", "Bob")));

        service.create("U-author", "W1", "K1", "@Bob 看一下", Collections.singletonList("U-bob"));

        verify(events, times(1)).notify(eq("U-bob"), eq("W1"),
                eq(UserNotificationPreferenceService.TASK_MENTION),
                anyString(), anyString(), eq("K1"), isNull());
    }

    @Test
    void mentionCandidatesExcludeMembersWhoCannotSeeProject() {
        Task task = new Task();
        task.setId("K1");
        task.setWorkspaceId("W1");
        task.setReqId("P1");
        when(tasks.selectById("K1")).thenReturn(task);
        List<WorkspaceMember> all = Arrays.asList(
                member("U-bob", "Bob"), member("U-hidden", "Hidden"));
        when(members.selectByWorkspace("W1")).thenReturn(all);
        when(access.filterVisibleMembers("W1", all, "P1"))
                .thenReturn(Collections.singletonList(all.get(0)));

        List<WorkspaceMember> candidates = service.mentionCandidates("U-author", "W1", "K1");

        assertEquals(1, candidates.size());
        assertEquals("U-bob", candidates.get(0).getUserId());
        verify(access, never()).canView(anyString(), anyString(), anyString());
    }

    private WorkspaceMember member(String userId, String displayName) {
        WorkspaceMember m = new WorkspaceMember();
        m.setUserId(userId);
        m.setDisplayName(displayName);
        return m;
    }

    private void prepare(String ownerId, String authorId) {
        Task task = new Task();
        task.setId("K1");
        task.setWorkspaceId("W1");
        task.setTitle("Task");
        task.setOwnerUserId(ownerId);
        when(tasks.selectById("K1")).thenReturn(task);
        AppUser author = new AppUser();
        author.setDisplayName("Author");
        when(users.selectById(authorId)).thenReturn(author);
    }
}
