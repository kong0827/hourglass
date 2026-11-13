package com.hourglass.common;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class VersionOrderingTest {

    @Test
    void comparesNumericSegmentsNaturallyInDescendingOrder() {
        List<String> versions = new java.util.ArrayList<String>(Arrays.asList(
                "V1.2", "V1.10", "V1.02", "V2.0", "V1.9.1"));

        versions.sort(VersionOrdering::compareDesc);

        assertEquals(Arrays.asList("V2.0", "V1.10", "V1.9.1", "V1.2", "V1.02"), versions);
        assertTrue(VersionOrdering.compareDesc("V1.10", "V1.2") < 0);
        assertTrue(VersionOrdering.compareDesc("V1.2", "V1.10") > 0);
    }

    @Test
    void emptyNamesSortLast() {
        assertTrue(VersionOrdering.compareDesc(null, "V1") > 0);
        assertTrue(VersionOrdering.compareDesc("  ", "V1") > 0);
        assertEquals(0, VersionOrdering.compareDesc(null, ""));
    }
}
