package com.hourglass.common;

import com.hourglass.entity.WorkspaceMember;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MentionsTest {

    @Test
    void matchesDisplayNameAndUsername() {
        List<WorkspaceMember> members = Arrays.asList(
                member("U1", "张三", "zhangsan"),
                member("U2", "Bob", "bob"));

        assertEquals(Arrays.asList("U1"), Mentions.mentionedUserIds("请 @张三 看下", members));
        assertEquals(Arrays.asList("U2"), Mentions.mentionedUserIds("@bob hi", members));
    }

    @Test
    void prefersLongestNameSoPrefixDoesNotMatch() {
        List<WorkspaceMember> members = Arrays.asList(
                member("U1", "张三", "zs"),
                member("U2", "张三丰", "zsf"));

        assertEquals(Arrays.asList("U2"), Mentions.mentionedUserIds("@张三丰 看一下", members));
    }

    @Test
    void supportsNamesWithSpaces() {
        List<WorkspaceMember> members = Arrays.asList(member("U1", "Li Si", "lisi"));

        assertEquals(Arrays.asList("U1"), Mentions.mentionedUserIds("@Li Si 请确认", members));
    }

    @Test
    void allowsMentionRightAfterChineseText() {
        List<WorkspaceMember> members = Arrays.asList(member("U1", "张三", "zhangsan"));

        assertEquals(Arrays.asList("U1"), Mentions.mentionedUserIds("请@张三 看下", members));
        assertEquals(Arrays.asList("U1"), Mentions.mentionedUserIds("这个问题找@张三，处理下", members));
    }

    @Test
    void ignoresEmailAddressAndUnknownNames() {
        List<WorkspaceMember> members = Arrays.asList(
                member("U1", "b", "b"),
                member("U2", "Bob", "bob"));

        assertTrue(Mentions.mentionedUserIds("mail a@b.com 给 @Nobody", members).isEmpty());
    }

    @Test
    void ignoresMentionInsideLongerName() {
        List<WorkspaceMember> members = Arrays.asList(member("U1", "张三", "zs"));

        assertTrue(Mentions.mentionedUserIds("@张三丰 看一下", members).isEmpty());
    }

    @Test
    void returnsEmptyForBlankContentOrMembers() {
        List<WorkspaceMember> members = Arrays.asList(member("U1", "Bob", "bob"));

        assertTrue(Mentions.mentionedUserIds("  ", members).isEmpty());
        assertTrue(Mentions.mentionedUserIds("@Bob", null).isEmpty());
        assertTrue(Mentions.mentionedUserIds("@Bob", Arrays.<WorkspaceMember>asList()).isEmpty());
    }

    private WorkspaceMember member(String userId, String displayName, String username) {
        WorkspaceMember m = new WorkspaceMember();
        m.setUserId(userId);
        m.setDisplayName(displayName);
        m.setUsername(username);
        return m;
    }
}
