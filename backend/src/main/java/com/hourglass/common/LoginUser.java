package com.hourglass.common;

import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.User;

import java.util.Collections;
import java.util.Locale;

/**
 * 登录态主体：携带用户 ID / 显示名 / 角色，供 CurrentUser 读取
 */
public class LoginUser extends User {

    private static final long serialVersionUID = 1L;

    private final String id;
    private final String displayName;
    private final String role;

    public LoginUser(String id, String username, String passwordHash, String displayName, String role) {
        super(username, passwordHash,
                Collections.singletonList(new SimpleGrantedAuthority("ROLE_" + role.toUpperCase(Locale.ROOT))));
        this.id = id;
        this.displayName = displayName;
        this.role = role;
    }

    public String getId() {
        return id;
    }

    public String getDisplayName() {
        return displayName;
    }

    /** admin/user */
    public String getRole() {
        return role;
    }
}
