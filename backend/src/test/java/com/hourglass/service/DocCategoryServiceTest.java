package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.DocCategoryNode;
import com.hourglass.dto.DocCategorySaveRequest;
import com.hourglass.dto.DocCategoryVisibilityRequest;
import com.hourglass.entity.DocCategory;
import com.hourglass.mapper.DocCategoryMapper;
import com.hourglass.mapper.RequirementMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 分类默认可见范围：只是新建文档时的默认值，不参与可见判定。
 * 覆盖默认名单校验、改默认的门控与落库、改名不丢默认、名单只回传给可写该范围的人。
 */
class DocCategoryServiceTest {

    private static final String WS = "W1";
    private static final String CAT = "DC1";
    private static final String ME = "U1";
    private static final String MEMBER = "U2";

    private final DocCategoryMapper categoryMapper = mock(DocCategoryMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final AuditService audit = mock(AuditService.class);
    private final DocCategoryService service = new DocCategoryService(categoryMapper,
            mock(RequirementMapper.class), access, audit);

    @Test
    void createStoresDedupedMemberDefaults() {
        when(access.canManage(WS, ME)).thenReturn(true);
        when(access.canView(WS, MEMBER, null)).thenReturn(true);
        when(categoryMapper.selectByScope(WS, "")).thenReturn(Collections.<DocCategory>emptyList());

        service.create(ME, WS, save("研发文档", "", "members", Arrays.asList(MEMBER, MEMBER)));

        DocCategory saved = captureInsert();
        assertEquals("members", saved.getVisibility());
        assertEquals(MEMBER, saved.getMemberIds());
    }

    @Test
    void createDefaultsToTeamWhenVisibilityOmitted() {
        when(access.canManage(WS, ME)).thenReturn(true);
        when(categoryMapper.selectByScope(WS, "")).thenReturn(Collections.<DocCategory>emptyList());

        service.create(ME, WS, save("研发文档", "", null, null));

        DocCategory saved = captureInsert();
        assertEquals("team", saved.getVisibility());
        assertEquals("", saved.getMemberIds());
    }

    @Test
    void createMembersRequiresAtLeastOnePerson() {
        when(access.canManage(WS, ME)).thenReturn(true);
        when(categoryMapper.selectByScope(WS, "")).thenReturn(Collections.<DocCategory>emptyList());

        AppException ex = assertThrows(AppException.class,
                () -> service.create(ME, WS, save("研发文档", "", "members", Collections.<String>emptyList())));
        assertEquals(400, ex.getCode());
        verify(categoryMapper, never()).insert(any(DocCategory.class));
    }

    @Test
    void createMembersRejectsPeopleWhoCannotSeeScope() {
        when(access.canManage(WS, ME)).thenReturn(true);
        when(access.canView(WS, MEMBER, null)).thenReturn(false);
        when(categoryMapper.selectByScope(WS, "")).thenReturn(Collections.<DocCategory>emptyList());

        AppException ex = assertThrows(AppException.class,
                () -> service.create(ME, WS, save("研发文档", "", "members", Collections.singletonList(MEMBER))));
        assertEquals(400, ex.getCode());
    }

    @Test
    void createRejectsMembersOnTeamVisibility() {
        when(access.canManage(WS, ME)).thenReturn(true);
        when(categoryMapper.selectByScope(WS, "")).thenReturn(Collections.<DocCategory>emptyList());

        AppException ex = assertThrows(AppException.class,
                () -> service.create(ME, WS, save("研发文档", "", "team", Collections.singletonList(MEMBER))));
        assertEquals(400, ex.getCode());
    }

    @Test
    void changeVisibilityRequiresCategoryManager() {
        when(categoryMapper.selectById(CAT)).thenReturn(category("team", ""));
        when(access.canManage(WS, ME)).thenReturn(false);

        AppException ex = assertThrows(AppException.class,
                () -> service.changeVisibility(ME, WS, CAT, visibility("members", Collections.singletonList(MEMBER))));
        assertEquals(403, ex.getCode());
        verify(categoryMapper, never()).update(any(DocCategory.class));
    }

    @Test
    void changeVisibilityPersistsDefaultsAndAudits() {
        when(categoryMapper.selectById(CAT)).thenReturn(category("team", ""));
        when(access.canManage(WS, ME)).thenReturn(true);
        when(access.canView(WS, MEMBER, null)).thenReturn(true);

        service.changeVisibility(ME, WS, CAT, visibility("members", Collections.singletonList(MEMBER)));

        ArgumentCaptor<DocCategory> captor = ArgumentCaptor.forClass(DocCategory.class);
        verify(categoryMapper).update(captor.capture());
        assertEquals("members", captor.getValue().getVisibility());
        assertEquals(MEMBER, captor.getValue().getMemberIds());
        verify(audit).recordCurrent(eq(WS), eq("doc_category_update"), eq("doc_category"), eq(CAT), anyString(),
                eq(true), eq("分类「研发文档」默认可见范围：团队共享 → 指定成员可见"), eq(null));
    }

    @Test
    void changeVisibilityBackToTeamClearsMembers() {
        when(categoryMapper.selectById(CAT)).thenReturn(category("members", MEMBER));
        when(access.canManage(WS, ME)).thenReturn(true);

        service.changeVisibility(ME, WS, CAT, visibility("team", null));

        ArgumentCaptor<DocCategory> captor = ArgumentCaptor.forClass(DocCategory.class);
        verify(categoryMapper).update(captor.capture());
        assertEquals("team", captor.getValue().getVisibility());
        assertEquals("", captor.getValue().getMemberIds());
    }

    @Test
    void renameKeepsExistingDefaults() {
        when(categoryMapper.selectById(CAT)).thenReturn(category("members", MEMBER));
        when(access.canManage(WS, ME)).thenReturn(true);

        service.update(ME, WS, CAT, save("新名字", "", null, null));

        ArgumentCaptor<DocCategory> captor = ArgumentCaptor.forClass(DocCategory.class);
        verify(categoryMapper).update(captor.capture());
        assertEquals("新名字", captor.getValue().getName());
        assertEquals("members", captor.getValue().getVisibility());
        assertEquals(MEMBER, captor.getValue().getMemberIds());
    }

    @Test
    void memberIdsOnlyReturnedToWriters() {
        DocCategory c = category("members", MEMBER);
        when(categoryMapper.selectByScope(WS, "")).thenReturn(Collections.singletonList(c));

        when(access.canWrite(WS, ME, null)).thenReturn(false);
        DocCategoryNode readOnly = service.tree(WS, ME, "").get(0);
        assertEquals("members", readOnly.getVisibility());
        assertEquals(1, readOnly.getMemberCount());
        assertNull(readOnly.getMemberIds(), "只读成员只给人数，不回传名单");

        when(access.canWrite(WS, ME, null)).thenReturn(true);
        List<DocCategoryNode> again = service.tree(WS, ME, "");
        assertEquals(Collections.singletonList(MEMBER), again.get(0).getMemberIds());
    }

    @Test
    void staleMemberMovingOutOfScopeIsRejectedOnChange() {
        when(categoryMapper.selectById(CAT)).thenReturn(category("team", ""));
        when(access.canManage(WS, ME)).thenReturn(true);
        when(access.canView(WS, MEMBER, null)).thenReturn(false);

        AppException ex = assertThrows(AppException.class,
                () -> service.changeVisibility(ME, WS, CAT, visibility("members", Collections.singletonList(MEMBER))));
        assertEquals(400, ex.getCode());
        assertTrue(ex.getMessage().contains("看不到该范围"));
        verify(categoryMapper, never()).update(any(DocCategory.class));
    }

    private DocCategory captureInsert() {
        ArgumentCaptor<DocCategory> captor = ArgumentCaptor.forClass(DocCategory.class);
        verify(categoryMapper).insert(captor.capture());
        return captor.getValue();
    }

    private DocCategory category(String visibility, String memberIds) {
        DocCategory c = new DocCategory();
        c.setId(CAT);
        c.setWorkspaceId(WS);
        c.setReqId("");
        c.setParentId("");
        c.setName("研发文档");
        c.setVisibility(visibility);
        c.setMemberIds(memberIds);
        c.setSortOrder(0);
        return c;
    }

    private DocCategorySaveRequest save(String name, String reqId, String visibility, List<String> memberIds) {
        DocCategorySaveRequest req = new DocCategorySaveRequest();
        req.setName(name);
        req.setReqId(reqId);
        req.setVisibility(visibility);
        req.setMemberIds(memberIds);
        return req;
    }

    private DocCategoryVisibilityRequest visibility(String visibility, List<String> memberIds) {
        DocCategoryVisibilityRequest req = new DocCategoryVisibilityRequest();
        req.setVisibility(visibility);
        req.setMemberIds(memberIds);
        return req;
    }
}
