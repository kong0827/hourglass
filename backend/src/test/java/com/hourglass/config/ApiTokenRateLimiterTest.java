package com.hourglass.config;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ApiTokenRateLimiterTest {

    @Test
    void enforcesPerTokenReadLimit() {
        ApiTokenRateLimiter limiter = new ApiTokenRateLimiter(3, 1);
        assertTrue(limiter.allow("T1", false));
        assertTrue(limiter.allow("T1", false));
        assertTrue(limiter.allow("T1", false));
        assertFalse(limiter.allow("T1", false));
        assertTrue(limiter.allow("T2", false));
    }

    @Test
    void readAndWriteBucketsAreSeparate() {
        ApiTokenRateLimiter limiter = new ApiTokenRateLimiter(1, 1);
        assertTrue(limiter.allow("T1", false));
        assertFalse(limiter.allow("T1", false));
        assertTrue(limiter.allow("T1", true));
        assertFalse(limiter.allow("T1", true));
    }

    @Test
    void nonPositiveLimitDisablesThrottling() {
        ApiTokenRateLimiter limiter = new ApiTokenRateLimiter(0, 0);
        for (int i = 0; i < 10; i++) {
            assertTrue(limiter.allow("T1", false));
            assertTrue(limiter.allow("T1", true));
        }
    }
}