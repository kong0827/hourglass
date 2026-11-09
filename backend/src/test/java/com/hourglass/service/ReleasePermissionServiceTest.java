package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.entity.*;
import com.hourglass.mapper.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ReleasePermissionServiceTest {
    private final WorkspaceMemberMapper members = mock(WorkspaceMemberMapper.class);
    private final RequirementMapper projects = mock(RequirementMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final ReleasePermissionService service = new ReleasePermissionService(members, projects, access);
    @ParameterizedTest @ValueSource(strings = {"owner", "admin"})
    void onlyPrivilegedMembersOrWritableProjectOwnerManage(String role) {
        member(role); when(access.canWrite("W", "U", "P")).thenReturn(true);
        assertTrue(service.canManageProject("U", "W", "P")); current(role, null, "O");
        assertDoesNotThrow(() -> service.assertManageProjectForUpdate("U", "W", "P"));
        assertFalse(service.canPublishTask("U", "W", task()));
    }
    @Test void taskOwnerAndPlanOwnerMetadataDoNotGrantVersionAuthority() {
        member("member"); when(access.canWrite("W", "U", "P")).thenReturn(true);
        current("member", null, "O"); ProjectVersion version = version();
        assertFalse(service.canPublishVersion("U", "W", version, Collections.singletonList(task())));
        assertEquals(403, assertThrows(AppException.class, () -> service.assertPublishVersionForUpdate("U", "W", version, Collections.singletonList(task()))).getCode());
        assertFalse(service.canPublishTask("U", "W", task()));
    }
    @Test void lockedRoleRevocationOverridesStaleAdmin() {
        member("admin"); when(access.canWrite("W", "U", "P")).thenReturn(true); assertTrue(service.canManageProject("U", "W", "P"));
        current("viewer", null, "U"); assertEquals(403, assertThrows(AppException.class, () -> service.assertManageProjectForUpdate("U", "W", "P")).getCode());
        when(members.selectDeliveryAccessForUpdate("W", "U", "P")).thenReturn(null);
        assertEquals(404, assertThrows(AppException.class, () -> service.assertManageProjectForUpdate("U", "W", "P")).getCode());
    }
    @ParameterizedTest @ValueSource(strings = {"read", "none"})
    void projectRestrictionsOverrideProjectOwner(String grant) {
        current("member", grant, "U"); assertEquals(grant.equals("none") ? 404 : 403,
                assertThrows(AppException.class, () -> service.assertManageProjectForUpdate("U", "W", "P")).getCode());
    }
    @Test void currentProjectOwnerIsAuthorizedWithoutTaskOwnership() {
        current("member", null, "U"); assertDoesNotThrow(() -> service.assertPublishVersionForUpdate("U", "W", version(), Collections.emptyList()));
        assertFalse(service.canPublishTask("U", "W", task()));
    }
    private void member(String role) { WorkspaceMember m = new WorkspaceMember(); m.setRole(role); when(members.selectMember("W", "U")).thenReturn(m); }
    private void current(String role, String grant, String owner) {
        Map<String, Object> m = new HashMap<String, Object>(); m.put("role", role); m.put("access", grant); m.put("projectOwnerUserId", owner);
        when(members.selectDeliveryAccessForUpdate("W", "U", "P")).thenReturn(m);
    }
    private Task task() { Task t = new Task(); t.setId("T"); t.setReqId("P"); t.setWorkspaceId("W"); t.setOwnerUserId("U"); return t; }
    private ProjectVersion version() { ProjectVersion v = new ProjectVersion(); v.setReqId("P"); v.setWorkspaceId("W"); return v; }
}
