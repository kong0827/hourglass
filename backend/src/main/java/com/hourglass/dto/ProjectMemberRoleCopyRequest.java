package com.hourglass.dto;

import lombok.Data;

@Data
public class ProjectMemberRoleCopyRequest {
    private String sourceProjectId;
    private boolean overwrite;
}
