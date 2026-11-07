package com.hourglass.common;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class OutboundUrlGuardTest {

    @Test
    void blocksLoopbackAndMetadataAddresses() {
        assertThrows(IllegalArgumentException.class,
                () -> OutboundUrlGuard.validate("http://127.0.0.1:11434/v1", false));
        assertThrows(IllegalArgumentException.class,
                () -> OutboundUrlGuard.validate("http://169.254.169.254/latest/meta-data", false));
        assertThrows(IllegalArgumentException.class,
                () -> OutboundUrlGuard.validate("http://10.0.0.8/v1", false));
    }

    @Test
    void allowsPrivateOnlyWhenExplicitlyEnabled() {
        assertDoesNotThrow(() -> OutboundUrlGuard.validate("http://127.0.0.1:11434/v1", true));
    }

    @Test
    void allowsPublicAddressAndRejectsBadSchemes() {
        assertDoesNotThrow(() -> OutboundUrlGuard.validate("https://8.8.8.8/v1", false));
        assertThrows(IllegalArgumentException.class,
                () -> OutboundUrlGuard.validate("file:///etc/passwd", false));
        assertThrows(IllegalArgumentException.class,
                () -> OutboundUrlGuard.validate("https://user:pass@8.8.8.8/v1", false));
    }
}
