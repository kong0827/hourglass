package com.hourglass.common;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** API Key 加解密与掩码 */
class AiCryptoTest {

    @Test
    void encryptDecryptRoundTrip() {
        AiCrypto crypto = new AiCrypto("unit-test-secret");
        String cipher = crypto.encrypt("sk-1234567890abcdef");
        assertTrue(cipher.startsWith("v1:"), "密文带 v1: 前缀");
        assertTrue(!cipher.contains("1234567890"), "密文里看不到明文");
        assertEquals("sk-1234567890abcdef", crypto.decrypt(cipher));
        assertNotEquals(cipher, crypto.encrypt("sk-1234567890abcdef"), "IV 随机，同明文两次加密不同");
    }

    @Test
    void decryptLegacyAndFailure() {
        AiCrypto crypto = new AiCrypto("unit-test-secret");
        String cipher = crypto.encrypt("sk-1234567890abcdef");
        assertEquals("legacy-key", crypto.decrypt("legacy-key"), "明文（历史数据）原样返回");
        assertNull(new AiCrypto("another-secret").decrypt(cipher), "换密钥后解不开返回 null");
        assertNull(crypto.decrypt(null));
    }

    @Test
    void mask() {
        assertEquals("****", AiCrypto.mask("abc123"));
        assertEquals("sk-****cdef", AiCrypto.mask("sk-1234567890abcdef"));
        assertNull(AiCrypto.mask(""));
    }
}
