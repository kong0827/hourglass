package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.ReleaseAccessScopeDto;
import com.hourglass.mapper.WorkspaceMapper;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ReleaseAccessScopeServiceTest {
    private final WorkspaceMapper workspaces = mock(WorkspaceMapper.class);
    private final ActivityService activity = mock(ActivityService.class);
    private final ReleaseAccessScopeService service = new ReleaseAccessScopeService(workspaces, activity);

    @Test
    void nullAndBlankValuesFallBackToManagerDefaults() {
        List<String> defaults = Arrays.asList(ReleaseAccessScopeService.SCOPE_OWNER,
                ReleaseAccessScopeService.SCOPE_ADMIN, ReleaseAccessScopeService.SCOPE_PROJECT_OWNER);
        assertEquals(defaults, ReleaseAccessScopeService.parse(null));
        assertEquals(defaults, ReleaseAccessScopeService.parse(""));
        assertEquals(defaults, ReleaseAccessScopeService.parse(" , "));
    }

    @Test
    void parseIgnoresUnknownTokensAndKeepsCanonicalOrder() {
        assertEquals(Arrays.asList(ReleaseAccessScopeService.SCOPE_OWNER, ReleaseAccessScopeService.SCOPE_PROJECT_WRITE),
                ReleaseAccessScopeService.parse("project_write,bogus,owner"));
    }

    @Test
    void normalizeRejectsMissingEmptyAndUnknownSelections() {
        assertEquals(400, assertThrows(AppException.class,
                () -> ReleaseAccessScopeService.normalize(null)).getCode());
        assertEquals(400, assertThrows(AppException.class,
                () -> ReleaseAccessScopeService.normalize(Collections.<String>emptyList())).getCode());
        assertEquals(400, assertThrows(AppException.class,
                () -> ReleaseAccessScopeService.normalize(Arrays.asList("bogus"))).getCode());
    }

    @Test
    void normalizeDedupesAndOrdersSelections() {
        assertEquals(Arrays.asList(ReleaseAccessScopeService.SCOPE_OWNER, ReleaseAccessScopeService.SCOPE_PROJECT_WRITE),
                ReleaseAccessScopeService.normalize(Arrays.asList("project_write", "owner", "project_write")));
    }

    @Test
    void saveSkipsWriteAndAuditWhenSelectionUnchanged() {
        when(workspaces.selectReleaseAccessScope("W")).thenReturn("owner,admin,project_owner");

        service.save("W", Arrays.asList("project_owner", "admin", "owner"), "U1");

        verify(workspaces, never()).updateReleaseAccessScope(anyString(), anyString());
        verify(activity, never()).logConfig(anyString(), anyString(), anyString());
    }

    @Test
    void saveEncodesSelectionAndLeavesAuditTrail() {
        when(workspaces.selectReleaseAccessScope("W")).thenReturn(null);

        service.save("W", Arrays.asList("project_write", "owner"), "U1");

        verify(workspaces).updateReleaseAccessScope("W", "owner,project_write");
        verify(activity).logConfig(eq("W"), eq("U1"),
                eq("更新发布维护权限：空间主、管理员、项目负责人 → 空间主、项目可写成员"));
    }

    @Test
    void viewExposesAllOptionsWithCurrentSelection() {
        when(workspaces.selectReleaseAccessScope("W")).thenReturn(null);

        ReleaseAccessScopeDto view = service.view("W");

        assertEquals(Arrays.asList(ReleaseAccessScopeService.SCOPE_OWNER,
                ReleaseAccessScopeService.SCOPE_ADMIN, ReleaseAccessScopeService.SCOPE_PROJECT_OWNER), view.getSelected());
        assertEquals(4, view.getOptions().size());
        assertEquals("项目可写成员", view.getOptions().get(3).getLabel());
        assertTrue(view.getOptions().get(3).getDescription().contains("最宽松"));
    }

    @Test
    void publicationSaveWritesOwnColumnAndAudit() {
        when(workspaces.selectPublicationAccessScope("W")).thenReturn(null);

        service.savePublication("W", Arrays.asList("project_write", "owner"), "U1");

        verify(workspaces).updatePublicationAccessScope("W", "owner,project_write");
        verify(activity).logConfig(eq("W"), eq("U1"),
                eq("更新人工标记发布权限：空间主、管理员、项目负责人 → 空间主、项目可写成员"));
        verify(workspaces, never()).updateReleaseAccessScope(anyString(), anyString());
    }

    @Test
    void publicationSaveSkipsWriteWhenUnchanged() {
        when(workspaces.selectPublicationAccessScope("W")).thenReturn("owner,admin,project_owner");

        service.savePublication("W", Arrays.asList("project_owner", "admin", "owner"), "U1");

        verify(workspaces, never()).updatePublicationAccessScope(anyString(), anyString());
        verify(activity, never()).logConfig(anyString(), anyString(), anyString());
    }

    @Test
    void publicationViewUsesMarkDescriptions() {
        when(workspaces.selectPublicationAccessScope("W")).thenReturn(null);

        ReleaseAccessScopeDto view = service.viewPublication("W");

        assertEquals(Arrays.asList(ReleaseAccessScopeService.SCOPE_OWNER,
                ReleaseAccessScopeService.SCOPE_ADMIN, ReleaseAccessScopeService.SCOPE_PROJECT_OWNER), view.getSelected());
        assertTrue(view.getOptions().get(0).getDescription().contains("标记"));
        assertTrue(view.getOptions().get(3).getDescription().contains("标记"));
    }

    @Test
    void normalizeNamesTheConfiguredScopeInErrors() {
        AppException unknown = assertThrows(AppException.class,
                () -> ReleaseAccessScopeService.normalize(Arrays.asList("bogus"), "人工标记工作项发布"));
        assertTrue(unknown.getMessage().contains("人工标记工作项发布"));
        AppException empty = assertThrows(AppException.class,
                () -> ReleaseAccessScopeService.normalize(Collections.<String>emptyList(), "人工标记工作项发布"));
        assertTrue(empty.getMessage().contains("人工标记工作项发布"));
    }
}
