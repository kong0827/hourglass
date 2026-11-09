package com.hourglass.service;

import com.hourglass.common.Consts;
import com.hourglass.dto.PhaseStatsResponse;
import com.hourglass.dto.ReleaseNoteResponse;
import com.hourglass.dto.UserDayRow;
import com.hourglass.dto.VersionOverviewResponse;
import com.hourglass.dto.VersionStatsResponse;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.Demand;
import com.hourglass.entity.DevBranch;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.entity.VersionRelease;
import com.hourglass.entity.VersionReleaseItem;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.WorkspaceMemberMapper;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.DevBranchMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.ReleaseMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TimeLogMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.VersionTaskMapper;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class VersionPhaseServiceTest {

    private static final String WS = "W1";
    private static final String REQ = "R1";
    private static final LocalDate FIRST_RELEASE = LocalDate.of(2026, 5, 10);

    private final ProjectVersionMapper versions = mock(ProjectVersionMapper.class);
    private final VersionTaskMapper versionTasks = mock(VersionTaskMapper.class);
    private final RequirementMapper reqs = mock(RequirementMapper.class);
    private final DemandMapper demands = mock(DemandMapper.class);
    private final TimeLogMapper timeLogs = mock(TimeLogMapper.class);
    private final UserMapper users = mock(UserMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final DevBranchMapper branches = mock(DevBranchMapper.class);
    private final ReleasePermissionService permissions = mock(ReleasePermissionService.class);
    private final ReleaseMapper releases = mock(ReleaseMapper.class);
    private final TaskPublicationService publications = new TaskPublicationService(mock(com.hourglass.mapper.TaskMapper.class),
            releases, mock(com.hourglass.mapper.TaskLogMapper.class), mock(DeliveryScopeLock.class), permissions,
            new com.fasterxml.jackson.databind.ObjectMapper());
    private final VersionPhaseService service = new VersionPhaseService(versions, versionTasks, reqs,
            demands, timeLogs, users, access, branches, permissions, releases);
    private final java.util.Map<String, java.util.List<String>> taskBindings = new java.util.HashMap<String, java.util.List<String>>();
    private final java.util.List<VersionRelease> publicationRecords = new java.util.ArrayList<VersionRelease>();

    @org.junit.jupiter.api.BeforeEach
    void setupProjection() {
        org.springframework.test.util.ReflectionTestUtils.setField(service, "publications", publications);
        org.mockito.Mockito.doCallRealMethod().when(versionTasks).enrichTasks(any(), anyList());
        when(versionTasks.selectVersionRowsByTaskIds(eq(WS), anyList())).thenAnswer(call -> {
            java.util.List<com.hourglass.dto.TaskVersionBinding> rows = new java.util.ArrayList<com.hourglass.dto.TaskVersionBinding>();
            for (String id : (java.util.List<String>) call.getArgument(1)) {
                for (String versionId : taskBindings.getOrDefault(id, Collections.emptyList())) {
                    com.hourglass.dto.TaskVersionBinding row = new com.hourglass.dto.TaskVersionBinding();
                    row.setTaskId(id); row.setVersionId(versionId); row.setVersionName(versionId);
                    rows.add(row);
                }
            }
            return rows;
        });
        when(releases.selectPublicationRecords(eq(WS), anyList())).thenAnswer(call -> {
            for (VersionRelease record : publicationRecords) record.setItems(releases.selectItems(WS, record.getId()));
            return publicationRecords;
        });
    }

    private void bind(Task task, String versionId) {
        taskBindings.put(task.getId(), Collections.singletonList(versionId));
    }

    @Test
    void phaseStatsGroupsHoursByLogDayAndAveragesOnlyCompletedTaskWork() {
        when(reqs.selectById(REQ)).thenReturn(requirement(REQ, FIRST_RELEASE));
        when(versionTasks.selectStatsByReq(WS, REQ)).thenReturn(Arrays.asList(
                completed("T1", FIRST_RELEASE.minusDays(9), FIRST_RELEASE.minusDays(8), 120, 100, "story"),
                completed("T2", FIRST_RELEASE.plusDays(22), FIRST_RELEASE.plusDays(20), 60, null, "bug"),
                open("T3", FIRST_RELEASE.plusDays(10), 30, 90)));
        when(timeLogs.sumUserDayMinutesByReq(WS, REQ)).thenReturn(Arrays.asList(
                log("U1", FIRST_RELEASE.minusDays(5), 60),
                log("U1", FIRST_RELEASE.plusDays(10), 30),
                log("U2", FIRST_RELEASE.plusDays(22), 90)));
        when(users.selectById("U1")).thenReturn(user("U1", "Alice"));
        when(users.selectById("U2")).thenReturn(user("U2", "Bob"));

        PhaseStatsResponse response = service.phaseStats(WS, REQ, "U9");

        PhaseStatsResponse.Phase mvp = response.getMvp();
        assertEquals(1, mvp.getDoneTasks());
        assertEquals(1, mvp.getStoryCount());
        assertEquals(120, mvp.getAvgTaskMinutes(), "仅按完成任务自身工时取均值，不含未完成任务的 30 分钟");
        assertEquals(60, mvp.getWorkMinutes(), "首版工时按计时自然日归组");
        assertEquals(1, mvp.getMemberCount());
        assertEquals(60, mvp.getAvgMemberMinutes());
        assertEquals("Alice", mvp.getMemberHours().get(0).getName());

        PhaseStatsResponse.Phase post = response.getPost();
        assertEquals(1, post.getDoneTasks());
        assertEquals(1, post.getBugCount());
        assertEquals(60, post.getAvgTaskMinutes());
        assertEquals(120, post.getWorkMinutes());
        assertEquals(2, post.getMemberCount());
        assertEquals(60, post.getAvgMemberMinutes());
    }

    @Test
    void versionStatsDoesNotInventPreLaunchBindingsFromReleaseDate() {
        when(reqs.selectById(REQ)).thenReturn(requirement(REQ, FIRST_RELEASE));
        when(versions.selectByReq(WS, REQ)).thenReturn(Arrays.asList(
                version("V1", "V1.0", "released", LocalDateTime.of(2026, 5, 1, 10, 0)),
                version("V2", "V2.0", "planned", null)));
        Task plannedTask = open("T3", FIRST_RELEASE.plusDays(30), 0, 60);
        bind(plannedTask, "V2");
        when(versionTasks.selectStatsByReq(WS, REQ)).thenReturn(Arrays.asList(
                completed("T1", FIRST_RELEASE.minusDays(5), null, 100, null, "task"),
                completed("T2", FIRST_RELEASE.plusDays(20), null, 50, null, "task"),
                plannedTask));
        Demand scheduled = new Demand();
        scheduled.setVersionId("V2");
        scheduled.setStatus("plan");
        Demand rejected = new Demand();
        rejected.setVersionId("V1");
        rejected.setStatus("rej");
        when(demands.selectByReq(WS, REQ)).thenReturn(Arrays.asList(scheduled, rejected));

        VersionStatsResponse response = service.versionStats(WS, REQ, "U9");

        VersionStatsResponse.VersionStat v1 = response.getVersions().get(0);
        assertEquals(0, v1.getTaskCount(), "不根据日期伪造版本成员");
        assertEquals(0, v1.getPreLaunchCount());
        assertEquals(0, v1.getWorkMinutes());
        assertNull(v1.getAvgTaskMinutes());
        assertEquals(0, v1.getDemandCount(), "已拒绝的需求不计入版本关联数");

        VersionStatsResponse.VersionStat v2 = response.getVersions().get(1);
        assertEquals(1, v2.getTaskCount(), "V2 绑定任务数");
        assertEquals(0, v2.getPreLaunchCount(), "V2 前置任务数");
        assertEquals(1, v2.getDemandCount(), "V2 关联需求数");
        assertEquals(1, v2.getScheduledDemandCount(), "V2 已排期需求数");

        assertEquals(2, response.getUnbound().getTaskCount(), "未绑定任务无论完成日期都留在待规划桶");
    }

    @Test
    void versionStatsSeparatesImmutableDeliveryCountsFromCurrentPlanning() {
        when(reqs.selectById(REQ)).thenReturn(requirement(REQ, FIRST_RELEASE));
        when(versions.selectByReq(WS, REQ)).thenReturn(Collections.singletonList(
                version("V1", "V1.0", "released", FIRST_RELEASE.atStartOfDay())));
        VersionRelease record = releaseRecord("V1");
        when(releases.selectRecords(WS, "V1")).thenReturn(Collections.singletonList(record));
        when(versionTasks.selectReleaseRecordsByReq(WS, REQ)).thenAnswer(call -> {
            record.setItems(releases.selectItems(WS, record.getId()));
            return Collections.singletonList(record);
        });
        when(releases.selectItems(WS, record.getId())).thenReturn(Arrays.asList(
                releaseItem("T1", "D1", "published", 120, 90),
                releaseItem("T2", "D1", "incomplete", 10, 60),
                releaseItem("T3", "D2", "already_published", 30, 20)));
        Task unbound = completed("FOLD", FIRST_RELEASE.minusDays(1), null, 600, 500, "task");
        Task rebound = completed("T1", FIRST_RELEASE.plusDays(1), null, 999, 400, "task");
        bind(rebound, "V2");
        when(versionTasks.selectStatsByReq(WS, REQ)).thenReturn(Arrays.asList(unbound, rebound));

        VersionStatsResponse.VersionStat stat = service.versionStats(WS, REQ, "U9").getVersions().get(0);

        assertEquals("release_snapshot", stat.getReleaseEvidenceKind());
        assertEquals(record.getId(), stat.getReleaseRecordId());
        assertEquals(1, stat.getPublishedTaskCount());
        assertEquals(2, stat.getExcludedTaskCount());
        assertEquals(0, stat.getPreLaunchCount());
        assertEquals(0, stat.getWorkMinutes(), "正式历史不把未绑定工作项自动搬入版本统计");
        when(versionTasks.selectStatsByReq(WS, REQ)).thenReturn(Collections.<Task>emptyList());
        VersionStatsResponse.VersionStat changed = service.versionStats(WS, REQ, "U9").getVersions().get(0);
        assertEquals(0, changed.getTaskCount());
        assertEquals(stat.getPublishedTaskCount(), changed.getPublishedTaskCount());
        assertEquals(stat.getExcludedTaskCount(), changed.getExcludedTaskCount());
    }

    @Test
    void versionStatsLabelsMissingFormalEvidenceAsPlannedScopeWithZeroRecordCounts() {
        when(reqs.selectById(REQ)).thenReturn(requirement(REQ, null));
        when(versions.selectByReq(WS, REQ)).thenReturn(Arrays.asList(
                version("V1", "V1.0", "released", FIRST_RELEASE.atStartOfDay()),
                version("V2", "V2.0", "active", null)));
        when(versionTasks.selectStatsByReq(WS, REQ)).thenReturn(Collections.<Task>emptyList());

        VersionStatsResponse response = service.versionStats(WS, REQ, "U9");

        assertEquals("planned_scope", response.getVersions().get(0).getReleaseEvidenceKind());
        assertEquals(0, response.getVersions().get(0).getPublishedTaskCount());
        assertEquals(0, response.getVersions().get(0).getExcludedTaskCount());
        assertNull(response.getVersions().get(0).getReleaseRecordId());
        assertEquals("planned_scope", response.getVersions().get(1).getReleaseEvidenceKind());
        assertEquals(0, response.getVersions().get(1).getPublishedTaskCount());
        verify(releases, never()).selectSuccess(WS, "V2");
    }

    @Test
    void versionStatsDerivesBranchProgressFromTasks() {
        when(reqs.selectById(REQ)).thenReturn(requirement(REQ, FIRST_RELEASE));
        when(versions.selectByReq(WS, REQ)).thenReturn(Arrays.asList(
                version("V1", "V1.0", "released", LocalDateTime.of(2026, 5, 1, 10, 0)),
                version("V2", "V2.0", "active", null)));
        Task fold = completed("T1", FIRST_RELEASE.minusDays(5), null, 100, null, "task");
        fold.setBranchId("B1");
        bind(fold, "V1");
        Task v2OnDevBranch = open("T3", FIRST_RELEASE.plusDays(30), 0, 60);
        bind(v2OnDevBranch, "V2");
        v2OnDevBranch.setBranchId("B1");
        Task v2OnMergingBranch = open("T4", FIRST_RELEASE.plusDays(31), 0, 30);
        bind(v2OnMergingBranch, "V2");
        v2OnMergingBranch.setBranchId("B3");
        Task unboundPost = completed("T2", FIRST_RELEASE.plusDays(20), null, 50, null, "task");
        unboundPost.setBranchId("B2");
        when(versionTasks.selectStatsByReq(WS, REQ)).thenReturn(Arrays.asList(fold, v2OnDevBranch,
                v2OnMergingBranch, unboundPost));
        when(demands.selectByReq(WS, REQ)).thenReturn(Collections.<Demand>emptyList());
        when(branches.selectBriefsByWorkspace(WS)).thenReturn(Arrays.asList(
                brief("B1", "feature/login", "dev"),
                brief("B2", "hotfix/pay", "testing"),
                brief("B3", "release/2.0", "merging")));

        VersionStatsResponse response = service.versionStats(WS, REQ, "U9");

        VersionStatsResponse.VersionStat v1 = response.getVersions().get(0);
        assertEquals(1, v1.getBranches().size(), "只依据实际版本绑定统计分支");
        assertEquals("feature/login", v1.getBranches().get(0).getName());
        assertEquals("dev", v1.getBranches().get(0).getStatus());
        assertEquals(1, v1.getBranches().get(0).getTaskCount());

        VersionStatsResponse.VersionStat v2 = response.getVersions().get(1);
        assertEquals(2, v2.getBranches().size());
        assertEquals("feature/login", v2.getBranches().get(0).getName(), "分支按状态 dev→merging 排序");
        assertEquals("release/2.0", v2.getBranches().get(1).getName());

        assertEquals(1, response.getUnbound().getBranches().size());
        assertEquals("hotfix/pay", response.getUnbound().getBranches().get(0).getName(),
                "待规划桶同样带分支进度");
        assertEquals(1, response.getUnbound().getBranches().get(0).getTaskCount());
    }

    @Test
    void overviewQueriesTasksOncePerProjectAndCachesMemberNames() {
        when(reqs.selectAll(WS)).thenReturn(Arrays.asList(
                requirement("R1", FIRST_RELEASE), requirement("R2", null)));
        when(versionTasks.selectStatsByReq(WS, "R1")).thenReturn(Collections.<Task>emptyList());
        when(versionTasks.selectStatsByReq(WS, "R2")).thenReturn(Collections.<Task>emptyList());
        when(versions.selectByReq(WS, "R1")).thenReturn(Collections.<ProjectVersion>emptyList());
        when(versions.selectByReq(WS, "R2")).thenReturn(Collections.<ProjectVersion>emptyList());
        when(timeLogs.sumUserDayMinutesByReq(WS, "R1"))
                .thenReturn(Collections.singletonList(log("U1", FIRST_RELEASE, 60)));
        when(timeLogs.sumUserDayMinutesByReq(WS, "R2"))
                .thenReturn(Collections.singletonList(log("U1", FIRST_RELEASE, 60)));
        when(users.selectById("U1")).thenReturn(user("U1", "Alice"));

        VersionOverviewResponse overview = service.overview(WS, "U9");

        assertEquals(2, overview.getProjects().size());
        assertEquals(120, overview.getTotals().getMvpWorkMinutes());
        verify(versionTasks, times(1)).selectStatsByReq(WS, "R1");
        verify(versionTasks, times(1)).selectStatsByReq(WS, "R2");
        verify(users, times(1)).selectById("U1");
    }

    @Test
    void phaseStatsWithoutReleaseDateKeepsEverythingInMvp() {
        when(reqs.selectById(REQ)).thenReturn(requirement(REQ, null));
        when(versionTasks.selectStatsByReq(WS, REQ)).thenReturn(Collections.singletonList(
                completed("T1", FIRST_RELEASE.plusDays(5), null, 30, null, "task")));
        when(timeLogs.sumUserDayMinutesByReq(WS, REQ)).thenReturn(Collections.<UserDayRow>emptyList());

        PhaseStatsResponse response = service.phaseStats(WS, REQ, "U9");

        assertEquals(1, response.getMvp().getDoneTasks());
        assertEquals(0, response.getPost().getDoneTasks());
        assertNull(response.getMvp().getAvgMemberMinutes());
    }

    @Test
    void releaseSnapshotUsesOnlyPublishedItemsAndNeverDriftsWithLiveBusinessData() {
        ProjectVersion liveVersion = version("V1", "新版名称", "released", FIRST_RELEASE.atTime(12, 0));
        when(versions.selectById("V1")).thenReturn(liveVersion);
        VersionRelease record = releaseRecord("V1");
        record.setPublishedCount(99); // 合计必须来自 published items，而非记录计数或当前范围
        when(releases.selectRecords(WS, "V1")).thenReturn(Collections.singletonList(record));
        when(versionTasks.selectReleaseRecordsByReq(WS, REQ)).thenAnswer(call -> {
            record.setItems(releases.selectItems(WS, record.getId()));
            return Collections.singletonList(record);
        });
        VersionReleaseItem published = releaseItem("T1", "D1", "published", 120, 90);
        VersionReleaseItem second = releaseItem("T2", "D1", "published", null, null);
        second.setBoardColumn(Consts.COL_BACKLOG);
        second.setCompletedAt(null);
        when(releases.selectItems(WS, record.getId())).thenReturn(Arrays.asList(
                published, second, releaseItem("T3", "D2", "candidate", 900, 800),
                releaseItem("T4", "D3", "already_published", 700, 600)));

        ReleaseNoteResponse before = service.releaseNote(WS, "V1", "U9");
        assertEquals("release_snapshot", before.getEvidenceKind());
        assertEquals(record.getId(), before.getReleaseRecordId());
        assertEquals(record.getRecordedAt(), before.getRecordedAt());
        assertEquals(record.getPublishedOn(), before.getGeneratedAt());
        assertEquals("捕获版本", before.getVersion().getName());
        assertEquals(record.getPublishedOn().atStartOfDay(), before.getVersion().getReleasedAt());
        assertNull(before.getVersion().getTargetDate(), "未捕获的日期不能从当前版本补齐");
        assertEquals(2, before.getTotalCount());
        assertEquals(1, before.getDoneCount());
        assertEquals(Consts.COL_BACKLOG, before.getTasks().get(1).getBoardColumn());
        assertNull(before.getTasks().get(1).getCompletedAt(), "实际发布不能伪造工作完成");
        assertEquals(120, before.getWorkMinutes());
        assertEquals(90, before.getEstimateMinutes());
        Task task = before.getTasks().get(0);
        assertEquals("捕获任务T1", task.getTitle());
        assertEquals("捕获负责人", task.getOwner());
        assertEquals("捕获项目", task.getReqName());
        assertEquals(Collections.singletonList("V1"), task.getVersionIds());
        assertEquals(Collections.singletonList("捕获版本"), task.getVersionNames());
        assertEquals(FIRST_RELEASE.minusDays(2), task.getCompletedAt());
        assertEquals(record.getPublishedOn(), task.getPublishedAt());
        assertNull(task.getPreLaunchFold());
        assertEquals(1, before.getDemands().size(), "只取已发布条目的关联需求并去重");
        Demand demand = before.getDemands().get(0);
        assertEquals("D1", demand.getId());
        assertEquals("捕获需求D1", demand.getTitle());
        assertEquals("V-target", demand.getVersionId());
        assertEquals("捕获需求目标版本", demand.getVersionName());

        liveVersion.setName("再次改名");
        liveVersion.setTargetDate(FIRST_RELEASE.plusYears(1));
        liveVersion.setReleasedAt(FIRST_RELEASE.plusYears(1).atStartOfDay());
        Task changedTask = completed("T1", FIRST_RELEASE.plusDays(10), null, 9999, 8888, "bug");
        bind(changedTask, "V2");
        changedTask.setTitle("当前已改名或改绑的任务");
        when(versionTasks.selectStatsByReq(WS, REQ)).thenReturn(Collections.singletonList(changedTask));
        Demand changedDemand = new Demand();
        changedDemand.setId("D1");
        changedDemand.setTitle("当前需求名称");
        when(demands.selectByVersion(WS, "V1")).thenReturn(Collections.singletonList(changedDemand));

        assertEquals(before, service.releaseNote(WS, "V1", "U9"));
        verifyNoInteractions(versionTasks, demands, reqs, timeLogs, users, branches);
    }

    @Test
    void emptySuccessSnapshotDoesNotFoldPreLaunchTasksIntoDelivery() {
        when(versions.selectById("V1")).thenReturn(version("V1", "V1", "released", FIRST_RELEASE.atStartOfDay()));
        VersionRelease record = releaseRecord("V1");
        when(releases.selectRecords(WS, "V1")).thenReturn(Collections.singletonList(record));
        when(versionTasks.selectReleaseRecordsByReq(WS, REQ)).thenAnswer(call -> {
            record.setItems(releases.selectItems(WS, record.getId()));
            return Collections.singletonList(record);
        });
        when(releases.selectItems(WS, record.getId())).thenReturn(Collections.singletonList(
                releaseItem("T1", "D1", "incomplete", 100, 100)));
        when(versionTasks.selectStatsByReq(WS, REQ)).thenReturn(Collections.singletonList(
                completed("PRE", FIRST_RELEASE.minusDays(1), null, 300, 200, "task")));

        ReleaseNoteResponse response = service.releaseNote(WS, "V1", "U9");

        assertEquals("release_snapshot", response.getEvidenceKind());
        assertEquals(0, response.getTotalCount());
        assertEquals(0, response.getDoneCount());
        assertEquals(0, response.getWorkMinutes());
        assertEquals(0, response.getEstimateMinutes());
        assertTrue(response.getDemands().isEmpty());
        verifyNoInteractions(versionTasks, demands, reqs);
    }

    @Test
    void releasedWithoutRecordDoesNotInventBindingsFromHistoricalDate() {
        ProjectVersion version = version("V1", "V1", "released", FIRST_RELEASE.atStartOfDay());
        when(versions.selectById("V1")).thenReturn(version);
        when(versions.selectByReq(WS, REQ)).thenReturn(Collections.singletonList(version));
        when(reqs.selectById(REQ)).thenReturn(requirement(REQ, FIRST_RELEASE));
        when(versionTasks.selectStatsByReq(WS, REQ)).thenReturn(Collections.singletonList(
                completed("PRE", FIRST_RELEASE.minusDays(1), null, 300, 200, "task")));

        ReleaseNoteResponse response = service.releaseNote(WS, "V1", "U9");

        assertEquals("no_release_record", response.getEvidenceKind());
        assertNull(response.getReleaseRecordId());
        assertNull(response.getRecordedAt());
        assertEquals(0, response.getTotalCount());
        assertEquals(0, response.getWorkMinutes());
        assertTrue(response.getTasks().isEmpty(), "历史日期不能生成未绑定任务的交付证据");
        verify(releases, never()).selectItems(any(), any());
    }

    @Test
    void unreleasedVersionIsPlannedScopeNotReleaseEvidence() {
        when(versions.selectById("V2")).thenReturn(version("V2", "V2", "active", null));
        Task task = open("T1", FIRST_RELEASE.plusDays(1), 60, 120);
        bind(task, "V2");
        when(versionTasks.selectStatsByReq(WS, REQ)).thenReturn(Collections.singletonList(task));

        ReleaseNoteResponse response = service.releaseNote(WS, "V2", "U9");

        assertEquals("planned_scope", response.getEvidenceKind());
        assertNull(response.getReleaseRecordId());
        assertNull(response.getRecordedAt());
        assertEquals(1, response.getTotalCount());
        assertEquals(0, response.getDoneCount());
        verify(releases).selectRecords(WS, "V2");
        verify(releases).selectPublicationRecords(WS, Collections.singletonList("T1"));
        verify(releases, never()).selectItems(any(), any());
    }

    @Test
    void versionPermissionsUseRealScopeStrictIdentityAndWritableAccess() {
        Requirement project = requirement(REQ, FIRST_RELEASE);
        project.setOwnerUserId("PM");
        when(reqs.selectById(REQ)).thenReturn(project);
        ProjectVersion first = version("V1", "V1", "released", FIRST_RELEASE.atStartOfDay());
        ProjectVersion active = version("V2", "V2", "active", null);
        active.setRevision(7L);
        when(versions.selectByReq(WS, REQ)).thenReturn(Arrays.asList(first, active));
        Task folded = completed("PRE", FIRST_RELEASE.minusDays(1), null, 300, 200, "task");
        folded.setOwnerUserId("U9");
        Task real = open("REAL", FIRST_RELEASE.plusDays(2), 10, 20);
        bind(real, "V2");
        real.setOwnerUserId("OTHER");
        real.setOwner("同名负责人");
        when(versionTasks.selectStatsByReq(WS, REQ)).thenReturn(Arrays.asList(folded, real));
        WorkspaceMemberMapper members = mock(WorkspaceMemberMapper.class);
        WorkspaceMember member = new WorkspaceMember();
        member.setRole("member");
        when(members.selectMember(WS, "U9")).thenReturn(member);
        when(access.canWrite(WS, "U9", REQ)).thenReturn(true);
        ReleasePermissionService actualPermissions = new ReleasePermissionService(members, reqs, access);
        VersionPhaseService actual = new VersionPhaseService(versions, versionTasks, reqs,
                demands, timeLogs, users, access, branches, actualPermissions, releases);
        org.springframework.test.util.ReflectionTestUtils.setField(actual, "publications", publications);

        VersionStatsResponse initial = actual.versionStats(WS, REQ, "U9");
        assertEquals(0, initial.getVersions().get(0).getPreLaunchCount());
        assertFalse(initial.getVersions().get(0).getCanPublish());
        assertFalse(initial.getVersions().get(1).getCanPublish(), "折算任务或显示名都不授予其他版本发布权");
        assertFalse(initial.getVersions().get(1).getCanManageReleasePlan());
        assertEquals(7L, initial.getVersions().get(1).getRevision());

        real.setOwnerUserId("U9");
        assertFalse(actual.versionStats(WS, REQ, "U9").getVersions().get(1).getCanPublish(), "任务负责人不自动获得版本发布管理权");
        when(access.canWrite(WS, "U9", REQ)).thenReturn(false);
        assertFalse(actual.versionStats(WS, REQ, "U9").getVersions().get(1).getCanPublish());
        assertFalse(actual.versionStats(WS, REQ).getVersions().get(1).getCanPublish(), "无身份不能沿用 canWrite(null) 的宽松语义");

        when(access.canWrite(WS, "U9", REQ)).thenReturn(true);
        project.setOwnerUserId("U9");
        VersionStatsResponse managed = actual.versionStats(WS, REQ, "U9");
        assertTrue(managed.getVersions().get(0).getCanManageReleasePlan());
        assertTrue(managed.getVersions().get(1).getCanManageReleasePlan());
        assertTrue(managed.getVersions().get(0).getCanPublish(), "正式历史不禁止项目管理者记录后续发布事实");
    }

    @Test
    void overviewPassesViewerIdentityAndOnlyActualBindingsToPermissions() {
        when(reqs.selectAll(WS)).thenReturn(Collections.singletonList(requirement(REQ, FIRST_RELEASE)));
        ProjectVersion active = version("V2", "V2", "active", null);
        when(versions.selectByReq(WS, REQ)).thenReturn(Collections.singletonList(active));
        Task real = open("REAL", FIRST_RELEASE.plusDays(1), 0, 20);
        bind(real, "V2");
        Task unbound = open("UNBOUND", FIRST_RELEASE.plusDays(1), 0, 20);
        when(versionTasks.selectStatsByReq(WS, REQ)).thenReturn(Arrays.asList(real, unbound));
        when(permissions.canManageProject("U9", WS, REQ)).thenReturn(true);

        VersionOverviewResponse response = service.overview(WS, "U9");

        assertEquals(1, response.getTotals().getVersionCount());
        verify(permissions).canManageProject("U9", WS, REQ);
        verify(permissions, never()).canPublishVersion(any(), any(), any(), anyList());
        verify(versionTasks).selectStatsByReq(WS, REQ);
    }

    @Test
    void manyToManyMembershipCountsInEachVersionButOnlyOnceInGlobalTotals() {
        Requirement project = requirement(REQ, null);
        when(reqs.selectById(REQ)).thenReturn(project);
        when(reqs.selectAll(WS)).thenReturn(Collections.singletonList(project));
        when(versions.selectByReq(WS, REQ)).thenReturn(Arrays.asList(
                version("V1", "V1", "active", null), version("V2", "V2", "planned", null)));
        Task shared = completed("SHARED", FIRST_RELEASE, null, 120, 120, "story");
        taskBindings.put(shared.getId(), Arrays.asList("V1", "V2"));
        when(versionTasks.selectStatsByReq(WS, REQ)).thenReturn(Collections.singletonList(shared));
        when(timeLogs.sumUserDayMinutesByReq(WS, REQ)).thenReturn(
                Collections.singletonList(log("U1", FIRST_RELEASE, 120)));

        VersionStatsResponse scoped = service.versionStats(WS, REQ, "U9");
        assertEquals(1, scoped.getVersions().get(0).getTaskCount());
        assertEquals(1, scoped.getVersions().get(1).getTaskCount());
        assertEquals(120, scoped.getVersions().get(0).getWorkMinutes());
        assertEquals(120, scoped.getVersions().get(1).getWorkMinutes());
        assertEquals(0, scoped.getUnbound().getTaskCount());
        VersionOverviewResponse overview = service.overview(WS, "U9");
        assertEquals(1, overview.getTotals().getMvpDoneTasks());
        assertEquals(120, overview.getTotals().getTotalWorkMinutes());
        assertEquals(1, overview.getProjects().get(0).getMvpDoneTasks());
        assertEquals(Arrays.asList("V1", "V2"), shared.getVersionIds());
    }

    private VersionRelease releaseRecord(String versionId) {
        VersionRelease record = new VersionRelease();
        record.setId("REL-1");
        record.setWorkspaceId(WS);
        record.setReqId(REQ);
        record.setVersionId(versionId);
        record.setVersionName("捕获版本");
        record.setProjectName("捕获项目");
        record.setResult("success");
        record.setEnvironment("production"); record.setOperation("deploy"); record.setCoverage("full");
        record.setTargetKeys(Collections.singletonList("main"));
        record.setOccurredAt(FIRST_RELEASE.atStartOfDay());
        publicationRecords.add(record);
        record.setPublishedOn(FIRST_RELEASE);
        record.setRecordedAt(FIRST_RELEASE.plusDays(1).atTime(9, 30));
        return record;
    }

    private VersionReleaseItem releaseItem(String taskId, String demandId, String disposition,
                                           Integer workMinutes, Integer estimateMinutes) {
        VersionReleaseItem item = new VersionReleaseItem();
        item.setTaskId(taskId);
        item.setTitle("捕获任务" + taskId);
        item.setItemType("story");
        item.setOwnerUserId("U1");
        item.setOwnerName("捕获负责人");
        item.setDemandId(demandId);
        item.setDemandTitle("捕获需求" + demandId);
        item.setTargetVersionId("V-target");
        item.setTargetVersionName("捕获需求目标版本");
        item.setBoardColumn(Consts.COL_DONE);
        item.setCompletedAt(FIRST_RELEASE.minusDays(2));
        item.setDisposition(disposition);
        item.setWorkMinutes(workMinutes);
        item.setEstimateMinutes(estimateMinutes);
        return item;
    }

    private Requirement requirement(String id, LocalDate firstReleasedAt) {
        Requirement r = new Requirement();
        r.setId(id);
        r.setWorkspaceId(WS);
        r.setName(id);
        r.setFirstReleasedAt(firstReleasedAt);
        return r;
    }

    private ProjectVersion version(String id, String name, String status, LocalDateTime releasedAt) {
        ProjectVersion v = new ProjectVersion();
        v.setId(id);
        v.setWorkspaceId(WS);
        v.setReqId(REQ);
        v.setName(name);
        v.setStatus(status);
        v.setReleasedAt(releasedAt);
        return v;
    }

    private DevBranch brief(String id, String name, String status) {
        DevBranch b = new DevBranch();
        b.setId(id);
        b.setWorkspaceId(WS);
        b.setName(name);
        b.setStatus(status);
        return b;
    }

    private Task completed(String id, LocalDate completedAt, LocalDate dueDate, Integer totalMinutes,
                           Integer estimateMinutes, String itemType) {
        Task t = new Task();
        t.setId(id);
        t.setWorkspaceId(WS);
        t.setReqId(REQ);
        t.setTitle(id);
        t.setBoardColumn(Consts.COL_DONE);
        t.setCompletedAt(completedAt);
        t.setDueDate(dueDate);
        t.setTotalMinutes(totalMinutes);
        t.setEstimateMinutes(estimateMinutes);
        t.setItemType(itemType);
        return t;
    }

    private Task open(String id, LocalDate startDate, Integer totalMinutes, Integer estimateMinutes) {
        Task t = new Task();
        t.setId(id);
        t.setWorkspaceId(WS);
        t.setReqId(REQ);
        t.setTitle(id);
        t.setBoardColumn(Consts.COL_DOING);
        t.setStartDate(startDate);
        t.setTotalMinutes(totalMinutes);
        t.setEstimateMinutes(estimateMinutes);
        t.setItemType("task");
        return t;
    }

    private UserDayRow log(String userId, LocalDate day, int minutes) {
        UserDayRow row = new UserDayRow();
        row.setUserId(userId);
        row.setDay(day);
        row.setTotalMinutes(minutes);
        return row;
    }

    private AppUser user(String id, String displayName) {
        AppUser u = new AppUser();
        u.setId(id);
        u.setDisplayName(displayName);
        return u;
    }
}
