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
    private final WorkspaceMapper workspaces = mock(WorkspaceMapper.class);
    private final ReleaseAccessScopeService scopes =
            new ReleaseAccessScopeService(workspaces, mock(ActivityService.class));
    private final ReleasePermissionService service = new ReleasePermissionService(members, projects, access, scopes);
    @ParameterizedTest @ValueSource(strings = {"owner", "admin"})
    void onlyPrivilegedMembersOrWritableProjectOwnerManage(String role) {
        member(role); writableProject();
        assertTrue(service.canManageProject("U", "W", "P")); current(role, null, "O");
        assertDoesNotThrow(() -> service.assertManageProjectForUpdate("U", "W", "P"));
    }
    @Test void writableMemberNeedsScopeBeforeTouchingRelease() {
        member("member"); writableProject(); current("member", null, "O");
        assertFalse(service.canManageRelease("U", "W", "P"), "默认只放开空间主/管理员/项目负责人，项目可写成员不在其中");
        AppException restricted = assertThrows(AppException.class, () -> service.assertManageRelease("U", "W", "P"));
        assertEquals(403, restricted.getCode());
        assertTrue(restricted.getMessage().contains("设置 → 工作流 → 发布权限"), "有写权限但不在配置范围时，应提示去设置里勾选身份");
        assertEquals(403, assertThrows(AppException.class,
                () -> service.assertManageReleaseForUpdate("U", "W", "P")).getCode());

        scope("owner,admin,project_owner,project_write");
        assertTrue(service.canManageRelease("U", "W", "P"), "勾选项目可写成员后即可维护发布");
        assertFalse(service.canManageProject("U", "W", "P"), "发布权限放宽不影响项目级管理");
        assertDoesNotThrow(() -> service.assertManageRelease("U", "W", "P"));
        assertDoesNotThrow(() -> service.assertManageReleaseForUpdate("U", "W", "P"));
    }
    @ParameterizedTest @ValueSource(strings = {"owner", "admin"})
    void defaultScopeKeepsPrivilegedRolesOnRelease(String role) {
        member(role);
        assertTrue(service.canManageRelease("U", "W", "P"), "空间主/管理员默认可维护发布，不依赖项目写权限配置");
        current(role, null, "U");
        assertDoesNotThrow(() -> service.assertManageReleaseForUpdate("U", "W", "P"));
    }
    @Test void projectOwnerScopeRequiresOwnership() {
        member("member"); writableProject(); scope("owner,admin,project_owner");
        Requirement project = new Requirement();
        project.setWorkspaceId("W"); project.setOwnerUserId("U");
        when(projects.selectById("P")).thenReturn(project);
        assertTrue(service.canManageRelease("U", "W", "P"));

        project.setOwnerUserId("OTHER");
        assertFalse(service.canManageRelease("U", "W", "P"), "项目负责人身份只看当前负责人");

        current("member", null, "OTHER");
        assertEquals(403, assertThrows(AppException.class,
                () -> service.assertManageReleaseForUpdate("U", "W", "P")).getCode());
    }
    @Test void readViewerAndTestOnlyMembersCannotManageRelease() {
        member("member");
        assertFalse(service.canManageRelease("U", "W", "P"));
        assertEquals(403, assertThrows(AppException.class, () -> service.assertManageRelease("U", "W", "P")).getCode());
        current("member", "read", "U");
        assertEquals(403, assertThrows(AppException.class, () -> service.assertManageReleaseForUpdate("U", "W", "P")).getCode());
        current("member", "test", "U");
        AppException testOnly = assertThrows(AppException.class, () -> service.assertManageReleaseForUpdate("U", "W", "P"));
        assertEquals(403, testOnly.getCode());
        assertTrue(testOnly.getMessage().contains("测试权限"));
        current("viewer", null, "U");
        assertEquals(403, assertThrows(AppException.class, () -> service.assertManageReleaseForUpdate("U", "W", "P")).getCode());
        member("viewer");
        AppException viewer = assertThrows(AppException.class, () -> service.assertManageRelease("U", "W", "P"));
        assertEquals(403, viewer.getCode());
        assertTrue(viewer.getMessage().contains("查看者"), "查看者应得到只读说明，而不是笼统的写权限提示");
    }
    @Test void lockedRoleRevocationOverridesStaleAdmin() {
        member("admin"); writableProject(); assertTrue(service.canManageProject("U", "W", "P"));
        current("viewer", null, "U"); assertEquals(403, assertThrows(AppException.class, () -> service.assertManageProjectForUpdate("U", "W", "P")).getCode());
        when(members.selectDeliveryAccessForUpdate("W", "U", "P")).thenReturn(null);
        assertEquals(404, assertThrows(AppException.class, () -> service.assertManageProjectForUpdate("U", "W", "P")).getCode());
    }
    @ParameterizedTest @ValueSource(strings = {"read", "none"})
    void projectRestrictionsOverrideProjectOwner(String grant) {
        current("member", grant, "U"); assertEquals(grant.equals("none") ? 404 : 403,
                assertThrows(AppException.class, () -> service.assertManageProjectForUpdate("U", "W", "P")).getCode());
    }
    @Test void unknownScopeTokensAreIgnoredAndEmptyFallsBackToDefault() {
        member("member"); writableProject();
        scope("owner,bogus,project_write");
        assertTrue(service.canManageRelease("U", "W", "P"), "未知项忽略，已知项照常生效");
        scope("bogus");
        assertFalse(service.canManageRelease("U", "W", "P"), "全部无效时回落默认口径，项目可写成员仍无权");
        member("admin");
        assertTrue(service.canManageRelease("U", "W", "P"), "回落默认口径保留管理员");
    }
    @Test void publicationScopeIsIndependentFromReleaseScope() {
        member("member"); writableProject(); scope("owner,admin,project_owner,project_write");
        assertTrue(service.canManageRelease("U", "W", "P"));
        assertFalse(service.canJudgePublication("U", "W", "P"), "发布维护放开项目可写成员，不自动放开人工标记");
        AppException restricted = assertThrows(AppException.class, () -> service.assertJudgePublication("U", "W", "P"));
        assertEquals(403, restricted.getCode());
        assertTrue(restricted.getMessage().contains("人工标记工作项发布"));

        pubScope("owner,admin,project_owner,project_write");
        assertTrue(service.canJudgePublication("U", "W", "P"));
        assertDoesNotThrow(() -> service.assertJudgePublication("U", "W", "P"));
    }

    @Test void publicationDefaultsKeepProjectOwnerAndRejectPlainWritableMember() {
        member("member"); writableProject();
        assertFalse(service.canJudgePublication("U", "W", "P"), "默认口径不含项目可写成员");
        Requirement project = new Requirement();
        project.setWorkspaceId("W"); project.setOwnerUserId("U");
        when(projects.selectById("P")).thenReturn(project);
        assertTrue(service.canJudgePublication("U", "W", "P"), "默认口径包含项目负责人");
    }

    @Test void markJudgeableCachesByProjectAndFlagsEachTask() {
        member("member"); writableProject();
        Requirement mine = new Requirement();
        mine.setWorkspaceId("W"); mine.setOwnerUserId("U");
        Requirement other = new Requirement();
        other.setWorkspaceId("W"); other.setOwnerUserId("OTHER");
        when(projects.selectById("P")).thenReturn(mine);
        when(projects.selectById("Q")).thenReturn(other);

        Task first = task("t1", "P"), second = task("t2", "P"), third = task("t3", "Q");
        service.markJudgeable("U", "W", Arrays.asList(first, second, third));

        assertTrue(first.getCanJudgePublication());
        assertTrue(second.getCanJudgePublication());
        assertFalse(third.getCanJudgePublication());
        verify(projects, times(1)).selectById("P");
    }

    @Test void markJudgeableLeavesViewerWithoutEntry() {
        member("viewer");
        Task task = task("t1", "P");
        service.markJudgeable("U", "W", Collections.singletonList(task));
        assertFalse(task.getCanJudgePublication());
    }

    private Task task(String id, String reqId) {
        Task t = new Task(); t.setId(id); t.setReqId(reqId); return t;
    }

    private void member(String role) { WorkspaceMember m = new WorkspaceMember(); m.setRole(role); when(members.selectMember("W", "U")).thenReturn(m); }
    private void writableProject() {
        when(access.canWrite(any(WorkspaceMember.class), eq("W"), eq("P"))).thenReturn(true);
    }
    private void scope(String value) { when(workspaces.selectReleaseAccessScope("W")).thenReturn(value); }
    private void pubScope(String value) { when(workspaces.selectPublicationAccessScope("W")).thenReturn(value); }
    private void current(String role, String grant, String owner) {
        Map<String, Object> m = new HashMap<String, Object>(); m.put("role", role); m.put("access", grant); m.put("projectOwnerUserId", owner);
        when(members.selectDeliveryAccessForUpdate("W", "U", "P")).thenReturn(m);
    }
}
