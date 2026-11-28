package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.entity.CaseSet;
import com.hourglass.mapper.CaseSetMapper;
import com.hourglass.mapper.TestCaseMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 示例用例包整包删除（sql/139 pack 标记）：非 pack 分组拒绝、子分组守卫、级联删用例并留痕。 */
class CaseSetServicePackTest {

    private static final String WS = "W1";
    private static final String PROJECT = "R1";
    private static final String USER = "U1";

    private final CaseSetMapper setMapper = mock(CaseSetMapper.class);
    private final TestCaseMapper caseMapper = mock(TestCaseMapper.class);
    private final TestCaseService caseService = mock(TestCaseService.class);
    private final ProjectAccessService projectAccess = mock(ProjectAccessService.class);
    private final AuditService auditService = mock(AuditService.class);
    private final CaseSetService service = new CaseSetService(setMapper, caseMapper, caseService,
            projectAccess, auditService);

    @BeforeEach
    void setUp() {
        when(setMapper.selectById(anyString())).thenAnswer(inv -> {
            CaseSet s = new CaseSet();
            s.setId(inv.getArgument(0));
            s.setWorkspaceId(WS);
            s.setReqId(PROJECT);
            s.setVisibility(CaseSetService.VIS_TEAM);
            s.setKind(CaseSetService.KIND_MANUAL);
            s.setName("分组");
            return s;
        });
    }

    private CaseSet packSet(String id) {
        CaseSet s = new CaseSet();
        s.setId(id);
        s.setWorkspaceId(WS);
        s.setReqId(PROJECT);
        s.setVisibility(CaseSetService.VIS_TEAM);
        s.setKind(CaseSetService.KIND_MANUAL);
        s.setName(TestCaseService.PACK_GROUP_NAME);
        s.setPack(1);
        return s;
    }

    @Test
    void deletePackRejectsOrdinaryGroup() {
        when(setMapper.selectById("CS1")).thenAnswer(inv -> {
            CaseSet s = packSet("CS1");
            s.setPack(0);
            s.setName("普通分组");
            return s;
        });
        AppException e = assertThrows(AppException.class, () -> service.deletePack(USER, WS, "CS1"));
        assertTrue(e.getMessage().contains("整包删除"));
        verify(caseService, never()).delete(anyString(), anyString(), anyString());
        verify(setMapper, never()).delete(anyString(), anyString());
    }

    @Test
    void deletePackRejectsGroupWithChildren() {
        when(setMapper.selectById("CS1")).thenAnswer(inv -> packSet("CS1"));
        when(setMapper.countChildren(WS, PROJECT, "CS1")).thenReturn(1);
        AppException e = assertThrows(AppException.class, () -> service.deletePack(USER, WS, "CS1"));
        assertTrue(e.getMessage().contains("子分组"));
        verify(caseService, never()).delete(anyString(), anyString(), anyString());
    }

    @Test
    void deletePackDeletesMemberCasesAndGroup() {
        when(setMapper.selectById("CS1")).thenAnswer(inv -> packSet("CS1"));
        when(setMapper.countChildren(WS, PROJECT, "CS1")).thenReturn(0);
        when(setMapper.selectCaseIds("CS1")).thenReturn(Arrays.asList("C1", "C2"));

        java.util.Map<String, Object> out = service.deletePack(USER, WS, "CS1");

        assertEquals(2, out.get("deleted"));
        verify(caseService).delete(USER, WS, "C1");
        verify(caseService).delete(USER, WS, "C2");
        verify(setMapper).deleteMembersBySet("CS1");
        verify(setMapper).deleteItemsBySet("CS1");
        verify(setMapper).delete(WS, "CS1");
        verify(auditService).recordCurrent(eq(WS), eq("case_set_pack_delete"), eq("case_set"),
                eq("CS1"), any(), eq(true), anyString(), any());
    }

    @Test
    void ordinaryDeleteStillKeepsCases() {
        when(setMapper.selectCaseIds("CS2")).thenReturn(Collections.singletonList("C9"));
        service.delete(USER, WS, "CS2");
        verify(caseService, never()).delete(anyString(), anyString(), anyString());
        verify(setMapper).deleteItemsBySet("CS2");
    }
}
