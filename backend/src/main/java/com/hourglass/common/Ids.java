package com.hourglass.common;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.concurrent.ThreadLocalRandom;
import java.util.regex.Pattern;

public final class Ids {

    private static final String CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";
    private static final Pattern VALID_ID = Pattern.compile("^[A-Za-z0-9_-]{1,32}$");
    /**
     * 随机后缀位数（第九轮审查 #6）。
     * 原为 4 位 Math.random()：同一毫秒内仅约 167 万组合，批量导入等并发写入下可能撞主键；
     * 且 Math.random() 可预测。改为 ThreadLocalRandom + 8 位后同毫秒组合数约 2.8×10^12，
     * 仍远小于 32 字符的 ID 上限（前缀 1 + 时间戳最多 9 + 后缀 8）。
     */
    private static final int SUFFIX_LEN = 8;
    /** 分享令牌：SecureRandom 24 字节 → base64url 32 字符（与 gantt_share.token VARCHAR(32) 对齐） */
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private Ids() {
    }

    /** 不可预测的公开令牌（只用于分享链接，不参与实体 ID） */
    public static String genToken() {
        byte[] bytes = new byte[24];
        SECURE_RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /** 与旧版前端一致的短字符串ID：前缀 + 时间戳36进制 + 随机后缀 */
    public static String gen(String prefix) {
        StringBuilder sb = new StringBuilder(prefix);
        sb.append(Long.toString(System.currentTimeMillis(), 36));
        ThreadLocalRandom rnd = ThreadLocalRandom.current();
        for (int i = 0; i < SUFFIX_LEN; i++) {
            sb.append(CHARS.charAt(rnd.nextInt(CHARS.length())));
        }
        return sb.toString();
    }

    /**
     * ID 只允许字母/数字/下划线/中划线（防止导入数据把 ID 注入到 HTML 属性），
     * 不合法则返回 null，由调用方重新生成
     */
    public static String sanitize(String id) {
        if (id == null) {
            return null;
        }
        return VALID_ID.matcher(id).matches() ? id : null;
    }
}
