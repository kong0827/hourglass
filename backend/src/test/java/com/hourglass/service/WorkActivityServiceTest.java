package com.hourglass.service;

import com.hourglass.entity.AppUser;
import com.hourglass.entity.WorkActivity;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkActivityMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WorkActivityServiceTest {

    private WorkActivityMapper activityMapper;
    private UserMapper userMapper;
    private WorkActivityService service;

    @BeforeEach
    void setUp() {
        activityMapper = mock(WorkActivityMapper.class);
        userMapper = mock(UserMapper.class);
        service = new WorkActivityService(activityMapper, userMapper);
    }

    @Test
    void recordStoresActorNameSnapshotAndCutsLongValues() {
        AppUser actor = new AppUser();
        actor.setId("U1");
        actor.setDisplayName(repeat('名', 70));
        when(userMapper.selectById("U1")).thenReturn(actor);

        service.record("W1", WorkActivityService.PROJECT, "R1", "U1", "update", repeat('详', 1005));

        ArgumentCaptor<WorkActivity> captor = ArgumentCaptor.forClass(WorkActivity.class);
        verify(activityMapper).insert(captor.capture());
        WorkActivity saved = captor.getValue();
        assertEquals("W1", saved.getWorkspaceId());
        assertEquals(WorkActivityService.PROJECT, saved.getEntityType());
        assertEquals("R1", saved.getEntityId());
        assertEquals("U1", saved.getActorId());
        assertEquals(64, saved.getActorName().length());
        assertEquals(1000, saved.getDetail().length());
        assertEquals("update", saved.getAction());
    }

    @Test
    void listByEntityUsesFixedDescendingLimit() {
        List<WorkActivity> expected = Collections.singletonList(new WorkActivity());
        when(activityMapper.selectByEntity("W1", WorkActivityService.REQUIREMENT_DOC, "D1", 200))
                .thenReturn(expected);

        List<WorkActivity> actual = service.listByEntity("W1", WorkActivityService.REQUIREMENT_DOC, "D1");

        assertSame(expected, actual);
        verify(activityMapper).selectByEntity("W1", WorkActivityService.REQUIREMENT_DOC, "D1", 200);
    }

    private static String repeat(char value, int count) {
        StringBuilder out = new StringBuilder(count);
        for (int i = 0; i < count; i++) {
            out.append(value);
        }
        return out.toString();
    }
}
