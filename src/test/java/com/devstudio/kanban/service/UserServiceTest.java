package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.dto.UserUpdateRequest;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.mapper.ProjectMemberMapper;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.mapper.WorkspaceMapper;
import com.devstudio.kanban.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.password.PasswordEncoder;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class UserServiceTest {

    private final UserMapper users = mock(UserMapper.class);
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final UserService service = new UserService(users,
            mock(WorkspaceMapper.class), mock(WorkspaceMemberMapper.class),
            mock(ProjectMemberMapper.class), tasks,
            mock(com.devstudio.kanban.mapper.TaskWatchMapper.class),
            mock(RequirementMapper.class),
            mock(com.devstudio.kanban.mapper.DevBranchMapper.class),
            mock(com.devstudio.kanban.mapper.RequirementDocMapper.class),
            mock(WorkspaceService.class), mock(PasswordEncoder.class),
            mock(WorkspaceMemberCache.class), mock(SessionEpochService.class));

    @Test
    void loginFallsBackToEmailWhenUsernameMisses() {
        AppUser u = user("U1", "alice", "alice@corp.com");
        when(users.selectByUsername("alice")).thenReturn(u);
        when(users.selectByUsername("alice@corp.com")).thenReturn(null);
        when(users.selectByEmail("alice@corp.com")).thenReturn(u);

        assertEquals("U1", ((com.devstudio.kanban.common.LoginUser) service.loadUserByUsername("alice")).getId());
        UserDetails byEmail = service.loadUserByUsername("alice@corp.com");
        assertEquals("alice", byEmail.getUsername(), "邮箱登录时 UserDetails 仍以登录名为准");

        when(users.selectByEmail("ghost@corp.com")).thenReturn(null);
        assertThrows(UsernameNotFoundException.class, () -> service.loadUserByUsername("ghost@corp.com"));
    }

    @Test
    void updateRejectsEmailAlreadyUsedByAnotherAccount() {
        when(users.selectById("U1")).thenReturn(user("U1", "alice", null));
        when(users.countByEmail("bob@corp.com", "U1")).thenReturn(1);

        UserUpdateRequest req = new UserUpdateRequest();
        req.setDisplayName("Alice");
        req.setEmail("bob@corp.com");

        AppException ex = assertThrows(AppException.class, () -> service.update("U1", req));
        assertEquals("该邮箱已被其他账号使用：bob@corp.com", ex.getMessage());
        verify(users, never()).update(any(AppUser.class));
    }

    @Test
    void updateKeepsOwnEmailAndClearsWhenEmpty() {
        when(users.selectById("U1")).thenReturn(user("U1", "alice", "alice@corp.com"));
        when(users.countByEmail("alice@corp.com", "U1")).thenReturn(0);
        when(users.selectById("U1")).thenReturn(user("U1", "alice", "alice@corp.com"));

        UserUpdateRequest keep = new UserUpdateRequest();
        keep.setDisplayName("Alice");
        keep.setEmail("alice@corp.com");
        service.update("U1", keep);
        verify(users).update(any(AppUser.class));

        org.mockito.Mockito.clearInvocations(users);
        UserUpdateRequest clear = new UserUpdateRequest();
        clear.setDisplayName("Alice");
        clear.setEmail("  ");
        service.update("U1", clear);
        verify(users).update(any(AppUser.class));
    }

    private AppUser user(String id, String username, String email) {
        AppUser u = new AppUser();
        u.setId(id);
        u.setUsername(username);
        u.setDisplayName(username);
        u.setPasswordHash("$2a$10$hashhashhashhashhashhashhashhashhashhashhash");
        u.setEmail(email);
        u.setRole("user");
        return u;
    }
}
