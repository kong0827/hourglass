package com.devstudio.kanban.common;

import com.devstudio.kanban.entity.WorkspaceMember;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 评论 @提及解析：按空间成员显示名（或登录名）匹配文本中的 {@code @名字}。
 * 名字可含空格；最长名字优先，且要求 @ 前后都是词边界，
 * 避免「@张三丰」误命中「张三」、也避免把邮箱 a@b.com 当成提及。
 */
public final class Mentions {

    private static final char MARK = '@';

    private Mentions() {
    }

    public static List<String> mentionedUserIds(String content, List<WorkspaceMember> members) {
        String text = Texts.trimToNull(content);
        if (text == null || text.indexOf(MARK) < 0 || members == null || members.isEmpty()) {
            return Collections.emptyList();
        }
        List<Candidate> candidates = new ArrayList<Candidate>();
        for (WorkspaceMember m : members) {
            if (m == null || Texts.trimToNull(m.getUserId()) == null) {
                continue;
            }
            addCandidate(candidates, m.getUserId(), m.getDisplayName());
            addCandidate(candidates, m.getUserId(), m.getUsername());
        }
        Collections.sort(candidates, new Comparator<Candidate>() {
            @Override
            public int compare(Candidate a, Candidate b) {
                return b.name.length() - a.name.length();
            }
        });
        Set<String> ids = new LinkedHashSet<String>();
        for (Candidate c : candidates) {
            if (found(text, c.name)) {
                ids.add(c.userId);
            }
        }
        return new ArrayList<String>(ids);
    }

    private static void addCandidate(List<Candidate> candidates, String userId, String rawName) {
        String name = Texts.trimToNull(rawName);
        if (name == null) {
            return;
        }
        for (Candidate existing : candidates) {
            if (existing.userId.equals(userId) && existing.name.equals(name)) {
                return;
            }
        }
        candidates.add(new Candidate(userId, name));
    }

    private static boolean found(String text, String name) {
        String token = MARK + name;
        int from = 0;
        while (from <= text.length() - token.length()) {
            int idx = text.indexOf(token, from);
            if (idx < 0) {
                return false;
            }
            int end = idx + token.length();
            boolean startOk = idx == 0 || !blocksStart(text.charAt(idx - 1));
            boolean endOk = end >= text.length() || !isWord(text.charAt(end));
            if (startOk && endOk) {
                return true;
            }
            from = idx + 1;
        }
        return false;
    }

    /** 中文没有词边界，"请@张三" 是自然写法；只把 ASCII 字母/数字/下划线视为邮箱或账号名的一部分 */
    private static boolean blocksStart(char c) {
        return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')
                || (c >= '0' && c <= '9') || c == '_';
    }

    private static boolean isWord(char c) {
        return Character.isLetterOrDigit(c) || c == '_';
    }

    private static final class Candidate {
        private final String userId;
        private final String name;

        private Candidate(String userId, String name) {
            this.userId = userId;
            this.name = name;
        }
    }
}
