package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/**
 * 个人工作台需求队列条件：我发起的 / 我关注的 / 待我评审。
 *
 * <p>三种视图共用同一套可见性过滤（viewerId），只改变个人关系谓词；
 * total 与列表使用同一 WHERE，避免计数与已加载行不一致。
 */
@Data
public class MyDemandQuery {

    private String workspaceId;
    private String userId;
    /** 提交人显示名：created_by 历史数据可能存的是显示名而不是账号 ID */
    private String displayName;
    /** created / watch / review */
    private String view;
    /** 状态筛选（仅 created 视图的状态 chips）；null = 全部 */
    private String status;
    private String q;
    private List<String> pris = new ArrayList<String>();
    private List<String> reqs = new ArrayList<String>();
    /** updated（默认）/ created / priority / expect */
    private String sort = "updated";
    private int offset;
    private int limit = 20;
    /** 项目可见范围：null 表示不过滤（owner/admin/viewer） */
    private String viewerId;
    /** 只统计“仅显示名匹配”的条数，用于 matchedByNameOnly 提示 */
    private boolean nameOnlyCount;

    public boolean isCreatedView() {
        return "created".equals(view);
    }

    public boolean isWatchView() {
        return "watch".equals(view);
    }

    public boolean isReviewView() {
        return "review".equals(view);
    }

    /** 搜索词里的需求编号（DM-001 / dm1 / 纯数字）；不是编号形态返回 null，走文本匹配 */
    public Integer getItemNo() {
        return com.hourglass.common.Nos.parseDemand(q);
    }
}
