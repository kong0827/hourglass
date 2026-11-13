package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.DemandDeliveryJudgementRequest;
import com.hourglass.dto.PageResult;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.Demand;
import com.hourglass.entity.DemandDeliveryJudgement;
import com.hourglass.mapper.DemandDeliveryJudgementMapper;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.UserMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDate;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class DemandDeliveryJudgementServiceTest {

    private final DemandMapper demands = mock(DemandMapper.class);
    private final DemandDeliveryJudgementMapper judgements = mock(DemandDeliveryJudgementMapper.class);
    private final UserMapper users = mock(UserMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final ReleasePermissionService permissions = mock(ReleasePermissionService.class);
    private final DeliveryScopeLock lock = mock(DeliveryScopeLock.class);
    private final DemandDeliveryJudgementService service =
            new DemandDeliveryJudgementService(demands, judgements, users, access, permissions, lock);
    private Demand demand;

    @BeforeEach
    void setup() {
        demand = new Demand();
        demand.setId("D1");
        demand.setWorkspaceId("W1");
        demand.setReqId("R1");
        demand.setStatus("plan");
        demand.setRevision(4L);
        demand.setVersionId("V1");
        when(demands.selectById("D1")).thenReturn(demand);
        when(demands.selectByIdForUpdate("W1", "D1")).thenReturn(demand);
        AppUser user = new AppUser();
        user.setId("U1");
        user.setDisplayName("张三");
        when(users.selectById("U1")).thenReturn(user);
    }

    private DemandDeliveryJudgementRequest body(String stage, LocalDate effectiveOn, String note, Long revision) {
        DemandDeliveryJudgementRequest body = new DemandDeliveryJudgementRequest();
        body.setStage(stage);
        body.setEffectiveOn(effectiveOn);
        body.setNote(note);
        body.setRevision(revision);
        return body;
    }

    @Test
    void judgeInsertsActiveRecordWithVersionSnapshotAndLogs() {
        when(judgements.selectActive("W1", "D1")).thenReturn(null);

        service.judge("U1", "W1", "D1", body("delivered", LocalDate.of(2026, 11, 1), "历史已发布", 4L));

        ArgumentCaptor<DemandDeliveryJudgement> captor = ArgumentCaptor.forClass(DemandDeliveryJudgement.class);
        verify(judgements).insert(captor.capture());
        DemandDeliveryJudgement saved = captor.getValue();
        assertEquals("W1", saved.getWorkspaceId());
        assertEquals("D1", saved.getDemandId());
        assertEquals("V1", saved.getVersionId());
        assertEquals("delivered", saved.getJudgedStage());
        assertEquals(LocalDate.of(2026, 11, 1), saved.getEffectiveOn());
        assertEquals("历史已发布", saved.getJudgeReason());
        assertEquals("U1", saved.getJudgedByUserId());
        assertEquals("张三", saved.getJudgedByName());
        verify(judgements, never()).revoke(anyLong(), anyString(), anyString(), anyString());
        verify(demands).insertLog(eq("W1"), eq("D1"), eq("judge_delivery"),
                contains("人工判定为已交付"), eq("U1"));
        verify(lock).lockProjects("W1", "R1");
        verify(permissions).assertManageProject("U1", "W1", "R1");
        verify(permissions).assertManageProjectForUpdate("U1", "W1", "R1");
    }

    @Test
    void judgeRevokesExistingRecordBeforeAppending() {
        DemandDeliveryJudgement active = new DemandDeliveryJudgement();
        active.setId(9L);
        when(judgements.selectActive("W1", "D1")).thenReturn(active);
        when(judgements.revoke(9L, "U1", "张三", "重新判定为已完成待发布")).thenReturn(1);

        service.judge("U1", "W1", "D1", body("donePending", LocalDate.of(2026, 11, 2), "证据未齐", 4L));

        verify(judgements).revoke(9L, "U1", "张三", "重新判定为已完成待发布");
        verify(judgements).insert(any(DemandDeliveryJudgement.class));
        verify(demands).insertLog(eq("W1"), eq("D1"), eq("judge_delivery"),
                contains("人工判定为已完成待发布"), eq("U1"));
    }

    @Test
    void judgeRejectsInvalidStageDateReasonStatusAndRevision() {
        when(judgements.selectActive("W1", "D1")).thenReturn(null);
        assertEquals(400, assertThrows(AppException.class, () -> service.judge("U1", "W1", "D1",
                body("active", LocalDate.of(2026, 11, 1), "原因", 4L))).getCode());
        assertEquals(400, assertThrows(AppException.class, () -> service.judge("U1", "W1", "D1",
                body("delivered", LocalDate.now().plusDays(1), "原因", 4L))).getCode());
        assertEquals(400, assertThrows(AppException.class, () -> service.judge("U1", "W1", "D1",
                body("delivered", LocalDate.of(2026, 11, 1), "  ", 4L))).getCode());

        demand.setStatus("pass");
        assertEquals(400, assertThrows(AppException.class, () -> service.judge("U1", "W1", "D1",
                body("delivered", LocalDate.of(2026, 11, 1), "原因", 4L))).getCode());

        demand.setStatus("plan");
        assertEquals(409, assertThrows(AppException.class, () -> service.judge("U1", "W1", "D1",
                body("delivered", LocalDate.of(2026, 11, 1), "原因", 3L))).getCode());
        verify(judgements, never()).insert(any(DemandDeliveryJudgement.class));
        verify(demands, never()).insertLog(anyString(), anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void revokeRequiresActiveRecordAndKeepsHistory() {
        assertEquals(400, assertThrows(AppException.class, () -> service.revoke("U1", "W1", "D1",
                body(null, null, "  撤销", 4L))).getCode());

        DemandDeliveryJudgement active = new DemandDeliveryJudgement();
        active.setId(9L);
        when(judgements.selectActive("W1", "D1")).thenReturn(active);
        when(judgements.revoke(9L, "U1", "张三", "证据已补齐")).thenReturn(1);

        service.revoke("U1", "W1", "D1", body(null, null, "证据已补齐", 4L));

        verify(judgements).revoke(9L, "U1", "张三", "证据已补齐");
        verify(demands).insertLog("W1", "D1", "revoke_delivery_judgement", "撤销人工判定：证据已补齐", "U1");
        verify(judgements, never()).deleteByDemand(anyString(), anyString());
    }

    @Test
    void revokeRejectsWhenNothingIsActive() {
        when(judgements.selectActive("W1", "D1")).thenReturn(null);
        assertEquals(400, assertThrows(AppException.class, () -> service.revoke("U1", "W1", "D1",
                body(null, null, "撤销", 4L))).getCode());
        verify(judgements, never()).revoke(anyLong(), anyString(), anyString(), anyString());
    }

    @Test
    void historyClampsPagingAndChecksVisibility() {
        when(judgements.countHistory("W1", "D1")).thenReturn(1);
        DemandDeliveryJudgement row = new DemandDeliveryJudgement();
        row.setId(9L);
        when(judgements.selectHistory("W1", "D1", 0, 100)).thenReturn(Collections.singletonList(row));

        PageResult<DemandDeliveryJudgement> page = service.history("W1", "U1", "D1", -5, 500);

        assertEquals(1, page.getTotal());
        assertEquals(0, page.getOffset());
        assertEquals(100, page.getLimit());
        assertEquals(1, page.getItems().size());
        verify(access).assertView("W1", "U1", "R1");

        doThrow(AppException.notFound("项目不存在或你没有访问权限：R1"))
                .when(access).assertView("W1", "U1", "R1");
        assertEquals(404, assertThrows(AppException.class,
                () -> service.history("W1", "U1", "D1", 0, 100)).getCode());
    }

    @Test
    void historySkipsQueryWhenOffsetBeyondTotal() {
        when(judgements.countHistory("W1", "D1")).thenReturn(2);
        PageResult<DemandDeliveryJudgement> page = service.history("W1", "U1", "D1", 5, 10);
        List<DemandDeliveryJudgement> items = page.getItems();
        assertTrue(items.isEmpty());
        verify(judgements, never()).selectHistory(anyString(), anyString(), anyInt(), anyInt());
    }
}
