package com.hourglass.common;

/** 版本号自然排序：数字段按数值比较，V1.10 排在 V1.2 前。 */
public final class VersionOrdering {

    private VersionOrdering() {
    }

    public static int compareDesc(String left, String right) {
        String a = left == null ? "" : left.trim();
        String b = right == null ? "" : right.trim();
        if (a.isEmpty() || b.isEmpty()) {
            return a.isEmpty() && b.isEmpty() ? 0 : a.isEmpty() ? 1 : -1;
        }
        return -compareNatural(a, b);
    }

    private static int compareNatural(String a, String b) {
        int ai = 0;
        int bi = 0;
        while (ai < a.length() && bi < b.length()) {
            char ac = a.charAt(ai);
            char bc = b.charAt(bi);
            if (Character.isDigit(ac) && Character.isDigit(bc)) {
                int ae = digitEnd(a, ai);
                int be = digitEnd(b, bi);
                String an = stripZeros(a.substring(ai, ae));
                String bn = stripZeros(b.substring(bi, be));
                if (an.length() != bn.length()) {
                    return Integer.compare(an.length(), bn.length());
                }
                int numeric = an.compareTo(bn);
                if (numeric != 0) {
                    return numeric;
                }
                ai = ae;
                bi = be;
                continue;
            }
            int text = Character.toLowerCase(ac) - Character.toLowerCase(bc);
            if (text != 0) {
                return text;
            }
            ai++;
            bi++;
        }
        if (ai < a.length() || bi < b.length()) {
            return ai == a.length() ? -1 : 1;
        }
        return a.compareTo(b);
    }

    private static int digitEnd(String value, int from) {
        int end = from;
        while (end < value.length() && Character.isDigit(value.charAt(end))) {
            end++;
        }
        return end;
    }

    private static String stripZeros(String value) {
        int index = 0;
        while (index < value.length() - 1 && value.charAt(index) == '0') {
            index++;
        }
        return value.substring(index);
    }
}
