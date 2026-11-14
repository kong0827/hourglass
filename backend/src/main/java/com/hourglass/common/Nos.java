package com.hourglass.common;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 项目内顺序编号的展示与识别口径（sql/82、sql/83）。
 *
 * <p>编号是给人读、给跨系统引用的稳定标识；实体 ID 仍是主键与导航用的内部值，两者不互相替代。
 * 与用例编号 TC-001 同一形态：不足三位补零，超过三位自然变宽。
 */
public final class Nos {

    /** 搜索词里的工作项编号：WI-001 / wi1 / 纯数字都认，最多 7 位（int 范围内） */
    private static final Pattern WORK_ITEM = Pattern.compile("^(?:WI-?)?(\\d{1,7})$", Pattern.CASE_INSENSITIVE);

    private Nos() {
    }

    /** 未取号（null / 0）返回空串，由调用方回退显示原 ID，不编造编号 */
    public static String workItem(Integer no) {
        return no == null || no <= 0 ? "" : String.format("WI-%03d", no);
    }

    public static String release(Integer no) {
        return no == null || no <= 0 ? "" : String.format("REL-%03d", no);
    }

    /** 不是编号形态的搜索词返回 null，走原有文本匹配 */
    public static Integer parseWorkItem(String text) {
        if (text == null) {
            return null;
        }
        Matcher m = WORK_ITEM.matcher(text.trim());
        if (!m.matches()) {
            return null;
        }
        int no = Integer.parseInt(m.group(1));
        return no > 0 ? Integer.valueOf(no) : null;
    }
}