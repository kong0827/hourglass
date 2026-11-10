package com.hourglass.dto;

import lombok.Data;

import java.util.List;

/** 生成邀请链接：可附带项目预分配（access 只接受 write/read，未列出的项目默认不可见） */
@Data
public class InviteCreateRequest {

    private List<Grant> grants;

    @Data
    public static class Grant {
        private String projectId;
        private String access;
    }
}
