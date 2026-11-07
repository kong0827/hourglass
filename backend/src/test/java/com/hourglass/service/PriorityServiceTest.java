package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.PriorityRequest;
import com.hourglass.entity.WorkspacePriority;
import com.hourglass.mapper.WorkspacePriorityMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PriorityServiceTest {

    private static final String WS = "W1";

    private final WorkspacePriorityMapper mapper = mock(WorkspacePriorityMapper.class);
    private final PriorityService service = new PriorityService(mapper);

    @Test
    void listReturnsDefaultsInFixedOrderWithoutPersisting() {
        when(mapper.selectByWorkspace(WS)).thenReturn(Collections.emptyList());

        List<WorkspacePriority> result = service.list(WS);

        assertEquals(Arrays.asList("P0", "P1", "P2", "P3"), Arrays.asList(
                result.get(0).getCode(), result.get(1).getCode(), result.get(2).getCode(), result.get(3).getCode()));
        assertEquals("紧急", result.get(0).getName());
        assertEquals("高", result.get(1).getName());
        assertEquals("中", result.get(2).getName());
        assertEquals("低", result.get(3).getName());
        assertEquals("#F04438", result.get(0).getColor());
        assertEquals(WS, result.get(0).getWorkspaceId());
    }

    @Test
    void listOnlyOverridesConfiguredLevel() {
        WorkspacePriority custom = row("P1", "阻塞", "#123ABC");
        when(mapper.selectByWorkspace(WS)).thenReturn(Collections.singletonList(custom));

        List<WorkspacePriority> result = service.list(WS);

        assertEquals("紧急", result.get(0).getName());
        assertEquals("阻塞", result.get(1).getName());
        assertEquals("#123ABC", result.get(1).getColor());
        assertEquals("中", result.get(2).getName());
    }

    @Test
    void updateInsertsSanitizedCustomLevel() {
        when(mapper.selectByCode(WS, "P1")).thenReturn(null);
        PriorityRequest req = request("  高,优先级  ", "bad");

        service.update(WS, "P1", req);

        ArgumentCaptor<WorkspacePriority> captor = ArgumentCaptor.forClass(WorkspacePriority.class);
        verify(mapper).insert(captor.capture());
        assertEquals("高 优先级", captor.getValue().getName());
        assertEquals("#F79009", captor.getValue().getColor());
        assertEquals("P1", captor.getValue().getCode());
    }

    @Test
    void updateExistingLevelKeepsIdentity() {
        WorkspacePriority existing = row("P2", "普通", "#2E90FA");
        existing.setId("PR1");
        when(mapper.selectByCode(WS, "P2")).thenReturn(existing);

        WorkspacePriority result = service.update(WS, "P2", request("一般", "#a1B2c3"));

        assertEquals("PR1", result.getId());
        assertEquals("一般", result.getName());
        assertEquals("#a1B2c3", result.getColor());
        verify(mapper).update(existing);
    }

    @Test
    void rejectsUnknownLevelAndResetClearsWorkspaceOnly() {
        assertThrows(AppException.class, () -> service.update(WS, "P4", request("其他", "#000000")));

        service.reset(WS);

        verify(mapper).deleteAllByWorkspace(WS);
    }

    private static WorkspacePriority row(String code, String name, String color) {
        WorkspacePriority row = new WorkspacePriority();
        row.setWorkspaceId(WS);
        row.setCode(code);
        row.setName(name);
        row.setColor(color);
        return row;
    }

    private static PriorityRequest request(String name, String color) {
        PriorityRequest req = new PriorityRequest();
        req.setName(name);
        req.setColor(color);
        return req;
    }
}
