package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.LoginUser;
import com.hourglass.entity.CaseSet;
import com.hourglass.entity.Requirement;
import com.hourglass.mapper.AttachmentMapper;
import com.hourglass.mapper.CaseSetMapper;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.TestCaseMapper;
import com.hourglass.mapper.TestCaseRunMapper;
import com.hourglass.mapper.TestCaseTaskMapper;
import com.hourglass.mapper.TestPlanCaseMapper;
import com.hourglass.mapper.TestPlanMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 示例用例包：20 条合成用例 + pack 分组一个事务落库；一项目一个示例包的去重守卫。 */
class TestCaseServiceSamplePackTest {

    private static final String WS = "W1";
    private static final String PROJECT = "R1";
    private static final String USER = "U1";

    private final TestCaseMapper caseMapper = mock(TestCaseMapper.class);
    private final RequirementMapper reqMapper = mock(RequirementMapper.class);
    private final CaseSetMapper setMapper = mock(CaseSetMapper.class);
    private final TestModuleService moduleService = mock(TestModuleService.class);
    private final NumberSeqService numberSeq = mock(NumberSeqService.class);
    private final TestCaseService service = new TestCaseService(
            caseMapper,
            mock(TestCaseRunMapper.class),
            mock(TaskCommandService.class),
            mock(ProjectAccessService.class),
            reqMapper,
            mock(DemandMapper.class),
            mock(com.hourglass.mapper.TestModuleMapper.class),
            mock(AttachmentMapper.class),
            mock(AttachmentService.class),
            mock(TestPlanMapper.class),
            mock(TestPlanCaseMapper.class),
            mock(AuditService.class),
            numberSeq,
            mock(TestCaseTaskMapper.class),
            mock(TaskMapper.class),
            mock(WorkspaceMemberMapper.class),
            moduleService,
            setMapper,
            mock(DemandCompletionService.class));

    @BeforeEach
    void setUp() {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                new LoginUser(USER, "u1", "x", "测试员", "user"), null,
                Collections.singletonList(new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_USER"))));
        Requirement project = new Requirement();
        project.setId(PROJECT);
        project.setWorkspaceId(WS);
        project.setName("示例项目");
        when(reqMapper.selectById(PROJECT)).thenReturn(project);
        when(caseMapper.maxSortOrder(WS, PROJECT)).thenReturn(0);
        when(numberSeq.nextCase(eq(WS), eq(PROJECT))).thenAnswer(inv -> ++counter);
        when(caseMapper.insert(any())).thenReturn(1);
        when(setMapper.maxSortOrder(WS, PROJECT, "")).thenReturn(0);
        when(setMapper.insertItems(anyString(), anyString(), any(), anyString())).thenReturn(20);
    }

    private int counter;

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void samplePackCreatesTwentyCasesAndPackGroup() {
        when(setMapper.selectByReqAll(WS, PROJECT)).thenReturn(new ArrayList<CaseSet>());

        Map<String, Object> out = service.samplePack(USER, WS, PROJECT);

        assertEquals(20, out.get("caseCount"));
        assertTrue(out.get("groupId") != null);
        /* 20 条用例全部插入，标题带「（示例）」后缀，编号连续取号 */
        ArgumentCaptor<com.hourglass.entity.TestCase> saved = ArgumentCaptor.forClass(com.hourglass.entity.TestCase.class);
        verify(caseMapper, org.mockito.Mockito.times(20)).insert(saved.capture());
        assertTrue(saved.getAllValues().stream().allMatch(c -> c.getTitle().endsWith("（示例）")));
        assertEquals(1, saved.getAllValues().get(0).getCaseNo().intValue());
        assertEquals(20, saved.getAllValues().get(19).getCaseNo().intValue());
        /* 分组：pack=1、团队可见、手工分组、固定名 */
        ArgumentCaptor<CaseSet> group = ArgumentCaptor.forClass(CaseSet.class);
        verify(setMapper).insert(group.capture());
        assertEquals(Integer.valueOf(1), group.getValue().getPack());
        assertEquals(CaseSetService.VIS_TEAM, group.getValue().getVisibility());
        assertEquals(CaseSetService.KIND_MANUAL, group.getValue().getKind());
        assertEquals(TestCaseService.PACK_GROUP_NAME, group.getValue().getName());
        /* 20 条全部挂进分组 */
        ArgumentCaptor<List<String>> members = ArgumentCaptor.forClass(List.class);
        verify(setMapper).insertItems(eq(WS), eq(group.getValue().getId()), members.capture(), eq(USER));
        assertEquals(20, members.getValue().size());
    }

    @Test
    void samplePackRejectsSecondPackInSameProject() {
        CaseSet existing = new CaseSet();
        existing.setId("CS9");
        existing.setPack(1);
        when(setMapper.selectByReqAll(WS, PROJECT)).thenReturn(Collections.singletonList(existing));

        AppException e = assertThrows(AppException.class, () -> service.samplePack(USER, WS, PROJECT));
        assertTrue(e.getMessage().contains("已有示例用例包"));
        verify(caseMapper, never()).insert(any());
        verify(setMapper, never()).insert(any(CaseSet.class));
    }
}
