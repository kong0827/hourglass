package com.hourglass.common;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class IdsTest {

    @Test
    void shareTokenIsUrlSafeAndUnpredictableLength() {
        Set<String> seen = new HashSet<String>();
        for (int i = 0; i < 200; i++) {
            String token = Ids.genToken();
            assertEquals(32, token.length());
            assertTrue(token.matches("^[A-Za-z0-9_-]{32}$"));
            assertTrue(seen.add(token), "分享令牌不应重复");
        }
    }

    @Test
    void sanitizeOnlyAllowsShortSafeIds() {
        assertEquals("K123", Ids.sanitize("K123"));
        assertNull(Ids.sanitize("../../etc/passwd"));
        assertNull(Ids.sanitize("含中文"));
        assertNull(Ids.sanitize("with space"));
        assertNull(Ids.sanitize("x".concat(new String(new char[40]).replace('\0', 'a'))));
        assertNotNull(Ids.gen("K"));
        assertFalse(Ids.gen("K").equals(Ids.gen("K")));
    }
}
