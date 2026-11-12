package com.hourglass.dto;

import lombok.Data;
import lombok.EqualsAndHashCode;
import java.util.List;

@Data
@EqualsAndHashCode(callSuper = true)
public class ProjectMemberRoleBatchRequest extends ProjectMemberRoleRequest {
    private List<String> userIds;
}
