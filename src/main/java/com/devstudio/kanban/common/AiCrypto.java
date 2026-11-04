package com.devstudio.kanban.common;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * 用户 AI Key 的加密存储。
 *
 * <p>为什么加密：Key 是用户自己掏钱买的额度，明文落库等于把所有用户的账单一起交出去 ——
 * 一次数据库导出泄露，所有人都要换 key。这里用 AES-GCM（带完整性校验，密文被篡改会解不开而不是解出乱码）。
 *
 * <p>密钥来自 {@code app.ai.crypto-key}（部署时用环境变量 AI_CRYPTO_KEY 覆盖）。
 * <b>密钥换了以前的密文就解不开了</b> —— 这不是故障：用户重填一次 key 即可，不阻塞任何流程。
 *
 * <p>存储格式：{@code v1:} + Base64(IV(12) || 密文)。带版本前缀是为了以后换算法能平滑迁移。
 */
@Component
public class AiCrypto {

    private static final String PREFIX = "v1:";
    private static final int IV_LEN = 12;
    private static final int TAG_BITS = 128;

    /** 与 application.yml 默认值一致；命中即说明部署时没配 AI_CRYPTO_KEY */
    static final String DEFAULT_KEY = "hourglass-local-ai-key-change-me";

    private final SecretKeySpec key;
    private final SecureRandom random = new SecureRandom();

    public AiCrypto(@Value("${app.ai.crypto-key:" + DEFAULT_KEY + "}") String raw) {
        if (DEFAULT_KEY.equals(raw)) {
            org.slf4j.LoggerFactory.getLogger(AiCrypto.class).warn(
                    "AI 密钥使用默认值：数据库一旦导出，加密的 AI Key / SMTP 密码等于明文。"
                            + "生产部署请用环境变量 AI_CRYPTO_KEY 覆盖");
        }
        this.key = new SecretKeySpec(derive(raw), "AES");
    }

    /** 把任意长度的配置串摘要成 16 字节 AES key */
    private static byte[] derive(String raw) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest((raw == null ? "" : raw).getBytes(StandardCharsets.UTF_8));
            byte[] k = new byte[16];
            System.arraycopy(digest, 0, k, 0, 16);
            return k;
        } catch (Exception e) {
            throw new IllegalStateException("AI key 派生失败", e);
        }
    }

    /** 加密后返回带版本前缀的串；空值原样返回 null */
    public String encrypt(String plain) {
        if (plain == null || plain.isEmpty()) {
            return null;
        }
        try {
            byte[] iv = new byte[IV_LEN];
            random.nextBytes(iv);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            byte[] out = new byte[IV_LEN + ct.length];
            System.arraycopy(iv, 0, out, 0, IV_LEN);
            System.arraycopy(ct, 0, out, IV_LEN, ct.length);
            return PREFIX + Base64.getEncoder().encodeToString(out);
        } catch (Exception e) {
            throw new IllegalStateException("AI key 加密失败", e);
        }
    }

    /**
     * 解密。解不开（换过密钥 / 老数据没加密）时返回 null，
     * 由调用方提示用户重填 —— 绝不把密文当明文发到上游。
     */
    public String decrypt(String stored) {
        if (stored == null || stored.isEmpty()) {
            return null;
        }
        if (!stored.startsWith(PREFIX)) {
            /* 兼容早期的明文写入：直接返回，下次保存时会被重新加密 */
            return stored;
        }
        try {
            byte[] all = Base64.getDecoder().decode(stored.substring(PREFIX.length()));
            if (all.length <= IV_LEN) {
                return null;
            }
            byte[] iv = new byte[IV_LEN];
            System.arraycopy(all, 0, iv, 0, IV_LEN);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            byte[] pt = c.doFinal(all, IV_LEN, all.length - IV_LEN);
            return new String(pt, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * 掩码：只留头尾几位给用户确认"填的是哪把 key"。
     * 短 key 一律全遮，避免掩码本身泄露长度信息。
     */
    public static String mask(String plain) {
        if (plain == null || plain.isEmpty()) {
            return null;
        }
        if (plain.length() <= 8) {
            return "****";
        }
        return plain.substring(0, 3) + "****" + plain.substring(plain.length() - 4);
    }
}
