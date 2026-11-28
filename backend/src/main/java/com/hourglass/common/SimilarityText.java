package com.hourglass.common;

import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * 相似条目的字面匹配：不做语义判断，只回答「标题/描述有多少字面重合」。
 *
 * <p>中文按字符二元组（bigram）比较，不做分词；标点、空格与大小写先归一。
 * 结果只用于提示，阈值取保守值，宁可少提示也不把无关条目推到用户面前。
 */
public final class SimilarityText {

    private SimilarityText() {
    }

    /** 只留字母、数字与汉字；全角标点、空白与常见符号都去掉 */
    public static String normalize(String raw) {
        if (raw == null) {
            return "";
        }
        String s = raw.toLowerCase(Locale.ROOT);
        StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (Character.isLetterOrDigit(c)) {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    private static Set<String> grams(String norm) {
        Set<String> out = new HashSet<String>();
        if (norm.isEmpty()) {
            return out;
        }
        if (norm.length() == 1) {
            out.add(norm);
            return out;
        }
        for (int i = 0; i < norm.length() - 1; i++) {
            out.add(norm.substring(i, i + 2));
        }
        return out;
    }

    /** Dice 系数：2×交集 /（两侧二元组总数），比 Jaccard 对长短标题更公平 */
    public static double dice(String normA, String normB) {
        if (normA == null || normB == null || normA.isEmpty() || normB.isEmpty()) {
            return 0;
        }
        if (normA.equals(normB)) {
            return 1;
        }
        Set<String> a = grams(normA);
        Set<String> b = grams(normB);
        int inter = 0;
        for (String g : a) {
            if (b.contains(g)) {
                inter++;
            }
        }
        return 2.0 * inter / (a.size() + b.size());
    }

    /**
     * 标题相似度：完全一致记 1；一方包含另一方且都不短时给一个低于 1 的下限，
     * 避免「登录白屏」与「登录后白屏」这类包含关系被二元组稀释到阈值以下。
     */
    public static double titleScore(String rawA, String rawB) {
        String a = normalize(rawA);
        String b = normalize(rawB);
        if (a.isEmpty() || b.isEmpty()) {
            return 0;
        }
        if (a.equals(b)) {
            return 1;
        }
        double score = dice(a, b);
        if (a.length() >= 4 && b.length() >= 4 && (a.contains(b) || b.contains(a))) {
            int shortLen = Math.min(a.length(), b.length());
            int longLen = Math.max(a.length(), b.length());
            score = Math.max(score, 0.72 + 0.28 * shortLen / longLen);
        }
        return score;
    }

    /** 描述只取一段纯文本摘要：去标签、压空白，用于展示与描述相似度 */
    public static String plainSnippet(String raw, int max) {
        if (raw == null) {
            return "";
        }
        String t = raw.replaceAll("(?is)<(script|style)[^>]*>.*?</\\1>", " ")
                .replaceAll("<[^>]+>", " ")
                .replaceAll("&nbsp;", " ")
                .replaceAll("\\s+", " ")
                .trim();
        if (t.length() > max) {
            return t.substring(0, max) + "…";
        }
        return t;
    }
}
