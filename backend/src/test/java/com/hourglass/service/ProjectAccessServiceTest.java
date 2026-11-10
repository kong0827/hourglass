package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.entity.ProjectMember;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.ProjectMemberMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

class ProjectAccessServiceTest {

    private static final String WS = "W1";

    private final ProjectMemberMapper grants = mock(ProjectMemberMapper.class);
    private final WorkspaceMemberMapper members = mock(WorkspaceMemberMapper.class);
    private final ProjectAccessService service = new ProjectAccessService(grants, members);

    @Test
    void viewerSeesEverythingButCannotWrite() {
        member("U1", ProjectAccessService.ROLE_VIEWER);

        assertTrue(service.canView(WS, "U1", "R1"));
        assertFalse(service.canWrite(WS, "U1", "R1"));

        AppException error = assertThrows(AppException.class, () -> service.assertWrite(WS, "U1", null));
        assertEquals(403, error.getCode());
        verify(grants, never()).selectOne(anyString(), anyString(), anyString());
    }

    @Test
    void memberWithoutGrantDefaultsToParticipate() {
        member("U2", ProjectAccessService.ROLE_MEMBER);
        when(grants.selectOne(WS, "R1", "U2")).thenReturn(null);

        assertTrue(service.canView(WS, "U2", "R1"));
        assertTrue(service.canWrite(WS, "U2", "R1"));
    }

    @Test
    void memberWithNoneGrantTreatsProjectAsMissing() {
        member("U2", ProjectAccessService.ROLE_MEMBER);
        when(grants.selectOne(WS, "R1", "U2")).thenReturn(grant("R1", "U2", ProjectAccessService.ACCESS_NONE));
        when(grants.selectByUser(WS, "U2")).thenReturn(Arrays.asList(
                grant("R1", "U2", ProjectAccessService.ACCESS_NONE),
                grant("R2", "U2", ProjectAccessService.ACCESS_READ)));

        assertFalse(service.canView(WS, "U2", "R1"));
        assertEquals(Collections.singleton("R1"), service.hiddenProjectIds(WS, "U2"));

        AppException error = assertThrows(AppException.class, () -> service.assertView(WS, "U2", "R1"));
        assertEquals(404, error.getCode(), "不可见项目按不存在处理，避免泄露项目是否存在");

        AppException writeError = assertThrows(AppException.class, () -> service.assertWrite(WS, "U2", "R1"));
        assertEquals(404, writeError.getCode(), "写入口径与读一致：不能靠 403 反推项目存在");
    }

    @Test
    void readGrantKeepsViewButBlocksWrite() {
        member("U2", ProjectAccessService.ROLE_MEMBER);
        when(grants.selectOne(WS, "R1", "U2")).thenReturn(grant("R1", "U2", ProjectAccessService.ACCESS_READ));

        assertTrue(service.canView(WS, "U2", "R1"));
        assertFalse(service.canWrite(WS, "U2", "R1"));

        AppException error = assertThrows(AppException.class, () -> service.assertWrite(WS, "U2", "R1"));
        assertEquals(403, error.getCode());
    }

    @Test
    void privilegedRolesIgnoreExplicitNoneAndKeepFullLists() {
        member("U3", ProjectAccessService.ROLE_OWNER);
        when(grants.selectByUser(WS, "U3"))
                .thenReturn(Collections.singletonList(grant("R1", "U3", ProjectAccessService.ACCESS_NONE)));

        assertTrue(service.canView(WS, "U3", "R1"));
        assertTrue(service.canWrite(WS, "U3", "R1"));
        assertTrue(service.hiddenProjectIds(WS, "U3").isEmpty());
        verify(grants, never()).selectByUser(WS, "U3");
    }

    @Test
    void saveGrantNormalizesLegacyRolesAndDefaultToRemoval() {
        service.saveGrant(WS, "U2", "R1", ProjectAccessService.ACCESS_DEV);
        service.saveGrant(WS, "U2", "R1", "pm");
        service.saveGrant(WS, "U2", "R1", " default ");

        verify(grants, times(3)).deleteOne(WS, "R1", "U2");
        verify(grants, never()).upsert(org.mockito.ArgumentMatchers.any(ProjectMember.class));
    }

    @Test
    void saveGrantPersistsSupportedAccess() {
        service.saveGrant(WS, "U2", "R1", ProjectAccessService.ACCESS_NONE);

        org.mockito.ArgumentCaptor<ProjectMember> saved =
                org.mockito.ArgumentCaptor.forClass(ProjectMember.class);
        verify(grants).upsert(saved.capture());
        assertEquals(WS, saved.getValue().getWorkspaceId());
        assertEquals("R1", saved.getValue().getProjectId());
        assertEquals("U2", saved.getValue().getUserId());
        assertEquals(ProjectAccessService.ACCESS_NONE, saved.getValue().getAccess());
    }

    @Test
    void saveGrantRejectsUnknownValue() {
        AppException error = assertThrows(AppException.class,
                () -> service.saveGrant(WS, "U2", "R1", "superuser"));
        assertEquals(400, error.getCode());
        verify(grants, never()).upsert(org.mockito.ArgumentMatchers.any(ProjectMember.class));
    }

    @Test
    void normalizeAccessCollapsesLegacyAndDefaultValues() {
        assertEquals("", ProjectAccessService.normalizeAccess(null));
        assertEquals("", ProjectAccessService.normalizeAccess("  "));
        assertEquals("", ProjectAccessService.normalizeAccess("DEFAULT"));
        assertEquals("", ProjectAccessService.normalizeAccess("pm"));
        assertEquals("", ProjectAccessService.normalizeAccess("dev"));
        assertEquals("", ProjectAccessService.normalizeAccess("qa"));
        assertEquals(ProjectAccessService.ACCESS_READ, ProjectAccessService.normalizeAccess(" READ "));
        assertEquals(ProjectAccessService.ACCESS_NONE, ProjectAccessService.normalizeAccess("none"));
    }

    @Test
    void filterVisibleMembersMatchesCanViewWithoutPerMemberQueries() {
        WorkspaceMember owner = rawMember("U9", ProjectAccessService.ROLE_OWNER);
        WorkspaceMember viewer = rawMember("U8", ProjectAccessService.ROLE_VIEWER);
        WorkspaceMember hidden = rawMember("U2", ProjectAccessService.ROLE_MEMBER);
        WorkspaceMember plain = rawMember("U3", ProjectAccessService.ROLE_MEMBER);
        when(grants.selectByWorkspace(WS))
                .thenReturn(Collections.singletonList(grant("R1", "U2", ProjectAccessService.ACCESS_NONE)));

        java.util.List<WorkspaceMember> visible = service.filterVisibleMembers(WS,
                Arrays.asList(owner, viewer, hidden, plain), "R1");

        assertEquals(3, visible.size());
        assertEquals("U9", visible.get(0).getUserId());
        assertEquals("U8", visible.get(1).getUserId());
        assertEquals("U3", visible.get(2).getUserId());
        verify(grants, times(1)).selectByWorkspace(WS);
        verify(members, never()).selectMember(anyString(), anyString());
    }

    @Test
    void filterVisibleMembersKeepsAllWhenTaskHasNoProject() {
        WorkspaceMember owner = rawMember("U9", ProjectAccessService.ROLE_OWNER);
        WorkspaceMember hidden = rawMember("U2", ProjectAccessService.ROLE_MEMBER);
        when(grants.selectByWorkspace(WS))
                .thenReturn(Collections.singletonList(grant("R1", "U2", ProjectAccessService.ACCESS_NONE)));

        java.util.List<WorkspaceMember> visible = service.filterVisibleMembers(WS,
                Arrays.asList(owner, hidden), null);

        assertEquals(2, visible.size());
        verify(grants, never()).selectByWorkspace(WS);
    }

    @ParameterizedTest
    @CsvSource({
            "owner,viewer,,403", "admin,viewer,none,403",
            "owner,member,read,403", "admin,member,read,403",
            "owner,member,none,404", "admin,member,none,404",
            "owner,,,404", "admin,,,404"
    })
    void currentWriteSnapshotOverridesStalePrivilegedOrdinaryReads(
            String staleRole, String currentRole, String access, int code) {
        member("U1", staleRole);
        assertDoesNotThrow(() -> service.assertWrite(WS, "U1", "R1"));
        currentSnapshot("R1", currentRole, access);
        clearInvocations(members, grants);

        assertEquals(code, assertThrows(AppException.class,
                () -> service.assertWriteForUpdate(WS, "U1", "R1")).getCode());
        verify(members).selectDeliveryAccessForUpdate(WS, "U1", "R1");
        verifyNoMoreInteractions(members);
        verifyNoInteractions(grants);
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"default", "pm", "dev", "qa"})
    void currentDefaultAndLegacyGrantsAllowOrdinaryNonOwnerWriter(String access) {
        member("U1", "member");
        when(grants.selectOne(WS, "R1", "U1")).thenReturn(grant("R1", "U1", "read"));
        assertFalse(service.canWrite(WS, "U1", "R1"));
        currentSnapshot("R1", "member", access);
        clearInvocations(members, grants);

        assertDoesNotThrow(() -> service.assertWriteForUpdate(WS, "U1", "R1"));
        verify(members).selectDeliveryAccessForUpdate(WS, "U1", "R1");
        verifyNoMoreInteractions(members);
        verifyNoInteractions(grants);
    }

    @ParameterizedTest
    @CsvSource({"owner,read", "owner,none", "admin,read", "admin,none"})
    void currentPrivilegedWriteSnapshotIgnoresProjectRestrictions(String role, String access) {
        currentSnapshot("R1", role, access);
        assertDoesNotThrow(() -> service.assertWriteForUpdate(WS, "U1", "R1"));
        verify(members).selectDeliveryAccessForUpdate(WS, "U1", "R1");
        verifyNoMoreInteractions(members);
        verifyNoInteractions(grants);
    }

    @ParameterizedTest
    @CsvSource({"viewer,403", ",404"})
    void uncategorizedCurrentWriteStillDeniesViewerAndRemovedMember(String role, int code) {
        member("U1", "admin");
        assertDoesNotThrow(() -> service.assertWrite(WS, "U1", null));
        currentSnapshot(null, role, null);
        clearInvocations(members, grants);

        assertEquals(code, assertThrows(AppException.class,
                () -> service.assertWriteForUpdate(WS, "U1", null)).getCode());
        verify(members).selectDeliveryAccessForUpdate(WS, "U1", null);
        verifyNoMoreInteractions(members);
        verifyNoInteractions(grants);
    }

    @ParameterizedTest
    @ValueSource(strings = {"owner", "admin", "member"})
    void uncategorizedCurrentWriteAllowsWritableMembers(String role) {
        currentSnapshot(null, role, null);
        assertDoesNotThrow(() -> service.assertWriteForUpdate(WS, "U1", null));
        verify(members).selectDeliveryAccessForUpdate(WS, "U1", null);
        verifyNoMoreInteractions(members);
        verifyNoInteractions(grants);
    }

    @Test
    void currentWriteDoesNotDefaultMissingRoleOrAnonymousUserToWriter() {
        when(members.selectDeliveryAccessForUpdate(WS, "U1", "R1"))
                .thenReturn(Collections.<String, Object>singletonMap("access", "dev"));
        assertEquals(404, assertThrows(AppException.class,
                () -> service.assertWriteForUpdate(WS, "U1", "R1")).getCode());
        assertEquals(404, assertThrows(AppException.class,
                () -> service.assertWriteForUpdate(WS, null, null)).getCode());
    }

    @ParameterizedTest
    @CsvSource({
            "owner,member,false", "admin,member,false", "member,owner,true", "member,admin,true",
            "owner,viewer,false", "admin,,false"
    })
    void currentForcePrivilegeIgnoresStaleRole(String staleRole, String currentRole, boolean allowed) {
        member("U1", staleRole);
        currentSnapshot(null, currentRole, null);
        assertEquals(allowed, service.canManageForUpdate(WS, "U1"));
        verify(members).selectDeliveryAccessForUpdate(WS, "U1", null);
        verifyNoMoreInteractions(members);
        verifyNoInteractions(grants);
    }

    @Test
    void ordinaryAccessChecksDoNotAcquireDeliveryPermissionLocks() {
        member("U1", "admin");
        assertTrue(service.canWrite(WS, "U1", "R1"));
        assertTrue(service.canManage(WS, "U1"));
        service.assertWrite(WS, "U1", "R1");
        verify(members, never()).selectDeliveryAccessForUpdate(anyString(), anyString(),
                org.mockito.ArgumentMatchers.any());
    }

    @Test
    void assignedMemberWithoutGrantSeesNothingAndCannotWrite() {
        memberWithMode("U4", ProjectAccessService.ROLE_MEMBER, ProjectAccessService.MODE_ASSIGNED);
        when(grants.selectOne(WS, "R1", "U4")).thenReturn(null);

        assertEquals(ProjectAccessService.ACCESS_NONE, service.effectiveAccess(WS, "R1",
                rawMember("U4", ProjectAccessService.ROLE_MEMBER, ProjectAccessService.MODE_ASSIGNED)));
        assertFalse(service.canView(WS, "U4", "R1"));
        assertFalse(service.canWrite(WS, "U4", "R1"));
        assertEquals(404, assertThrows(AppException.class, () -> service.assertView(WS, "U4", "R1")).getCode());
        assertEquals(404, assertThrows(AppException.class, () -> service.assertWrite(WS, "U4", "R1")).getCode());
    }

    @Test
    void assignedMemberExplicitGrantWorksLikeOrdinaryMember() {
        memberWithMode("U4", ProjectAccessService.ROLE_MEMBER, ProjectAccessService.MODE_ASSIGNED);
        when(grants.selectOne(WS, "R1", "U4"))
                .thenReturn(grant("R1", "U4", ProjectAccessService.ACCESS_WRITE));
        when(grants.selectOne(WS, "R2", "U4"))
                .thenReturn(grant("R2", "U4", ProjectAccessService.ACCESS_READ));

        assertTrue(service.canView(WS, "U4", "R1"));
        assertTrue(service.canWrite(WS, "U4", "R1"));
        assertTrue(service.canView(WS, "U4", "R2"));
        assertFalse(service.canWrite(WS, "U4", "R2"));
    }

    @Test
    void saveGrantOnAssignedMemberFallsBackToNoneInsteadOfRemoving() {
        memberWithMode("U4", ProjectAccessService.ROLE_MEMBER, ProjectAccessService.MODE_ASSIGNED);

        assertEquals(ProjectAccessService.ACCESS_NONE, service.saveGrant(WS, "U4", "R1", "default"));

        org.mockito.ArgumentCaptor<ProjectMember> saved =
                org.mockito.ArgumentCaptor.forClass(ProjectMember.class);
        verify(grants).upsert(saved.capture());
        assertEquals(ProjectAccessService.ACCESS_NONE, saved.getValue().getAccess());
        verify(grants, never()).deleteOne(anyString(), anyString(), anyString());
    }

    @Test
    void saveGrantWritesExplicitWriteForAssignedMember() {
        memberWithMode("U4", ProjectAccessService.ROLE_MEMBER, ProjectAccessService.MODE_ASSIGNED);
        assertEquals(ProjectAccessService.ACCESS_WRITE, service.saveGrant(WS, "U4", "R1", " WRITE "));

        org.mockito.ArgumentCaptor<ProjectMember> saved =
                org.mockito.ArgumentCaptor.forClass(ProjectMember.class);
        verify(grants).upsert(saved.capture());
        assertEquals(ProjectAccessService.ACCESS_WRITE, saved.getValue().getAccess());
    }

    @Test
    void saveGrantDropsRedundantWriteRowForLegacyMember() {
        memberWithMode("U3", ProjectAccessService.ROLE_MEMBER, ProjectAccessService.MODE_ALL);
        assertEquals("", service.saveGrant(WS, "U3", "R1", "write"));
        verify(grants).deleteOne(WS, "R1", "U3");
        verify(grants, never()).upsert(any(ProjectMember.class));
    }

    @Test
    void saveMemberGrantsReportsOnlyEffectiveChanges() {
        WorkspaceMember legacy = rawMember("U3", ProjectAccessService.ROLE_MEMBER, ProjectAccessService.MODE_ALL);
        when(members.selectMember(WS, "U3")).thenReturn(legacy);
        when(grants.selectOne(WS, "R2", "U3"))
                .thenReturn(grant("R2", "U3", ProjectAccessService.ACCESS_NONE));
        Map<String, String> wanted = new java.util.LinkedHashMap<String, String>();
        wanted.put("R1", "write");   /* 缺记录 = 可参与：不算变化 */
        wanted.put("R2", "");        /* none → 默认参与：变化为 write */
        wanted.put("R3", "read");    /* 可参与 → 只读：变化 */

        Map<String, String> changed = service.saveMemberGrants(WS, legacy, wanted);

        assertEquals(2, changed.size());
        assertEquals(ProjectAccessService.ACCESS_WRITE, changed.get("R2"));
        assertEquals(ProjectAccessService.ACCESS_READ, changed.get("R3"));
        assertEquals(Arrays.asList("R2", "R3"), new java.util.ArrayList<String>(changed.keySet()));
    }

    @Test
    void effectiveOfFollowsMemberMode() {
        assertEquals(ProjectAccessService.ACCESS_WRITE, ProjectAccessService.effectiveOf("",
                rawMember("U3", ProjectAccessService.ROLE_MEMBER, ProjectAccessService.MODE_ALL)));
        assertEquals(ProjectAccessService.ACCESS_NONE, ProjectAccessService.effectiveOf("",
                rawMember("U4", ProjectAccessService.ROLE_MEMBER, ProjectAccessService.MODE_ASSIGNED)));
        assertEquals(ProjectAccessService.ACCESS_READ, ProjectAccessService.effectiveOf("read", null));
    }

    @Test
    void seedAssignedNoneDelegatesToMapper() {
        service.seedAssignedNone(WS);
        verify(grants).seedAssignedNone(WS);
    }

    @Test
    void assignedMemberMissingGrantIsMarkedReadOnlyInMyTasks() {
        when(members.selectMember(WS, "U4"))
                .thenReturn(rawMember("U4", ProjectAccessService.ROLE_MEMBER,
                        ProjectAccessService.MODE_ASSIGNED));
        com.hourglass.entity.Task hidden = new com.hourglass.entity.Task();
        hidden.setWorkspaceId(WS);
        hidden.setReqId("R1");
        com.hourglass.entity.Task granted = new com.hourglass.entity.Task();
        granted.setWorkspaceId(WS);
        granted.setReqId("R2");
        when(grants.selectByUser(WS, "U4"))
                .thenReturn(Collections.singletonList(grant("R2", "U4", ProjectAccessService.ACCESS_WRITE)));

        service.markWritable("U4", Arrays.asList(hidden, granted));

        assertEquals("read", hidden.getAccess());
        assertEquals("write", granted.getAccess());
    }

    @Test
    void legacyMemberMissingGrantStaysWritableInMyTasks() {
        when(members.selectMember(WS, "U3"))
                .thenReturn(rawMember("U3", ProjectAccessService.ROLE_MEMBER, ProjectAccessService.MODE_ALL));
        com.hourglass.entity.Task task = new com.hourglass.entity.Task();
        task.setWorkspaceId(WS);
        task.setReqId("R9");
        when(grants.selectByUser(WS, "U3")).thenReturn(Collections.<ProjectMember>emptyList());

        service.markWritable("U3", Collections.singletonList(task));

        assertEquals("write", task.getAccess());
    }

    @Test
    void filterVisibleMembersRequiresExplicitGrantForAssignedMembers() {
        WorkspaceMember assigned = rawMember("U4", ProjectAccessService.ROLE_MEMBER,
                ProjectAccessService.MODE_ASSIGNED);
        WorkspaceMember legacy = rawMember("U3", ProjectAccessService.ROLE_MEMBER,
                ProjectAccessService.MODE_ALL);
        when(grants.selectByWorkspace(WS))
                .thenReturn(Collections.singletonList(grant("R2", "U4", ProjectAccessService.ACCESS_WRITE)));

        java.util.List<WorkspaceMember> visible = service.filterVisibleMembers(WS,
                Arrays.asList(assigned, legacy), "R1");
        assertEquals(Collections.singletonList("U3"),
                Arrays.asList(visible.get(0).getUserId()));

        java.util.List<WorkspaceMember> visibleR2 = service.filterVisibleMembers(WS,
                Arrays.asList(assigned, legacy), "R2");
        assertEquals(2, visibleR2.size());
    }

    @Test
    void groupDigestHidesOnlyProjectsHiddenFromCurrentMembers() {
        when(members.selectByWorkspace(WS)).thenReturn(Arrays.asList(
                rawMember("U1", ProjectAccessService.ROLE_OWNER),
                rawMember("U2", ProjectAccessService.ROLE_MEMBER, ProjectAccessService.MODE_ASSIGNED),
                rawMember("U3", ProjectAccessService.ROLE_ADMIN, ProjectAccessService.MODE_ASSIGNED),
                rawMember("U4", ProjectAccessService.ROLE_VIEWER, ProjectAccessService.MODE_ASSIGNED)));
        when(grants.selectByWorkspace(WS)).thenReturn(Arrays.asList(
                grant("R1", "U2", ProjectAccessService.ACCESS_NONE),
                grant("R2", "U2", ProjectAccessService.ACCESS_WRITE),
                /* 升为 admin / 降为 viewer 后保留的历史 none 行：当前全量可见，不能把项目挡出群摘要 */
                grant("R2", "U3", ProjectAccessService.ACCESS_NONE),
                grant("R3", "U4", ProjectAccessService.ACCESS_NONE),
                /* 已离开空间的残留行同样不计入 */
                grant("R4", "U9", ProjectAccessService.ACCESS_NONE)));

        assertEquals(Collections.singleton("R1"), service.projectsHiddenFromAnyMember(WS));
    }

    private void memberWithMode(String userId, String role, String mode) {
        when(members.selectMember(WS, userId)).thenReturn(rawMember(userId, role, mode));
    }

    private void currentSnapshot(String projectId, String role, String access) {
        Map<String, Object> snapshot = null;
        if (role != null) {
            snapshot = new HashMap<String, Object>();
            snapshot.put("role", role);
            snapshot.put("access", access);
            snapshot.put("projectOwnerUserId", "U-other");
        }
        when(members.selectDeliveryAccessForUpdate(WS, "U1", projectId)).thenReturn(snapshot);
    }

    private WorkspaceMember rawMember(String userId, String role) {
        return rawMember(userId, role, null);
    }

    private WorkspaceMember rawMember(String userId, String role, String mode) {
        WorkspaceMember m = new WorkspaceMember();
        m.setWorkspaceId(WS);
        m.setUserId(userId);
        m.setRole(role);
        m.setProjectAccessMode(mode);
        return m;
    }

    private void member(String userId, String role) {
        WorkspaceMember m = new WorkspaceMember();
        m.setWorkspaceId(WS);
        m.setUserId(userId);
        m.setRole(role);
        when(members.selectMember(WS, userId)).thenReturn(m);
    }

    private ProjectMember grant(String projectId, String userId, String access) {
        ProjectMember pm = new ProjectMember();
        pm.setWorkspaceId(WS);
        pm.setProjectId(projectId);
        pm.setUserId(userId);
        pm.setAccess(access);
        return pm;
    }
}
