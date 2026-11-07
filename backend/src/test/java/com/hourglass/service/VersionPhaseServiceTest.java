package com.hourglass.service;

import com.hourglass.common.Consts;
import com.hourglass.dto.PhaseStatsResponse;
import com.hourglass.dto.UserDayRow;
import com.hourglass.dto.VersionOverviewResponse;
import com.hourglass.dto.VersionStatsResponse;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.Demand;
import com.hourglass.entity.DevBranch;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.DevBranchMapper;
import com.hourglass.mapper.ProjectVersionMapper;
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
    private final VersionPhaseService service = new VersionPhaseService(versions, versionTasks, reqs,
            demands, timeLogs, users, access, branches);

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
    void versionStatsFoldsPreLaunchUnboundTasksIntoEarliestReleasedVersion() {
        when(reqs.selectById(REQ)).thenReturn(requirement(REQ, FIRST_RELEASE));
        when(versions.selectByReq(WS, REQ)).thenReturn(Arrays.asList(
                version("V1", "V1.0", "released", LocalDateTime.of(2026, 5, 1, 10, 0)),
                version("V2", "V2.0", "planned", null)));
        Task plannedTask = open("T3", FIRST_RELEASE.plusDays(30), 0, 60);
        plannedTask.setVersionId("V2");
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
        assertEquals(1, v1.getTaskCount(), "首版上线前未绑版本的任务归入最早已发布版本");
        assertEquals(1, v1.getPreLaunchCount(), "V1 前置任务数");
        assertEquals(100, v1.getWorkMinutes(), "V1 工时");
        assertEquals(100, v1.getAvgTaskMinutes(), "V1 均耗时");
        assertEquals(0, v1.getDemandCount(), "已拒绝的需求不计入版本关联数");

        VersionStatsResponse.VersionStat v2 = response.getVersions().get(1);
        assertEquals(1, v2.getTaskCount(), "V2 绑定任务数");
        assertEquals(0, v2.getPreLaunchCount(), "V2 前置任务数");
        assertEquals(1, v2.getDemandCount(), "V2 关联需求数");
        assertEquals(1, v2.getScheduledDemandCount(), "V2 已排期需求数");

        assertEquals(1, response.getUnbound().getTaskCount(), "上线后的未绑版本任务留在待规划桶");
    }

    @Test
    void versionStatsDerivesBranchProgressFromTasks() {
        when(reqs.selectById(REQ)).thenReturn(requirement(REQ, FIRST_RELEASE));
        when(versions.selectByReq(WS, REQ)).thenReturn(Arrays.asList(
                version("V1", "V1.0", "released", LocalDateTime.of(2026, 5, 1, 10, 0)),
                version("V2", "V2.0", "active", null)));
        Task fold = completed("T1", FIRST_RELEASE.minusDays(5), null, 100, null, "task");
        fold.setBranchId("B1");
        Task v2OnDevBranch = open("T3", FIRST_RELEASE.plusDays(30), 0, 60);
        v2OnDevBranch.setVersionId("V2");
        v2OnDevBranch.setBranchId("B1");
        Task v2OnMergingBranch = open("T4", FIRST_RELEASE.plusDays(31), 0, 30);
        v2OnMergingBranch.setVersionId("V2");
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
        assertEquals(1, v1.getBranches().size(), "上线前折叠任务的分支同样计入首版版本");
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
