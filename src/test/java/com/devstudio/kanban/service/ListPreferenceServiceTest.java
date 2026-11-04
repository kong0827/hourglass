package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.dto.ListPreferenceRequest;
import com.devstudio.kanban.dto.ListPreferenceResponse;
import com.devstudio.kanban.entity.UserListPreference;
import com.devstudio.kanban.mapper.UserListPreferenceMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ListPreferenceServiceTest {

    private UserListPreferenceMapper mapper;
    private ListPreferenceService service;

    @BeforeEach
    void setUp() {
        mapper = mock(UserListPreferenceMapper.class);
        service = new ListPreferenceService(mapper);
    }

    @Test
    void getReturnsEmptyPreferenceWhenNothingIsSaved() {
        ListPreferenceResponse result = service.get("U1", "W1", "task-list");

        assertEquals("task-list", result.getViewKey());
        assertNull(result.getViewMode());
        assertTrue(result.getColumns().isEmpty());
        verify(mapper).select("U1", "W1", "task-list");
    }

    @Test
    void getReturnsSavedModeAndColumnOrder() {
        UserListPreference saved = new UserListPreference();
        saved.setViewMode("card");
        saved.setColumnsJson("[\"name\",\"progress\",\"status\"]");
        when(mapper.select("U1", "W1", "project-list")).thenReturn(saved);

        ListPreferenceResponse result = service.get("U1", "W1", "project-list");

        assertEquals("card", result.getViewMode());
        assertEquals(Arrays.asList("name", "progress", "status"), result.getColumns());
    }

    @Test
    void savePersistsCompactJsonAndKeepsRequestedOrder() {
        ListPreferenceResponse result = service.save("U1", "W1", "task-list",
                request("table", Arrays.asList("title", "owner", "dueDate")));

        ArgumentCaptor<UserListPreference> captor = ArgumentCaptor.forClass(UserListPreference.class);
        verify(mapper).upsert(captor.capture());
        UserListPreference saved = captor.getValue();
        assertEquals("U1", saved.getUserId());
        assertEquals("W1", saved.getWorkspaceId());
        assertEquals("task-list", saved.getViewKey());
        assertEquals("table", saved.getViewMode());
        assertEquals("[\"title\",\"owner\",\"dueDate\"]", saved.getColumnsJson());
        assertEquals(Arrays.asList("title", "owner", "dueDate"), result.getColumns());
    }

    @Test
    void saveAcceptsEveryProjectWhitelistColumnInCardMode() {
        List<String> columns = Arrays.asList("name", "status", "description", "taskCount", "doneCount",
                "progress", "docCount", "firstReleasedAt", "createdAt", "updatedAt");

        ListPreferenceResponse result = service.save("U1", "W1", "project-list", request("card", columns));

        assertEquals("card", result.getViewMode());
        assertEquals(columns, result.getColumns());
        verify(mapper).upsert(org.mockito.ArgumentMatchers.any(UserListPreference.class));
    }

    @Test
    void rejectsUnknownViewAndInvalidModes() {
        assertBadRequest(() -> service.get("U1", "W1", "other-list"));
        assertBadRequest(() -> service.save("U1", "W1", "task-list",
                request("card", Collections.singletonList("title"))));
        assertBadRequest(() -> service.save("U1", "W1", "project-list",
                request("list", Collections.singletonList("name"))));
        verify(mapper, never()).upsert(org.mockito.ArgumentMatchers.any(UserListPreference.class));
    }

    @Test
    void rejectsUnknownAndDuplicateColumns() {
        assertBadRequest(() -> service.save("U1", "W1", "task-list",
                request("table", Arrays.asList("title", "unknown"))));
        assertBadRequest(() -> service.save("U1", "W1", "project-list",
                request("table", Arrays.asList("name", "status", "status"))));
        verify(mapper, never()).upsert(org.mockito.ArgumentMatchers.any(UserListPreference.class));
    }

    @Test
    void requiresTitleOrNameAsFirstColumn() {
        assertBadRequest(() -> service.save("U1", "W1", "task-list",
                request("table", Collections.singletonList("owner"))));
        assertBadRequest(() -> service.save("U1", "W1", "project-list",
                request("table", Arrays.asList("status", "name"))));
        assertBadRequest(() -> service.save("U1", "W1", "task-list",
                request("table", Collections.<String>emptyList())));
        verify(mapper, never()).upsert(org.mockito.ArgumentMatchers.any(UserListPreference.class));
    }

    @Test
    void rejectsTooManyColumnsBeforeWriting() {
        List<String> columns = new ArrayList<String>(Collections.singletonList("title"));
        for (int i = 0; i < 15; i++) {
            columns.add("extra" + i);
        }

        AppException error = assertBadRequest(() -> service.save("U1", "W1", "task-list", request("table", columns)));

        assertTrue(error.getMessage().contains("最多 15 列"));
        verify(mapper, never()).upsert(org.mockito.ArgumentMatchers.any(UserListPreference.class));
    }

    @Test
    void acceptsPortfolioAndDemandPoolWhitelists() {
        ListPreferenceResponse portfolio = service.save("U1", "W1", "portfolio",
                request("table", Arrays.asList("name", "health", "overdue", "weekWorkMinutes")));
        assertEquals("table", portfolio.getViewMode());
        assertEquals(Arrays.asList("name", "health", "overdue", "weekWorkMinutes"), portfolio.getColumns());

        ListPreferenceResponse pool = service.save("U1", "W1", "demand-pool",
                request("board", Arrays.asList("title", "status", "wsjf")));
        assertEquals("board", pool.getViewMode());
        assertEquals(Arrays.asList("title", "status", "wsjf"), pool.getColumns());
    }

    @Test
    void rejectsModesAndColumnsOutsidePortfolioAndDemandPoolRules() {
        assertBadRequest(() -> service.save("U1", "W1", "portfolio",
                request("board", Collections.singletonList("name"))));
        assertBadRequest(() -> service.save("U1", "W1", "demand-pool",
                request("card", Collections.singletonList("title"))));
        assertBadRequest(() -> service.save("U1", "W1", "portfolio",
                request("table", Collections.singletonList("title"))));
        assertBadRequest(() -> service.save("U1", "W1", "demand-pool",
                request("table", Arrays.asList("status", "title"))));
        assertBadRequest(() -> service.save("U1", "W1", "demand-pool",
                request("table", Arrays.asList("title", "taskCount"))));
    }

    @Test
    void acceptsProjectViewWhitelistInBoardAndDrillModes() {
        List<String> columns = Arrays.asList("name", "status", "health", "total", "backlog", "doing",
                "done", "overdue", "progress", "owner", "dueDate", "estimate", "actual");

        ListPreferenceResponse board = service.save("U1", "W1", "project-view", request("board", columns));
        assertEquals("board", board.getViewMode());
        assertEquals(columns, board.getColumns());

        ListPreferenceResponse drill = service.save("U1", "W1", "project-view",
                request("drill", Arrays.asList("name", "status", "progress")));
        assertEquals("drill", drill.getViewMode());

        assertBadRequest(() -> service.save("U1", "W1", "project-view",
                request("table", Collections.singletonList("name"))));
        assertBadRequest(() -> service.save("U1", "W1", "project-view",
                request("board", Arrays.asList("name", "members"))));
    }

    private ListPreferenceRequest request(String viewMode, List<String> columns) {
        ListPreferenceRequest req = new ListPreferenceRequest();
        req.setViewMode(viewMode);
        req.setColumns(columns);
        return req;
    }

    private AppException assertBadRequest(Runnable action) {
        AppException error = assertThrows(AppException.class, action::run);
        assertEquals(400, error.getCode());
        return error;
    }
}
