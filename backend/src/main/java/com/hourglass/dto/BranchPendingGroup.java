package com.hourglass.dto;

import com.hourglass.entity.DevBranch;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/** 待确认分支按仓库分组；repoId 为空表示已解绑仓库/人工冲突项。 */
@Data
public class BranchPendingGroup {

    private String repoId;
    private String repoName;
    private String repoUrl;
    private String reqId;
    private String reqName;
    private int count;
    private List<DevBranch> items = new ArrayList<DevBranch>();

    public void add(DevBranch branch) {
        items.add(branch);
        count = items.size();
    }
}
