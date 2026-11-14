package com.hourglass.dto;

import lombok.Data;

/** 批量判定逐条结果：ok=false 时 message 说明原因，其余条目继续处理。 */
@Data
public class BranchOutcomeResult {

    private String id;
    private String name;
    private boolean ok;
    private String message;
    private String outcome;

    public static BranchOutcomeResult ok(String id, String name, String outcome) {
        BranchOutcomeResult r = new BranchOutcomeResult();
        r.setId(id);
        r.setName(name);
        r.setOk(true);
        r.setOutcome(outcome);
        return r;
    }

    public static BranchOutcomeResult fail(String id, String name, String message) {
        BranchOutcomeResult r = new BranchOutcomeResult();
        r.setId(id);
        r.setName(name);
        r.setMessage(message);
        return r;
    }
}
