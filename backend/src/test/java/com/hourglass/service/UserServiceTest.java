package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.UserUpdateRequest;
import com.hourglass.entity.AppUser;
import com.hourglass.mapper.ProjectMemberMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
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
            mock(com.hourglass.mapper.TaskWatchMapper.class),
            mock(RequirementMapper.class),
            mock(com.hourglass.mapper.DevBranchMapper.class),
            mock(com.hourglass.mapper.RequirementDocMapper.class),
            mock(WorkspaceService.class), mock(PasswordEncoder.class),
            mock(WorkspaceMemberCache.class), mock(SessionEpochService.class));

    @Test
    void loginFallsBackToEmailWhenUsernameMisses() {
        AppUser u = user("U1", "alice", "alice@corp.com");
        when(users.selectByUsername("alice")).thenReturn(u);
        when(users.selectByUsername("alice@corp.com")).thenReturn(null);
        when(users.selectByEmail("alice@corp.com")).thenReturn(u);

        assertEquals("U1", ((com.hourglass.common.LoginUser) service.loadUserByUsername("alice")).getId());
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
